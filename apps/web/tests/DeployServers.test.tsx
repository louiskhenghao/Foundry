import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DeployServer } from '@foundry/core/browser';
import { DeployServers, newServerId } from '../src/pages/settings/DeployServers.tsx';

const box: DeployServer = { id: 'srv1', name: 'hostinger', host: '203.0.113.4', port: 22, user: 'deploy', privateKey: null, dir: '~/foundry', publicUrl: 'https://app.example.com' };

test('the servers are edited in place: each field shown, the saved key never, only its hint; an empty list says what a server is for (ADR-0090)', () => {
  const html = renderToStaticMarkup(<DeployServers servers={[box]} secrets={{ 'delivery.servers.srv1.privateKey': { set: true, hint: '----…END-' } }} onChange={() => {}} />);
  expect(html).toContain('value="hostinger"');
  expect(html).toContain('value="203.0.113.4"');
  expect(html).toContain('value="https://app.example.com"');
  expect(html).toContain('saved: ----…END- — paste a key to replace it');
  expect(html).not.toContain('BEGIN OPENSSH');
  expect(html).toContain('Add a server');
  const empty = renderToStaticMarkup(<DeployServers servers={[]} secrets={{}} onChange={() => {}} />);
  expect(empty).toContain('No server yet');
  expect(newServerId()).toMatch(/^srv_[a-z0-9]+$/);
});
