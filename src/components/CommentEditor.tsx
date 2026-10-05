import { useId, useState } from 'react';
import type { CommentTarget, LocalComment } from '../lib/review-comments';
import CommentBody from './CommentBody';
import LocalCommentCard from './LocalCommentCard';

export default function CommentEditor({ target, existing, onSave, onCancel }: {
  target: CommentTarget; existing?: LocalComment; onSave: (comment: LocalComment) => void; onCancel: () => void;
}) {
  const id = useId();
  const [body, setBody] = useState(existing?.body ?? '');
  const [suggesting, setSuggesting] = useState(existing?.suggestion !== undefined);
  const [suggestion, setSuggestion] = useState(existing?.suggestion ?? target.code);
  const [preview, setPreview] = useState(false);
  const comment = { ...target, id: existing?.id ?? id, body: body.trim(), suggestion: suggesting ? suggestion : undefined };
  return <form className="comment-editor" onSubmit={event => { event.preventDefault(); onSave(comment); }}>
    <header><strong>{existing ? 'Edit comment' : 'Add a review comment'}</strong>
      <span className="comment-location">{target.side === 'LEFT' ? 'Old' : 'New'} line {target.line}</span>
    </header>
    <div className="editor-tabs" aria-label="Comment mode">
      <button type="button" className="secondary-button" aria-pressed={!preview} onClick={() => setPreview(false)}>Write</button>
      <button type="button" className="secondary-button" aria-pressed={preview} onClick={() => setPreview(true)}>Preview</button>
      {target.side === 'RIGHT' && <button type="button" className="quiet-button" aria-pressed={suggesting}
        onClick={() => { setSuggesting(!suggesting); setPreview(false); }}>{suggesting ? 'Remove suggestion' : 'Suggest a change'}</button>}
    </div>
    {preview ? <div className="comment-preview">
      {suggesting ? <LocalCommentCard comment={comment} /> : body.trim() ? <CommentBody body={body} /> : <p>Nothing to preview.</p>}
    </div> : <>
      <label className="sr-only" htmlFor={`${id}-body`}>Review comment</label>
      <textarea id={`${id}-body`} autoFocus value={body} onChange={event => setBody(event.target.value)}
        placeholder="Leave a comment… Markdown is supported." rows={4} />
      {suggesting && <label className="suggestion-editor">Replacement for new line {target.line}
        <textarea aria-label="Suggested replacement" value={suggestion} onChange={event => setSuggestion(event.target.value)} rows={4} spellCheck={false} />
        <span className="field-help">Replace one line with one or more lines. Leave empty to suggest removing it.</span>
      </label>}
    </>}
    <div className="editor-actions"><span className="field-help">Saved locally for this practice. Never posted to GitHub.</span>
      <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
      <button type="submit" disabled={!body.trim() && !suggesting}>{existing ? 'Save changes locally' : 'Add comment locally'}</button>
    </div>
  </form>;
}
