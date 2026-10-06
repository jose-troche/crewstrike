type AiRunner = { run(model: string, input: Record<string, unknown>): Promise<unknown> };

function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function responseOf(out: unknown): unknown {
  if (!out || typeof out !== 'object') return null;
  const r = (out as { response?: unknown }).response;
  if (r && typeof r === 'object') return r;
  if (typeof r === 'string') return extractJson(r);
  return null;
}

/**
 * Run a chat model in JSON mode; if the model rejects the schema, retry with plain output and parse
 * the JSON in code (the implementation doc's fallback for a JSON-mode mismatch).
 */
export async function runJson(env: Env, system: string, user: string, schema: object, maxTokens: number): Promise<unknown> {
  const ai = env.AI as unknown as AiRunner;
  const model = String(env.AI_MODEL || '@cf/meta/llama-3.1-8b-instruct-fp8');
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  try {
    const out = await ai.run(model, {
      messages,
      response_format: { type: 'json_schema', json_schema: schema },
      max_tokens: maxTokens,
      temperature: 0.2,
    });
    const parsed = responseOf(out);
    if (parsed) return parsed;
  } catch {
    // fall through to plain mode
  }
  const out = await ai.run(model, { messages, max_tokens: maxTokens, temperature: 0.2 });
  return responseOf(out);
}

export async function transcribe(env: Env, audio: ArrayBuffer): Promise<string> {
  const ai = env.AI as unknown as AiRunner;
  const out = (await ai.run('@cf/openai/whisper', { audio: [...new Uint8Array(audio)] })) as { text?: string } | null;
  return (out?.text ?? '').trim();
}
