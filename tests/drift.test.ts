import { describe, expect, it } from 'vitest';
import {
  matchCrossRepoByNames,
  matchDocsByNames,
  matchDocsByPaths,
  mergeMatches,
  pathMatches,
  runDriftCheck,
  type DocCoverage,
} from '../src/drift/match';

const docs: DocCoverage[] = [
  {
    id: 'd1',
    path: 'billing.md',
    title: 'Billing',
    coveredPaths: ['src/billing/**', 'src/payments/stripe.ts'],
    coveredNames: ['createInvoice', 'POST /api/billing'],
  },
  {
    id: 'd2',
    path: 'auth.md',
    title: 'Auth',
    coveredPaths: ['src/auth/'],
    coveredNames: ['loginUser'],
  },
  {
    id: 'd3',
    path: 'mobile-billing.md',
    title: 'Mobile Billing',
    coveredPaths: ['apps/mobile/billing/**'],
    coveredNames: ['createInvoice'],
  },
];

describe('pathMatches', () => {
  it('matches exact and prefix', () => {
    expect(pathMatches('src/auth/', 'src/auth/login.ts')).toBe(true);
    expect(pathMatches('src/payments/stripe.ts', 'src/payments/stripe.ts')).toBe(true);
    expect(pathMatches('src/auth/', 'src/billing/x.ts')).toBe(false);
  });

  it('matches globs', () => {
    expect(pathMatches('src/billing/**', 'src/billing/invoice.ts')).toBe(true);
    expect(pathMatches('src/billing/**', 'src/billing/a/b.ts')).toBe(true);
    expect(pathMatches('*.ts', 'foo.ts')).toBe(true);
    expect(pathMatches('*.ts', 'dir/foo.ts')).toBe(false);
  });
});

describe('matchDocsByPaths', () => {
  it('flags docs covering changed paths', () => {
    const m = matchDocsByPaths(docs, ['src/billing/invoice.ts', 'README.md']);
    expect(m).toHaveLength(1);
    expect(m[0].docId).toBe('d1');
    expect(m[0].matchType).toBe('path');
  });
});

describe('matchDocsByNames', () => {
  it('flags docs by covered names', () => {
    const m = matchDocsByNames(docs, ['createInvoice', 'unrelated']);
    expect(m.map((x) => x.docId).sort()).toEqual(['d1', 'd3']);
  });
});

describe('cross-repo + merge', () => {
  it('cross-matches via keyword hits and merges', () => {
    const hits = new Map([['d3', ['createInvoice']]]);
    const cross = matchCrossRepoByNames(docs, ['createInvoice'], hits);
    expect(cross.some((c) => c.docId === 'd3')).toBe(true);
    const all = runDriftCheck({
      docs,
      changedPaths: ['src/billing/x.ts'],
      changedNames: ['createInvoice'],
      keywordHits: hits,
    });
    const billing = all.find((a) => a.docId === 'd1');
    expect(billing).toBeTruthy();
    expect(billing!.matchedPaths.length).toBeGreaterThan(0);
    expect(billing!.matchedNames).toContain('createInvoice');
    const merged = mergeMatches(all);
    expect(merged.length).toBeLessThanOrEqual(all.length);
  });
});
