import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReviewFinder, repositoryQuery, selectSmallFiles } from '../src/lib/github.ts';
import { DEFAULT_FILTERS, LANGUAGES, type ReviewFilters } from '../src/lib/preferences.ts';

const smallFile = {
  filename: 'src/example.ts', status: 'modified', additions: 1, deletions: 1,
  patch: '@@ -1 +1 @@\n-old()\n+new()',
};
const item = (number: number, repo = 'vuejs/core') => ({
  number, title: `Fix ${number}`, repository_url: `https://api.github.com/repos/${repo}`,
  pull_request: {}, body: 'Comments and descriptions must not be displayed',
  user: { login: 'pr-author' },
});
const repository = {
  full_name: 'vuejs/core', default_branch: 'main', private: false, fork: false, archived: false,
  stargazers_count: 50000, topics: ['frontend', 'framework'],
};
const json = (data: unknown) => new Response(JSON.stringify(data), {
  headers: { 'Content-Type': 'application/json' },
});
const reviewComment = {
  id: 1, pull_request_review_id: 10, path: smallFile.filename, line: 1, side: 'RIGHT',
  user: { login: 'reviewer', type: 'User' }, body: 'Please cover the empty input case.',
};
const withRepos = (handler: typeof fetch): typeof fetch => async (...args) =>
  String(args[0]).includes('/search/repositories') ? json({ items: [repository] })
    : String(args[0]).includes('/pulls/comments?') ? json([])
      : String(args[0]).includes('/comments?') ? json([reviewComment]) : handler(...args);
const filters = (changes: Partial<ReviewFilters> = {}): ReviewFilters => ({ ...DEFAULT_FILTERS, ...changes });
const signal = () => new AbortController().signal;
const progress = () => {};

test('accepts a complete small source diff and keeps renamed filenames', () => {
  const files = selectSmallFiles([{ ...smallFile, status: 'renamed', previous_filename: 'src/old.ts' }]);
  assert.equal(files?.[0].previousFilename, 'src/old.ts');
  assert.equal(files?.[0].lines.length, 3);
});

test('rejects oversized PRs, documentation, binary/missing patches, and partial patches', () => {
  for (const input of [null, [], [smallFile, smallFile, smallFile],
    [{ ...smallFile, additions: 20 }], [{ ...smallFile, filename: 'README.md' }],
    [{ ...smallFile, patch: undefined }], [{ ...smallFile, patch: '@@ -1 +1 @@\n-old()' }],
    [{ ...smallFile, additions: -1 }], [{ ...smallFile, additions: 2 }]]) {
    assert.equal(selectSmallFiles(input), null);
  }
});

test('enforces the changed-line limit across all files, including custom ranges', () => {
  const added = (filename: string, count: number) => ({
    filename, status: 'added', additions: count, deletions: 0,
    patch: `@@ -0,0 +1,${count} @@\n${Array.from({ length: count }, () => '+code').join('\n')}`,
  });
  assert.equal(selectSmallFiles([added('one.py', 10), added('two.py', 10)])?.length, 2);
  assert.equal(selectSmallFiles([added('one.py', 10), added('two.py', 11)]), null);
  assert.equal(selectSmallFiles([added('one.py', 10)], filters({ minLines: 11 })), null);
  assert.equal(selectSmallFiles([added('one.py', 25)], filters({ maxLines: 30 }))?.length, 1);
  assert.equal(selectSmallFiles([added('one.py', 10)], filters({ minFiles: 2 })), null);
});

test('all changed files must use selected languages and the whole PR must match', () => {
  assert.equal(selectSmallFiles([smallFile], filters({ languages: ['Python'] })), null);
  assert.equal(selectSmallFiles([smallFile], filters({ languages: ['TypeScript'] }))?.length, 1);
  assert.equal(selectSmallFiles([smallFile, { ...smallFile, filename: 'test.py' }], filters({ languages: ['TypeScript'] })), null);
  assert.equal(selectSmallFiles([smallFile, { ...smallFile, filename: 'test.py' }], filters({ languages: ['TypeScript', 'Python'] }))?.length, 2);
});

test('discovers public popular repos and searches merged PRs on the default branch', async () => {
  const calls: string[] = [];
  const finder = createReviewFinder(async url => {
    calls.push(String(url));
    if (String(url).includes('/search/repositories')) return json({ items: [repository] });
    if (String(url).includes('/search/issues')) return json({ items: [item(12)] });
    return json([smallFile, smallFile, smallFile]);
  });
  await assert.rejects(finder.findReview(filters(), signal(), progress), /No reviewed change matched/);
  assert.match(decodeURIComponent(calls[0]), /stars:>=1000/);
  assert.match(decodeURIComponent(calls[0]), /is:public/);
  assert.match(decodeURIComponent(calls[1]), /repo:vuejs\/core/);
  assert.match(decodeURIComponent(calls[1].replace(/\+/g, ' ')), /base:"main"/);
  assert.equal(calls[3], 'https://api.github.com/repos/vuejs/core/pulls/12/files?per_page=3');
});

test('uses the candidate queue for subsequent clicks and never repeats a review', async () => {
  const calls: string[] = [];
  const finder = createReviewFinder(withRepos(async url => {
    calls.push(String(url));
    return String(url).includes('/search/issues') ? json({ items: [item(1), item(2)] }) : json([smallFile]);
  }));
  const first = await finder.findReview(filters(), signal(), progress);
  const second = await finder.findReview(filters(), signal(), progress);
  assert.notEqual(first.number, second.number);
  assert.equal(calls.length, 3);
  assert.equal(first.additions, 1);
  assert.equal(first.deletions, 1);
  assert.equal('body' in first, false);
  assert.deepEqual(first.topics, repository.topics);
  assert.equal(first.defaultBranch, 'main');
});

test('ignores candidate repos outside the discovered set and malformed search results', async () => {
  let calls = 0;
  const finder = createReviewFinder(withRepos(async () => {
    calls++;
    return json({ items: [item(1, 'unknown/repo'), { number: 2 }, item(-1)] });
  }));
  await assert.rejects(finder.findReview(filters(), signal(), progress), /No reviewed change matched/);
  assert.equal(calls, 1);
});

test('surfaces rate limiting, observes cooldown, and retains failed candidates for retry', async context => {
  let now = Date.now();
  context.mock.method(Date, 'now', () => now);
  let calls = 0;
  const finder = createReviewFinder(withRepos(async () => {
    calls++;
    if (calls === 1) return json({ items: [item(5)] });
    if (calls === 2) return new Response('', { status: 429, headers: { 'retry-after': '60' } });
    return json([smallFile]);
  }));
  await assert.rejects(finder.findReview(filters(), signal(), progress), /Try again in 60 seconds/);
  await assert.rejects(finder.findReview(filters(), signal(), progress), /Try again in 60 seconds/);
  assert.equal(calls, 2);
  now += 61_000;
  assert.equal((await finder.findReview(filters(), signal(), progress)).number, 5);
  assert.equal(calls, 3);
});

test('forwards abort signals and limits file lookups per click', async () => {
  let lookups = 0;
  const abortSignal = signal();
  const finder = createReviewFinder(withRepos(async (url, options) => {
    assert.equal(options?.signal, abortSignal);
    if (String(url).includes('/search/issues')) return json({ items: Array.from({ length: 20 }, (_, n) => item(n + 1)) });
    lookups++;
    return json([{ ...smallFile, filename: 'README.md' }]);
  }));
  await assert.rejects(finder.findReview(filters(), abortSignal, progress), /No reviewed change matched/);
  assert.equal(lookups, 12);
});

test('tag discovery comes from GitHub metadata and repository queries combine topics', async () => {
  let calls = 0;
  const finder = createReviewFinder(async url => {
    calls++;
    if (String(url).includes('language')) return json({ items: [repository] });
    return json({ items: [{ ...repository, language: 'TypeScript', full_name: 'vitejs/vite', topics: ['build-tool', 'dev-server', 'frontend', 'hmr'] }] });
  });
  assert.deepEqual(await finder.listTopics(['TypeScript'], signal()), ['build-tool', 'dev-server', 'framework', 'frontend', 'hmr']);
  await finder.listTopics(['TypeScript'], signal());
  assert.equal(calls, 2);
  assert.match(repositoryQuery(['C#', 'C++'], ['build-tool', 'frontend']), /language:"C#" language:"C\+\+"/);
  assert.match(repositoryQuery([], ['frontend', 'hmr']), /topic:frontend topic:hmr/);
});

test('rejects private, forked, archived, low-star, and incorrectly tagged repositories', async () => {
  const finder = createReviewFinder(async () => json({ items: [
    { ...repository, private: true }, { ...repository, fork: true },
    { ...repository, archived: true }, { ...repository, stargazers_count: 20 },
    { ...repository, topics: ['frontend'] },
  ] }));
  await assert.rejects(finder.findReview(filters({ topics: ['frontend', 'build-tool'] }), signal(), progress), /No popular public repositories/);
});

test('changing limits creates a new candidate search and reevaluates previously rejected PRs', async () => {
  let fileRequests = 0;
  const finder = createReviewFinder(withRepos(async url => {
    if (String(url).includes('/search/issues')) return json({ items: [item(5)] });
    fileRequests++;
    assert.match(String(url), new RegExp(`per_page=${fileRequests === 1 ? 2 : 4}$`));
    return json([smallFile, { ...smallFile, filename: 'two.ts' }, { ...smallFile, filename: 'three.ts' }]);
  }));
  await assert.rejects(finder.findReview(filters({ maxFiles: 1 }), signal(), progress), /No reviewed change matched/);
  const review = await finder.findReview(filters({ maxFiles: 3 }), signal(), progress);
  assert.equal(review.files.length, 3);
  assert.equal(fileRequests, 2);
});

test('invalid preference ranges are rejected before any request', async () => {
  const finder = createReviewFinder(async () => { throw new Error('Unexpected API call'); });
  await assert.rejects(finder.findReview(filters({ minLines: 30, maxLines: 20 }), signal(), progress), /Minimum changed lines/);
});

test('large language and topic selections stay within GitHub search query limits', () => {
  const query = repositoryQuery(LANGUAGES.map(language => language.name), Array.from({ length: 5 }, (_, n) => `${n}${'a'.repeat(49)}`));
  assert.ok(query.length <= 256);
  assert.match(query, /stars:>=1000/);
});

test('connected finder authenticates quota, repository, topic, PR, and file requests', async () => {
  const paths: string[] = [];
  const finder = createReviewFinder(async (url, options) => {
    assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer synthetic-test-token');
    paths.push(new URL(String(url)).pathname);
    if (String(url).endsWith('/rate_limit')) return json({ resources: {
      core: { limit: 5000, remaining: 4999, reset: 2000000000 },
      search: { limit: 30, remaining: 29, reset: 2000000000 },
    } });
    if (String(url).includes('/search/repositories')) return json({ items: [repository] });
    if (String(url).includes('/search/issues')) return json({ items: [item(1)] });
    if (String(url).includes('/comments?')) return json([reviewComment]);
    return json([smallFile]);
  }, { token: 'synthetic-test-token' });
  await finder.checkConnection(signal());
  await finder.listTopics([], signal());
  const review = await finder.findReview(filters(), signal(), progress);
  assert.equal(review.number, 1);
  assert.deepEqual(paths, ['/rate_limit', '/search/repositories', '/search/issues', '/repos/vuejs/core/pulls/comments', '/repos/vuejs/core/pulls/1/files', '/repos/vuejs/core/pulls/1/comments']);
});

test('only accepts human root review comments from someone other than the PR author on changed files', async () => {
  for (const comments of [[], [{ ...reviewComment, user: { login: 'pr-author', type: 'User' } }],
    [{ ...reviewComment, user: { login: 'review-bot[bot]', type: 'Bot' } }],
    [{ ...reviewComment, path: 'unrelated.py' }], [{ ...reviewComment, in_reply_to_id: 9 }]]) {
    const finder = createReviewFinder(async url => {
      if (String(url).includes('/search/repositories')) return json({ items: [repository] });
      if (String(url).includes('/search/issues')) return json({ items: [item(1)] });
      return json(String(url).includes('/files?') ? [smallFile] : comments);
    });
    await assert.rejects(finder.findReview(filters(), signal(), progress), /No reviewed change matched/);
  }
});

test('builds a validated pool before randomly choosing and serves subsequent picks without requests', async () => {
  let fileRequests = 0;
  const finder = createReviewFinder(withRepos(async url => {
    if (String(url).includes('/search/issues')) return json({ items: [item(1), item(2), item(3)] });
    fileRequests++;
    return json([smallFile]);
  }), { random: () => 0.999 });
  const first = await finder.findReview(filters(), signal(), progress);
  assert.equal(fileRequests, 3);
  assert.equal(first.number, 3);
  const second = await finder.findReview(filters(), signal(), progress);
  assert.notEqual(second.number, first.number);
  assert.equal(fileRequests, 3);
  assert.equal(first.originalComments[0].body, reviewComment.body);
});

test('default discovery is broad and a pool rotates among repositories', async () => {
  assert.doesNotMatch(repositoryQuery([], []), /repo:/);
  const names = ['vuejs/core', 'vitejs/vite', 'django/django'];
  const finder = createReviewFinder(async url => {
    const parsed = new URL(String(url));
    if (parsed.pathname === '/search/repositories') return json({ items: names.map(full_name => ({ ...repository, full_name, language: 'TypeScript' })) });
    if (parsed.pathname === '/search/issues') {
      const name = parsed.searchParams.get('q')!.match(/repo:(\S+)/)![1];
      return json({ items: [item(1, name)] });
    }
    return json(parsed.pathname.endsWith('/files') ? [smallFile] : [reviewComment]);
  }, { random: () => 0.999 });
  const first = await finder.findReview(filters(), signal(), progress);
  const second = await finder.findReview(filters(), signal(), progress);
  const third = await finder.findReview(filters(), signal(), progress);
  assert.equal(new Set([first.repo, second.repo, third.repo]).size, 3);
});

test('qualifies paginated comments and exposes remaining comment and summary pages', async () => {
  const finder = createReviewFinder(async url => {
    const path = String(url);
    if (path.includes('/search/repositories')) return json({ items: [repository] });
    if (path.includes('/search/issues')) return json({ items: [item(1)] });
    if (path.includes('/files?')) return json([smallFile]);
    if (path.includes('/reviews?')) return json([{ id: 1, user: { login: 'reviewer' }, body: 'Needs a test.', state: 'CHANGES_REQUESTED' }]);
    if (path.endsWith('page=1')) return json(Array.from({ length: 100 }, (_, n) => ({ ...reviewComment, id: n + 1, path: 'other.ts' })));
    if (path.endsWith('page=2')) return json(Array.from({ length: 100 }, (_, n) => ({ ...reviewComment, id: n + 101 })));
    return json([{ ...reviewComment, id: 201 }]);
  });
  const review = await finder.findReview(filters(), signal(), progress);
  assert.equal(review.originalComments.length, 200);
  assert.equal(review.commentsNextPage, 3);
  assert.equal((await finder.loadMoreComments(review, 3, signal())).comments[0].id, 201);
  assert.equal((await finder.loadSummaries(review, 1, signal())).summaries[0].state, 'CHANGES_REQUESTED');
});

test('prioritizes recently discussed PRs but still verifies their size and actual comments', async () => {
  const filesChecked: number[] = [];
  const finder = createReviewFinder(async url => {
    const path = new URL(String(url)).pathname;
    if (path === '/search/repositories') return json({ items: [repository] });
    if (path === '/search/issues') return json({ items: Array.from({ length: 20 }, (_, n) => item(n + 1)) });
    if (path === '/repos/vuejs/core/pulls/comments') return json([{ ...reviewComment, pull_request_url: 'https://api.github.com/repos/vuejs/core/pulls/19' }]);
    if (path.endsWith('/files')) {
      const number = Number(path.split('/')[5]);
      filesChecked.push(number);
      return json([{ ...smallFile, filename: number === 19 ? smallFile.filename : 'README.md' }]);
    }
    return json([reviewComment]);
  }, { random: () => 0.999 });
  const review = await finder.findReview(filters(), signal(), progress);
  assert.equal(review.number, 19);
  assert.equal(filesChecked[0], 19);
  assert.equal(filesChecked.length, 12);
});
