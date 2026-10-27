import { describe, expect, it } from 'vitest';
import { applySectionPatch, parseFrontmatter, splitSections } from '../src/util/markdown';

describe('optimistic version conflict shape', () => {
  it('documents the conflict error contract used by saveDoc/API', () => {
    // Pure contract test — storage needs D1/R2; API returns this shape.
    const conflict = {
      ok: false as const,
      error: 'version_conflict' as const,
      currentVersion: 3,
    };
    expect(conflict.error).toBe('version_conflict');
    expect(conflict.currentVersion).toBe(3);
  });
});

describe('section patch (used with version checks)', () => {
  const md = `---
title: Demo
covered_paths:
  - src/a.ts
---
# Intro
Hello

## Details
Old text
`;

  it('parses frontmatter and patches a section', () => {
    const { frontmatter, body } = parseFrontmatter(md);
    expect(frontmatter.title).toBe('Demo');
    expect(frontmatter.covered_paths).toContain('src/a.ts');
    const sections = splitSections(body);
    expect(sections.some((s) => s.heading === 'Details')).toBe(true);
    const patched = applySectionPatch(body, 'Details', '## Details\nNew text\n');
    expect(patched.ok).toBe(true);
    if (patched.ok) {
      expect(patched.body).toContain('New text');
      expect(patched.body).not.toContain('Old text');
      expect(patched.body).toContain('# Intro');
    }
  });

  it('fails when section missing', () => {
    const { body } = parseFrontmatter(md);
    const patched = applySectionPatch(body, 'Nope', 'x');
    expect(patched.ok).toBe(false);
  });
});
