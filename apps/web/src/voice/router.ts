import { ADVICE_ACTIONS, ADVICE_SCHEMA, ADVICE_SYSTEM, type Advice, type AdviceAction } from '@crewstrike/shared';
import { actionLabel, validateReason } from '@crewstrike/nl';
import { api } from '../net/api';

export type Tier = 'device' | 'edge' | 'template';

interface LanguageModelSession {
  prompt(input: string, opts?: { responseConstraint?: unknown; signal?: AbortSignal }): Promise<string>;
}
interface LanguageModelApi {
  availability(): Promise<string>;
  create(opts: { initialPrompts: { role: string; content: string }[] }): Promise<LanguageModelSession>;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>(r => setTimeout(() => r(null), ms))]);
}

/**
 * Inference tiers for phrasing a strategic verdict: on-device model (Chrome built-in AI) first,
 * then the Workers AI free pool, then the template. The verdict never changes; the reason is
 * validated against the facts before it is shown.
 */
export class PhraseRouter {
  private device: LanguageModelSession | null = null;
  private deviceChecked = false;
  session: string | null = null;
  lastTier: Tier = 'template';
  edgeDown = false;

  private async deviceSession(): Promise<LanguageModelSession | null> {
    if (this.deviceChecked) return this.device;
    this.deviceChecked = true;
    const lm = (globalThis as { LanguageModel?: LanguageModelApi }).LanguageModel;
    if (!lm) return null;
    try {
      if ((await withTimeout(lm.availability(), 800)) !== 'available') return null;
      this.device = await withTimeout(lm.create({ initialPrompts: [{ role: 'system', content: ADVICE_SYSTEM }] }), 2000);
    } catch {
      this.device = null;
    }
    return this.device;
  }

  async hasDevice(): Promise<boolean> {
    return (await this.deviceSession()) !== null;
  }

  private finish(a: Advice, reason: string, action: unknown, tier: Tier): Advice {
    if (!validateReason(reason, a.verdict, a.facts).ok) {
      this.lastTier = 'template';
      return a;
    }
    let act: AdviceAction = a.action;
    if (act === 'none' && ADVICE_ACTIONS.includes(action as AdviceAction)) act = action as AdviceAction;
    if (a.verdict === 'ABORT') act = 'route_exit';
    this.lastTier = tier;
    return { ...a, reason, action: act, actionLabel: actionLabel(act, String(a.facts.route ?? 'north')), source: tier === 'device' ? 'device' : 'edge' };
  }

  async phrase(a: Advice): Promise<Advice> {
    const dev = await this.deviceSession();
    if (dev) {
      try {
        const out = await withTimeout(dev.prompt(JSON.stringify({ verdict: a.verdict, facts: a.facts }), { responseConstraint: ADVICE_SCHEMA }), 1500);
        if (out) {
          const parsed = JSON.parse(out) as { reason?: string; action?: string };
          if (typeof parsed.reason === 'string') return this.finish(a, parsed.reason.trim(), parsed.action, 'device');
        }
      } catch {
        // fall through to the edge
      }
    }
    if (!this.session) {
      this.lastTier = 'template';
      return a;
    }
    const r = await api.advice({ session: this.session, verdict: a.verdict, kind: a.kind, facts: a.facts });
    if (r.status === 200 && r.data && typeof r.data.reason === 'string') {
      this.edgeDown = false;
      return this.finish(a, r.data.reason.trim(), r.data.action, 'edge');
    }
    if (r.status === 0) this.edgeDown = true;
    this.lastTier = 'template';
    return a;
  }
}

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

/** Push-to-talk: browser SpeechRecognition, or a short recording sent to Whisper on the edge. */
export class PushToTalk {
  private rec: RecognitionLike | null = null;
  private media: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private result: string | null = null;
  private resolve: ((t: string | null) => void) | null = null;
  active = false;

  constructor(private session: () => string | null) {}

  private recognitionCtor(): (new () => RecognitionLike) | null {
    const w = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike };
    return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
  }

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    this.result = null;
    const Ctor = this.recognitionCtor();
    if (Ctor) {
      try {
        const rec = new Ctor();
        rec.lang = 'en-US';
        rec.interimResults = false;
        rec.maxAlternatives = 1;
        rec.onresult = e => {
          this.result = e.results[0]?.[0]?.transcript ?? null;
        };
        rec.onerror = () => undefined;
        rec.onend = () => {
          this.resolve?.(this.result);
          this.resolve = null;
        };
        rec.start();
        this.rec = rec;
        return;
      } catch {
        this.rec = null;
      }
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.chunks = [];
      this.media = new MediaRecorder(stream);
      this.media.ondataavailable = e => this.chunks.push(e.data);
      this.startedAt = performance.now();
      this.media.start();
      // Clips are capped at 6 seconds.
      setTimeout(() => {
        if (this.media?.state === 'recording') this.media.stop();
      }, 6000);
    } catch {
      this.active = false;
    }
  }

  /** Stop listening and resolve the transcript (null if nothing was heard). */
  stop(): Promise<string | null> {
    if (!this.active) return Promise.resolve(null);
    this.active = false;
    if (this.rec) {
      const rec = this.rec;
      this.rec = null;
      return new Promise(res => {
        this.resolve = res;
        rec.stop();
        setTimeout(() => {
          if (this.resolve) {
            this.resolve(this.result);
            this.resolve = null;
          }
        }, 1500);
      });
    }
    const media = this.media;
    if (!media) return Promise.resolve(null);
    this.media = null;
    return new Promise(res => {
      media.onstop = async () => {
        media.stream.getTracks().forEach(t => t.stop());
        const session = this.session();
        if (!session || this.chunks.length === 0) return res(null);
        const blob = new Blob(this.chunks, { type: media.mimeType || 'audio/webm' });
        const seconds = (performance.now() - this.startedAt) / 1000;
        res(await api.stt(session, blob, Math.min(6, seconds)));
      };
      if (media.state === 'recording') media.stop();
      else media.onstop?.(new Event('stop'));
    });
  }
}
