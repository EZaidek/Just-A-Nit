export type DiffLine = {
  kind: 'hunk' | 'added' | 'removed' | 'context' | 'note';
  content: string;
  oldLine: number | null;
  newLine: number | null;
};

/** Parse a GitHub file patch, rejecting missing or incomplete hunks. */
export function parsePatch(patch: string): DiffLine[] {
  const rows: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let oldRemaining = 0;
  let newRemaining = 0;
  let hasHunk = false;
  const lines = patch.split('\n');
  if (lines.at(-1) === '') lines.pop();

  for (const raw of lines) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(line);
    if (hunk) {
      if (oldRemaining || newRemaining) throw new Error('Incomplete diff hunk');
      hasHunk = true;
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[3]);
      oldRemaining = Number(hunk[2] ?? 1);
      newRemaining = Number(hunk[4] ?? 1);
      rows.push({ kind: 'hunk', content: line, oldLine: null, newLine: null });
      continue;
    }
    if (!hasHunk) throw new Error('Missing diff hunk');
    if (line === '\\ No newline at end of file') {
      rows.push({ kind: 'note', content: line, oldLine: null, newLine: null });
    } else if (line.startsWith('+')) {
      newRemaining--;
      rows.push({ kind: 'added', content: line.slice(1), oldLine: null, newLine: newLine++ });
    } else if (line.startsWith('-')) {
      oldRemaining--;
      rows.push({ kind: 'removed', content: line.slice(1), oldLine: oldLine++, newLine: null });
    } else if (line.startsWith(' ')) {
      oldRemaining--;
      newRemaining--;
      rows.push({ kind: 'context', content: line.slice(1), oldLine: oldLine++, newLine: newLine++ });
    } else {
      throw new Error('Invalid diff line');
    }
    if (oldRemaining < 0 || newRemaining < 0) throw new Error('Invalid diff hunk size');
  }

  if (!hasHunk || oldRemaining || newRemaining) throw new Error('Incomplete diff patch');
  return rows;
}
