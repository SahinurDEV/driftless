import type { DocFrontmatter } from '../types';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Parse simple YAML-like frontmatter (title, covered_paths, covered_names). */
export function parseFrontmatter(markdown: string): {
  frontmatter: DocFrontmatter;
  body: string;
} {
  const match = markdown.match(FRONTMATTER_RE);
  if (!match) {
    return { frontmatter: {}, body: markdown };
  }
  const raw = match[1];
  const frontmatter: DocFrontmatter = {};
  let currentKey: string | null = null;
  let currentList: string[] | null = null;

  for (const line of raw.split(/\r?\n/)) {
    const listItem = line.match(/^\s*-\s+(.+)\s*$/);
    if (listItem && currentList) {
      currentList.push(stripQuotes(listItem[1].trim()));
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!kv) continue;
    if (currentKey && currentList) {
      (frontmatter as Record<string, unknown>)[currentKey] = currentList;
    }
    const key = kv[1];
    const value = kv[2].trim();
    if (value === '' || value === '|' || value === '>') {
      currentKey = key;
      currentList = [];
    } else if (value.startsWith('[') && value.endsWith(']')) {
      frontmatter[key as keyof DocFrontmatter] = parseInlineList(value) as never;
      currentKey = null;
      currentList = null;
    } else {
      (frontmatter as Record<string, unknown>)[key] = stripQuotes(value);
      currentKey = null;
      currentList = null;
    }
  }
  if (currentKey && currentList) {
    (frontmatter as Record<string, unknown>)[currentKey] = currentList;
  }

  return { frontmatter, body: markdown.slice(match[0].length) };
}

function parseInlineList(value: string): string[] {
  const inner = value.slice(1, -1).trim();
  if (!inner) return [];
  return inner.split(',').map((s) => stripQuotes(s.trim())).filter(Boolean);
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

export interface Section {
  heading: string;
  level: number;
  start: number; // char offset in body
  end: number;
  content: string;
}

/** Split markdown body into sections by ATX headings. */
export function splitSections(body: string): Section[] {
  const lines = body.split(/\r?\n/);
  const headingIdx: { line: number; level: number; heading: string }[] = [];
  let offset = 0;
  const lineOffsets: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    lineOffsets.push(offset);
    const m = lines[i].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (m) {
      headingIdx.push({ line: i, level: m[1].length, heading: m[2] });
    }
    offset += lines[i].length + 1;
  }

  if (headingIdx.length === 0) {
    return [
      {
        heading: '(root)',
        level: 0,
        start: 0,
        end: body.length,
        content: body,
      },
    ];
  }

  const sections: Section[] = [];
  // Content before first heading
  if (headingIdx[0].line > 0) {
    const start = 0;
    const end = lineOffsets[headingIdx[0].line];
    sections.push({
      heading: '(preamble)',
      level: 0,
      start,
      end,
      content: body.slice(start, end),
    });
  }

  for (let i = 0; i < headingIdx.length; i++) {
    const h = headingIdx[i];
    const start = lineOffsets[h.line];
    const end =
      i + 1 < headingIdx.length ? lineOffsets[headingIdx[i + 1].line] : body.length;
    sections.push({
      heading: h.heading,
      level: h.level,
      start,
      end,
      content: body.slice(start, end),
    });
  }
  return sections;
}

export function outlineFromSections(sections: Section[]): { heading: string; level: number }[] {
  return sections
    .filter((s) => s.level > 0)
    .map((s) => ({ heading: s.heading, level: s.level }));
}

/** Apply a section-level patch: replace section matching heading (exact) with newContent. */
export function applySectionPatch(
  body: string,
  heading: string,
  newSectionContent: string,
): { ok: true; body: string } | { ok: false; error: string } {
  const sections = splitSections(body);
  const idx = sections.findIndex(
    (s) => s.heading === heading || s.heading.toLowerCase() === heading.toLowerCase(),
  );
  if (idx < 0) {
    return { ok: false, error: `Section not found: ${heading}` };
  }
  const target = sections[idx];
  const before = body.slice(0, target.start);
  const after = body.slice(target.end);
  let replacement = newSectionContent;
  if (!replacement.endsWith('\n') && after.length > 0) {
    replacement += '\n';
  }
  return { ok: true, body: before + replacement + after };
}

export function extractNamesFromDiff(text: string): string[] {
  const names = new Set<string>();
  // function / method / class-ish
  const patterns = [
    /\b(?:function|class|interface|type|enum|const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)/g,
    /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g,
    /(?:GET|POST|PUT|PATCH|DELETE)\s+(\/[A-Za-z0-9_\-/{}.:]+)/gi,
    /@?(?:Get|Post|Put|Patch|Delete|Route)\(['"`]([^'"`]+)['"`]\)/g,
    /['"`](\/[A-Za-z0-9_\-/{}.:]+)['"`]/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[1] && m[1].length >= 2) names.add(m[1]);
    }
  }
  return [...names];
}
