import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SwitchNotice } from '../src/components/UpdateDialog.tsx';

const sw = { to: '3.0.0', install: 'app' as const, from: 'local' as const, dataDir: '/Users/me/foundry/data', target: '/Users/me/Library/Application Support/Foundry/data', port: 4111, log: '/Users/me/.foundry/switch.log' };
const none = () => {};

test('before 3.0 a checkout reads what the switch does, the risks and the way back, and switches on a ticked box (ADR-0103)', () => {
  const h = renderToStaticMarkup(<SwitchNotice sw={sw} steps={[]} canSwitch force={false} onForce={none} err={null} onSwitch={none} onClose={none} />);
  expect(h).toContain('Foundry 3.0.0 ships only as the Foundry app.');
  expect(h).toContain('This source install gets no updates from 3.0.0 on.');
  expect(h).toContain('What switching does');
  expect(h).toContain('/Users/me/foundry/data');
  expect(h).toContain('/Users/me/Library/Application Support/Foundry/data');
  expect(h).toContain('on port 4111');
  expect(h).toContain('The risks');
  expect(h).toContain('not notarized by Apple');
  expect(h).toContain('/Users/me/.foundry/switch.log');
  expect(h).toContain('The way back');
  expect(h).toContain('I understand: switch this install to Foundry 3.0.0');
  // the button waits for the box
  expect(h).toMatch(/<button[^>]*disabled=""[^>]*>.*Switch to 3\.0\.0/);
});

test('a container gets the steps for its host, no button', () => {
  const steps = ['curl -fsSL https://x/install.sh | bash -s -- --mode binary --no-start', 'foundry start'];
  const h = renderToStaticMarkup(<SwitchNotice sw={{ ...sw, install: 'binary', from: 'docker' }} steps={steps} canSwitch={false} force={false} onForce={none} err={null} onSwitch={none} onClose={none} />);
  expect(h).toContain('ships only as the foundry binary');
  expect(h).toContain('This Docker install gets no updates');
  expect(h).toContain('Nothing in a container can install on its host');
  expect(h).toContain('foundry start');
  expect(h).not.toContain('I understand');
  expect(h).not.toContain('not notarized');
  expect(h).toContain('The Docker volumes stay as they are');
});
