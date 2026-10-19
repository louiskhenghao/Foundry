import { expect, test } from 'bun:test';
import { onServerBuild } from '../src/buildWatch.tsx';

test('a page reloads into a new build by itself, asks first with an edit unsaved, and stays on the same build', () => {
  expect(onServerBuild('index-a.js', 'index-b.js', false)).toBe('reload');
  expect(onServerBuild('index-a.js', 'index-b.js', true)).toBe('ask');
  expect(onServerBuild('index-a.js', 'index-a.js', true)).toBe('stay');
  // the dev server's page has no hashed entry, and a server without a web build names none
  expect(onServerBuild(null, 'index-b.js', false)).toBe('stay');
  expect(onServerBuild('index-a.js', null, false)).toBe('stay');
});
