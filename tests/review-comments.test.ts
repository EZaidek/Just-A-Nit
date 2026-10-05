import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMPTY_REVIEW, hasReviewerComment, parseReviewComments, parseReviewSummaries, removeLocalComment, saveLocalComment, type LocalComment } from '../src/lib/review-comments.ts';

test('local comments can be created, edited, deleted and suggest an empty replacement without mutating previous state', () => {
  const comment: LocalComment = { id: 'local-1', path: 'a.ts', line: 2, side: 'RIGHT', code: 'old()', body: 'Why?', suggestion: '' };
  const initial = { ...EMPTY_REVIEW, summary: 'A thought' };
  const saved = saveLocalComment(initial, comment);
  assert.equal(initial.comments.length, 0);
  assert.equal(saved.comments[0].suggestion, '');
  const edited = saveLocalComment(saved, { ...comment, body: 'Please test it.' });
  assert.equal(edited.comments.length, 1);
  assert.equal(saved.comments[0].body, 'Why?');
  const removed = removeLocalComment(edited, comment.id);
  assert.equal(removed.comments.length, 0);
  assert.equal(removed.summary, 'A thought');
  assert.equal(saveLocalComment(initial, { ...comment, body: '', suggestion: undefined }), initial);
  assert.equal(saveLocalComment(initial, { ...comment, side: 'LEFT' }), initial);
});

test('original comments retain side, earlier revision context and reply attribution', () => {
  const comments = parseReviewComments([{ id: 1, pull_request_review_id: 2, user: { login: 'reviewer', type: 'User' },
    body: 'Check this', path: 'a.ts', line: null, original_line: 7, original_start_line: 5, side: 'LEFT', diff_hunk: '@@ old context' },
  { id: 2, pull_request_review_id: 2, user: { login: 'author', type: 'User' }, body: 'Fixed', path: 'a.ts', line: 8, in_reply_to_id: 1 }], 'author');
  assert.equal(comments[0].outdated, true);
  assert.equal(comments[0].line, 7);
  assert.equal(comments[0].startLine, 5);
  assert.equal(comments[0].side, 'LEFT');
  assert.equal(comments[0].diffHunk, '@@ old context');
  assert.equal(comments[1].replyTo, 1);
  assert.equal(comments[1].reviewer, false);
  assert.equal(hasReviewerComment(comments, ['a.ts']), true);
  assert.equal(hasReviewerComment(comments, ['b.ts']), false);
  assert.equal(hasReviewerComment(comments.slice(1), ['a.ts']), false);
});

test('malformed comments and empty approvals never qualify as review feedback', () => {
  assert.deepEqual(parseReviewComments([{ body: 'No reviewer data' }, null], 'author'), []);
  assert.throws(() => parseReviewComments({}, 'author'), /unexpected/);
  assert.deepEqual(parseReviewSummaries([{ id: 1, user: { login: 'user' }, body: '', state: 'APPROVED' },
    { id: 2, user: { login: 'user' }, body: 'draft', state: 'PENDING' }]), []);
});
