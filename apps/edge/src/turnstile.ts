/** Server-side Turnstile check. When no secret is configured (local dev, tests) the check is skipped. */
export async function verifyTurnstile(secret: string | undefined, token: string | undefined, ip: string | undefined): Promise<boolean> {
  if (!secret) return true;
  if (!token) return false;
  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  if (ip) body.append('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

export async function hashIp(ip: string | undefined): Promise<string> {
  const data = new TextEncoder().encode(`crewstrike:${ip ?? 'unknown'}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}
