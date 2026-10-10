import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { PortRow } from '../src/api.ts';
import { PortLine } from '../src/pages/PortsPage.tsx';

const row = (r: Partial<PortRow>): PortRow => ({ id: 'x', port: 3000, addresses: ['*'], category: 'process', kind: 'process', label: 'node', detail: null, goalId: null, taskId: null, pid: 42, process: 'node', cwd: null, container: null, url: null, relevant: true, release: { allowed: true, confirm: 'Stop?', reason: null }, ...r });
const render = (r: PortRow) => renderToStaticMarkup(<MemoryRouter><PortLine row={r} onRelease={() => {}} /></MemoryRouter>);

test('a port says who holds it, where it listens, and offers open and stop & release when it may', () => {
  const html = render(row({ label: 'Tailscale serve (yours)', detail: 'forwards http://127.0.0.1:3000 to your tailnet', url: 'https://mac.ts.net:3000', pid: null }));
  expect(html).toContain('Tailscale serve (yours)');
  expect(html).toContain('forwards http://127.0.0.1:3000 to your tailnet');
  expect(html).toContain('mac.ts.net:3000');
  expect(html).toContain('stop &amp; release');
  expect(html).toContain('href="https://mac.ts.net:3000"');
});

test('what may not be stopped says why instead', () => {
  const html = render(row({ kind: 'serve-self', category: 'tailscale', label: 'Tailscale serve → Foundry', release: { allowed: false, confirm: null, reason: 'it carries Foundry to your other devices' } }));
  expect(html).not.toContain('stop &amp; release');
  expect(html).toContain('can&#x27;t stop here: it carries Foundry to your other devices');
  expect(render(row({ category: 'foundry', kind: 'task', goalId: 'g1', taskId: 't1', label: 'Task · build the kit' }))).toContain('Task · build the kit');
});
