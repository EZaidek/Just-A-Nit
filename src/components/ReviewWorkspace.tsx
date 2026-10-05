import { useEffect, useRef, useState } from 'react';
import type { createReviewFinder, Review } from '../lib/github';
import type { RateLimits } from '../lib/github-api';
import { EMPTY_REVIEW, removeLocalComment, saveLocalComment, type CommentTarget, type LocalComment, type LocalReview, type OriginalSummary } from '../lib/review-comments';
import FileDiff from './FileDiff';
import CommentEditor from './CommentEditor';
import LocalCommentCard from './LocalCommentCard';
import ReviewComparison from './ReviewComparison';

type Finder = ReturnType<typeof createReviewFinder>;
export default function ReviewWorkspace({ review, finder, onQuota }: {
  review: Review; finder: Finder; onQuota: (limits: RateLimits) => void;
}) {
  const [tab, setTab] = useState<'practice' | 'compare'>('practice');
  const [local, setLocal] = useState<LocalReview>(EMPTY_REVIEW);
  const [editor, setEditor] = useState<{ target: CommentTarget; existing?: LocalComment } | null>(null);
  const [comments, setComments] = useState(review.originalComments);
  const [commentsPage, setCommentsPage] = useState(review.commentsNextPage);
  const [summaries, setSummaries] = useState<OriginalSummary[]>([]);
  const [summariesPage, setSummariesPage] = useState<number | null>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), [finder]);

  async function loadOriginal(kind: 'comments' | 'summaries') {
    const page = kind === 'comments' ? commentsPage : summariesPage;
    if (page === null || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    setBusy(true);
    setError('');
    try {
      if (kind === 'comments') {
        const result = await finder.loadMoreComments(review, page, controller.signal);
        if (controller.signal.aborted) return;
        setComments(current => [...current, ...result.comments.filter(item => !current.some(comment => comment.id === item.id))]);
        setCommentsPage(result.nextPage);
      } else {
        const result = await finder.loadSummaries(review, page, controller.signal);
        if (controller.signal.aborted) return;
        setSummaries(current => [...current, ...result.summaries.filter(item => !current.some(summary => summary.id === item.id))]);
        setSummariesPage(result.nextPage);
      }
    } catch (cause) {
      setError(controller.signal.aborted ? 'Loading the original review timed out. Try again.'
        : cause instanceof Error ? cause.message : 'Could not load more original reviews.');
    } finally {
      window.clearTimeout(timeout);
      request.current = null;
      setBusy(false);
      if (!controller.signal.aborted) onQuota(finder.rateLimits());
    }
  }
  function compare() {
    setTab('compare');
    if (summariesPage === 1) void loadOriginal('summaries');
  }
  function edit(target: CommentTarget, existing?: LocalComment) {
    // One active draft at a time: finish it or cancel before choosing another line.
    if (!editor) setEditor({ target, existing });
  }
  function matches(target: CommentTarget, other: CommentTarget) {
    return target.path === other.path && target.side === other.side && target.line === other.line;
  }

  return <div className="review-workspace">
    <div className="review-tabs" role="tablist" aria-label="Review practice and comparison">
      <button type="button" id="practice-tab" role="tab" aria-selected={tab === 'practice'} aria-controls="practice-panel"
        tabIndex={tab === 'practice' ? 0 : -1} onClick={() => setTab('practice')}
        onKeyDown={event => { if (event.key === 'ArrowRight' && !editor) { compare(); document.getElementById('compare-tab')?.focus(); } }}>Your review <span className="count-badge">{local.comments.length}</span></button>
      <button type="button" id="compare-tab" role="tab" aria-selected={tab === 'compare'} aria-controls="compare-panel"
        tabIndex={tab === 'compare' ? 0 : -1} disabled={Boolean(editor)} onClick={compare}
        onKeyDown={event => { if (event.key === 'ArrowLeft') { setTab('practice'); document.getElementById('practice-tab')?.focus(); } }}>Compare reviews</button>
    </div>
    <div id="practice-panel" role="tabpanel" aria-labelledby="practice-tab" hidden={tab !== 'practice'}>
      <div className="practice-help"><p>Use <strong>+</strong> beside a line to comment or suggest a replacement. Original reviews stay hidden until you compare.</p>
        <p className="field-help">Local to this page. Getting another PR or refreshing clears this practice review.</p>
        {editor && <p className="field-help" role="status">Finish or cancel your open comment before selecting another line or comparing.</p>}
      </div>
      {review.files.map(file => <FileDiff key={file.filename} file={file} onComment={target => edit(target)} renderThread={target => {
        const items = local.comments.filter(comment => matches(target, comment));
        const active = editor && matches(target, editor.target);
        if (!items.length && !active) return null;
        return <>
          {items.filter(comment => comment.id !== editor?.existing?.id).map(comment => <LocalCommentCard key={comment.id} comment={comment}
            onEdit={() => edit(target, comment)} onDelete={() => setLocal(current => removeLocalComment(current, comment.id))} />)}
          {active && <CommentEditor key={editor.existing?.id ?? `${target.path}:${target.side}:${target.line}`} target={editor.target} existing={editor.existing}
            onCancel={() => setEditor(null)} onSave={comment => { setLocal(current => saveLocalComment(current, comment)); setEditor(null); }} />}
        </>;
      }} />)}
      <section className="review-summary-editor"><label htmlFor="local-review-summary">Review summary (optional)</label>
        <textarea id="local-review-summary" value={local.summary} rows={3} placeholder="Overall thoughts, questions, or follow-up checks…"
          onChange={event => setLocal(current => ({ ...current, summary: event.target.value }))} />
        <button type="button" disabled={Boolean(editor)} onClick={compare}>Ready to compare reviews</button>
      </section>
    </div>
    {tab === 'compare' && <div id="compare-panel" role="tabpanel" aria-labelledby="compare-tab">
      <ReviewComparison review={review} local={local} comments={comments} summaries={summaries} />
      <div className="original-loading" aria-live="polite">
        {busy && <p className="field-help" role="status">Loading original review…</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {commentsPage && <button type="button" className="secondary-button" disabled={busy} onClick={() => void loadOriginal('comments')}>Load more original comments</button>}
        {summariesPage && <button type="button" className="secondary-button" disabled={busy} onClick={() => void loadOriginal('summaries')}>{summariesPage === 1 ? 'Load review summaries' : 'Load more review summaries'}</button>}
        {(commentsPage || (summariesPage && summariesPage > 1)) && <p className="field-help">More original review pages are available. The comparison currently shows the loaded pages.</p>}
      </div>
    </div>}
  </div>;
}
