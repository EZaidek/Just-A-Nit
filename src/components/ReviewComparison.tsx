import type { Review } from '../lib/github';
import type { LocalReview, OriginalComment, OriginalSummary } from '../lib/review-comments';
import CommentBody from './CommentBody';
import LocalCommentCard from './LocalCommentCard';

export default function ReviewComparison({ review, local, comments, summaries }: {
  review: Review; local: LocalReview; comments: OriginalComment[]; summaries: OriginalSummary[];
}) {
  const paths = [...new Set([...review.files.map(file => file.filename), ...comments.map(comment => comment.path)])];
  return <div className="review-comparison">
    <p className="field-help">Compare the points you raised with the original discussion. Original comments may refer to an earlier revision;
      expand their code context to see what the reviewer saw.</p>
    <div className="comparison-columns comparison-heading"><h3>Your review ({local.comments.length})</h3><h3>Original GitHub review ({comments.length})</h3></div>
    <div className="comparison-columns">
      <section aria-label="Your review summary"><h4>Summary</h4>{local.summary.trim() ? <CommentBody body={local.summary} /> : <p className="field-help">No summary written.</p>}</section>
      <section aria-label="Original review summaries"><h4>Review summaries</h4>
        {summaries.length ? summaries.map(summary => <article className="comment-card" key={summary.id}>
          <header className="comment-card-header"><strong>{summary.author}</strong><span className="local-badge">{summary.state.replaceAll('_', ' ').toLowerCase()}</span></header>
          <CommentBody body={summary.body} />
        </article>) : <p className="field-help">No written summaries loaded. Inline review comments appear below.</p>}
      </section>
    </div>
    {paths.map(path => <section key={path} className="comparison-file" aria-label={`Review comparison for ${path}`}>
      <h4 className="comparison-path">{path}</h4>
      <div className="comparison-columns">
        <div aria-label={`Your comments on ${path}`}>
          {local.comments.some(comment => comment.path === path)
            ? local.comments.filter(comment => comment.path === path).map(comment => <LocalCommentCard key={comment.id} comment={comment} />)
            : <p className="field-help">You left no comments on this file.</p>}
        </div>
        <div aria-label={`Original comments on ${path}`}>
          {comments.some(comment => comment.path === path) ? comments.filter(comment => comment.path === path).map(comment => <article className="comment-card" key={comment.id}>
            <header className="comment-card-header"><strong>{comment.author}</strong>
              <span className="comment-location">{comment.side === 'LEFT' ? 'Old' : 'New'} {comment.line === null ? 'file comment' : `line ${comment.startLine && comment.startLine !== comment.line ? `${comment.startLine}–` : ''}${comment.line}`}</span>
              {comment.outdated && <span className="outdated-badge">Earlier revision</span>}
              {comment.replyTo && <span className="local-badge">Reply to comment #{comment.replyTo}</span>}
              <a href={`https://github.com/${review.repo}/pull/${review.number}#discussion_r${comment.id}`} target="_blank" rel="noreferrer">Original</a>
            </header>
            <CommentBody body={comment.body} />
            {comment.diffHunk && <details className="original-context"><summary>Code context from this comment</summary><pre><code>{comment.diffHunk}</code></pre></details>}
          </article>) : <p className="field-help">No original inline comments on this file.</p>}
        </div>
      </div>
    </section>)}
  </div>;
}
