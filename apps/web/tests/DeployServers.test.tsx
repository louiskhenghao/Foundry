import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DeployServer } from '@foundry/core/browser';
import { DeployServers, newServerId } from '../src/pages/settings/DeployServers.tsx';
import { RecipeRuns, initialParams } from '../src/pages/settings/RecipeDialog.tsx';

const box: DeployServer = { id: 'srv1', name: 'hostinger', host: '203.0.113.4', port: 22, user: 'deploy', privateKey: null, dir: '~/foundry', publicUrl: 'https://app.example.com', allowPrivileged: false, mode: 'docker' };

test('the servers are edited in place: each field shown, the saved key never, only its hint; an empty list says what a server is for (ADR-0091)', () => {
  const html = renderToStaticMarkup(<DeployServers servers={[box]} secrets={{ 'delivery.servers.srv1.privateKey': { set: true, hint: '----…END-' } }} onChange={() => {}} />);
  expect(html).toContain('value="hostinger"');
  expect(html).toContain('value="203.0.113.4"');
  expect(html).toContain('value="https://app.example.com"');
  expect(html).toContain('saved: ----…END- — paste a key to replace it');
  expect(html).not.toContain('BEGIN OPENSSH');
  expect(html).toContain('Add a server');
  // the switch that lets a compose file reach outside its project is off, and says what it would allow (ADR-0091)
  expect(html).toContain('Allow a compose file that reaches outside its project');
  expect(html).not.toContain('checked=""');
  const empty = renderToStaticMarkup(<DeployServers servers={[]} secrets={{}} onChange={() => {}} />);
  expect(empty).toContain('No server yet');
  expect(newServerId()).toMatch(/^srv_[a-z0-9]+$/);
  // the mode (ADR-0092) and the Scripts fold: a server not yet saved has nothing to run on
  expect(html).toContain('PM2 (a Node.js project, no containers)');
  expect(html).toContain('Scripts — set this server up');
  const unsaved = renderToStaticMarkup(<DeployServers servers={[box]} secrets={{}} savedIds={[]} onChange={() => {}} />);
  expect(unsaved).toContain('Save the settings first');
});

test('a recipe starts from its defaults and what the project prefilled; the runs list says how each went (ADR-0092)', () => {
  const recipe = { id: 'nginx-site', title: 'nginx', root: true, fixes: 'front', source: 'bundled' as const, file: 'nginx-site.sh', text: '#!/bin/bash', changes: ['installs nginx'], params: [{ name: 'DOMAIN', label: 'd', default: null, secret: false }, { name: 'APP_PORT', label: 'p', default: '3000', secret: false }, { name: 'CERT_PEM', label: 'c', default: null, secret: true }] };
  expect(initialParams(recipe, { DOMAIN: 'shop.example.com', APP_PORT: '8080' })).toEqual({ DOMAIN: 'shop.example.com', APP_PORT: '8080', CERT_PEM: '' });
  expect(initialParams(recipe)).toEqual({ DOMAIN: '', APP_PORT: '3000', CERT_PEM: '' });
  const runs = renderToStaticMarkup(<RecipeRuns runs={[{ serverId: 's', recipe: 'install-docker', title: 'Install Docker', status: 'failed', exitCode: 100, reason: 'the script failed (exit 100): E: no package', outputTail: '', at: '2026-11-12T10:00:00Z', endedAt: '2026-11-12T10:01:00Z' }, { serverId: 's', recipe: 'install-redis', title: 'Redis', status: 'ok', exitCode: 0, reason: null, outputTail: 'Done', at: '2026-11-12T09:00:00Z', endedAt: '2026-11-12T09:00:30Z' }]} />);
  expect(runs).toContain('Install Docker');
  expect(runs).toContain('the script failed (exit 100): E: no package');
  expect(runs).toContain('>ok<');
  expect(renderToStaticMarkup(<RecipeRuns runs={[]} />)).toContain('No script has run on this server yet');
});
