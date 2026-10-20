import { beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getGoal } from '@foundry/core';
import { renderAttachments } from './attachments.ts';
import { defaultConfig } from './config.ts';
import { FakeGh } from './delivery/gh.fake.ts';
import type { IssueView } from './delivery/gh.ts';
import { Engine } from './engine.ts';
import { IssueError, githubRepoOf, issueRefFor, parseIssueRef, renderIssueThread } from './issue.ts';
import { FakeRunner, makeRepo, makeRepoWithRemote, sh, waitFor } from './test-helpers.ts';

const ROOT = resolve(import.meta.dir, '../../..');
let dataDir: string;
beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'foundry-issue-'));
});
const cfg = () => defaultConfig(ROOT, { dataDir, claudeHome: join(dataDir, 'claude-home'), alwaysReviewTasks: false, log: () => {}, delivery: { pollMs: 10, noChecksGraceMs: 30, checksTimeoutMs: 3000, automergeWaitMs: 200, updateLocalBase: true, prWatchMs: 60_000 } });

const issue = (over: Partial<IssueView> = {}): IssueView => ({
  number: 7,
  url: 'https://github.com/acme/app/issues/7',
  title: 'Export orders as CSV',
  state: 'OPEN',
  body: 'The orders page needs a CSV export.\n\n- include the date column',
  labels: ['feature', 'orders'],
  author: 'pat',
  createdAt: '2026-10-01T10:00:00Z',
  comments: [{ author: 'sam', body: 'Dates in ISO format please.', createdAt: '2026-10-02T09:00:00Z' }],
  ...over,
});
const ghWith = (v: IssueView = issue()) => {
  const gh = new FakeGh();
  gh.issues.set(`acme/app#${v.number}`, v);
  return gh;
};

describe('an issue reference', () => {
  test('is a GitHub link, owner/name#number, or a bare number within a known repository', () => {
    expect(parseIssueRef('https://github.com/acme/app/issues/7')).toEqual({ repo: 'acme/app', number: 7 });
    expect(parseIssueRef('https://www.github.com/acme/app.git/issues/7/')).toEqual({ repo: 'acme/app', number: 7 });
    expect(parseIssueRef('https://github.com/acme/app/issues/7#issuecomment-12')).toEqual({ repo: 'acme/app', number: 7 });
    expect(parseIssueRef('github.com/acme/app/pull/9')).toEqual({ repo: 'acme/app', number: 9 });
    expect(parseIssueRef(' acme/app#12 ')).toEqual({ repo: 'acme/app', number: 12 });
    expect(parseIssueRef('#12', 'acme/app')).toEqual({ repo: 'acme/app', number: 12 });
    expect(parseIssueRef('12', 'acme/app')).toEqual({ repo: 'acme/app', number: 12 });
    expect(parseIssueRef('#12')).toBeNull();
    expect(parseIssueRef('https://gitlab.com/acme/app/-/issues/7')).toBeNull();
    expect(parseIssueRef('fix the bug')).toBeNull();
    expect(parseIssueRef('')).toBeNull();
  });

  test('is written as #n in the issue’s own repository and owner/name#n elsewhere', () => {
    expect(issueRefFor({ repo: 'acme/app', number: 7 }, 'acme/app')).toBe('#7');
    expect(issueRefFor({ repo: 'acme/app', number: 7 }, 'Acme/App')).toBe('#7');
    expect(issueRefFor({ repo: 'acme/app', number: 7 }, 'acme/other')).toBe('acme/app#7');
    expect(issueRefFor({ repo: 'acme/app', number: 7 }, null)).toBe('acme/app#7');
  });

  test('the folder’s GitHub remote names the repository; another host or no remote does not', async () => {
    const repo = await makeRepo();
    expect(await githubRepoOf(repo)).toBeNull();
    await sh('git remote add origin git@github.com:acme/app.git', repo);
    expect(await githubRepoOf(repo)).toBe('acme/app');
    await sh('git remote set-url origin https://gitlab.com/acme/app.git', repo);
    expect(await githubRepoOf(repo)).toBeNull();
  });
});

describe('the issue thread', () => {
  test('renders the header, the description and every comment with who wrote it and when', () => {
    const md = renderIssueThread('acme/app', issue());
    expect(md).toStartWith('# acme/app#7: Export orders as CSV\n\nhttps://github.com/acme/app/issues/7 · open · opened by @pat on 2026-10-01 · labels: feature, orders\n\n## Description\n\nThe orders page needs a CSV export.');
    expect(md).toContain('## Comments (1)\n\n### @sam · 2026-10-02\n\nDates in ISO format please.');
    const bare = renderIssueThread('acme/app', issue({ body: '', comments: [], labels: [], author: null, createdAt: null, state: 'CLOSED' }));
    expect(bare).toContain('· closed · opened by someone on an unknown date\n\n## Description\n\n_(no description)_\n\n## Comments (0)\n\n_(none)_');
  });

  test('stops before the thread outgrows a prompt and says how many comments are left on GitHub', () => {
    const big = 'x'.repeat(150 * 1024);
    const md = renderIssueThread('acme/app', issue({ comments: [1, 2, 3, 4].map((n) => ({ author: `u${n}`, body: big, createdAt: null })) }));
    expect(md.length).toBeLessThan(420 * 1024);
    expect(md).toContain('### @u2');
    expect(md).not.toContain('### @u3');
    expect(md).toContain('…2 more comments not shown; read them at https://github.com/acme/app/issues/7');
  });
});

describe('reading an issue for a new goal', () => {
  test('stages the thread as a link attachment with a ready snapshot; the goal claims it and every session is told to read it', async () => {
    const repo = await makeRepo();
    const engine = new Engine(cfg(), new FakeRunner(() => {}), ghWith());
    const read = await engine.readIssue({ ref: 'https://github.com/acme/app/issues/7' });
    expect(read.issue).toMatchObject({ repo: 'acme/app', number: 7, url: 'https://github.com/acme/app/issues/7', title: 'Export orders as CSV', state: 'open', labels: ['feature', 'orders'] });
    expect(read.title).toBe('Export orders as CSV');
    expect(read.prompt).toBe('The orders page needs a CSV export.\n\n- include the date column');
    const a = read.attachment;
    expect(a).toMatchObject({ kind: 'link', name: 'acme/app#7', url: 'https://github.com/acme/app/issues/7' });
    expect(a.markdown).toMatchObject({ status: 'ready', tool: 'gh issue view' });
    expect(a.markdown!.path).toBe(`attachments/_staging/${a.id}/snapshot.md`);
    expect(readFileSync(join(dataDir, a.markdown!.path!), 'utf8')).toContain('### @sam');
    expect(engine.stagedView(a.id)?.markdown?.status).toBe('ready');

    const goal = await engine.createGoal({ prompt: read.prompt, repoPath: repo, issue: read.issue, attachments: [a] });
    expect(goal.title).toBe('Export orders as CSV');
    expect(goal.issue).toEqual(read.issue);
    const claimed = goal.attachments.find((x) => x.id === a.id)!;
    expect(claimed.markdown!.path).toBe(`attachments/${goal.id}/${a.id}/snapshot.md`);
    expect(existsSync(join(dataDir, claimed.markdown!.path!))).toBe(true);
    expect(engine.stagedView(a.id)).toBeNull();
    const prompt = renderAttachments(goal, dataDir);
    expect(prompt).toContain('[link] https://github.com/acme/app/issues/7 — "the GitHub issue this goal was made from: its description and the comments under it" — markdown snapshot');
    expect(prompt).toContain(join(dataDir, claimed.markdown!.path!));
    // a title given by the caller wins over the issue’s
    const g2 = await engine.createGoal({ prompt: 'other words', title: 'My title', repoPath: repo, issue: read.issue });
    expect(g2.title).toBe('My title');
    expect(getGoal(engine.store.db, g2.id)!.issue?.number).toBe(7);
  });

  test('a bare #n needs the folder’s GitHub remote; a closed issue, an empty body and a missing title still read', async () => {
    const repo = await makeRepo();
    const engine = new Engine(cfg(), new FakeRunner(() => {}), ghWith(issue({ state: 'CLOSED', body: '  ', title: '' })));
    await expect(engine.readIssue({ ref: '#7' })).rejects.toThrow(/pick the repository folder first/);
    await expect(engine.readIssue({ ref: '#7', repoPath: repo })).rejects.toThrow(/no GitHub remote/);
    await sh('git remote add origin https://github.com/acme/app.git', repo);
    const read = await engine.readIssue({ ref: '#7', repoPath: repo });
    expect(read.issue.state).toBe('closed');
    expect(read.title).toBe('acme/app#7');
    expect(read.prompt).toBe('acme/app#7');
  });

  test('says what to do when the reference, gh or the issue is not right', async () => {
    const gh = ghWith();
    const engine = new Engine(cfg(), new FakeRunner(() => {}), gh);
    const err = async (ref: string) => engine.readIssue({ ref }).then(() => null, (e: IssueError) => ({ code: e.code, message: e.message }));
    expect(await err('fix the bug')).toMatchObject({ code: 'bad-ref' });
    expect(await err('https://github.com/acme/app/issues/8')).toMatchObject({ code: 'not-found', message: expect.stringContaining('no issue #8 in acme/app') });
    expect(gh.calls.filter((c) => c[0] === 'issueView').length).toBe(1);
    gh.authenticated = false;
    expect(await err('acme/app#7')).toMatchObject({ code: 'gh-login', message: expect.stringContaining('connect GitHub') });
    gh.installed = false;
    expect(await err('acme/app#7')).toMatchObject({ code: 'gh-missing', message: expect.stringContaining('brew install gh') });
    // nothing was staged for a read that failed
    expect(existsSync(join(dataDir, 'attachments'))).toBe(false);
  });
});
