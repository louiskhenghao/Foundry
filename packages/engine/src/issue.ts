/**
 * A goal from a GitHub issue (ADR-0052). The issue is read once, through `gh`, when the person asks for it: its
 * thread (description and comments) becomes a link attachment with a ready markdown snapshot, its title and body the
 * goal's title and description, and the pull request of the delivery closes it. Nothing here writes to GitHub.
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Attachment, GoalIssue } from '@foundry/core';
import { attachmentDir, linkAttachment, markdownFileName } from './attachments.ts';
import type { IssueView } from './delivery/gh.ts';
import { repoSlug } from './delivery/policy.ts';
import type { Engine } from './engine.ts';
import { git } from './git/git.ts';

export class IssueError extends Error {
  constructor(
    message: string,
    public readonly code: 'bad-ref' | 'no-repo' | 'gh-missing' | 'gh-login' | 'not-found' | 'gh-failed',
  ) {
    super(message);
  }
}

/** An issue reference as a person writes it: a GitHub link, `owner/name#12`, or `#12` / `12` within a known repository. */
export function parseIssueRef(ref: string, defaultRepo: string | null = null): { repo: string; number: number } | null {
  const s = ref.trim();
  if (!s) return null;
  const url = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/(?:issues|pull)\/(\d+)(?:[/#?].*)?$/i);
  if (url) return { repo: `${url[1]}/${url[2]}`, number: Number(url[3]) };
  const slug = s.match(/^([\w.-]+\/[\w.-]+)#(\d+)$/);
  if (slug) return { repo: slug[1]!, number: Number(slug[2]) };
  const bare = s.match(/^#?(\d+)$/);
  if (bare && defaultRepo) return { repo: defaultRepo, number: Number(bare[1]) };
  return null;
}

/** owner/name of the folder's GitHub remote, or null when the remote is missing or not on GitHub */
export async function githubRepoOf(repoPath: string, remote = 'origin'): Promise<string | null> {
  const r = await git(['remote', 'get-url', remote], repoPath).catch(() => null);
  const url = r?.code === 0 ? r.stdout.trim() : '';
  if (!url || !/github\.com/i.test(url)) return null;
  const slug = repoSlug(url);
  return /^[\w.-]+\/[\w.-]+$/.test(slug) ? slug : null;
}

/** the thread a session reads stays a size a prompt can carry; the rest is on GitHub */
const MAX_THREAD_BYTES = 400 * 1024;

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : 'an unknown date');
const who = (login: string | null) => (login ? `@${login}` : 'someone');

/** The issue as markdown: its header line, the description, then every comment with who wrote it and when. */
export function renderIssueThread(repo: string, v: IssueView): string {
  const state = v.state.toUpperCase() === 'CLOSED' ? 'closed' : 'open';
  const header = [v.url, state, `opened by ${who(v.author)} on ${day(v.createdAt)}`, v.labels.length ? `labels: ${v.labels.join(', ')}` : null].filter(Boolean).join(' · ');
  const parts = [`# ${repo}#${v.number}: ${v.title.trim() || '(no title)'}`, header, '## Description', v.body.trim() || '_(no description)_', `## Comments (${v.comments.length})`];
  let size = parts.join('\n\n').length;
  let shown = 0;
  for (const c of v.comments) {
    const block = `### ${who(c.author)} · ${day(c.createdAt)}\n\n${c.body.trim() || '_(empty)_'}`;
    if (size + block.length > MAX_THREAD_BYTES) break;
    parts.push(block);
    size += block.length;
    shown++;
  }
  if (shown < v.comments.length) parts.push(`_…${v.comments.length - shown} more comment${v.comments.length - shown === 1 ? '' : 's'} not shown; read them at ${v.url}_`);
  if (!v.comments.length) parts.push('_(none)_');
  return parts.join('\n\n') + '\n';
}

/** What a read gives the New goal form or the CLI: the issue, the title and description to start from, and the staged thread. */
export interface IssueRead {
  issue: GoalIssue;
  title: string;
  prompt: string;
  /** a link attachment with the thread as its ready markdown snapshot, staged like an upload: pass it to the goal's `attachments` */
  attachment: Attachment;
}

const notFound = (msg: string) => /could not resolve|not found|no issue|404/i.test(msg);

/**
 * Read an issue with `gh` and stage its thread as an attachment. `repoPath` resolves a bare `#12` through the folder's
 * GitHub remote. The errors say what to do: install gh, connect GitHub, or check the reference.
 */
export async function readIssue(engine: Engine, i: { ref: string; repoPath?: string | null }): Promise<IssueRead> {
  const defaultRepo = i.repoPath ? await githubRepoOf(i.repoPath) : null;
  const parsed = parseIssueRef(i.ref, defaultRepo);
  if (!parsed) {
    if (/^#?\d+$/.test(i.ref.trim())) throw new IssueError(i.repoPath ? 'the repository folder has no GitHub remote: paste the issue link, or write it as owner/name#number' : 'pick the repository folder first, or paste the issue link (owner/name#number also works)', 'no-repo');
    throw new IssueError('not an issue reference: paste the issue link, or write owner/name#number', 'bad-ref');
  }
  const a = await engine.gh.available().catch(() => ({ installed: false, authenticated: false }));
  if (!a.installed) throw new IssueError('GitHub CLI (gh) is not installed. Run: brew install gh && gh auth login --web', 'gh-missing');
  if (!a.authenticated) throw new IssueError('GitHub CLI is not logged in: connect GitHub on the Setup page (or run gh auth login --web)', 'gh-login');
  let view: IssueView;
  try {
    view = await engine.gh.issueView(engine.config.dataDir, parsed);
  } catch (err) {
    const msg = String((err as Error).message ?? err);
    throw new IssueError(notFound(msg) ? `no issue #${parsed.number} in ${parsed.repo} (or the account connected to gh cannot read it)` : msg, notFound(msg) ? 'not-found' : 'gh-failed');
  }
  const now = new Date().toISOString();
  const repo = parsed.repo;
  const base = linkAttachment(view.url, { name: `${repo}#${view.number}`, note: 'the GitHub issue this goal was made from: its description and the comments under it' });
  // the snapshot is written where an upload's conversion would land, so claiming the goal moves it along (attachments.ts)
  const dir = attachmentDir(engine.config.dataDir, null, base.id);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, markdownFileName(base));
  writeFileSync(file, renderIssueThread(repo, view));
  const attachment = engine.stage({ ...base, markdown: { status: 'ready', path: relative(engine.config.dataDir, file), bytes: statSync(file).size, tool: 'gh issue view', error: null, at: now } });
  const title = view.title.trim() || `${repo}#${view.number}`;
  return {
    issue: { repo, number: view.number, url: view.url, title, state: view.state.toUpperCase() === 'CLOSED' ? 'closed' : 'open', labels: view.labels, readAt: now },
    title,
    prompt: view.body.trim() || title,
    attachment,
  };
}

/** The line a PR body closes (or refers to) the goal's issue with: `#12` in the issue's own repository, `owner/name#12` elsewhere. */
export function issueRefFor(issue: Pick<GoalIssue, 'repo' | 'number'>, prRepo: string | null | undefined): string {
  return prRepo && prRepo.toLowerCase() === issue.repo.toLowerCase() ? `#${issue.number}` : `${issue.repo}#${issue.number}`;
}
