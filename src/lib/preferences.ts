export const LANGUAGES = [
  { name: 'Python', extensions: ['py', 'pyi'] },
  { name: 'C', extensions: ['c', 'h'] },
  { name: 'C++', extensions: ['cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx', 'h'] },
  { name: 'TypeScript', extensions: ['ts', 'tsx', 'mts', 'cts'] },
  { name: 'JavaScript', extensions: ['js', 'jsx', 'mjs', 'cjs'] },
  { name: 'Java', extensions: ['java'] },
  { name: 'C#', extensions: ['cs', 'csx'] },
  { name: 'Rust', extensions: ['rs'] },
  { name: 'Go', extensions: ['go'] },
  { name: 'Ruby', extensions: ['rb', 'rake'] },
  { name: 'PHP', extensions: ['php', 'phtml'] },
  { name: 'Swift', extensions: ['swift'] },
  { name: 'Kotlin', extensions: ['kt', 'kts'] },
  { name: 'Scala', extensions: ['scala', 'sc'] },
  { name: 'Dart', extensions: ['dart'] },
  { name: 'Lua', extensions: ['lua'] },
  { name: 'R', extensions: ['r', 'rmd'] },
  { name: 'MATLAB', extensions: ['m'] },
  { name: 'Perl', extensions: ['pl', 'pm'] },
  { name: 'Shell', extensions: ['sh', 'bash', 'zsh', 'fish'] },
  { name: 'PowerShell', extensions: ['ps1', 'psm1', 'psd1'] },
  { name: 'SQL', extensions: ['sql'] },
  { name: 'HTML', extensions: ['html', 'htm'] },
  { name: 'CSS', extensions: ['css', 'scss', 'sass', 'less'] },
  { name: 'Vue', extensions: ['vue'] },
  { name: 'Svelte', extensions: ['svelte'] },
  { name: 'Objective-C', extensions: ['m', 'mm'] },
  { name: 'Elixir', extensions: ['ex', 'exs'] },
  { name: 'Erlang', extensions: ['erl', 'hrl'] },
  { name: 'Clojure', extensions: ['clj', 'cljs', 'cljc', 'edn'] },
  { name: 'Haskell', extensions: ['hs', 'lhs'] },
  { name: 'F#', extensions: ['fs', 'fsx', 'fsi'] },
  { name: 'Julia', extensions: ['jl'] },
  { name: 'Groovy', extensions: ['groovy', 'gradle'] },
] as const;

export type Language = typeof LANGUAGES[number]['name'];
export type ReviewFilters = {
  minLines: number;
  maxLines: number;
  minFiles: number;
  maxFiles: number;
  languages: Language[];
  topics: string[];
};
export const DEFAULT_FILTERS: ReviewFilters = {
  minLines: 1, maxLines: 20, minFiles: 1, maxFiles: 2, languages: [], topics: [],
};
export const MAX_LINES = 500;
export const MAX_FILES = 10;
export const MAX_TOPICS = 5;
export const PREFERENCES_KEY = 'mr-practice:filters:v1';
export const TOPIC_PATTERN = /^[a-z0-9][a-z0-9-]{0,49}$/;

export function validateFilters(filters: ReviewFilters): string | null {
  if (![filters.minLines, filters.maxLines].every(n => Number.isSafeInteger(n) && n >= 1 && n <= MAX_LINES)) {
    return `Choose whole numbers between 1 and ${MAX_LINES} for changed lines.`;
  }
  if (filters.minLines > filters.maxLines) return 'Minimum changed lines cannot exceed the maximum.';
  if (![filters.minFiles, filters.maxFiles].every(n => Number.isSafeInteger(n) && n >= 1 && n <= MAX_FILES)) {
    return `Choose whole numbers between 1 and ${MAX_FILES} for changed files.`;
  }
  if (filters.minFiles > filters.maxFiles) return 'Minimum changed files cannot exceed the maximum.';
  if (filters.languages.some(name => !LANGUAGES.some(language => language.name === name))) return 'Choose supported languages.';
  if (filters.topics.length > MAX_TOPICS || filters.topics.some(topic => !TOPIC_PATTERN.test(topic))) {
    return `Choose up to ${MAX_TOPICS} tags using lowercase letters, numbers, and hyphens (up to 50 characters).`;
  }
  return null;
}

export function restoreFilters(raw: unknown): ReviewFilters {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_FILTERS };
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.languages) || !Array.isArray(value.topics) ||
    !value.languages.every(name => typeof name === 'string') ||
    !value.topics.every(topic => typeof topic === 'string')) return { ...DEFAULT_FILTERS };
  const filters = {
    minLines: value.minLines, maxLines: value.maxLines, minFiles: value.minFiles, maxFiles: value.maxFiles,
    languages: [...new Set(value.languages)], topics: [...new Set(value.topics)],
  } as ReviewFilters;
  return validateFilters(filters) ? { ...DEFAULT_FILTERS } : filters;
}

export function filterKey(filters: ReviewFilters): string {
  return JSON.stringify({ ...filters, languages: [...filters.languages].sort(), topics: [...filters.topics].sort() });
}

export function fileMatchesLanguages(filename: string, selected: readonly Language[]): boolean {
  const extension = filename.split('.').at(-1)?.toLowerCase();
  // Header files and .m files may belong to more than one language.
  return LANGUAGES.some(language => (!selected.length || selected.includes(language.name)) &&
    (language.extensions as readonly string[]).includes(extension ?? ''));
}
