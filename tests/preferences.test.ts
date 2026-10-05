import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_FILTERS, LANGUAGES, fileMatchesLanguages, filterKey, restoreFilters, validateFilters,
} from '../src/lib/preferences.ts';

test('common languages match their source extensions, including ambiguous headers', () => {
  for (const [filename, language] of [
    ['test.py', 'Python'], ['file.cpp', 'C++'], ['file.c', 'C'], ['file.tsx', 'TypeScript'],
    ['test.jsx', 'JavaScript'], ['file.java', 'Java'], ['file.cs', 'C#'], ['file.rs', 'Rust'],
    ['file.kt', 'Kotlin'], ['file.go', 'Go'], ['file.swift', 'Swift'], ['file.sql', 'SQL'],
  ] as const) assert.equal(fileMatchesLanguages(filename, [language]), true);
  assert.equal(fileMatchesLanguages('file.h', ['C']), true);
  assert.equal(fileMatchesLanguages('file.h', ['C++']), true);
  assert.equal(fileMatchesLanguages('file.ts', ['JavaScript']), false);
  assert.equal(fileMatchesLanguages('README.md', []), false);
  for (const language of LANGUAGES) assert.equal(fileMatchesLanguages(`example.${language.extensions[0]}`, [language.name]), true);
});

test('validates integer sizes, ordered ranges, and topic syntax', () => {
  assert.equal(validateFilters(DEFAULT_FILTERS), null);
  for (const changes of [
    { minLines: 0 }, { maxLines: 501 }, { maxFiles: 11 }, { minFiles: 3 }, { maxLines: 1.5 },
    { topics: ['Frontend'] }, { topics: ['frontend', 'build-tool', 'hmr', 'dev-server', 'vite', 'javascript'] },
    { topics: ['frontend OR private:true'] },
  ]) assert.ok(validateFilters({ ...DEFAULT_FILTERS, ...changes }));
});

test('restores valid saved preferences, removes duplicates, and rejects malformed storage', () => {
  const saved = { ...DEFAULT_FILTERS, minLines: 10, maxLines: 60, maxFiles: 4, languages: ['Rust', 'Rust'], topics: ['cli'] };
  assert.deepEqual(restoreFilters(saved), { ...saved, languages: ['Rust'] });
  for (const raw of [null, {}, { ...saved, maxFiles: 100 }, { ...saved, languages: ['unknown'] },
    { ...saved, topics: [12] }, { ...saved, minLines: '10' }]) {
    assert.deepEqual(restoreFilters(raw), DEFAULT_FILTERS);
  }
});

test('filter cache identity ignores selection order and includes sizes', () => {
  const first = { ...DEFAULT_FILTERS, languages: ['Python', 'Rust'] as const, topics: ['cli', 'frontend'] };
  assert.equal(filterKey({ ...first, languages: [...first.languages] }),
    filterKey({ ...first, languages: ['Rust', 'Python'], topics: ['frontend', 'cli'] }));
  assert.notEqual(filterKey(DEFAULT_FILTERS), filterKey({ ...DEFAULT_FILTERS, maxFiles: 3 }));
});
