import { readFile, readdir, access } from 'node:fs/promises';
import { join, basename, relative, extname } from 'node:path';
import { existsSync } from 'node:fs';

export interface GeneratedDoc {
  path: string;
  title: string;
  content: string;
  covered_paths: string[];
  covered_names: string[];
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.driftless',
  'vendor', '__pycache__', '.venv', 'target', '.turbo', '.cache',
]);

const CODE_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java',
  '.kt', '.rb', '.php', '.cs', '.swift',
]);

async function walk(dir: string, root: string, out: string[] = [], depth = 0): Promise<string[]> {
  if (depth > 8) return out;
  let ents;
  try {
    ents = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of ents) {
    if (ent.name.startsWith('.') && ent.name !== '.env.example') continue;
    if (SKIP_DIRS.has(ent.name)) continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) await walk(full, root, out, depth + 1);
    else out.push(full);
  }
  return out;
}

function extractExports(content: string, file: string): string[] {
  const names: string[] = [];
  const ext = extname(file);
  if (ext === '.py') {
    for (const m of content.matchAll(/^def\s+([A-Za-z_][\w]*)/gm)) names.push(m[1]);
    for (const m of content.matchAll(/^class\s+([A-Za-z_][\w]*)/gm)) names.push(m[1]);
  } else if (ext === '.go') {
    for (const m of content.matchAll(/^func\s+(?:\([^)]*\)\s+)?([A-Z][\w]*)/gm)) names.push(m[1]);
  } else {
    for (const m of content.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_][\w]*)/g)) names.push(m[1]);
    for (const m of content.matchAll(/export\s+(?:const|let|var|class|type|interface|enum)\s+([A-Za-z_][\w]*)/g))
      names.push(m[1]);
    for (const m of content.matchAll(/module\.exports\.([A-Za-z_][\w]*)/g)) names.push(m[1]);
    for (const m of content.matchAll(/(?:app|router)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)/gi))
      names.push(`${m[1].toUpperCase()} ${m[2]}`);
  }
  return names;
}

async function tryOllamaEnhance(summary: string): Promise<string | null> {
  try {
    const res = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.2',
        stream: false,
        prompt: `Write a short developer-facing overview (max 120 words) for this codebase summary:\n${summary}`,
      }),
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { response?: string };
    return j.response?.trim() || null;
  } catch {
    return null;
  }
}

/** Scan a repo folder and build a starter markdown doc with coverage frontmatter. */
export async function generateDocFromRepo(
  repoPath: string,
  opts: { useOllama?: boolean } = {},
): Promise<GeneratedDoc> {
  const root = repoPath;
  await access(root);
  const name = basename(root);
  const files = await walk(root, root);
  const covered_paths: string[] = [];
  const covered_names: string[] = [];
  const sections: string[] = [];

  // package.json / pyproject / go.mod
  const pkgPath = join(root, 'package.json');
  let description = '';
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as {
        name?: string;
        description?: string;
        main?: string;
        exports?: unknown;
        scripts?: Record<string, string>;
      };
      description = pkg.description || '';
      sections.push(`## Package\n\n- **name:** \`${pkg.name || name}\``);
      if (pkg.description) sections.push(`- **description:** ${pkg.description}`);
      if (pkg.main) {
        sections.push(`- **main:** \`${pkg.main}\``);
        covered_paths.push(pkg.main);
      }
      if (pkg.scripts) {
        sections.push('\n### Scripts\n');
        for (const [k, v] of Object.entries(pkg.scripts).slice(0, 12)) {
          sections.push(`- \`${k}\`: \`${v}\``);
        }
      }
      covered_paths.push('package.json');
    } catch {
      /* ignore */
    }
  }

  // README excerpt
  for (const readme of ['README.md', 'readme.md', 'README']) {
    const p = join(root, readme);
    if (existsSync(p)) {
      const text = await readFile(p, 'utf8');
      const excerpt = text.replace(/^---[\s\S]*?---\n/, '').trim().slice(0, 1200);
      sections.push(`## From README\n\n${excerpt}`);
      covered_paths.push(readme);
      break;
    }
  }

  // Source files — prefer src/, lib/, app/, routes
  const codeFiles = files
    .filter((f) => CODE_EXT.has(extname(f)))
    .filter((f) => {
      const rel = relative(root, f).replace(/\\/g, '/');
      return /^(src|lib|app|routes|api|server|pkg)\//.test(rel) || !rel.includes('/');
    })
    .slice(0, 40);

  const exportLines: string[] = [];
  for (const f of codeFiles) {
    const rel = relative(root, f).replace(/\\/g, '/');
    covered_paths.push(rel);
    try {
      const content = await readFile(f, 'utf8');
      if (content.length > 200_000) continue;
      const names = extractExports(content, f).slice(0, 20);
      for (const n of names) {
        if (!covered_names.includes(n)) covered_names.push(n);
      }
      if (names.length) exportLines.push(`- \`${rel}\`: ${names.map((n) => `\`${n}\``).join(', ')}`);
    } catch {
      /* ignore */
    }
  }
  if (exportLines.length) {
    sections.push(`## Exports & routes\n\n${exportLines.join('\n')}`);
  }

  // Deduplicate paths — prefer directory globs for dense trees
  const uniquePaths = [...new Set(covered_paths)].slice(0, 40);
  const uniqueNames = [...new Set(covered_names)].slice(0, 60);

  let overview =
    description ||
    `Auto-generated overview of **${name}**. Update this doc as the code evolves; Driftless will flag drift when covered paths or names change.`;
  if (opts.useOllama !== false) {
    const enhanced = await tryOllamaEnhance(
      `Repo ${name}. Paths: ${uniquePaths.slice(0, 15).join(', ')}. Names: ${uniqueNames.slice(0, 20).join(', ')}. ${description}`,
    );
    if (enhanced) overview = enhanced;
  }

  const title = `${name} overview`;
  const fmPaths = uniquePaths.map((p) => `  - ${p}`).join('\n');
  const fmNames = uniqueNames.map((n) => `  - ${n}`).join('\n');
  const content = `---
title: ${title}
covered_paths:
${fmPaths || '  []'}
covered_names:
${fmNames || '  []'}
---

# ${title}

${overview}

${sections.join('\n\n')}

## Coverage

This doc is linked to the paths and symbols above. When they change, Driftless opens a drift flag.
`;

  return {
    path: `generated/${name}.md`,
    title,
    content,
    covered_paths: uniquePaths,
    covered_names: uniqueNames,
  };
}
