/** Minimal line-level unified diff for version history UI. */
export function unifiedDiff(before: string, after: string, aLabel = 'a', bLabel = 'b'): string {
  const a = before.split('\n');
  const b = after.split('\n');
  const lines: string[] = [`--- ${aLabel}`, `+++ ${bLabel}`];
  if (a.length + b.length > 8000) {
    lines.push('@@ large change @@');
    for (const l of a.slice(0, 40)) lines.push(`-${l}`);
    for (const l of b.slice(0, 40)) lines.push(`+${l}`);
    return lines.join('\n');
  }
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  const hunk: string[] = [];
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      hunk.push(` ${a[i]}`);
      i++;
      j++;
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      hunk.push(`+${b[j]}`);
      j++;
    } else if (i < n) {
      hunk.push(`-${a[i]}`);
      i++;
    }
  }
  lines.push('@@');
  lines.push(...hunk);
  return lines.join('\n');
}
