/**
 * MCP over stdio — Cursor / Claude Desktop can launch `driftless mcp`.
 * Speaks JSON-RPC lines on stdin/stdout; reuses handleMcp tool logic via HTTP-shaped requests.
 */
import type { Env } from '../types/env';
import { handleMcp } from '../mcp/server';
import { createLocalSession } from './bootstrap';
import { createInterface } from 'node:readline';

export async function runMcpStdio(env: Env, apiKey?: string): Promise<void> {
  // Prefer API key; else mint a session bearer via cookie simulation
  let authHeader: string;
  if (apiKey) {
    authHeader = `Bearer ${apiKey}`;
  } else {
    const token = await createLocalSession(env);
    // handleMcp uses resolveAuth which wants Bearer dl_ or session cookie.
    // Create a write API key for local user if none provided — simpler: use cookie.
    authHeader = '';
    (globalThis as unknown as { __driftlessStdioSession?: string }).__driftlessStdioSession = token;
  }

  const rl = createInterface({ input: process.stdin, terminal: false });

  async function dispatch(msg: unknown): Promise<unknown> {
    const body = JSON.stringify(msg);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (authHeader) headers.Authorization = authHeader;
    else {
      const token = (globalThis as unknown as { __driftlessStdioSession?: string })
        .__driftlessStdioSession;
      if (token) headers.Cookie = `driftless_session=${token}`;
    }
    const req = new Request('http://127.0.0.1/mcp', {
      method: 'POST',
      headers,
      body,
    });
    const res = await handleMcp(req, env);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { jsonrpc: '2.0', error: { code: -32000, message: text }, id: null };
    }
  }

  // Prevent accidental logging to stdout (MCP channel)
  const log = (...args: unknown[]) => console.error(...args);

  rl.on('line', (line) => {
    void (async () => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let msg: unknown;
      try {
        msg = JSON.parse(trimmed);
      } catch (e) {
        process.stdout.write(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32700, message: 'Parse error' },
            id: null,
          }) + '\n',
        );
        return;
      }
      try {
        const out = await dispatch(msg);
        // notifications have no id / no response needed for some methods
        const m = msg as { id?: unknown; method?: string };
        if (m.id === undefined || m.id === null) {
          // still ok to skip response for notifications
          if (m.method?.startsWith('notifications/')) return;
        }
        process.stdout.write(JSON.stringify(out) + '\n');
      } catch (e) {
        log('mcp error', e);
        const m = msg as { id?: unknown };
        process.stdout.write(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: e instanceof Error ? e.message : 'error' },
            id: m.id ?? null,
          }) + '\n',
        );
      }
    })();
  });

  await new Promise<void>((resolve) => rl.on('close', () => resolve()));
}
