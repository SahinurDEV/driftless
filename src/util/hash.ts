export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashApiKey(rawKey: string): Promise<string> {
  return sha256Hex(`driftless:apikey:${rawKey}`);
}

export async function hashToken(raw: string): Promise<string> {
  return sha256Hex(`driftless:token:${raw}`);
}

export async function hashContent(content: string): Promise<string> {
  return sha256Hex(content);
}
