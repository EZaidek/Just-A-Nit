import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGitHubApi, normalizeToken } from '../src/lib/github-api.ts';

const signal = () => new AbortController().signal;
const quota = { resources: {
  core: { limit: 5000, remaining: 4980, reset: 2_000_000_000 },
  search: { limit: 30, remaining: 25, reset: 2_000_000_000 },
} };
const json = (data: unknown, init?: ResponseInit) => new Response(JSON.stringify(data), init);

test('adds bearer authentication only in request headers for GitHub GET requests', async () => {
  const api = createGitHubApi(async (url, options) => {
    assert.equal(url, 'https://api.github.com/rate_limit');
    assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer synthetic-test-token');
    assert.equal(options?.method, 'GET');
    assert.equal(options?.credentials, 'omit');
    assert.equal(options?.redirect, 'error');
    assert.equal(options?.cache, 'no-store');
    assert.equal(options?.body, undefined);
    return json(quota);
  }, { token: '  synthetic-test-token  ' });
  assert.deepEqual(await api.checkConnection(signal()), { core: quota.resources.core, search: quota.resources.search });
});

test('anonymous requests omit credentials and independently created clients forget the token', async () => {
  const headers: Array<string | null> = [];
  const fetcher: typeof fetch = async (_url, options) => {
    headers.push(new Headers(options?.headers).get('Authorization'));
    return json({});
  };
  const authenticated = createGitHubApi(fetcher, { token: 'synthetic-test-token' });
  await authenticated.get('/search/repositories?q=test', signal());
  const api = createGitHubApi(fetcher);
  await api.get('/search/repositories?q=test', signal());
  assert.deepEqual(headers, ['Bearer synthetic-test-token', null]);
});

test('rejects blank or malformed tokens without echoing the supplied value', () => {
  for (const token of ['', ' ', 'secret\nline', 'secret token', 'secret\u0000token', 'x'.repeat(1025)]) {
    assert.throws(() => normalizeToken(token), /Enter a GitHub access token/);
  }
  assert.equal(normalizeToken('github_pat_test'), 'github_pat_test');
});

test('restricts credential-bearing requests to supported paths at api.github.com', async () => {
  let calls = 0;
  const api = createGitHubApi(async () => { calls++; return json({}); }, { token: 'synthetic-test-token' });
  for (const path of ['https://other.example/steal', '//other.example/steal', '/user', '/repos/private/repo/issues', '/rate_limit?token=value']) {
    await assert.rejects(api.get(path, signal()), /Unsupported GitHub API request/);
  }
  assert.equal(calls, 0);
});

test('invalid and revoked tokens show an authentication error without anonymous fallback', async () => {
  let calls = 0;
  const api = createGitHubApi(async () => {
    calls++;
    return json({ message: 'synthetic-test-token' }, { status: 401 });
  }, { token: 'synthetic-test-token' });
  await assert.rejects(api.checkConnection(signal()), error => error instanceof Error &&
    error.message.includes('GitHub rejected the token') && !error.message.includes('synthetic-test-token'));
  assert.equal(calls, 1);
});

test('permission failures are distinguished from rate-limit failures and do not echo bodies', async () => {
  const api = createGitHubApi(async () => json({ message: 'synthetic-test-token' }, { status: 403 }), { token: 'synthetic-test-token' });
  await assert.rejects(api.get('/search/issues?q=test', signal()), error => error instanceof Error &&
    error.message.includes('GitHub denied access') && !error.message.includes('synthetic-test-token'));
});

test('primary search limits block search retries while core requests remain available', async context => {
  let now = 1_900_000_000_000;
  context.mock.method(Date, 'now', () => now);
  let calls = 0;
  const api = createGitHubApi(async url => {
    calls++;
    if (String(url).includes('/search/')) return json({}, { status: 403, headers: {
      'x-ratelimit-resource': 'search', 'x-ratelimit-limit': '30',
      'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(now / 1000 + 60),
    } });
    return json({});
  });
  await assert.rejects(api.get('/search/issues?q=test', signal()), /GitHub search is limiting requests/);
  await assert.rejects(api.get('/search/repositories?q=test', signal()), /GitHub search is limiting requests/);
  assert.equal(calls, 1);
  await api.get('/repos/vuejs/core/pulls/1/files?per_page=3', signal());
  assert.equal(calls, 2);
  now += 61_000;
  await assert.rejects(api.get('/search/issues?q=test', signal()), /GitHub search is limiting requests/);
  assert.equal(calls, 3);
});

test('secondary limits prevent retries across resources until Retry-After expires', async context => {
  let now = Date.now();
  context.mock.method(Date, 'now', () => now);
  let calls = 0;
  const api = createGitHubApi(async () => {
    calls++;
    return calls === 1 ? json({ message: 'You have exceeded a secondary rate limit' },
      { status: 403, headers: { 'retry-after': '90' } }) : json({});
  });
  await assert.rejects(api.get('/search/issues?q=test', signal()), /90 seconds/);
  await assert.rejects(api.get('/repos/vuejs/core/pulls/1/files?per_page=3', signal()), /90 seconds/);
  assert.equal(calls, 1);
  now += 91_000;
  await api.get('/repos/vuejs/core/pulls/1/files?per_page=3', signal());
  assert.equal(calls, 2);
});

test('updates core and search budgets separately from authoritative response headers', async () => {
  const api = createGitHubApi(async url => {
    if (String(url).endsWith('/rate_limit')) return json(quota);
    const resource = String(url).includes('/search/') ? 'search' : 'core';
    return json({}, { headers: {
      'x-ratelimit-resource': resource, 'x-ratelimit-limit': resource === 'search' ? '30' : '5000',
      'x-ratelimit-remaining': resource === 'search' ? '24' : '4979', 'x-ratelimit-reset': '2000000000',
    } });
  });
  await api.checkConnection(signal());
  await api.get('/search/repositories?q=test', signal());
  await api.get('/repos/vuejs/core/pulls/1/files?per_page=3', signal());
  assert.equal(api.rateLimits().core?.remaining, 4979);
  assert.equal(api.rateLimits().search?.remaining, 24);
  const snapshot = api.rateLimits();
  snapshot.core!.remaining = 0;
  assert.equal(api.rateLimits().core?.remaining, 4979);
});

test('verification rejects unconfirmed authentication and malformed quota responses', async () => {
  for (const body of [{}, { resources: { core: { limit: 5000 } } },
    { resources: { ...quota.resources, core: { ...quota.resources.core, limit: 60, remaining: 59 } } }]) {
    const api = createGitHubApi(async () => json(body), { token: 'synthetic-test-token' });
    await assert.rejects(api.checkConnection(signal()), /GitHub (could not confirm|did not confirm)/);
  }
});

test('network and parse errors never expose credentials, and cancelled requests stay cancelled', async () => {
  const api = createGitHubApi(async () => { throw new Error('synthetic-test-token'); }, { token: 'synthetic-test-token' });
  await assert.rejects(api.checkConnection(signal()), /Could not reach GitHub/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(api.checkConnection(controller.signal), { name: 'AbortError' });
  const malformed = createGitHubApi(async () => new Response('synthetic-test-token'));
  await assert.rejects(malformed.checkConnection(signal()), /unexpected response/);
});
