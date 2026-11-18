import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { EarlierInstall, MoveStatus } from '../src/api.ts';
import { MoveView, type MoveViewProps } from '../src/components/MoveCard.tsx';

const none = () => {};
const install = (over: Partial<EarlierInstall> = {}): EarlierInstall => ({ id: 'source:/Users/me/Projects/foundry', kind: 'source', where: '/Users/me/Projects/foundry', version: '2.35.0', recorded: false, running: { pid: 42, how: 'process' }, port: 4111, url: 'http://127.0.0.1:4111', goals: 50, last: '2026-11-17T01:00:00.000Z', plan: [], ...over });
const status = (over: Partial<MoveStatus> = {}): MoveStatus => ({ kind: 'app', here: { goals: 0, dataDir: '/Users/me/Library/Application Support/Foundry/data', provider: 'claude' }, offer: true, installs: [install()], notes: [], job: null, last: null, failed: null, ...over });
const view = (over: Partial<MoveViewProps> = {}) => renderToStaticMarkup(<MoveView variant="offer" status={status()} chosen={null} onChoose={none} replace={false} onReplace={none} busy={false} err={null} onMove={none} onMoveNow={none} {...over} />);

test('an app with no goals offers the earlier Foundry it found, with one button (ADR-0107)', () => {
  const h = view();
  expect(h).toContain('Bring your goals over');
  expect(h).toContain('/Users/me/Projects/foundry');
  expect(h).toContain('50 goals');
  expect(h).toContain('running now');
  expect(h).toContain('Then it stops that Foundry and keeps it as it is, as the backup.');
  expect(h).toContain('takes over its address');
  expect(h).toContain('Goals at work there are paused first');
  expect(h).toMatch(/<button(?![^>]*disabled="")[^>]*>Move 50 goals here<\/button>/);
});

test('nothing to offer, or a checkout: nothing shows on the Goals page', () => {
  expect(view({ status: status({ offer: false }) })).toBe('');
  expect(view({ status: status({ kind: 'checkout' }) })).toBe('');
  // Settings says there is nothing to move
  expect(view({ variant: 'settings', status: status({ offer: false, installs: [] }) })).toContain('No earlier Foundry with goals on this computer.');
});

test("with goals of its own, this install's are set aside only on a ticked box", () => {
  const h = view({ variant: 'settings', status: status({ here: { goals: 2, dataDir: '/x', provider: 'claude' }, offer: false }) });
  expect(h).toContain('Move from another Foundry');
  expect(h).toContain('this Foundry’s own 2 goals are set aside as a backup, not merged');
  expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Move 50 goals here<\/button>/);
  expect(view({ variant: 'settings', replace: true, status: status({ here: { goals: 2, dataDir: '/x', provider: 'claude' }, offer: false }) })).toMatch(/<button(?![^>]*disabled="")[^>]*>Move 50 goals here<\/button>/);
});

test('a move under way can stop waiting; one that stopped says why and can be tried again', () => {
  const job = { id: 'source:/Users/me/Projects/foundry', where: '/Users/me/Projects/foundry', state: 'running' as const, lines: [], error: null, nextUrl: null, startedAt: 'x' };
  const running = view({ status: status({ job }) });
  expect(running).toContain('Moving the goals of');
  expect(running).toContain('Move now');
  const failed = view({ status: status({ job: { ...job, state: 'failed', error: 'not enough room.' } }) });
  expect(failed).toContain('The move stopped:');
  expect(failed).toContain('Nothing here changed, and the old Foundry is as it was.');
  expect(failed).toContain('Try again');
});

test('two earlier installs with goals: the person picks one, a container named as one', () => {
  const h = view({ status: status({ installs: [install(), install({ id: 'docker:foundry', kind: 'docker', where: 'foundry', goals: 7, running: null, port: 4111 })] }) });
  expect(h).toContain('Which one moves here?');
  expect(h).toContain('the Docker container foundry');
  expect(h).toContain('7 goals');
});

test('a move whose copy did not open says so, with the old Foundry running again', () => {
  const h = view({ status: status({ failed: { error: 'the database is malformed', at: '2026-11-17T09:00:00.000Z' } }) });
  expect(h).toContain('The last move did not take:');
  expect(h).toContain('the database is malformed');
  expect(h).toContain('the old one runs again as it was');
});
