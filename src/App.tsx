import { useEffect, useRef, useState } from 'react';
import ReviewWorkspace from './components/ReviewWorkspace';
import ReviewPreferences from './components/ReviewPreferences';
import GitHubAccess from './components/GitHubAccess';
import { createReviewFinder, type Review } from './lib/github';
import { GitHubApiError, type RateLimits } from './lib/github-api';
import { DEFAULT_FILTERS, PREFERENCES_KEY, restoreFilters, validateFilters, type ReviewFilters } from './lib/preferences';

export default function App() {
  const [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [finder, setFinder] = useState(() => createReviewFinder());
  const [authenticated, setAuthenticated] = useState(false);
  const [checkingToken, setCheckingToken] = useState(false);
  const [rateLimits, setRateLimits] = useState<RateLimits>({ core: null, search: null });
  const [filters, setFilters] = useState<ReviewFilters>(() => {
    try { return restoreFilters(JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? 'null')); }
    catch { return { ...DEFAULT_FILTERS }; }
  });
  const [topics, setTopics] = useState<string[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(true);
  const [topicsError, setTopicsError] = useState('');
  const request = useRef<AbortController | null>(null);
  const tokenRequest = useRef<AbortController | null>(null);

  useEffect(() => () => { request.current?.abort(); tokenRequest.current?.abort(); }, []);

  async function connectToken(token: string) {
    if (tokenRequest.current || request.current) throw new GitHubApiError('Wait for the current request to finish.');
    const controller = new AbortController();
    tokenRequest.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    setCheckingToken(true);
    try {
      const connectedFinder = createReviewFinder(undefined, { token });
      const verifiedLimits = await connectedFinder.checkConnection(controller.signal);
      if (controller.signal.aborted) throw new GitHubApiError('Token verification timed out. Please try again.');
      setFinder(connectedFinder);
      setAuthenticated(true);
      setRateLimits(verifiedLimits);
      setError('');
    } catch (cause) {
      if (controller.signal.aborted) throw new GitHubApiError('Token verification timed out. Please try again.');
      throw cause;
    } finally {
      window.clearTimeout(timeout);
      tokenRequest.current = null;
      setCheckingToken(false);
    }
  }

  function disconnectToken() {
    setFinder(createReviewFinder());
    setAuthenticated(false);
    setRateLimits({ core: null, search: null });
    setError('');
  }

  useEffect(() => {
    if (!validateFilters(filters)) {
      try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(filters)); }
      catch { /* Preferences still work when browser storage is unavailable. */ }
    }
  }, [filters]);

  useEffect(() => {
    const controller = new AbortController();
    let deadline: number | undefined;
    // Debounce language changes and avoid duplicate requests during Strict Mode setup.
    const timer = window.setTimeout(() => {
      setTopicsLoading(true);
      setTopicsError('');
      setTopics([]);
      deadline = window.setTimeout(() => {
        controller.abort();
        setTopicsLoading(false);
        setTopicsError('Tag lookup timed out. You can still enter a GitHub topic.');
      }, 15_000);
      void finder.listTopics(filters.languages, controller.signal).then(values => {
        if (!controller.signal.aborted) setTopics(values);
      }).catch(cause => {
        if (!controller.signal.aborted) setTopicsError(cause instanceof GitHubApiError
          ? `${cause.message} You can still enter a GitHub topic.`
          : 'Could not load tag suggestions. You can still enter a GitHub topic.');
      }).finally(() => {
        window.clearTimeout(deadline);
        if (!controller.signal.aborted) {
          setTopicsLoading(false);
          setRateLimits(finder.rateLimits());
        }
      });
    }, 700);
    return () => { window.clearTimeout(timer); window.clearTimeout(deadline); controller.abort(); };
  }, [filters.languages, finder]);

  async function loadReview() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 45_000);
    setLoading(true);
    setError('');
    setProgress('Searching public pull requests…');
    try {
      const nextReview = await finder.findReview(filters, controller.signal, setProgress);
      setReview(nextReview);
    } catch (cause) {
      if (controller.signal.aborted) {
        setError('The search took too long. Please try again.');
      } else {
        setError(cause instanceof TypeError
          ? 'Could not reach GitHub. Check your internet connection and try again.'
          : cause instanceof Error ? cause.message : 'Could not load a code review. Please try again.');
      }
    } finally {
      window.clearTimeout(timeout);
      request.current = null;
      setLoading(false);
      setProgress('');
      setRateLimits(finder.rateLimits());
    }
  }

  return (
    <main className="page">
      <header className="brand">
        <svg className="brand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <circle cx="6" cy="4" r="2.5" />
          <circle cx="6" cy="20" r="2.5" />
          <circle cx="18" cy="20" r="2.5" />
          <path d="M6 6.5v11M18 17.5V10a6 6 0 0 0-6-6m3-3-3 3 3 3" />
        </svg>
        Just-A-Nit <span className="brand-label">Review practice</span>
      </header>
      <section className="intro" aria-labelledby="welcome-title">
        <p className="eyebrow">Review to your standard.</p>
        <h1 id="welcome-title">Practice your next code review.</h1>
        <p className="summary">Explore a small change from a well-known open source project.
          Write your review, then compare it with the original reviewers’ comments.</p>
        <GitHubAccess authenticated={authenticated} limits={rateLimits} checking={checkingToken}
          disabled={loading} onConnect={connectToken} onDisconnect={disconnectToken} />
        <ReviewPreferences filters={filters} onChange={setFilters} topics={topics}
          topicsLoading={topicsLoading} topicsError={topicsError} disabled={loading || checkingToken} />
        <div className="toolbar">
          <button type="button" disabled={loading || checkingToken || Boolean(validateFilters(filters))} onClick={() => void loadReview()}>
            {loading ? 'Finding a review…' : review ? 'Get another code review' : 'Get a code review'}
          </button>
          <span className="scope">{filters.minLines}–{filters.maxLines} changed lines · {filters.minFiles}–{filters.maxFiles} files</span>
        </div>
        <p className="progress" role="status" aria-live="polite">{progress}</p>
        {error && <div className="error" role="alert">{error}</div>}
      </section>

      <div aria-busy={loading} className={loading && review ? 'review-loading' : undefined}>
        {review ? (
          <section className="review" aria-labelledby="review-title">
            <header className="review-header">
              <div>
                <p className="repo-name">{review.repo} <span>#{review.number}</span></p>
                <h2 id="review-title">{review.title}</h2>
                <p className="review-branch">Default branch: <code>{review.defaultBranch}</code></p>
              </div>
              <a href={review.url} target="_blank" rel="noreferrer">View on GitHub <span aria-hidden="true">↗</span></a>
            </header>
            {review.topics.length > 0 && <div className="review-topics" aria-label="Repository GitHub topics">
              {review.topics.map(topic => <span key={topic}>{topic}</span>)}
            </div>}
            <div className="review-summary">
              <span className="diff-label">Files changed <span className="count-badge">{review.files.length}</span></span>
              <span className="total-stats"><span className="additions">+{review.additions}</span> <span className="deletions">−{review.deletions}</span></span>
              <span className="diff-mode">Unified diff</span>
            </div>
            <ReviewWorkspace key={`${review.repo}#${review.number}`} review={review} finder={finder} onQuota={setRateLimits} />
          </section>
        ) : (
          <section className="empty-state" aria-label="Ready to practice">
            <div className="empty-icon" aria-hidden="true">{'±'}</div>
            <h2>A fresh pair of eyes starts here.</h2>
            <p>Get a code review to see the changed files.<br />Just the code, with a little context.</p>
            <p className="discovery-hint">Popular public repositories, matched to your preferences.</p>
          </section>
        )}
      </div>
      <footer>Public GitHub pull requests · Small changes for focused practice</footer>
    </main>
  );
}
