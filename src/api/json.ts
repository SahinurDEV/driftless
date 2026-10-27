export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 0), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    },
  });
}

export function error(message: string, status = 400, extra?: Record<string, unknown>): Response {
  return json({ error: message, ...extra }, status);
}

export async function readJson<T = unknown>(request: Request): Promise<T> {
  return (await request.json()) as T;
}
