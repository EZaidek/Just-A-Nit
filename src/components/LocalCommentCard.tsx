import type { LocalComment } from '../lib/review-comments';
import CommentBody from './CommentBody';

export default function LocalCommentCard({ comment, onEdit, onDelete }: {
  comment: LocalComment; onEdit?: () => void; onDelete?: () => void;
}) {
  return <article className="comment-card">
    <header className="comment-card-header"><strong>You</strong><span className="local-badge">Local review</span>
      <span className="comment-location">{comment.side === 'LEFT' ? 'Old' : 'New'} line {comment.line}</span>
      {onEdit && <button type="button" className="quiet-button" onClick={onEdit}>Edit</button>}
      {onDelete && <button type="button" className="quiet-button" onClick={onDelete}>Delete</button>}
    </header>
    {comment.body && <CommentBody body={comment.body} />}
    {comment.suggestion !== undefined && <div className="suggestion-diff">
      <div className="suggestion-label">Suggested change · replaces new line {comment.line}</div>
      <pre className="suggestion-old"><code>{`− ${comment.code}`}</code></pre>
      {comment.suggestion === '' ? <p className="field-help">Remove this line.</p>
        : <pre className="suggestion-new"><code>{comment.suggestion.split('\n').map(line => `+ ${line}`).join('\n')}</code></pre>}
    </div>}
  </article>;
}
