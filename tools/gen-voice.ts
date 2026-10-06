/**
 * Renders the ~30 critical voice clips once and writes them to apps/web/public/audio/*.mp3.
 *
 * Uses MeloTTS on Workers AI through wrangler's platform proxy (your `wrangler login`), which costs
 * well under 20 neurons for the whole set. With --local, or if Workers AI is unavailable, it falls back
 * to the macOS `say` voice encoded with `lame`.
 *
 *   pnpm gen:voice          # Workers AI, fallback to say
 *   pnpm gen:voice --local  # macOS say only
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CLIPS } from '../packages/agents/src/clips';

const root = resolve(import.meta.dirname, '..');
const outDir = join(root, 'apps/web/public/audio');
const local = process.argv.includes('--local');

type AiRunner = { run(model: string, input: Record<string, unknown>): Promise<unknown> };

async function remoteAi(): Promise<{ ai: AiRunner; dispose(): Promise<void> } | null> {
  try {
    const { getPlatformProxy } = await import('wrangler');
    const proxy = await getPlatformProxy<{ AI: AiRunner }>({ configPath: join(root, 'apps/edge/wrangler.jsonc'), remoteBindings: true });
    return { ai: proxy.env.AI, dispose: () => proxy.dispose() };
  } catch (e) {
    console.warn('Workers AI proxy unavailable:', (e as Error).message);
    return null;
  }
}

async function melo(ai: AiRunner, text: string): Promise<Buffer | null> {
  try {
    const out = (await ai.run('@cf/myshell-ai/melotts', { prompt: text, lang: 'en' })) as { audio?: string } | null;
    return out?.audio ? Buffer.from(out.audio, 'base64') : null;
  } catch (e) {
    console.warn(`MeloTTS failed for "${text}":`, (e as Error).message);
    return null;
  }
}

function say(text: string, file: string): boolean {
  const aiff = join(tmpdir(), `crewstrike-${Date.now()}.aiff`);
  try {
    execFileSync('say', ['-v', 'Samantha', '-r', '210', '-o', aiff, text]);
    execFileSync('lame', ['--quiet', '-b', '48', '-m', 'm', aiff, file]);
    return true;
  } catch {
    return false;
  } finally {
    if (existsSync(aiff)) rmSync(aiff);
  }
}

/** MeloTTS may return WAV; ship small mono MP3s either way. */
function writeMp3(buf: Buffer, file: string): boolean {
  if (buf.subarray(0, 4).toString('ascii') !== 'RIFF') {
    writeFileSync(file, buf);
    return true;
  }
  const wav = join(tmpdir(), `crewstrike-${Date.now()}.wav`);
  try {
    writeFileSync(wav, buf);
    execFileSync('lame', ['--quiet', '-b', '48', '-m', 'm', wav, file]);
    return true;
  } catch {
    return false;
  } finally {
    if (existsSync(wav)) rmSync(wav);
  }
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const remote = local ? null : await remoteAi();
  let viaAi = 0;
  let viaSay = 0;
  for (const [id, text] of Object.entries(CLIPS)) {
    const file = join(outDir, `${id}.mp3`);
    const buf = remote ? await melo(remote.ai, text) : null;
    if (buf && writeMp3(buf, file)) {
      viaAi++;
    } else if (say(text, file)) viaSay++;
    else console.warn(`No clip for ${id}`);
  }
  await remote?.dispose();
  console.log(`Wrote ${viaAi + viaSay} clips to ${outDir} (${viaAi} MeloTTS, ${viaSay} macOS say).`);
}

void main();
