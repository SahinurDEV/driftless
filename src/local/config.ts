import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

export interface LocalConfig {
  dataDir: string;
  dbPath: string;
  docsDir: string;
  configPath: string;
  port: number;
  password?: string;
}

export function resolveDataDir(explicit?: string): string {
  if (explicit) return resolve(explicit);
  if (process.env.DRIFTLESS_DATA) return resolve(process.env.DRIFTLESS_DATA);
  const cwdLocal = join(process.cwd(), '.driftless');
  if (existsSync(cwdLocal)) return cwdLocal;
  return join(homedir(), '.driftless');
}

export function loadConfig(opts: {
  dataDir?: string;
  port?: number;
  password?: string;
}): LocalConfig {
  const dataDir = resolveDataDir(opts.dataDir);
  return {
    dataDir,
    dbPath: join(dataDir, 'driftless.db'),
    docsDir: join(dataDir, 'docs'),
    configPath: join(dataDir, 'config.json'),
    port: opts.port ?? Number(process.env.DRIFTLESS_PORT || 4747),
    password: opts.password ?? process.env.DRIFTLESS_PASSWORD,
  };
}

export function absPath(p: string): string {
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}
