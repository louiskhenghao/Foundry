import type { ExecResult } from '../git/git.ts';
import { git } from '../git/git.ts';
import type { GhAvailability, GhClient, IssueView, PrRef, PrReview, PrReviewComment, PrView } from './gh.ts';

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
  /** 'settling': right after a push GitHub has not recomputed mergeability — the first merge of a PR is refused as not
   * mergeable, its next `unknownViews` views say UNKNOWN and a merge asked for meanwhile is refused again; then the view
   * says `settlesAs`, and a merge goes through when that is MERGEABLE */
  mergeBehavior: 'ok' | 'protected' | 'fail' | 'settling' = 'ok';
  unknownViews = 1;
  settlesAs: 'MERGEABLE' | 'CONFLICTING' = 'MERGEABLE';
  /** how many views say CONFLICTING once the PR settled as a conflict, before a re-sync and push cleared it (never, by default) */
  conflictViews = Infinity;
  /** someone merges (or closes) the PR on GitHub right after the refusal (its views may still say UNKNOWN) */
  mergedWhileSettling = false;
  closedWhileSettling = false;
  /** runs before each look at a PR: a test closes or merges it on GitHub while its checks are waited for */
  beforeView: ((pr: PrView & { head: string; base: string; repo: string }) => void | Promise<void>) | null = null;
  /** how many times a PR was looked at after its first merge was refused */
  viewsAfterRefusal = 0;
  /** what gh prints when branch protection refuses a plain merge ('protected') */
  protectedStderr = 'GraphQL: Base branch requires review (protected branch)';
  private settled = new Set<number>();
  private unknownLeft = new Map<number, number>();
  private conflictLeft = new Map<number, number>();
  private conflicting = (n: number) => this.settlesAs === 'CONFLICTING' && (this.conflictLeft.get(n) ?? this.conflictViews) > 0;
  /** 'squash' writes one new commit on the base with the head's content, as GitHub's squash merge does */
  mergeStyle: 'fast-forward' | 'squash' = 'fast-forward';
  failedLogText: string | null = null;
  /** when set, a failing check is reported like this (e.g. a deploy integration's commit status) instead of an Actions run */
  failingCheck: { name: string; description: string; url: string; kind: 'run' | 'status' } | null = null;
  /** issues `issueView` can read, keyed `owner/name#number` */
  issues = new Map<string, IssueView>();
  /** review comments and reviews on each PR, as a test scripts them (ADR-0053) */
  reviewComments = new Map<number, PrReviewComment[]>();
  reviews = new Map<number, PrReview[]>();
  /** what Foundry wrote back: replies under inline comments, comments in the conversation */
  replies: { number: number; commentId: number; body: string }[] = [];
  comments: { number: number; body: string }[] = [];
  /** when set, every reply and comment is refused with this (a token without write scope, say) */
  writeError: string | null = null;
  private nextCommentId = 1000;
  /** a test's reviewer leaves an inline comment on the PR; the reply Foundry posts lands in `replies` */
  addReviewComment(number: number, c: Partial<PrReviewComment> & { body: string }): PrReviewComment {
    const full: PrReviewComment = { id: this.nextCommentId++, author: 'pat', bot: false, path: 'src/x.ts', line: 1, diffHunk: '@@ -1 +1 @@\n-old\n+new', url: `https://github.com/acme/app/pull/${number}#discussion_r${this.nextCommentId}`, createdAt: new Date().toISOString(), inReplyTo: null, ...c };
    this.reviewComments.set(number, [...(this.reviewComments.get(number) ?? []), full]);
    return full;
  }
  addReview(number: number, r: Partial<PrReview> & { state: string; body: string }): PrReview {
    const full: PrReview = { id: this.nextCommentId++, author: 'pat', bot: false, url: `https://github.com/acme/app/pull/${number}#pullrequestreview-${this.nextCommentId}`, submittedAt: new Date().toISOString(), ...r };
    this.reviews.set(number, [...(this.reviews.get(number) ?? []), full]);
    return full;
  }
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
    await this.beforeView?.(pr);
    if (this.settled.has(i.number)) this.viewsAfterRefusal++;
    const unknown = this.unknownLeft.get(i.number) ?? 0;
    if (unknown > 0) {
      this.unknownLeft.set(i.number, unknown - 1);
      return { ...pr, mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN', checks: [] };
    }
    if (this.mergeBehavior === 'settling' && this.settled.has(i.number) && this.conflicting(i.number) && pr.state === 'OPEN') {
      this.conflictLeft.set(i.number, (this.conflictLeft.get(i.number) ?? this.conflictViews) - 1);
      return { ...pr, mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', checks: [] };
    }
    const state = this.checksSequence[Math.min(this.viewCount, this.checksSequence.length - 1)]!;
    this.viewCount++;
    const checks =
      state === 'none'
        ? []
        : state === 'failing' && this.failingCheck
          ? [{ name: this.failingCheck.name, status: 'FAILURE', conclusion: 'FAILURE', kind: this.failingCheck.kind, description: this.failingCheck.description, url: this.failingCheck.url }]
          : [{ name: 'ci', status: state === 'pending' ? 'IN_PROGRESS' : 'COMPLETED', conclusion: state === 'pending' ? null : state === 'passing' ? 'SUCCESS' : 'FAILURE' }];
    return { ...pr, checks };
  }
  async prMerge(_cwd: string, i: { repo: string; number: number; method: string; auto: boolean }): Promise<ExecResult> {
    this.calls.push(['prMerge', String(i.number), i.method, i.auto ? 'auto' : 'now']);
    const pr = this.prs.get(i.number);
    if (!pr) return { code: 1, stdout: '', stderr: 'no such PR' };
    if (this.mergeBehavior === 'fail') return { code: 1, stdout: '', stderr: 'Pull request is not mergeable' };
    if (this.mergeBehavior === 'settling' && !i.auto) {
      const refused = { code: 1, stdout: '', stderr: 'GraphQL: Pull Request is not mergeable (mergePullRequest)' };
      if (!this.settled.has(i.number)) {
        this.settled.add(i.number);
        this.unknownLeft.set(i.number, this.unknownViews);
        if (this.mergedWhileSettling) await this.mergeOnGitHub(i.number);
        if (this.closedWhileSettling) pr.state = 'CLOSED';
        return refused;
      }
      // still computing, or settled as a conflict: refused as GitHub refuses
      if ((this.unknownLeft.get(i.number) ?? 0) > 0 || this.conflicting(i.number)) return refused;
    }
    if (this.mergeBehavior === 'settling' && i.auto) return { code: 1, stdout: '', stderr: 'GraphQL: Auto merge is not allowed for this repository (enablePullRequestAutoMerge)' };
    if (this.mergeBehavior === 'protected' && !i.auto) return { code: 1, stdout: '', stderr: this.protectedStderr };
    if (this.mergeBehavior === 'protected' && i.auto) return { code: 0, stdout: 'auto-merge enabled', stderr: '' }; // never actually merges in the fake
    if (this.bareRemote) pr.mergeCommit = await this.land(pr.head, pr.base);
    pr.state = 'MERGED';
    pr.mergedAt = new Date().toISOString();
    if (this.closeDependentsOnMerge) for (const other of this.prs.values()) if (other.state === 'OPEN' && other.base === pr.head) other.state = 'CLOSED';
    return { code: 0, stdout: 'merged', stderr: '' };
  }
  /** move the bare remote's base to the PR's content; returns the commit the base now points at */
  private async land(head: string, base: string): Promise<string> {
    const r = this.bareRemote!;
    const sha = (await git(['rev-parse', `refs/heads/${head}`], r)).stdout.trim();
    if (this.mergeStyle === 'fast-forward') {
      await git(['update-ref', `refs/heads/${base}`, sha], r);
      return sha;
    }
    const parent = (await git(['rev-parse', `refs/heads/${base}`], r)).stdout.trim();
    // the PR's diff against its base, applied on the base as it is now (a plain tree copy when the head contains it)
    const mergeTree = (await git(['merge-tree', '--write-tree', `--merge-base=${(await git(['merge-base', parent, sha], r)).stdout.trim()}`, parent, sha], r)).stdout.split('\n')[0]!.trim();
    const env = { GIT_AUTHOR_NAME: 'GitHub', GIT_AUTHOR_EMAIL: 'noreply@github.com', GIT_COMMITTER_NAME: 'GitHub', GIT_COMMITTER_EMAIL: 'noreply@github.com' };
    const proc = Bun.spawnSync(['git', 'commit-tree', mergeTree, '-p', parent, '-m', `squash ${head}`], { cwd: r, env: { ...process.env, ...env } });
    const commit = proc.stdout.toString().trim();
    await git(['update-ref', `refs/heads/${base}`, commit], r);
    return commit;
  }
  /** a merge done on GitHub after the delivery finished (auto-merge that took long, or a human pressing Merge) */
  async mergeOnGitHub(number: number): Promise<void> {
    const pr = this.prs.get(number)!;
    if (this.bareRemote) pr.mergeCommit = await this.land(pr.head, pr.base);
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
  async prClose(_cwd: string, i: { repo: string; number: number; comment: string }): Promise<ExecResult> {
    this.calls.push(['prClose', String(i.number)]);
    const pr = this.prs.get(i.number);
    if (!pr) return { code: 1, stdout: '', stderr: 'no such PR' };
    if (pr.state !== 'OPEN') return { code: 1, stdout: '', stderr: `PR is ${pr.state}` };
    pr.state = 'CLOSED';
    return { code: 0, stdout: 'closed', stderr: '' };
  }
  async failedLog() {
    return this.failedLogText;
  }
  async issueView(_cwd: string, i: { repo: string; number: number }): Promise<IssueView> {
    this.calls.push(['issueView', i.repo, String(i.number)]);
    if (!this.installed) throw new Error('gh not installed');
    if (!this.authenticated) throw new Error('gh issue view failed: To get started with GitHub CLI, please run:  gh auth login');
    const issue = this.issues.get(`${i.repo}#${i.number}`);
    if (!issue) throw new Error(`gh issue view failed: GraphQL: Could not resolve to an Issue with the number of ${i.number}. (repository.issue)`);
    return structuredClone(issue);
  }
  async prReviewComments(_cwd: string, i: { repo: string; number: number }): Promise<PrReviewComment[]> {
    this.calls.push(['prReviewComments', String(i.number)]);
    return structuredClone(this.reviewComments.get(i.number) ?? []);
  }
  async prReviews(_cwd: string, i: { repo: string; number: number }): Promise<PrReview[]> {
    this.calls.push(['prReviews', String(i.number)]);
    return structuredClone(this.reviews.get(i.number) ?? []);
  }
  async prReplyToComment(_cwd: string, i: { repo: string; number: number; commentId: number; body: string }): Promise<ExecResult> {
    this.calls.push(['prReplyToComment', String(i.number), String(i.commentId)]);
    if (this.writeError) return { code: 1, stdout: '', stderr: this.writeError };
    this.replies.push({ number: i.number, commentId: i.commentId, body: i.body });
    // the reply is a review comment too: a later look must know it is Foundry's
    this.addReviewComment(i.number, { author: 'tester', body: i.body, inReplyTo: i.commentId });
    return { code: 0, stdout: '{}', stderr: '' };
  }
  async prComment(_cwd: string, i: { repo: string; number: number; body: string }): Promise<ExecResult> {
    this.calls.push(['prComment', String(i.number)]);
    if (this.writeError) return { code: 1, stdout: '', stderr: this.writeError };
    this.comments.push({ number: i.number, body: i.body });
    return { code: 0, stdout: '{}', stderr: '' };
  }
}
