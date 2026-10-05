import type { ReviewFile } from '../lib/github';
import { Fragment, type ReactNode } from 'react';
import type { CommentTarget } from '../lib/review-comments';

export default function FileDiff({ file, onComment, renderThread }: {
  file: ReviewFile; onComment?: (target: CommentTarget) => void;
  renderThread?: (target: CommentTarget) => ReactNode;
}) {
  return (
    <section className="file-diff" aria-label={`Changes in ${file.filename}`}>
      <header className="file-header">
        <span className="file-name">
          <span aria-hidden="true" className="file-icon">▤</span>
          {file.previousFilename && <span className="previous-name">{file.previousFilename} → </span>}
          {file.filename}
        </span>
        <span className="file-stats">
          <span className="file-status">{file.status}</span>
          <span className="additions" aria-label={`${file.additions} added lines`}>+{file.additions}</span>
          <span className="deletions" aria-label={`${file.deletions} removed lines`}>−{file.deletions}</span>
        </span>
      </header>
      <div className="diff-scroll" tabIndex={0} role="region" aria-label={`Scrollable diff for ${file.filename}`}>
        <table className="diff-table">
          <caption className="sr-only">Unified diff for {file.filename}</caption>
          <thead className="sr-only">
            <tr><th>Old line</th><th>New line</th><th>Change</th><th>Code</th></tr>
          </thead>
          <tbody>
            {file.lines.map((line, index) => {
              const number = line.kind === 'removed' ? line.oldLine : line.newLine;
              const target: CommentTarget | null = number === null ? null : {
                path: file.filename, line: number, side: line.kind === 'removed' ? 'LEFT' : 'RIGHT', code: line.content,
              };
              const thread = target && renderThread?.(target);
              return <Fragment key={index}>
              <tr key={index} className={`diff-${line.kind}`}>
                {line.kind === 'hunk' || line.kind === 'note' ? (
                  <td colSpan={4} className="diff-hunk-text"><code>{line.content}</code></td>
                ) : (
                  <>
                    <td className="line-number">{line.oldLine}</td>
                    <td className="line-number">{line.newLine}</td>
                    <td className="line-marker">{onComment && target && <button type="button" className="line-comment-button"
                      aria-label={`Comment on ${file.filename} ${target.side === 'LEFT' ? 'old' : 'new'} line ${target.line}`}
                      title="Add a review comment" onClick={() => onComment(target)}>+</button>}
                      <span>{line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}</span></td>
                    <td className="line-code"><code>{line.content || ' '}</code></td>
                  </>
                )}
              </tr>
              {thread && <tr className="comment-thread-row"><td colSpan={4}><div className="comment-thread">{thread}</div></td></tr>}
              </Fragment>;
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
