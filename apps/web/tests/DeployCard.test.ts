import { expect, test } from 'bun:test';
import type { Deployment } from '@foundry/core/browser';
import type { DeployInfo } from '../src/api.ts';
import { defaultHost } from '../src/pages/goal/DeployCard.tsx';

const host = (id: 'vercel' | 'netlify' | 'cloudflare', over: Partial<DeployInfo['providers'][number]> = {}): DeployInfo['providers'][number] => ({ id, label: id, configured: true, refused: null, ...over });
const deployed = (provider: Deployment['provider']): Deployment => ({ provider, production: false, status: 'live', url: `https://${provider}.example`, reason: null, ref: 'abc', framework: 'Vite', at: '2026-10-22T10:00:00Z', endedAt: '2026-10-22T10:01:00Z' });

test('the host chosen at first: the one the goal last deployed to, while it is set up and takes the app; else the first that is', () => {
  const all = [host('vercel'), host('netlify'), host('cloudflare')];
  expect(defaultHost(all, [])).toBe('vercel');
  expect(defaultHost(all, [deployed('vercel'), deployed('netlify')])).toBe('netlify');
  // a failed deploy still names the host the person picked
  expect(defaultHost(all, [{ ...deployed('cloudflare'), status: 'failed', url: null, reason: 'refused' }])).toBe('cloudflare');
  // the last host no longer set up, or refusing this app: the first one that is
  expect(defaultHost([host('vercel'), host('netlify', { configured: false })], [deployed('netlify')])).toBe('vercel');
  expect(defaultHost([host('vercel', { configured: false }), host('cloudflare', { refused: 'renders on a server' }), host('netlify')], [deployed('cloudflare')])).toBe('netlify');
  expect(defaultHost([host('vercel', { configured: false })], [])).toBeNull();
});
