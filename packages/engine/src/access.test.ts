import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getEscalation, getGoal, upsertEscalation, type Escalation } from '@foundry/core';
import { Access, AccessError } from './access.ts';
import { defaultConfig } from './config.ts';
import { Engine } from './engine.ts';
import { FakeRunner, makeRepo } from './test-helpers.ts';

describe('Access (ADR-0061)', () => {
  test('a person gets a token shown once and only its fingerprint is kept, in a file of its own; the token verifies, a wrong one does not, a revoked one stops, and the people persist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'foundry-access-'));
    const a = new Access(dir);
    expect(a.enabled()).toBe(false);
    expect(a.verify('anything')).toBeNull();
    const { person, token } = a.add('  Ada ');
    expect(person).toMatchObject({ name: 'Ada', lastUsedAt: null });
    expect(token).toMatch(/^fnd_[A-Za-z0-9_-]{32}$/);
    expect(a.enabled()).toBe(true);
    const file = readFileSync(join(dir, 'access.json'), 'utf8');
    expect(file).not.toContain(token);
    expect(file).toContain(person.id);
    expect(statSync(join(dir, 'access.json')).mode & 0o777).toBe(0o600);
    expect(a.list()).toEqual([person]);
    expect(Object.keys(a.list()[0]!)).not.toContain('hash');
    expect(a.verify(token)).toMatchObject({ id: person.id, name: 'Ada' });
    expect(a.list()[0]!.lastUsedAt).toBeTruthy();
    expect(a.verify(`${token}x`)).toBeNull();
    expect(a.verify('')).toBeNull();
    expect(a.verify(null)).toBeNull();
    // the same name twice is refused; a blank name too; a second person is fine
    expect(() => a.add('ada')).toThrow(AccessError);
    expect(() => a.add('   ')).toThrow('a name is needed');
    const bob = a.add('Bob');
    const again = new Access(dir);
    expect(again.list().map((p) => p.name)).toEqual(['Ada', 'Bob']);
    expect(again.verify(bob.token)?.name).toBe('Bob');
    expect(again.revoke(person.id).name).toBe('Ada');
    expect(again.verify(token)).toBeNull();
    expect(() => again.revoke(person.id)).toThrow('no such person');
    expect(new Access(dir).list().map((p) => p.name)).toEqual(['Bob']);
    const last = new Access(dir);
    expect(last.revoke(bob.person.id).name).toBe('Bob');
    expect(last.enabled()).toBe(false);
    expect(new Access(dir).enabled()).toBe(false);
  });

  test('a missing or broken file means no one has a token', () => {
    const dir = mkdtempSync(join(tmpdir(), 'foundry-access-'));
    expect(new Access(dir).list()).toEqual([]);
    writeFileSync(join(dir, 'access.json'), '{ not json');
    expect(new Access(dir).list()).toEqual([]);
    writeFileSync(join(dir, 'access.json'), JSON.stringify({ people: [{ id: 'p_1', name: 'Ada' }, 7, { id: 'p_2', name: 'Bob', hash: 'h', createdAt: 'c', lastUsedAt: null }] }));
    expect(new Access(dir).list().map((p) => p.name)).toEqual(['Bob']);
  });

  test('what a person does is recorded under their name: the goal asked for, the Brief approved, the Inbox item answered', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'foundry-access-by-'));
    const engine = new Engine(defaultConfig(resolve(import.meta.dir, '../../..'), { dataDir, claudeHome: join(dataDir, 'claude-home'), log: () => {} }), new FakeRunner(() => {}));
    engine.beginUpdateDrain();
    const repo = await makeRepo();
    const db = engine.store.db;
    const g = await engine.createGoal({ prompt: 'p', repoPath: repo, by: 'Ada' });
    expect(getGoal(db, g.id)).toMatchObject({ by: 'Ada', approvedBy: null });
    const unsigned = await engine.createGoal({ prompt: 'q', repoPath: repo });
    expect(getGoal(db, unsigned.id)!.by).toBeNull();
    // the Brief's approval names its approver; an older event without the field leaves the goal as it was
    const brief = { goalId: g.id, title: 't', understanding: 'u', areas: [], assumptions: [], questions: [], styleOptions: [], tasks: [], checks: [], costEstimateUsd: 1, timeEstimateMin: 10 };
    engine.store.append({ type: 'brief.approved', goalId: g.id, payload: { brief: brief as never, by: 'Bob' } });
    expect(getGoal(db, g.id)!.approvedBy).toBe('Bob');
    engine.store.append({ type: 'brief.approved', goalId: g.id, payload: { brief: brief as never } });
    expect(getGoal(db, g.id)!.approvedBy).toBe('Bob');
    // an Inbox answer names who answered
    const esc: Escalation = { id: 'esc_1', goalId: g.id, taskId: null, attemptId: null, trigger: 'brief_question', message: 'm', payload: {}, state: 'open', answer: null, createdAt: new Date().toISOString(), answeredAt: null, suggestion: null };
    upsertEscalation(db, esc);
    engine.store.append({ type: 'escalation.answered', goalId: g.id, payload: { escalationId: esc.id, answer: { action: 'abort_goal' }, by: 'Ada' } });
    expect(getEscalation(db, esc.id)).toMatchObject({ state: 'answered', answeredBy: 'Ada' });
    await engine.stop();
  }, 20_000);
});
