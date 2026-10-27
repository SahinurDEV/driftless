import type { ApiKeyPermission, TrustMode } from '../types';

export type EditSource = 'user' | 'agent' | 'system';

export interface EditDecisionInput {
  trustMode: TrustMode;
  /** Session users act as full editors; API keys use read|write. */
  permission: ApiKeyPermission | 'session';
  source: EditSource;
  /** Heuristic size of the change for Auto mode. */
  change: {
    /** Characters added+removed estimate */
    size: number;
    /** True if only renaming symbols / updating endpoints-style small fix */
    isSmallSafeFix: boolean;
  };
}

export type EditDecision =
  | { action: 'reject'; reason: string }
  | { action: 'apply'; logOnly?: boolean }
  | { action: 'queue_review'; reason: string };

const SMALL_FIX_MAX_CHARS = 400;

/**
 * API key permissions always win: read-only never writes, even in Trust mode.
 * Session (dashboard) editors apply immediately (they are humans).
 * Agent edits follow trust mode.
 */
export function decideEdit(input: EditDecisionInput): EditDecision {
  if (input.permission === 'read') {
    return { action: 'reject', reason: 'API key is read-only' };
  }

  // Human dashboard edits always apply (role checks happen elsewhere).
  if (input.source === 'user' || input.source === 'system') {
    return { action: 'apply' };
  }

  // Agent / MCP write path
  switch (input.trustMode) {
    case 'review':
      return { action: 'queue_review', reason: 'Trust mode is review: AI edits need approval' };
    case 'auto': {
      const small =
        input.change.isSmallSafeFix && input.change.size <= SMALL_FIX_MAX_CHARS;
      if (small) {
        return { action: 'apply', logOnly: true };
      }
      return {
        action: 'queue_review',
        reason: 'Trust mode is auto: change is larger than a small safe fix',
      };
    }
    case 'trust':
      return { action: 'apply', logOnly: true };
    default:
      return { action: 'queue_review', reason: 'Unknown trust mode' };
  }
}

/** Heuristic: small safe fix if mostly identifier/path tokens changed. */
export function isSmallSafeFix(before: string, after: string): boolean {
  if (before === after) return true;
  const size = Math.abs(before.length - after.length) + levenshteinCap(before, after, 500);
  if (size > SMALL_FIX_MAX_CHARS) return false;

  // Strip common rename patterns — if structure (punctuation density) stays similar
  const strip = (s: string) => s.replace(/[A-Za-z_][A-Za-z0-9_]*/g, '~').replace(/\/[A-Za-z0-9_\-/{}.]*/g, '#');
  const a = strip(before);
  const b = strip(after);
  if (a === b) return true;
  // Allow tiny structural diffs
  return levenshteinCap(a, b, 40) <= 8;
}

function levenshteinCap(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const m = a.length;
  const n = b.length;
  const prev = new Array(n + 1);
  const cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > cap) return cap + 1;
    for (let j = 0; j <= n; j++) prev[j] = cur[j];
  }
  return prev[n];
}

export function estimateChangeSize(before: string, after: string): number {
  return Math.abs(before.length - after.length) + levenshteinCap(before, after, 2000);
}
