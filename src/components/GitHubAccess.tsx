import { useState } from 'react';
import { GitHubApiError, normalizeToken, type RateLimits } from '../lib/github-api';

export type GitHubAccessProps = {
  authenticated: boolean;
  limits: RateLimits;
  checking: boolean;
  disabled: boolean;
  onConnect: (token: string) => Promise<void>;
  onDisconnect: () => void;
};

export default function GitHubAccess({ authenticated, limits, checking, disabled, onConnect, onDisconnect }: GitHubAccessProps) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');

  async function connect() {
    setError('');
    try {
      await onConnect(normalizeToken(draft));
      setDraft('');
    } catch (cause) {
      setError(cause instanceof GitHubApiError ? cause.message : 'Could not connect to GitHub. Please try again.');
    }
  }

  return (
    <details className="github-access" open>
      <summary>GitHub access <span className={authenticated ? 'access-connected' : 'access-anonymous'}>
        {authenticated ? 'Token connected' : 'Anonymous'}
      </span></summary>
      <div className="access-body">
        <p className="field-help">Use your personal token for a higher API allowance. It stays in this page’s memory and is cleared on refresh or removal.</p>
        <div className="token-entry">
          <label htmlFor="github-token">Personal access token</label>
          <div className="token-controls">
            <input id="github-token" type="password" autoComplete="off" spellCheck={false} autoCapitalize="none"
              placeholder={authenticated ? 'Enter a replacement token' : 'Paste your GitHub token'} value={draft}
              disabled={disabled || checking} maxLength={1024}
              onChange={event => { setDraft(event.target.value); setError(''); }}
              onKeyDown={event => {
                if (event.key === 'Enter' && draft.trim() && !disabled && !checking) {
                  event.preventDefault(); void connect();
                }
              }} />
            <button type="button" className="secondary-button" disabled={disabled || checking || !draft.trim()}
              onClick={() => void connect()}>{checking ? 'Checking token…' : 'Use token'}</button>
            {authenticated && <button type="button" className="quiet-button" disabled={disabled || checking}
              onClick={() => { setDraft(''); setError(''); onDisconnect(); }}>Remove token</button>}
          </div>
        </div>
        <p className="field-help">A fine-grained token’s public read access is sufficient. <a
          href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">Create a token on GitHub ↗</a></p>
        <div className="rate-status" role="status" aria-live="polite">
          {checking ? 'Verifying access with GitHub…' : authenticated ? 'Authenticated with GitHub.' : 'Using public, unauthenticated access.'}
          <span>{limits.core ? ` REST: ${limits.core.remaining.toLocaleString()} / ${limits.core.limit.toLocaleString()} remaining this hour.`
            : ` REST allowance: ${authenticated ? 'reported by GitHub' : '60 requests/hour'}.`}</span>
          <span>{limits.search ? ` Search: ${limits.search.remaining} / ${limits.search.limit} remaining this minute.`
            : ` Search allowance: ${authenticated ? '30' : '10'} requests/minute.`}</span>
        </div>
        {error && <p className="validation-error" role="alert">{error}</p>}
      </div>
    </details>
  );
}
