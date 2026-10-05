import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import type { ReviewFile } from '../src/lib/github.ts';
import { parsePatch } from '../src/lib/diff.ts';
import { DEFAULT_FILTERS, LANGUAGES, type ReviewFilters } from '../src/lib/preferences.ts';
import type { GitHubAccessProps } from '../src/components/GitHubAccess.tsx';

test('diff rendering preserves numbering, change markers, and safely escapes source text', async () => {
  const server = await createServer({
    server: { middlewareMode: true, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: 'custom',
  });
  try {
    const module = await server.ssrLoadModule('/src/components/FileDiff.tsx') as { default: ComponentType<{ file: ReviewFile }> };
    const html = renderToStaticMarkup(createElement(module.default, { file: {
      filename: 'src/example.tsx', status: 'modified', additions: 1, deletions: 1,
      lines: parsePatch('@@ -10 +20 @@\n-old()\n+<script>alert("test")</script>'),
    } }));
    assert.match(html, /class="diff-added"/);
    assert.match(html, /class="diff-removed"/);
    assert.match(html, /class="line-number">10<\/td>/);
    assert.match(html, /class="line-number">20<\/td>/);
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /Unified diff for src\/example.tsx/);
  } finally {
    await server.close();
  }
});

test('GitHub access renders a masked empty input, quota status, and removal control', async () => {
  const server = await createServer({
    server: { middlewareMode: true, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom',
  });
  try {
    const module = await server.ssrLoadModule('/src/components/GitHubAccess.tsx') as { default: ComponentType<GitHubAccessProps> };
    const props: GitHubAccessProps = {
      authenticated: true, checking: false, disabled: false,
      limits: { core: { limit: 5000, remaining: 4999, reset: 2000000000 }, search: { limit: 30, remaining: 29, reset: 2000000000 } },
      onConnect: async () => {}, onDisconnect: () => {},
    };
    const html = renderToStaticMarkup(createElement(module.default, props));
    assert.match(html, /type="password"/);
    assert.match(html, /autoComplete="off"/);
    assert.match(html, /value=""/);
    assert.match(html, /Token connected/);
    assert.match(html, /Remove token/);
    assert.match(html, /4,999 \/ 5,000/);
    assert.match(html, /29 \/ 30/);
    const anonymous = renderToStaticMarkup(createElement(module.default, { ...props, authenticated: false, limits: { core: null, search: null } }));
    assert.match(anonymous, /60 requests\/hour/);
    assert.doesNotMatch(anonymous, /Remove token/);
  } finally { await server.close(); }
});

test('preferences render size controls, every language, and topics provided by GitHub', async () => {
  const server = await createServer({
    server: { middlewareMode: true, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom',
  });
  try {
    type Props = { filters: ReviewFilters; onChange: () => void; topics: string[]; topicsLoading: boolean; topicsError: string; disabled: boolean };
    const module = await server.ssrLoadModule('/src/components/ReviewPreferences.tsx') as { default: ComponentType<Props> };
    const html = renderToStaticMarkup(createElement(module.default, {
      filters: { ...DEFAULT_FILTERS, languages: ['Rust'], topics: ['cli'] }, onChange: () => {},
      topics: ['build-tool', 'frontend', 'cli'], topicsLoading: false, topicsError: '', disabled: false,
    }));
    assert.equal((html.match(/type="number"/g) ?? []).length, 4);
    assert.equal((html.match(/type="checkbox"/g) ?? []).length, LANGUAGES.length);
    assert.match(html, /Remove tag cli/);
    assert.match(html, /build-tool/);
    assert.match(html, /frontend/);
    assert.match(html, /all selected tags/);
  } finally { await server.close(); }
});

test('review Markdown renders formatting and suggestions without executing HTML or unsafe links', async () => {
  const server = await createServer({ server: { middlewareMode: true, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' });
  try {
    const module = await server.ssrLoadModule('/src/components/CommentBody.tsx') as { default: ComponentType<{ body: string }> };
    const html = renderToStaticMarkup(createElement(module.default, {
      body: '**Review point**\n\n<script>alert(1)</script>\n\n[bad](javascript:alert%281%29)\n\n```suggestion\nsafer()\n```',
    }));
    assert.match(html, /<strong>Review point<\/strong>/);
    assert.match(html, /Suggested change/);
    assert.match(html, /safer\(\)/);
    assert.doesNotMatch(html, /<script|href="javascript:/);
  } finally { await server.close(); }
});
