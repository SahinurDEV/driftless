import { describe, expect, it } from 'vitest';
import { decideEdit, estimateChangeSize, isSmallSafeFix } from '../src/trust/modes';

describe('decideEdit', () => {
  it('read-only API key always rejects, even in trust mode', () => {
    const d = decideEdit({
      trustMode: 'trust',
      permission: 'read',
      source: 'agent',
      change: { size: 10, isSmallSafeFix: true },
    });
    expect(d.action).toBe('reject');
  });

  it('review mode queues agent edits', () => {
    const d = decideEdit({
      trustMode: 'review',
      permission: 'write',
      source: 'agent',
      change: { size: 10, isSmallSafeFix: true },
    });
    expect(d.action).toBe('queue_review');
  });

  it('auto mode applies small safe fixes', () => {
    const d = decideEdit({
      trustMode: 'auto',
      permission: 'write',
      source: 'agent',
      change: { size: 50, isSmallSafeFix: true },
    });
    expect(d.action).toBe('apply');
  });

  it('auto mode queues large rewrites', () => {
    const d = decideEdit({
      trustMode: 'auto',
      permission: 'write',
      source: 'agent',
      change: { size: 5000, isSmallSafeFix: false },
    });
    expect(d.action).toBe('queue_review');
  });

  it('trust mode applies agent edits', () => {
    const d = decideEdit({
      trustMode: 'trust',
      permission: 'write',
      source: 'agent',
      change: { size: 5000, isSmallSafeFix: false },
    });
    expect(d.action).toBe('apply');
  });

  it('session user edits always apply', () => {
    const d = decideEdit({
      trustMode: 'review',
      permission: 'session',
      source: 'user',
      change: { size: 5000, isSmallSafeFix: false },
    });
    expect(d.action).toBe('apply');
  });
});

describe('isSmallSafeFix', () => {
  it('treats renames as small', () => {
    const before = 'Call createInvoice when charging.';
    const after = 'Call createBill when charging.';
    expect(isSmallSafeFix(before, after)).toBe(true);
  });

  it('treats large rewrites as not small', () => {
    const before = 'Short.';
    const after = 'A'.repeat(2000);
    expect(isSmallSafeFix(before, after)).toBe(false);
    expect(estimateChangeSize(before, after)).toBeGreaterThan(400);
  });
});
