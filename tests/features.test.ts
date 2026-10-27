import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/local/config';
import { createLocalEnv, LOCAL_USER_ID } from '../src/local/bootstrap';
import { saveDoc, readDocVersion } from '../src/storage/docs';
import { generateDocFromRepo } from '../src/docs/generate';
import { parseJUnitXml, ingestTestFailures } from '../src/tests-ingest/junit';
import { listDocVersions, rollbackDoc, getVersionDiff } from '../src/storage/versions';
import { unifiedDiff } from '../src/util/diff';
import { formatSlackPayload, formatDiscordPayload } from '../src/notify/webhooks';
import { indexRepoCode, searchAll } from '../src/search/code-index';
import { newId } from '../src/util/id';
import { nowIso } from '../src/util/time';

const migrationsDir = join(process.cwd(), 'migrations');

describe('unifiedDiff', () => {
  it('marks added and removed lines', () => {
    const d = unifiedDiff('a\nb\n', 'a\nc\n');
    expect(d).toContain('-b');
    expect(d).toContain('+c');
  });
});

describe('junit parse', () => {
  it('extracts failed testcases', () => {
    const xml = `<?xml version="1.0"?>
<testsuite>
  <testcase classname="src/billing.js" name="createInvoice builds" time="0.1"/>
  <testcase classname="src/billing.js" name="applyTax" time="0.1">
    <failure message="expected 1100">boom</failure>
  </testcase>
</testsuite>`;
    const fails = parseJUnitXml(xml);
    expect(fails).toHaveLength(1);
    expect(fails[0].name).toBe('applyTax');
    expect(fails[0].file).toContain('billing');
  });
});

describe('webhook payloads', () => {
  it('formats slack and discord', () => {
    const p = {
      projectId: 'p1',
      flagId: 'f1',
      docTitle: 'Billing',
      docPath: 'billing.md',
      reason: 'path match',
      matchType: 'path',
    };
    expect(formatSlackPayload(p).text).toContain('Billing');
    expect(formatDiscordPayload(p).content).toContain('Billing');
  });
});

describe('local feature flows', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'driftless-feat-'));
  });
  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('generates a doc, versions, rollback, test ingest, search', async () => {
    const repo = join(dataDir, 'app');
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(
      join(repo, 'package.json'),
      JSON.stringify({ name: 'demo-app', description: 'Demo', main: 'src/index.js' }),
    );
    writeFileSync(join(repo, 'README.md'), '# Demo\n\nHello');
    writeFileSync(
      join(repo, 'src/index.js'),
      'export function hello() { return 1; }\nexport const billing = 1;\n',
    );

    const cfg = loadConfig({ dataDir: join(dataDir, 'dl') });
    const { env, projectId } = await createLocalEnv(cfg, migrationsDir);

    const generated = await generateDocFromRepo(repo, { useOllama: false });
    expect(generated.content).toContain('covered_paths');
    expect(generated.covered_names.length + generated.covered_paths.length).toBeGreaterThan(0);

    const docId = newId('doc');
    const repoId = newId('repo');
    await env.DB.prepare(
      `INSERT INTO repos (id, project_id, github_owner, github_name, default_branch, local_path, created_at, updated_at)
       VALUES (?, ?, 'local', 'app', 'main', ?, ?, ?)`,
    )
      .bind(repoId, projectId, repo, nowIso(), nowIso())
      .run();

    let saved = await saveDoc(env, {
      projectId,
      docId,
      path: generated.path,
      content: generated.content,
      baseVersion: null,
      authorId: LOCAL_USER_ID,
      authorType: 'system',
      repoId,
    });
    expect(saved.ok).toBe(true);

    saved = await saveDoc(env, {
      projectId,
      docId,
      path: generated.path,
      content: generated.content + '\n\n## Extra\nnote\n',
      baseVersion: 1,
      authorId: LOCAL_USER_ID,
      authorType: 'user',
      summary: 'edit',
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;

    const versions = await listDocVersions(env, docId);
    expect(versions.length).toBe(2);
    const diff = await getVersionDiff(env, projectId, docId, 1, 2);
    expect(diff?.diff).toContain('Extra');

    const rb = await rollbackDoc(env, {
      projectId,
      docId,
      path: generated.path,
      toVersion: 1,
      currentVersion: 2,
      authorId: LOCAL_USER_ID,
    });
    expect(rb.ok).toBe(true);
    const body = await readDocVersion(env, projectId, docId, 3);
    expect(body).not.toContain('## Extra');

    // team + assign columns exist
    await env.DB.prepare(
      `INSERT INTO local_team (id, project_id, name, created_at) VALUES (?, ?, ?, ?)`,
    )
      .bind(newId('tm'), projectId, 'Asha', nowIso())
      .run();

    const xml = `<?xml version="1.0"?><testsuite>
      <testcase classname="src/index.js" name="hello" time="0.1">
        <failure message="boom">err</failure>
      </testcase>
    </testsuite>`;
    const failures = parseJUnitXml(xml);
    const ingested = await ingestTestFailures(env, { projectId, repoId, failures });
    expect(ingested.created).toBeGreaterThanOrEqual(1);

    const indexed = await indexRepoCode(env, { projectId, repoId, localPath: repo });
    expect(indexed.indexed).toBeGreaterThan(0);
    const hits = await searchAll(env, projectId, 'hello');
    expect(hits.code.length + hits.docs.length).toBeGreaterThan(0);

    // notifications columns
    await env.DB.prepare(
      `UPDATE projects SET notify_webhook_url = ?, notify_webhook_type = ? WHERE id = ?`,
    )
      .bind('https://example.com/hook', 'slack', projectId)
      .run();
    const row = await env.DB.prepare(
      `SELECT notify_webhook_url FROM projects WHERE id = ?`,
    )
      .bind(projectId)
      .first<{ notify_webhook_url: string }>();
    expect(row?.notify_webhook_url).toContain('example.com');
  }, 30000);
});
