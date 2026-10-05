export type ReviewSide = 'LEFT' | 'RIGHT';
export type CommentTarget = { path: string; line: number; side: ReviewSide; code: string };
export type LocalComment = CommentTarget & { id: string; body: string; suggestion?: string };
export type LocalReview = { comments: LocalComment[]; summary: string };
export const EMPTY_REVIEW: LocalReview = { comments: [], summary: '' };
export type OriginalComment = {
  id: number; author: string; body: string; path: string; line: number | null;
  startLine: number | null; side: ReviewSide; outdated: boolean; diffHunk: string;
  replyTo: number | null; reviewer: boolean;
};
export type OriginalSummary = { id: number; author: string; body: string; state: string };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function parseReviewComments(data: unknown, prAuthor: string): OriginalComment[] {
  if (!Array.isArray(data)) throw new Error('GitHub returned an unexpected review comments response.');
  return data.flatMap(item => {
    if (!record(item) || !positive(item.id) || !record(item.user) || typeof item.user.login !== 'string' ||
      typeof item.body !== 'string' || !item.body.trim() || typeof item.path !== 'string' || !positive(item.pull_request_review_id)) return [];
    const author = item.user.login;
    const currentLine = positive(item.line);
    return [{
      id: item.id as number, author, body: item.body, path: item.path,
      line: currentLine ?? positive(item.original_line), startLine: positive(item.start_line) ?? positive(item.original_start_line),
      side: item.side === 'LEFT' ? 'LEFT' as const : 'RIGHT' as const,
      outdated: currentLine === null && item.subject_type !== 'file',
      diffHunk: typeof item.diff_hunk === 'string' ? item.diff_hunk : '',
      replyTo: positive(item.in_reply_to_id),
      reviewer: item.user.type === 'User' && !author.endsWith('[bot]') && author.toLowerCase() !== prAuthor.toLowerCase(),
    }];
  });
}

export function hasReviewerComment(comments: OriginalComment[], paths: string[]): boolean {
  return comments.some(comment => comment.reviewer && comment.replyTo === null && paths.includes(comment.path));
}

export function parseReviewSummaries(data: unknown): OriginalSummary[] {
  if (!Array.isArray(data)) throw new Error('GitHub returned an unexpected reviews response.');
  return data.flatMap(item => !record(item) || !positive(item.id) || !record(item.user) ||
    typeof item.user.login !== 'string' || typeof item.body !== 'string' || !item.body.trim() ||
    typeof item.state !== 'string' || item.state === 'PENDING' ? [] : [{
      id: item.id as number, author: item.user.login, body: item.body, state: item.state,
    }]);
}

/** Pure local edit operations; no transport or credentials enter this model. */
export function saveLocalComment(review: LocalReview, comment: LocalComment): LocalReview {
  if (!comment.body.trim() && comment.suggestion === undefined) return review;
  if (comment.suggestion !== undefined && comment.side !== 'RIGHT') return review;
  const existing = review.comments.some(item => item.id === comment.id);
  return { ...review, comments: existing
    ? review.comments.map(item => item.id === comment.id ? comment : item)
    : [...review.comments, comment] };
}
export function removeLocalComment(review: LocalReview, id: string): LocalReview {
  return { ...review, comments: review.comments.filter(comment => comment.id !== id) };
}
