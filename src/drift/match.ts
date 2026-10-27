/**
 * Path + name based drift matching (no AI).
 * Docs declare covered_paths (globs/prefixes) and covered_names in frontmatter / DB.
 */

export interface DocCoverage {
  id: string;
  path: string;
  title: string;
  coveredPaths: string[];
  coveredNames: string[];
}

export interface DriftMatch {
  docId: string;
  docPath: string;
  matchType: 'path' | 'name';
  reason: string;
  matchedPaths: string[];
  matchedNames: string[];
}

/** Glob-ish match: supports * and ** and exact / prefix. */
export function pathMatches(pattern: string, filePath: string): boolean {
  const p = normalizePath(pattern);
  const f = normalizePath(filePath);
  if (!p) return false;
  if (p === f) return true;
  if (p.endsWith('/') && f.startsWith(p)) return true;
  // prefix without wildcard
  if (!p.includes('*') && (f === p || f.startsWith(p.endsWith('/') ? p : p + '/'))) {
    return true;
  }
  const regex = globToRegExp(p);
  return regex.test(f);
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*';
      i++;
      if (glob[i + 1] === '/') i++;
    } else if (c === '*') {
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else if ('+()[]{}|.^$'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

export function matchDocsByPaths(
  docs: DocCoverage[],
  changedPaths: string[],
): DriftMatch[] {
  const results: DriftMatch[] = [];
  for (const doc of docs) {
    const matchedPaths: string[] = [];
    for (const changed of changedPaths) {
      for (const pattern of doc.coveredPaths) {
        if (pathMatches(pattern, changed)) {
          matchedPaths.push(changed);
          break;
        }
      }
    }
    if (matchedPaths.length) {
      results.push({
        docId: doc.id,
        docPath: doc.path,
        matchType: 'path',
        reason: `Changed paths match covered_paths: ${matchedPaths.join(', ')}`,
        matchedPaths: [...new Set(matchedPaths)],
        matchedNames: [],
      });
    }
  }
  return results;
}

export function matchDocsByNames(
  docs: DocCoverage[],
  changedNames: string[],
): DriftMatch[] {
  const nameSet = new Set(changedNames.map((n) => n.toLowerCase()));
  const results: DriftMatch[] = [];
  for (const doc of docs) {
    const matchedNames = doc.coveredNames.filter((n) => nameSet.has(n.toLowerCase()));
    if (matchedNames.length) {
      results.push({
        docId: doc.id,
        docPath: doc.path,
        matchType: 'name',
        reason: `Changed names match covered_names: ${matchedNames.join(', ')}`,
        matchedPaths: [],
        matchedNames,
      });
    }
  }
  return results;
}

/**
 * Cross-repo name match via keyword hits: given names found in changed code,
 * flag docs whose FTS/keyword index contains those names (caller supplies docs
 * already filtered by FTS). We still require the name to appear in covered_names
 * OR in the provided keywordHits map for that doc.
 */
export function matchCrossRepoByNames(
  docs: DocCoverage[],
  changedNames: string[],
  keywordHits: Map<string, string[]>, // docId -> names that hit in FTS
): DriftMatch[] {
  const results: DriftMatch[] = [];
  const changedLower = changedNames.map((n) => n.toLowerCase());
  for (const doc of docs) {
    const hits = keywordHits.get(doc.id) ?? [];
    const covered = new Set(doc.coveredNames.map((n) => n.toLowerCase()));
    const matched = new Set<string>();
    for (const name of changedNames) {
      if (covered.has(name.toLowerCase())) matched.add(name);
    }
    for (const hit of hits) {
      if (changedLower.includes(hit.toLowerCase())) matched.add(hit);
    }
    if (matched.size) {
      results.push({
        docId: doc.id,
        docPath: doc.path,
        matchType: 'name',
        reason: `Cross-repo name match: ${[...matched].join(', ')}`,
        matchedPaths: [],
        matchedNames: [...matched],
      });
    }
  }
  return results;
}

/** Merge matches for the same doc (path + name). */
export function mergeMatches(matches: DriftMatch[]): DriftMatch[] {
  const byDoc = new Map<string, DriftMatch>();
  for (const m of matches) {
    const existing = byDoc.get(m.docId);
    if (!existing) {
      byDoc.set(m.docId, { ...m, matchedPaths: [...m.matchedPaths], matchedNames: [...m.matchedNames] });
      continue;
    }
    existing.matchedPaths = [...new Set([...existing.matchedPaths, ...m.matchedPaths])];
    existing.matchedNames = [...new Set([...existing.matchedNames, ...m.matchedNames])];
    if (existing.matchType !== m.matchType) {
      existing.reason = `${existing.reason}; ${m.reason}`;
      // prefer path if both
      if (m.matchType === 'path') existing.matchType = 'path';
    } else {
      existing.reason = existing.reason;
    }
  }
  return [...byDoc.values()];
}

export function runDriftCheck(input: {
  docs: DocCoverage[];
  changedPaths: string[];
  changedNames: string[];
  keywordHits?: Map<string, string[]>;
}): DriftMatch[] {
  const pathMatchesResult = matchDocsByPaths(input.docs, input.changedPaths);
  const nameMatches = matchDocsByNames(input.docs, input.changedNames);
  const cross = input.keywordHits
    ? matchCrossRepoByNames(input.docs, input.changedNames, input.keywordHits)
    : [];
  return mergeMatches([...pathMatchesResult, ...nameMatches, ...cross]);
}
