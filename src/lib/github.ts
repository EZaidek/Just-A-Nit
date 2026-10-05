import { parsePatch, type DiffLine } from './diff.ts';
import { createGitHubApi, type GitHubApiOptions } from './github-api.ts';
import { hasReviewerComment, parseReviewComments, parseReviewSummaries, type OriginalComment, type OriginalSummary } from './review-comments.ts';
import {
  DEFAULT_FILTERS, LANGUAGES, fileMatchesLanguages, filterKey, validateFilters,
  type Language, type ReviewFilters,
} from './preferences.ts';

const API = 'https://api.github.com';
const MAX_CANDIDATES_PER_CLICK = 12;
const POOL_SIZE = 3;
export const MIN_REPOSITORY_STARS = 1000;

type Repository = { name: string; defaultBranch: string; topics: string[]; language: string | null };
type Candidate = { repo: string; number: number; title: string; author: string };
export type ReviewFile = {
  filename: string;
  previousFilename?: string;
  status: string;
  additions: number;
  deletions: number;
  lines: DiffLine[];
};
export type Review = Candidate & {
  url: string;
  files: ReviewFile[];
  additions: number;
  deletions: number;
  topics: string[];
  defaultBranch: string;
  originalComments: OriginalComment[];
  commentsNextPage: number | null;
};

type Fetch = typeof globalThis.fetch;
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Return only complete source-code diffs matching the user's size/language filters. */
export function selectSmallFiles(data: unknown, filters: ReviewFilters = DEFAULT_FILTERS): ReviewFile[] | null {
  if (validateFilters(filters) || !Array.isArray(data) || data.length < filters.minFiles || data.length > filters.maxFiles) return null;
  const files: ReviewFile[] = [];
  let changes = 0;
  for (const file of data) {
    if (!isRecord(file) || typeof file.filename !== 'string' ||
      !fileMatchesLanguages(file.filename, filters.languages) || typeof file.patch !== 'string' ||
      typeof file.status !== 'string' || !isCount(file.additions) || !isCount(file.deletions)) return null;
    changes += file.additions + file.deletions;
    if (changes > filters.maxLines) return null;
    try {
      const lines = parsePatch(file.patch);
      if (lines.filter(line => line.kind === 'added').length !== file.additions ||
        lines.filter(line => line.kind === 'removed').length !== file.deletions) return null;
      files.push({
        filename: file.filename,
        previousFilename: typeof file.previous_filename === 'string' ? file.previous_filename : undefined,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        lines,
      });
    } catch {
      return null;
    }
  }
  return changes >= filters.minLines ? files : null;
}

export function repositoryQuery(languages: readonly Language[], topics: readonly string[]): string {
  const base = `is:public stars:>=${MIN_REPOSITORY_STARS} archived:false fork:false`;
  let withTopics = base;
  for (const topic of topics) {
    const next = `${withTopics} topic:${topic}`;
    if (next.length <= 256) withTopics = next;
  }
  // All selected topics are verified against returned repository metadata,
  // including any that don't fit in GitHub's search query.
  const languageQuery = languages.map(language => `language:"${language}"`).join(' ');
  // Broad language selections can exceed GitHub's 256-character search limit.
  // In that case discover by topics and enforce languages on every changed file.
  return languages.length === LANGUAGES.length || `${withTopics} ${languageQuery}`.length > 256
    ? withTopics : `${withTopics} ${languageQuery}`.trim();
}

type RepositoryQueue = { repository: Repository; candidates: Candidate[]; page: number };
type SearchState = { queues: RepositoryQueue[]; repoIndex: number; checked: Set<string>; pool: Review[] };
type FinderOptions = GitHubApiOptions & { random?: () => number };

export function createReviewFinder(fetcher: Fetch = globalThis.fetch.bind(globalThis), options: FinderOptions = {}) {
  const repositories = new Map<string, Repository[]>();
  const searches = new Map<string, SearchState>();
  const shown = new Set<string>();
  const random = options.random ?? Math.random;
  let lastRepository = '';
  function shuffle<T>(items: T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  const api = createGitHubApi(fetcher, options);
  const get = api.get;

  async function discover(languages: Language[], topics: string[], signal: AbortSignal): Promise<Repository[]> {
    const key = JSON.stringify([[...languages].sort(), [...topics].sort()]);
    const cached = repositories.get(key);
    if (cached) return cached;
    const params = new URLSearchParams({ q: repositoryQuery(languages, topics), sort: 'stars', order: 'desc', per_page: '100' });
    const result = await get(`/search/repositories?${params}`, signal);
    if (!isRecord(result) || !Array.isArray(result.items)) throw new Error('GitHub returned an unexpected repository response. Please try again.');
    const found: Repository[] = [];
    for (const item of result.items) {
      if (!isRecord(item) || typeof item.full_name !== 'string' ||
        !/^[\w.-]+\/[\w.-]+$/.test(item.full_name) || typeof item.default_branch !== 'string' || !item.default_branch ||
        item.private !== false || item.fork !== false || item.archived !== false ||
        !isCount(item.stargazers_count) || item.stargazers_count < MIN_REPOSITORY_STARS || !Array.isArray(item.topics)) continue;
      const repoTopics = item.topics.filter((topic): topic is string => typeof topic === 'string');
      if (!topics.every(topic => repoTopics.includes(topic))) continue;
      found.push({ name: item.full_name, defaultBranch: item.default_branch, topics: repoTopics,
        language: typeof item.language === 'string' ? item.language : null });
    }
    // Prefer software projects over tutorial, book, and link collections.
    const software = found.filter(repo => repo.language &&
      !repo.topics.some(topic => ['awesome', 'awesome-list', 'list', 'books', 'tutorial'].includes(topic)));
    const ordered = [...shuffle(software), ...shuffle(found.filter(repo => !software.includes(repo)))];
    repositories.set(key, ordered);
    return ordered;
  }

  async function search(queue: RepositoryQueue, state: SearchState, signal: AbortSignal) {
    const repository = queue.repository;
    const branch = repository.defaultBranch.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const query = `is:pr is:merged repo:${repository.name} base:"${branch}" -review:none -label:dependencies`;
    const params = new URLSearchParams({ q: query, sort: 'created', order: 'desc', per_page: '100', page: String(queue.page) });
    const result = await get(`/search/issues?${params}`, signal);
    if (!isRecord(result) || !Array.isArray(result.items)) throw new Error('GitHub returned an unexpected search response. Please try again.');
    // Review states include empty approvals. Use actual recent discussion as
    // a hint, then still verify each selected PR's comments against its files.
    const discussion = result.items.length ? await get(`/repos/${repository.name}/pulls/comments?sort=created&direction=desc&per_page=100`, signal) : [];
    if (!Array.isArray(discussion)) throw new Error('GitHub returned an unexpected repository review comments response.');
    const reviewers = new Map<number, Set<string>>();
    for (const comment of discussion) {
      if (!isRecord(comment) || typeof comment.pull_request_url !== 'string' || typeof comment.body !== 'string' || !comment.body.trim() ||
        comment.in_reply_to_id || !isRecord(comment.user) || comment.user.type !== 'User' || typeof comment.user.login !== 'string' || comment.user.login.endsWith('[bot]')) continue;
      const prefix = `${API}/repos/${repository.name}/pulls/`;
      if (!comment.pull_request_url.startsWith(prefix)) continue;
      const number = Number(comment.pull_request_url.slice(prefix.length));
      if (!isCount(number) || !number) continue;
      const authors = reviewers.get(number) ?? new Set<string>();
      authors.add(comment.user.login.toLowerCase());
      reviewers.set(number, authors);
    }
    const found: Candidate[] = [];
    for (const item of result.items) {
      if (!isRecord(item) || !isCount(item.number) || item.number === 0 || typeof item.title !== 'string' || !item.pull_request ||
        !isRecord(item.user) || typeof item.user.login !== 'string' || !item.user.login ||
        typeof item.repository_url !== 'string' || item.repository_url.toLowerCase() !== `${API}/repos/${repository.name}`.toLowerCase()) continue;
      const id = `${repository.name}#${item.number}`;
      if (!state.checked.has(id) && !shown.has(id)) found.push({ repo: repository.name, number: item.number, title: item.title,
        author: item.user.login });
    }
    const discussed = (candidate: Candidate) => [...(reviewers.get(candidate.number) ?? [])].some(author => author !== candidate.author.toLowerCase());
    queue.candidates = [...shuffle(found.filter(discussed)), ...shuffle(found.filter(candidate => !discussed(candidate)))];
    queue.page = result.items.length === 100 && queue.page < 10 ? queue.page + 1 : 1;
  }

  async function commentPage(review: Candidate, page: number, signal: AbortSignal) {
    if (!Number.isSafeInteger(page) || page < 1) throw new Error('Invalid review page.');
    const data = await get(`/repos/${review.repo}/pulls/${review.number}/comments?per_page=100&page=${page}`, signal);
    return { comments: parseReviewComments(data, review.author), nextPage: Array.isArray(data) && data.length === 100 ? page + 1 : null };
  }
  function choose(state: SearchState): Review {
    const available = state.pool.filter(review => !shown.has(`${review.repo}#${review.number}`));
    const diverse = available.filter(review => review.repo !== lastRepository);
    const choices = diverse.length ? diverse : available;
    const review = choices[Math.floor(random() * choices.length)];
    state.pool = available.filter(item => item !== review);
    shown.add(`${review.repo}#${review.number}`);
    lastRepository = review.repo;
    return review;
  }

  return {
    checkConnection: api.checkConnection,
    rateLimits: api.rateLimits,
    loadMoreComments: commentPage,
    async loadSummaries(review: Review, page: number, signal: AbortSignal): Promise<{ summaries: OriginalSummary[]; nextPage: number | null }> {
      if (!Number.isSafeInteger(page) || page < 1) throw new Error('Invalid review page.');
      const data = await get(`/repos/${review.repo}/pulls/${review.number}/reviews?per_page=100&page=${page}`, signal);
      return { summaries: parseReviewSummaries(data), nextPage: Array.isArray(data) && data.length === 100 ? page + 1 : null };
    },
    async listTopics(languages: Language[], signal: AbortSignal): Promise<string[]> {
      // Supplement common-language suggestions with topics from the broad discovery cache.
      const broad = !languages.length || languages.some(language => ['Python', 'TypeScript', 'JavaScript'].includes(language))
        ? await discover([], [], signal) : [];
      const repos = languages.length ? await discover(languages, [], signal) : broad;
      const relevant = broad.filter(repo => !languages.length || languages.some(language => language === repo.language));
      return [...new Set([...repos, ...relevant].flatMap(repo => repo.topics))].sort();
    },
    async findReview(
      filters: ReviewFilters, signal: AbortSignal, onProgress: (message: string) => void,
    ): Promise<Review> {
      const validationError = validateFilters(filters);
      if (validationError) throw new Error(validationError);
      signal.throwIfAborted();
      const key = filterKey(filters);
      let state = searches.get(key);
      if (!state) {
        onProgress('Finding repositories matching your preferences…');
        const repos = await discover(filters.languages, filters.topics, signal);
        if (!repos.length) throw new Error('No popular public repositories match these languages and tags. Try fewer tags or different languages.');
        state = { queues: repos.map(repository => ({ repository, candidates: [], page: 1 })), repoIndex: 0, checked: new Set(), pool: [] };
        searches.set(key, state);
      }
      state.pool = state.pool.filter(review => !shown.has(`${review.repo}#${review.number}`));
      if (state.pool.length) return choose(state);
      const active = Array.from({ length: Math.min(3, state.queues.length) }, (_, index) =>
        state!.queues[(state!.repoIndex + index) % state!.queues.length]);
      try {
        onProgress('Collecting reviewed pull requests across repositories…');
        for (const queue of active) if (!queue.candidates.length) await search(queue, state, signal);
        for (let attempt = 0; attempt < MAX_CANDIDATES_PER_CLICK && state.pool.length < POOL_SIZE; attempt++) {
          const available = active.filter(queue => queue.candidates.length);
          if (!available.length) break;
          const queue = available[attempt % available.length];
          const candidate = queue.candidates[0];
          const id = `${candidate.repo}#${candidate.number}`;
          if (shown.has(id) || state.checked.has(id)) { queue.candidates.shift(); attempt--; continue; }
          onProgress(`Checking size, languages and reviewer comments… (${attempt + 1}/${MAX_CANDIDATES_PER_CLICK})`);
          const data = await get(`/repos/${candidate.repo}/pulls/${candidate.number}/files?per_page=${filters.maxFiles + 1}`, signal);
          const files = selectSmallFiles(data, filters);
          if (files) {
            const paths = files.flatMap(file => [file.filename, ...(file.previousFilename ? [file.previousFilename] : [])]);
            let comments: OriginalComment[] = [];
            let nextPage: number | null = 1;
            // Bound qualification requests. Remaining pages are available in comparison.
            for (let page = 1; nextPage && page <= 3; page++) {
              const result = await commentPage(candidate, page, signal);
              comments = [...comments, ...result.comments];
              nextPage = result.nextPage;
              if (hasReviewerComment(comments, paths)) break;
            }
            if (hasReviewerComment(comments, paths)) {
              const repo = queue.repository;
              state.pool.push({
                ...candidate, url: `https://github.com/${candidate.repo}/pull/${candidate.number}/files`, files,
                additions: files.reduce((sum, file) => sum + file.additions, 0),
                deletions: files.reduce((sum, file) => sum + file.deletions, 0),
                topics: repo.topics, defaultBranch: repo.defaultBranch, originalComments: comments, commentsNextPage: nextPage,
              });
            }
          }
          queue.candidates.shift();
          state.checked.add(id);
        }
      } catch (error) {
        // Keep useful validated results if the quota is exhausted during pool refill.
        if (!state.pool.length || signal.aborted) throw error;
      }
      state.repoIndex = (state.repoIndex + active.length) % state.queues.length;
      if (state.pool.length) return choose(state);
      throw new Error('No reviewed change matched your preferences in this batch. Try again for other repositories and candidates, or widen your ranges and filters.');
    },
  };
}
