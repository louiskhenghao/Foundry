import type { ExecResult } from '../git/git.ts';
import { git } from '../git/git.ts';
import type { GhAvailability, GhClient, PrRef, PrView } from './gh.ts';

/**
 * Scripted GitHub for tests. PRs live in memory; "merge" fast-forwards the bare remote's base
 * branch to the head sha so the rest of the pipeline (cleanup, verification) behaves like GitHub.
 */
export class FakeGh implements GhClient {
  installed = true;
  authenticated = true;
  login_ = 'tester';
  repos = new Set<string>();
  prs = new Map<number, PrView & { head: string; base: string; repo: string }>();
  nextPr = 1;
  /** checks state returned on successive prView calls (last value repeats) */
  checksSequence: ('pending' | 'passing' | 'failing' | 'none')[] = ['passing'];
  private viewCount = 0;
  mergeBehavior: 'ok' | 'protected' | 'fail' = 'ok';
  failedLogText: string | null = null;
  calls: string[][] = [];
  /** path of the bare remote so merges can update refs */
  constructor(private bareRemote: string | null = null) {}

  async available(): Promise<GhAvailability> {
    return { installed: this.installed, version: this.installed ? '2.x-fake' : null, authenticated: this.installed && this.authenticated, login: this.authenticated ? this.login_ : null };
  }
  async login(onLine: (l: string) => void) {
    onLine('! First copy your one-time code: ABCD-1234');
    onLine('Open this URL to continue in your web browser: https://github.com/login/device');
    this.authenticated = true;
    return { ok: true, output: 'ok' };
  }
  async orgs() {
    return [this.login_, 'acme-org'];
  }
  async repoExists(owner: string, name: string) {
    this.calls.push(['repoExists', owner, name]);
    return this.repos.has(`${owner}/${name}`);
  }
  async repoCreate(i: { owner: string; name: string; visibility: 'private' | 'public'; sourcePath: string; remote: string }) {
    this.calls.push(['repoCreate', `${i.owner}/${i.name}`]);
    this.repos.add(`${i.owner}/${i.name}`);
    if (this.bareRemote) await git(['remote', 'add', i.remote, this.bareRemote], i.sourcePath);
    return { url: `https://github.com/${i.owner}/${i.name}` };
  }
  async prFind(_cwd: string, i: { repo: string; head: string; base: string }): Promise<PrRef | null> {
    const pr = [...this.prs.values()].find((p) => p.repo === i.repo && p.head === i.head && p.base === i.base && p.state === 'OPEN');
    return pr ? { number: pr.number, url: pr.url } : null;
  }
  async prCreate(_cwd: string, i: { repo: string; head: string; base: string; title: string; bodyFile: string }): Promise<PrRef> {
    this.calls.push(['prCreate', i.repo, i.head, i.base]);
    const number = this.nextPr++;
    const pr = { number, url: `https://github.com/${i.repo}/pull/${number}`, state: 'OPEN', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', mergedAt: null, mergeCommit: null, checks: [], head: i.head, base: i.base, repo: i.repo };
    this.prs.set(number, pr);
    return { number, url: pr.url };
  }
  async prView(_cwd: string, i: { repo: string; number: number }): Promise<PrView> {
    const pr = this.prs.get(i.number);
    if (!pr) throw new Error('no such PR');
    const state = this.checksSequence[Math.min(this.viewCount, this.checksSequence.length - 1)]!;
    this.viewCount++;
    const checks = state === 'none' ? [] : [{ name: 'ci', status: state === 'pending' ? 'IN_PROGRESS' : 'COMPLETED', conclusion: state === 'pending' ? null : state === 'passing' ? 'SUCCESS' : 'FAILURE' }];
    return { ...pr, checks };
  }
  async prMerge(_cwd: string, i: { repo: string; number: number; method: string; auto: boolean }): Promise<ExecResult> {
    this.calls.push(['prMerge', String(i.number), i.method, i.auto ? 'auto' : 'now']);
    const pr = this.prs.get(i.number);
    if (!pr) return { code: 1, stdout: '', stderr: 'no such PR' };
    if (this.mergeBehavior === 'fail') return { code: 1, stdout: '', stderr: 'Pull request is not mergeable' };
    if (this.mergeBehavior === 'protected' && !i.auto) return { code: 1, stdout: '', stderr: 'GraphQL: Base branch requires review (protected branch)' };
    if (this.mergeBehavior === 'protected' && i.auto) return { code: 0, stdout: 'auto-merge enabled', stderr: '' }; // never actually merges in the fake
    if (this.bareRemote) {
      const head = (await git(['rev-parse', `refs/heads/${pr.head}`], this.bareRemote)).stdout.trim();
      await git(['update-ref', `refs/heads/${pr.base}`, head], this.bareRemote);
      pr.mergeCommit = head;
    }
    pr.state = 'MERGED';
    pr.mergedAt = new Date().toISOString();
    if (this.closeDependentsOnMerge) for (const other of this.prs.values()) if (other.state === 'OPEN' && other.base === pr.head) other.state = 'CLOSED';
    return { code: 0, stdout: 'merged', stderr: '' };
  }
  /** a merge done on GitHub after the delivery finished (auto-merge that took long, or a human pressing Merge) */
  async mergeOnGitHub(number: number): Promise<void> {
    const pr = this.prs.get(number)!;
    if (this.bareRemote) {
      const head = (await git(['rev-parse', `refs/heads/${pr.head}`], this.bareRemote)).stdout.trim();
      await git(['update-ref', `refs/heads/${pr.base}`, head], this.bareRemote);
      pr.mergeCommit = head;
    }
    pr.state = 'MERGED';
    pr.mergedAt = new Date().toISOString();
  }
  /** a PR closed on GitHub without merging */
  closeOnGitHub(number: number): void {
    this.prs.get(number)!.state = 'CLOSED';
  }
  /** GitHub closes a PR whose base branch disappears; simulate that right after its base PR merges */
  closeDependentsOnMerge = false;
  async prEdit(_cwd: string, i: { repo: string; number: number; base: string }): Promise<ExecResult> {
    this.calls.push(['prEdit', String(i.number), i.base]);
    const pr = this.prs.get(i.number);
    if (!pr) return { code: 1, stdout: '', stderr: 'no such PR' };
    if (pr.state === 'CLOSED') return { code: 1, stdout: '', stderr: 'GraphQL: Cannot change the base branch of a closed pull request. (updatePullRequest)' };
    pr.base = i.base;
    return { code: 0, stdout: '', stderr: '' };
  }
  async prFindAny(_cwd: string, i: { repo: string; head: string }) {
    const all = [...this.prs.values()].filter((p) => p.repo === i.repo && p.head === i.head);
    const pick = all.find((p) => p.state === 'OPEN') ?? all.find((p) => p.state === 'MERGED') ?? all.at(-1);
    return pick ? { number: pick.number, url: pick.url, state: pick.state, base: pick.base } : null;
  }
  async prReopen(_cwd: string, i: { repo: string; number: number }): Promise<ExecResult> {
    this.calls.push(['prReopen', String(i.number)]);
    const pr = this.prs.get(i.number);
    if (!pr) return { code: 1, stdout: '', stderr: 'no such PR' };
    if (pr.state !== 'CLOSED') return { code: 1, stdout: '', stderr: `PR is ${pr.state}` };
    pr.state = 'OPEN';
    return { code: 0, stdout: 'reopened', stderr: '' };
  }
  async failedLog() {
    return this.failedLogText;
  }
}
