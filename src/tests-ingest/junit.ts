import type { Env } from '../types';
import { newId } from '../util/id';
import { nowIso } from '../util/time';
import { notifyProjectDrift } from '../notify/webhooks';

export interface FailedTest {
  name: string;
  classname?: string;
  file?: string;
  message?: string;
}

/** Parse JUnit / xUnit XML for failed/error testcases. */
export function parseJUnitXml(xml: string): FailedTest[] {
  const fails: FailedTest[] = [];
  // Match testcase elements that contain failure or error children
  const caseRe = /<testcase\b([\s\S]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/gi;
  let m: RegExpExecArray | null;
  while ((m = caseRe.exec(xml))) {
    const attrs = m[1] || '';
    const body = m[2];
    if (body === undefined) continue; // self-closing = pass
    if (!/<failure\b|<error\b/i.test(body)) continue;
    const name = attr(attrs, 'name') || 'unknown';
    const classname = attr(attrs, 'classname') || undefined;
    const file = attr(attrs, 'file') || attr(attrs, 'filepath') || guessFile(classname, name);
    const failMsg =
      body.match(/<(?:failure|error)\b[^>]*message="([^"]*)"/i)?.[1] ||
      body.match(/<(?:failure|error)\b[^>]*>([\s\S]*?)<\//i)?.[1]?.trim().slice(0, 400);
    fails.push({
      name: decodeXml(name),
      classname: classname ? decodeXml(classname) : undefined,
      file: file ? decodeXml(file) : undefined,
      message: failMsg ? decodeXml(failMsg) : undefined,
    });
  }
  return fails;
}

function attr(attrs: string, key: string): string | undefined {
  const m = attrs.match(new RegExp(`\\b${key}\\s*=\\s*"([^"]*)"`, 'i'));
  return m?.[1];
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function guessFile(classname?: string, name?: string): string | undefined {
  if (!classname) return undefined;
  // Jest often uses absolute or relative paths in classname
  if (/\.(ts|tsx|js|jsx|py|go)$/.test(classname)) return classname;
  return classname.replace(/\./g, '/') + '.ts';
}

export async function ingestTestFailures(
  env: Env,
  opts: {
    projectId: string;
    repoId?: string | null;
    failures: FailedTest[];
    commitSha?: string;
  },
): Promise<{ created: number; flagIds: string[] }> {
  if (!opts.failures.length) return { created: 0, flagIds: [] };
  const docs = await env.DB.prepare(
    `SELECT id, path, title, covered_paths, covered_names FROM docs WHERE project_id = ?`,
  )
    .bind(opts.projectId)
    .all<{
      id: string;
      path: string;
      title: string;
      covered_paths: string;
      covered_names: string;
    }>();

  const flagIds: string[] = [];
  const ts = nowIso();

  for (const fail of opts.failures) {
    for (const d of docs.results ?? []) {
      let paths: string[] = [];
      let names: string[] = [];
      try {
        paths = JSON.parse(d.covered_paths) as string[];
      } catch {
        paths = [];
      }
      try {
        names = JSON.parse(d.covered_names) as string[];
      } catch {
        names = [];
      }
      const fileHit =
        !!fail.file &&
        paths.some(
          (p) =>
            fail.file!.includes(p.replace(/\*\*/g, '').replace(/\*$/, '')) ||
            p.includes(fail.file!) ||
            matchGlob(fail.file!, p),
        );
      const nameHit =
        names.some(
          (n) =>
            fail.name.includes(n) ||
            n.includes(fail.name) ||
            (fail.classname && fail.classname.includes(n)),
        );
      if (!fileHit && !nameHit) continue;

      const id = newId('drf');
      const reason = `test failed: ${fail.name}${fail.message ? ` — ${fail.message.slice(0, 180)}` : ''}`;
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO drift_flags (id, doc_id, project_id, repo_id, reason, match_type, changed_paths, changed_names, commit_sha, status, created_at)
           VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, ?, 'open', ?)`,
        ).bind(
          id,
          d.id,
          opts.projectId,
          opts.repoId ?? null,
          reason,
          JSON.stringify(fail.file ? [fail.file] : []),
          JSON.stringify([fail.name]),
          opts.commitSha ?? null,
          ts,
        ),
        env.DB.prepare(
          `UPDATE docs SET drift_status = 'stale' WHERE id = ? AND drift_status = 'ok'`,
        ).bind(d.id),
      ]);
      flagIds.push(id);
      void notifyProjectDrift(env, opts.projectId, {
        flagId: id,
        docTitle: d.title,
        docPath: d.path,
        reason,
        matchType: 'manual',
      });
    }
  }
  return { created: flagIds.length, flagIds };
}

function matchGlob(file: string, pattern: string): boolean {
  if (!pattern.includes('*')) return file === pattern || file.endsWith('/' + pattern);
  const esc = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, ':::')
    .replace(/\*/g, '[^/]*')
    .replace(/:::/g, '.*');
  return new RegExp('^' + esc + '$').test(file) || new RegExp(esc).test(file);
}
