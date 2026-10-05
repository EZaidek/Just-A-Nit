import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePatch } from '../src/lib/diff.ts';

test('replacement assigns independent old and new line numbers and preserves whitespace', () => {
  const rows = parsePatch('@@ -10,3 +10,4 @@ function example\n before\n-  old()\n+  new()\n+\tmore()\n after');
  assert.deepEqual(rows.slice(1).map(row => [row.kind, row.oldLine, row.newLine]), [
    ['context', 10, 10], ['removed', 11, null], ['added', null, 11],
    ['added', null, 12], ['context', 12, 13],
  ]);
  assert.equal(rows[4].content, '\tmore()');
});

test('multiple hunks reset line numbering and accept implicit single-line counts', () => {
  const rows = parsePatch('@@ -1 +1 @@\n-old\n+new\n@@ -30 +40 @@\n-old2\n+new2\n');
  assert.equal(rows[4].oldLine, 30);
  assert.equal(rows[5].newLine, 40);
});

test('new files, deleted files, and no-newline markers retain correct numbering', () => {
  const added = parsePatch('@@ -0,0 +1,2 @@\n+one\n+two\n\\ No newline at end of file');
  assert.equal(added[1].oldLine, null);
  assert.equal(added[2].newLine, 2);
  assert.equal(added[3].kind, 'note');
  const removed = parsePatch('@@ -1,2 +0,0 @@\n-one\n-two');
  assert.equal(removed[2].oldLine, 2);
  assert.equal(removed[2].newLine, null);
});

test('rejects truncated, missing, malformed, and overflowing hunks', () => {
  for (const patch of ['', '+orphan', '@@ -1,2 +1,2 @@\n same',
    '@@ -1 +1 @@\n same\n extra', '@@ -1 +1 @@\ninvalid',
    '@@ -1,2 +1,2 @@\n same\n@@ -5 +5 @@\n same']) {
    assert.throws(() => parsePatch(patch));
  }
});

test('HTML-looking source remains plain text', () => {
  const rows = parsePatch('@@ -0,0 +1 @@\n+<script>alert("test")</script>');
  assert.equal(rows[1].content, '<script>alert("test")</script>');
});
