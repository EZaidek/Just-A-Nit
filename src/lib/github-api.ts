export type RateLimit = { limit: number; remaining: number; reset: number };
export type RateLimits = { core: RateLimit | null; search: RateLimit | null };
export type GitHubApiOptions = { token?: string };
export class GitHubApiError extends Error {}

const API = 'https://api.github.com';
const ALLOWED_PATH = /^\/(?:rate_limit|search\/(?:repositories|issues)\?.*|repos\/[\w.-]+\/[\w.-]+\/pulls\/(?:comments\?.*|[1-9]\d*\/(?:files|comments|reviews)\?.*))$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function parseLimit(value: unknown): RateLimit | null {
  if (!isRecord(value)) return null;
  const { limit, remaining, reset } = value;
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit <= 0 ||
    typeof remaining !== 'number' || !Number.isSafeInteger(remaining) || remaining < 0 || remaining > limit ||
    typeof reset !== 'number' || !Number.isSafeInteger(reset) || reset <= 0 || !Number.isFinite(new Date(reset * 1000).getTime())) return null;
  return { limit, remaining, reset };
}

export function normalizeToken(value: string): string {
  const token = value.trim();
  if (!token || token.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new GitHubApiError('Enter a GitHub access token without spaces or line breaks.');
  }
  return token;
}

/** A page-session transport. Credentials are held in this closure, never persisted. */
export function createGitHubApi(
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis), options: GitHubApiOptions = {},
) {
  const token = options.token === undefined ? '' : normalizeToken(options.token);
  const limits: RateLimits = { core: null, search: null };
  const cooldowns = new Map<string, { until: number; message: string }>();

  async function get(path: string, signal: AbortSignal): Promise<unknown> {
    if (!ALLOWED_PATH.test(path)) throw new GitHubApiError('Unsupported GitHub API request.');
    const resource = path.startsWith('/search/') ? 'search' : 'core';
    // The quota endpoint is available even when the normal quota is exhausted.
    if (path !== '/rate_limit') {
      for (const key of [resource, 'all']) {
        const cooldown = cooldowns.get(key);
        if (cooldown && cooldown.until > Date.now()) {
          const remaining = Math.ceil((cooldown.until - Date.now()) / 1000);
          throw new GitHubApiError(cooldown.message.replace(/Try again in [\d.]+ seconds/, `Try again in ${remaining} seconds`));
        }
      }
    }
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    let response: Response;
    try {
      response = await fetcher(`${API}${path}`, {
        method: 'GET', signal, headers, redirect: 'error', credentials: 'omit', cache: 'no-store',
      });
    } catch {
      if (signal.aborted) throw new DOMException('GitHub request cancelled.', 'AbortError');
      throw new GitHubApiError('Could not reach GitHub. Check your connection and try again.');
    }

    const headerResource = response.headers.get('x-ratelimit-resource');
    const headerLimit = ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset'].every(header => response.headers.has(header)) ? parseLimit({
      limit: Number(response.headers.get('x-ratelimit-limit')),
      remaining: Number(response.headers.get('x-ratelimit-remaining')),
      reset: Number(response.headers.get('x-ratelimit-reset')),
    }) : null;
    if (headerLimit && (headerResource === 'core' || headerResource === 'search')) limits[headerResource] = headerLimit;

    if (response.status === 401) throw new GitHubApiError('GitHub rejected the token. It may be invalid, expired, or revoked. Enter a valid token or remove it to use anonymous access.');
    if (response.status === 403 || response.status === 429) {
      let body: unknown;
      try { body = await response.json(); } catch { /* Error bodies are optional. */ }
      const mentionsRateLimit = isRecord(body) && typeof body.message === 'string' && /rate limit/i.test(body.message);
      const retryHeader = response.headers.get('retry-after');
      const retrySeconds = retryHeader === null ? null : Number(retryHeader);
      const isRateLimit = response.status === 429 || mentionsRateLimit || retryHeader !== null || response.headers.get('x-ratelimit-remaining') === '0';
      if (isRateLimit) {
        const primary = response.headers.get('x-ratelimit-remaining') === '0' && headerLimit !== null;
        const retry = retrySeconds !== null && Number.isFinite(retrySeconds) && retrySeconds > 0 ? retrySeconds : null;
        const until = retry ? Date.now() + retry * 1000 : primary ? headerLimit.reset * 1000 : Date.now() + 60_000;
        const name = resource === 'search' ? 'GitHub search' : 'GitHub';
        const message = `${name} is limiting requests. ${retry ? `Try again in ${retry} seconds.` : primary
          ? `Try again after ${new Date(until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
          : 'Please wait at least a minute before trying again.'}`;
        cooldowns.set(primary ? resource : 'all', { until, message });
        throw new GitHubApiError(message);
      }
      throw new GitHubApiError(token
        ? 'GitHub denied access. Check that this token can read public repositories and is not restricted by an organization policy.'
        : 'GitHub denied this request. Try connecting a personal access token.');
    }
    if (!response.ok) throw new GitHubApiError(`GitHub could not load this request (HTTP ${response.status}). Please try again later.`);
    try { return await response.json(); }
    catch { throw new GitHubApiError('GitHub returned an unexpected response. Please try again.'); }
  }

  function rateLimits(): RateLimits {
    return { core: limits.core ? { ...limits.core } : null, search: limits.search ? { ...limits.search } : null };
  }

  return {
    get,
    rateLimits,
    async checkConnection(signal: AbortSignal): Promise<RateLimits> {
      const data = await get('/rate_limit', signal);
      if (!isRecord(data) || !isRecord(data.resources)) throw new GitHubApiError('GitHub could not confirm the connection. Please try again.');
      const core = parseLimit(data.resources.core);
      const search = parseLimit(data.resources.search);
      if (!core || !search) throw new GitHubApiError('GitHub could not confirm your rate limits. Please try again.');
      if (token && (limits.core ?? core).limit <= 60) throw new GitHubApiError('GitHub did not confirm authenticated access. Check your token and try again.');
      // Response headers, when present, are authoritative for their resource.
      limits.core ??= core;
      limits.search ??= search;
      return rateLimits();
    },
  };
}
