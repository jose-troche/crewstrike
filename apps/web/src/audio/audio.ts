import type { Level, VoiceMode } from '@crewstrike/shared';
import { CLIP_IDS, CLIPS } from '@crewstrike/agents';

export interface VoiceLogEntry {
  kind: 'clip' | 'speech';
  id: string;
  text: string;
  at: number;
}

type Tone = 'none' | 'seeking' | 'locked' | 'tracking' | 'launch';

/**
 * Web Audio for effects and critical clips (instant), speechSynthesis for non-critical lines.
 * Effects are synthesized so nothing but the short voice clips is downloaded.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private clips = new Map<string, AudioBuffer>();
  private loading = false;
  private engine: { osc: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private cannonTimer = 0;
  private tone: Tone = 'none';
  private toneTimer = 0;
  private lastClipAt = 0;
  readonly log: VoiceLogEntry[] = [];
  voice: VoiceMode = 'critical';
  muted = false;

  /** Browsers block audio until a user gesture; call from the first click or key. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(this.ctx.destination);
      this.sfx = this.ctx.createGain();
      this.sfx.gain.value = 0.5;
      this.sfx.connect(this.master);
      void this.loadClips();
    } catch {
      this.ctx = null;
    }
  }

  private async loadClips(): Promise<void> {
    if (this.loading || !this.ctx) return;
    this.loading = true;
    const ctx = this.ctx;
    await Promise.all(
      CLIP_IDS.map(async id => {
        try {
          const res = await fetch(`/audio/${id}.mp3`);
          if (!res.ok) return;
          const buf = await ctx.decodeAudioData(await res.arrayBuffer());
          this.clips.set(id, buf);
        } catch {
          // clip missing: speech synthesis covers it
        }
      }),
    );
  }

  private noiseBuffer(seconds: number): AudioBuffer | null {
    if (!this.ctx) return null;
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  private burst(seconds: number, freq: number, gain: number, q = 0.8, type: BiquadFilterType = 'lowpass'): void {
    if (!this.ctx || !this.sfx || this.muted) return;
    const src = this.ctx.createBufferSource();
    const buf = this.noiseBuffer(seconds);
    if (!buf) return;
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + seconds);
    src.connect(f).connect(g).connect(this.sfx);
    src.start();
  }

  private beep(freq: number, dur: number, gain = 0.12, type: OscillatorType = 'square', endFreq?: number): void {
    if (!this.ctx || !this.sfx || this.muted) return;
    const o = this.ctx.createOscillator();
    o.type = type;
    const t = this.ctx.currentTime;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start();
    o.stop(t + dur + 0.02);
  }

  explosion(big = false): void {
    this.burst(big ? 1.6 : 0.8, big ? 400 : 700, big ? 0.9 : 0.6);
  }
  missileLaunch(): void {
    this.burst(0.9, 1800, 0.35, 0.6, 'bandpass');
  }
  flare(): void {
    this.beep(900, 0.08, 0.08, 'triangle', 300);
    this.burst(0.25, 3000, 0.2, 0.5, 'highpass');
  }
  hit(): void {
    this.burst(0.25, 1200, 0.5, 1.5, 'bandpass');
  }
  click(): void {
    this.beep(1200, 0.04, 0.05, 'sine');
  }
  ringPass(): void {
    this.beep(660, 0.12, 0.1, 'sine', 990);
  }

  /** Called every frame while the cannon trigger is held. */
  cannon(firing: boolean, now: number): void {
    if (!firing || now < this.cannonTimer) return;
    this.cannonTimer = now + 55;
    this.burst(0.06, 2400, 0.22, 1, 'bandpass');
  }

  /** Lock and threat tones: seeking beeps, locked steady tone, tracking pulse, launch fast warble. */
  setTone(t: Tone, now: number): void {
    if (t !== this.tone) {
      this.tone = t;
      this.toneTimer = 0;
    }
    if (t === 'none' || now < this.toneTimer) return;
    switch (t) {
      case 'seeking':
        this.beep(880, 0.06, 0.05, 'sine');
        this.toneTimer = now + 220;
        break;
      case 'locked':
        this.beep(1320, 0.18, 0.06, 'sine');
        this.toneTimer = now + 180;
        break;
      case 'tracking':
        this.beep(520, 0.12, 0.06, 'sawtooth', 700);
        this.toneTimer = now + 700;
        break;
      case 'launch':
        this.beep(1500, 0.08, 0.09, 'square', 1100);
        this.toneTimer = now + 140;
        break;
    }
  }

  engineHum(speed: number, boost: boolean): void {
    if (!this.ctx || !this.master) return;
    if (!this.engine) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 300;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      osc.connect(filter).connect(gain).connect(this.master);
      osc.start();
      this.engine = { osc, gain, filter };
    }
    const t = this.ctx.currentTime;
    this.engine.osc.frequency.setTargetAtTime(40 + speed * 0.12 + (boost ? 25 : 0), t, 0.2);
    this.engine.filter.frequency.setTargetAtTime(boost ? 900 : 300 + speed, t, 0.2);
    this.engine.gain.gain.setTargetAtTime(this.muted ? 0 : boost ? 0.07 : 0.035, t, 0.3);
  }

  silenceEngine(): void {
    if (this.engine && this.ctx) this.engine.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
    this.tone = 'none';
  }

  /** Speak a console line by voice mode: critical uses a pre-rendered clip; All also speaks other lines. */
  say(line: { text: string; level: Level; clip?: string }): void {
    if (this.voice === 'off') return;
    const critical = line.level === 'red' || line.level === 'amber';
    if (line.clip && critical) {
      this.playClip(line.clip, line.level === 'red');
      return;
    }
    if (this.voice === 'all') this.speak(line.text, line.level === 'red');
  }

  playClip(id: string, urgent: boolean): void {
    const now = performance.now();
    if (!urgent && now - this.lastClipAt < 900) return;
    this.lastClipAt = now;
    const text = (CLIPS as Record<string, string>)[id] ?? id;
    this.log.push({ kind: 'clip', id, text, at: now });
    if (this.log.length > 50) this.log.shift();
    if (urgent && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    const buf = this.clips.get(id);
    if (buf && this.ctx && this.master && !this.muted) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = 1.2;
      src.connect(g).connect(this.master);
      src.start();
      return;
    }
    this.speak(text, urgent, false);
  }

  speak(text: string, urgent: boolean, log = true): void {
    if (log) {
      this.log.push({ kind: 'speech', id: '', text, at: performance.now() });
      if (this.log.length > 50) this.log.shift();
    }
    if (this.muted || typeof speechSynthesis === 'undefined') return;
    try {
      if (urgent) speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.1;
      speechSynthesis.speak(u);
    } catch {
      // speech unavailable
    }
  }
}
