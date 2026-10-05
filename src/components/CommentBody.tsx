import Markdown from 'react-markdown';

export default function CommentBody({ body }: { body: string }) {
  return <div className="comment-markdown"><Markdown skipHtml components={{
    a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
    img: ({ alt }) => <span>{alt ? `[Image: ${alt}]` : '[Image]'}</span>,
    code: ({ children, className }) => className?.startsWith('language-suggestion')
      ? <code className="original-suggestion"><span className="suggestion-label">Suggested change</span>{children}</code>
      : <code className={className}>{children}</code>,
  }}>{body}</Markdown></div>;
}
