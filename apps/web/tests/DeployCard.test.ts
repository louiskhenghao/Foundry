import { expect, test } from 'bun:test';
import type { Deployment } from '@foundry/core/browser';
import type { DeployInfo } from '../src/api.ts';
import { MAKE_DEPLOYABLE_PROMPT, defaultHost, placeKey, placeLabel } from '../src/pages/goal/DeployCard.tsx';

const host = (id: 'vercel' | 'netlify' | 'cloudflare', over: Partial<DeployInfo['providers'][number]> = {}): DeployInfo['providers'][number] => ({ id, target: null, kind: 'host', label: id, configured: true, refused: null, ...over });
const server = (target: string, over: Partial<DeployInfo['providers'][number]> = {}): DeployInfo['providers'][number] => ({ id: 'server', target, kind: 'server', label: `box ${target}`, configured: true, refused: null, ...over });
const deployed = (provider: Deployment['provider'], target: Deployment['target'] = null): Deployment => ({ provider, target, production: false, status: 'live', url: `https://${provider}.example`, reason: null, ref: 'abc', framework: 'Vite', at: '2026-10-22T10:00:00Z', endedAt: '2026-10-22T10:01:00Z' });

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

test('a server is a place of its own, keyed by its id (ADR-0090): the last one deployed to comes first, and a deploy names it by the name it had', () => {
  const all = [host('vercel'), server('s1'), server('s2')];
  expect(placeKey(server('s1'))).toBe('server:s1');
  expect(defaultHost(all, [deployed('server', { id: 's2', label: 'box s2' })])).toBe('server:s2');
  // a server removed from Settings, or without its key: the first usable place
  expect(defaultHost([host('vercel'), server('s1', { configured: false })], [deployed('server', { id: 's1', label: 'old' })])).toBe('vercel');
  expect(defaultHost([host('vercel', { configured: false }), server('s1', { refused: 'no compose file' }), server('s2')], [])).toBe('server:s2');
  expect(placeLabel(deployed('server', { id: 's9', label: 'the box' }), all)).toBe('the box (server)');
  expect(placeLabel(deployed('vercel'), all)).toBe('vercel');
  expect(placeLabel(deployed('netlify'), all)).toBe('netlify');
});

test('the follow-up goal that makes a project deployable asks for a Dockerfile and a compose file and forbids what the deploy refuses (ADR-0090)', () => {
  for (const words of ['Dockerfile', 'compose.yaml', 'EXPOSE', 'HEALTHCHECK', 'named volumes', 'docker compose config', 'Never mount the Docker socket']) expect(MAKE_DEPLOYABLE_PROMPT).toContain(words);
});
