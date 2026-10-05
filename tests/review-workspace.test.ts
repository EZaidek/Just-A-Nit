import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, createElement, type ComponentType } from 'react';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import { createReviewFinder, type Review } from '../src/lib/github.ts';
import { parsePatch } from '../src/lib/diff.ts';
import { parseReviewComments } from '../src/lib/review-comments.ts';

test('practice supports local comments, preview, suggestions, edits, deletion and spoiler-free comparison', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  }
  const { createRoot } = await import('react-dom/client');
  const server = await createServer({ server: { middlewareMode: true, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: 'custom' });
  const root = createRoot(dom.window.document.getElementById('root')!);
  const doc = dom.window.document;
  let requests = 0;
  const finder = createReviewFinder(async (_url, options) => {
    requests++;
    assert.equal(options?.method, 'GET');
    assert.equal(options?.body, undefined);
    return new Response(JSON.stringify([{ id: 10, user: { login: 'real-reviewer' }, body: 'Original summary spoiler', state: 'COMMENTED' }]));
  });
  const review: Review = {
    repo: 'vuejs/core', number: 1, title: 'Example', author: 'author', defaultBranch: 'main', topics: [], url: 'https://github.com/vuejs/core/pull/1/files',
    additions: 1, deletions: 1, commentsNextPage: null,
    files: [{ filename: 'a.ts', status: 'modified', additions: 1, deletions: 1, lines: parsePatch('@@ -1 +1 @@\n-old()\n+new()') }],
    originalComments: parseReviewComments([{ id: 1, pull_request_review_id: 2, user: { login: 'real-reviewer', type: 'User' }, body: 'Original inline spoiler',
      path: 'a.ts', line: null, original_line: 1, side: 'RIGHT', diff_hunk: '@@ -1 +1 @@\n-old()\n+new()' }], 'author'),
  };
  async function click(text: string) {
    const button = [...doc.querySelectorAll('button')].find(item => item.textContent === text);
    assert.ok(button, `Button exists: ${text}`);
    await act(async () => button.click());
  }
  async function write(selector: string, value: string) {
    const textarea = doc.querySelector<HTMLTextAreaElement>(selector);
    assert.ok(textarea, `Textarea exists: ${selector}`);
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value);
      textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
  }
  try {
    type Props = { review: Review; finder: typeof finder; onQuota: () => void };
    const module = await server.ssrLoadModule('/src/components/ReviewWorkspace.tsx') as { default: ComponentType<Props> };
    await act(async () => root.render(createElement(module.default, { key: 'first', review, finder, onQuota: () => {} })));
    assert.doesNotMatch(doc.body.textContent!, /Original inline spoiler|Original summary spoiler/);
    assert.equal(requests, 0);
    const line = doc.querySelector<HTMLButtonElement>('button[aria-label="Comment on a.ts new line 1"]')!;
    await act(async () => line.click());
    assert.equal(doc.querySelector<HTMLButtonElement>('#compare-tab')!.disabled, true);
    await write('.comment-editor textarea', '**Please test this.**');
    await click('Suggest a change');
    await write('textarea[aria-label="Suggested replacement"]', 'safer()\ncheck()');
    await click('Preview');
    assert.match(doc.querySelector('.comment-preview')!.innerHTML, /<strong>Please test this\.<\/strong>/);
    assert.match(doc.querySelector('.comment-preview')!.textContent!, /safer\(\)/);
    await click('Add comment locally');
    assert.match(doc.querySelector('.comment-card')!.textContent!, /Please test this/);
    assert.match(doc.querySelector('.suggestion-old')!.textContent!, /new\(\)/);
    assert.equal(requests, 0);
    await click('Edit');
    await write('.comment-editor textarea', 'Updated local comment');
    await click('Save changes locally');
    await write('#local-review-summary', 'My local summary');
    await click('Ready to compare reviews');
    const comparison = doc.querySelector('#compare-panel')!;
    assert.match(comparison.textContent!, /Updated local comment/);
    assert.match(comparison.textContent!, /My local summary/);
    assert.match(comparison.textContent!, /Original inline spoiler/);
    assert.match(comparison.textContent!, /Original summary spoiler/);
    assert.match(comparison.textContent!, /Earlier revision/);
    assert.equal(requests, 1);
    await click('Your review 1');
    await click('Delete');
    assert.equal(doc.querySelectorAll('#practice-panel .comment-card').length, 0);
    const oldLine = doc.querySelector<HTMLButtonElement>('button[aria-label="Comment on a.ts old line 1"]')!;
    await act(async () => oldLine.click());
    assert.ok(![...doc.querySelectorAll('button')].some(button => button.textContent === 'Suggest a change'));
    await click('Cancel');
    await act(async () => root.render(createElement(module.default, { key: 'second', review: { ...review, number: 2 }, finder, onQuota: () => {} })));
    assert.equal(doc.querySelector<HTMLTextAreaElement>('#local-review-summary')!.value, '');
    assert.doesNotMatch(doc.body.textContent!, /Original inline spoiler|Updated local comment/);
  } finally {
    await act(async () => root.unmount());
    await server.close();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
