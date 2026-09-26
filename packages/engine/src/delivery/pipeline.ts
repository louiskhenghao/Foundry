import { afterMerge } from './after-merge.ts';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Check, DeliveryPolicy, DeliveryStep, Goal, Task } from '@foundry/core';
import { IdPrefix, getBrief, getGoal, getTask, listCheckResultsByGoal, listChecks, listTasks, newId } from '@foundry/core';
import { maxAttemptsFor, runAttempt } from '../attempt-loop.ts';
import { runCommandCheck } from '../checks/command.ts';
import { truncateOutput } from '../distill/truncate.ts';
import type { Engine } from '../engine.ts';
import { raiseEscalation } from '../escalation.ts';
import { branchSlug, goalHeader, headerOf, taskCommitMessage } from '../git/conventional.ts';
import { detectRun } from '../preview/detect.ts';
import { abortInProgress, commitAuthorMode, commitStaged, conflictedFiles, ensureDetachedWorktree, exec, git, gitIdent, gitOk, headRef, isGitRepo, removeWorktree, withCoauthor, type ExecResult } from '../git/git.ts';
import { mergeBranchInto, resolveConflicts } from '../merge.ts';
import { deliveryWorkspacePath, ensureGoalWorkspace, goalWorkspacePath, isStackBranch, listStackBranches, stackBranchName } from '../workspace.ts';
import { reduceChecks, type GhClient, type PrView } from './gh.ts';
import { baseOf, buildPrBody, buildTaskPrBody, needsGh, planDelivery, repoSlug } from './policy.ts';

export interface DeliveryOptions {
  pollMs: number;
  noChecksGraceMs: number;
  checksTimeoutMs: number;
  automergeWaitMs: number;
}

class DeliveryFailed extends Error {
  constructor(
    public readonly step: DeliveryStep,
    message: string,
  ) {
    super(message);
  }
}
class DeliveryCancelled extends Error {}

interface Ctx {
  engine: Engine;
  goal: Goal;
  policy: DeliveryPolicy;
  goalWs: string;
  /** scratch worktree for stacked deliveries */
  deliveryWs: string;
  repoPath: string;
  base: string;
  remote: string;
  gh: GhClient;
  opts: DeliveryOptions;
  signal: AbortSignal;
  repo: string | null; // owner/name
  /** whether the repository runs any CI (detected once per delivery); null = unknown, keep the grace period */
  ci: boolean | null;
  /** PRs already pointed at the base branch in this run: the retarget call is not repeated for them */
  retargeted: Set<number>;
  /** checkouts whose dependencies were installed in this run (the scratch worktree starts without node_modules) */
  depsInstalled: Set<string>;
}

/** One branch of a stacked delivery. */
interface StackBranch {
  task: Task;
  index: number;
  branch: string;
  /** branch below it in the stack (the base branch for the first one) */
  base: string;
  commit: string;
  title: string;
}

/** The unit a PR is waited on / fixed / merged for: the whole goal branch or one stacked branch. */
interface PrUnit {
  cwd: string;
  branch: string;
  taskId: string | null;
  /** bring the remote base branch into `branch` (after it moved) */
  resync: () => Promise<boolean>;
}

type StepFn = <T>(s: DeliveryStep, fn: () => Promise<{ status: 'ok' | 'skipped'; detail: string; value?: T }>) => Promise<T | undefined>;

/**
 * Deliver a finished goal according to its policy. Every step is idempotent so a failed or
 * interrupted delivery can simply be run again. Only the engine talks to the remote — never the model.
 */
export async function runDelivery(engine: Engine, goalIn: Goal, signal: AbortSignal): Promise<void> {
  const { store, config } = engine;
  const goal = getGoal(store.db, goalIn.id)!;
  const policy = goal.delivery.policy;
  if (policy.mode === 'local') return;
  const ctx: Ctx = { engine, goal, policy, goalWs: goalWorkspacePath(config.dataDir, goal), deliveryWs: deliveryWorkspacePath(config.dataDir, goal), repoPath: goal.repoPath, base: baseOf(goal, policy), remote: policy.remote, gh: engine.gh, opts: config.delivery, signal, repo: null, ci: null, retargeted: new Set<number>(), depsInstalled: new Set<string>() };
  const ev = <T extends Parameters<typeof store.append>[0]>(e: T) => store.append(e);
  const step: StepFn = async (s, fn) => {
    if (signal.aborted) throw new DeliveryCancelled('cancelled');
    ev({ type: 'delivery.step', goalId: goal.id, payload: { step: s, status: 'started', detail: '' } });
    try {
      const r = await fn();
      ev({ type: 'delivery.step', goalId: goal.id, payload: { step: s, status: r.status, detail: r.detail } });
      return r.value;
    } catch (err) {
      if (err instanceof DeliveryCancelled) throw err;
      const msg = err instanceof DeliveryFailed ? err.message : String((err as Error).message ?? err);
      ev({ type: 'delivery.step', goalId: goal.id, payload: { step: s, status: 'failed', detail: msg } });
      throw err instanceof DeliveryFailed ? err : new DeliveryFailed(s, msg);
    }
  };
  const done = async (outcome: 'pushed' | 'pr_open' | 'automerge_armed' | 'merged') => {
    ev({ type: 'delivery.completed', goalId: goal.id, payload: { outcome } });
    config.log(`[delivery] ${goal.id}: ${outcome}`);
    // the work is on the remote base now: bring it to the user's checkout and tidy up (ADR-0015); never fails the delivery
    if (outcome === 'merged') await afterMerge(engine, goal.id).catch((err) => config.log(`[delivery] ${goal.id}: after-merge failed: ${String((err as Error).message ?? err)}`));
  };

  try {
    // ---- preflight + plan
    const probes = await probe(ctx);
    const plan = planDelivery(goal, policy, probes);
    ev({ type: 'delivery.started', goalId: goal.id, payload: { policy, plan: plan.map((p) => `${p.step}: ${p.command ?? p.note}`) } });
    await step('preflight', async () => {
      if (!(await isGitRepo(ctx.repoPath))) throw new DeliveryFailed('preflight', `${ctx.repoPath} is not a git repository`);
      await ensureGoalWorkspace(config.dataDir, goal);
      if (goal.branch === ctx.base) throw new DeliveryFailed('preflight', 'goal branch equals the base branch');
      if (needsGh(policy)) {
        const a = await ctx.gh.available();
        if (!a.installed) throw new DeliveryFailed('preflight', 'GitHub CLI (gh) is not installed. Run: brew install gh && gh auth login --web — or choose delivery mode "push".');
        if (!a.authenticated) throw new DeliveryFailed('preflight', 'GitHub CLI is not logged in. Run: gh auth login --web');
      }
      return { status: 'ok', detail: `base ${ctx.base}, remote ${ctx.remote}${needsGh(policy) ? ', gh ready' : ''}${policy.unit === 'task' ? ', one PR per task' : ''}` };
    });

    // ---- ensure-remote
    await step('ensure-remote', async () => {
      const url = await remoteUrl(ctx);
      if (url) {
        ctx.repo = repoSlug(url);
        if (policy.createRepo && ctx.repo !== `${policy.createRepo.owner}/${policy.createRepo.name}`) throw new DeliveryFailed('ensure-remote', `remote ${ctx.remote} points to ${url}, not ${policy.createRepo.owner}/${policy.createRepo.name}; refusing to change it`);
        return { status: 'ok', detail: `${ctx.remote} → ${url}` };
      }
      if (policy.remoteUrl) {
        await run(ctx, 'ensure-remote', ['git', 'remote', 'add', ctx.remote, policy.remoteUrl], ctx.repoPath, true);
        ctx.repo = repoSlug(policy.remoteUrl);
        return { status: 'ok', detail: `added remote ${ctx.remote} → ${policy.remoteUrl}` };
      }
      if (policy.createRepo) {
        const { owner, name, visibility } = policy.createRepo;
        const exists = await ctx.gh.repoExists(owner, name);
        let url2: string;
        if (exists) {
          url2 = `https://github.com/${owner}/${name}`;
          await run(ctx, 'ensure-remote', ['git', 'remote', 'add', ctx.remote, `${url2}.git`], ctx.repoPath, true);
        } else {
          const created = await ctx.gh.repoCreate({ owner, name, visibility, sourcePath: ctx.repoPath, remote: ctx.remote });
          url2 = created.url;
          ev({ type: 'delivery.repo_created', goalId: goal.id, payload: { owner, name, url: url2, visibility } });
        }
        ctx.repo = `${owner}/${name}`;
        // the one and only push of the base branch: a brand-new repository needs one so the PR has a base
        await run(ctx, 'ensure-remote', ['git', 'push', '-u', ctx.remote, `refs/heads/${ctx.base}:refs/heads/${ctx.base}`], ctx.goalWs, true);
        return { status: 'ok', detail: `${exists ? 'reusing' : 'created'} ${url2}; pushed ${ctx.base}` };
      }
      throw new DeliveryFailed('ensure-remote', `remote "${ctx.remote}" does not exist. Add a remote URL or pick an owner to create the repository.`);
    });

    // ---- stacked per-task delivery
    if (policy.unit === 'task') {
      const stack = await buildStack(ctx, step);
      if (stack) return await runStacked(ctx, stack, step, done);
    }

    // ---- sync-base
    await step('sync-base', async () => {
      const f = await run(ctx, 'sync-base', ['git', 'fetch', ctx.remote, ctx.base], ctx.goalWs, false);
      if (f.code !== 0) return { status: 'skipped', detail: `remote has no ${ctx.base} yet` };
      const ref = `${ctx.remote}/${ctx.base}`;
      const anc = await git(['merge-base', '--is-ancestor', ref, 'HEAD'], ctx.goalWs);
      if (anc.code === 0) return { status: 'skipped', detail: `already contains ${ref}` };
      const ok = await syncWithBase(ctx, ref);
      if (!ok) throw new DeliveryFailed('sync-base', `could not merge ${ref} into ${goal.branch}`);
      return { status: 'ok', detail: `merged ${ref}` };
    });

    // ---- push
    await step('push', async () => {
      const r = await pushRef(ctx, goal.branch, null);
      return { status: 'ok', detail: `${goal.branch} @ ${r.slice(0, 7)} → ${ctx.remote}` };
    });
    if (policy.mode === 'push') return done('pushed');

    // ---- open-pr
    const repo = ctx.repo!;
    const pr = (await step('open-pr', async () => {
      const existing = await ctx.gh.prFind(ctx.goalWs, { repo, head: goal.branch, base: ctx.base });
      const title = probes.title ?? goal.title;
      if (existing) {
        ev({ type: 'delivery.pr_opened', goalId: goal.id, payload: { number: existing.number, url: existing.url, base: ctx.base, head: goal.branch, taskId: null, title } });
        return { status: 'ok', detail: `reusing PR #${existing.number}`, value: existing };
      }
      const brief = getBrief(store.db, goal.id)?.brief ?? null;
      const review = [...store.listByGoal(goal.id, 2000)].reverse().find((e) => e.type === 'review.goal.finished')?.payload as any;
      const names = new Map(listChecks(store.db, goal.id).map((c) => [c.id, c.name]));
      const bodyFile = bodyPath(ctx, 'pr-body.md');
      writeFileSync(bodyFile, buildPrBody(goal, brief, review ?? null, names));
      const created = await ctx.gh.prCreate(ctx.goalWs, { repo, head: goal.branch, base: ctx.base, title, bodyFile });
      ev({ type: 'delivery.pr_opened', goalId: goal.id, payload: { number: created.number, url: created.url, base: ctx.base, head: goal.branch, taskId: null, title } });
      return { status: 'ok', detail: `opened PR #${created.number}`, value: created };
    }))!;
    if (policy.mode === 'pr') return done('pr_open');

    const unit: PrUnit = {
      cwd: ctx.goalWs,
      branch: goal.branch,
      taskId: null,
      resync: async () => {
        await run(ctx, 'sync-base', ['git', 'fetch', ctx.remote, ctx.base], ctx.goalWs, true);
        return syncWithBase(ctx, `${ctx.remote}/${ctx.base}`);
      },
    };
    const view = await settlePr(ctx, step, repo, pr.number, unit);
    const merged = await mergePr(ctx, step, repo, pr.number, view, unit);
    if (!merged) return done('automerge_armed');

    // ---- cleanup
    await step('cleanup', async () => deleteRemoteBranch(ctx, goal.branch));
    return done('merged');
  } catch (err) {
    if (err instanceof DeliveryCancelled) {
      ev({ type: 'delivery.failed', goalId: goal.id, payload: { step: getGoal(store.db, goal.id)!.delivery.step ?? 'preflight', reason: 'cancelled by user' } });
      return;
    }
    const f = err instanceof DeliveryFailed ? err : new DeliveryFailed(getGoal(store.db, goal.id)!.delivery.step ?? 'preflight', String((err as Error).stack ?? err));
    ev({ type: 'delivery.failed', goalId: goal.id, payload: { step: f.step, reason: f.message } });
    config.log(`[delivery] ${goal.id} failed at ${f.step}: ${f.message}`);
  }
}

// ---------- stacked delivery ----------

/**
 * Every task commit in the order it landed on the goal branch, with its stable stack position and
 * whether a previous delivery already merged it. Positions never shift when a task merges, so a re-run
 * reuses the same branch names (and therefore the same PRs).
 */
function committedTasks(ctx: Ctx): { task: Task; index: number; merged: boolean }[] {
  const { store } = ctx.engine;
  const events = store.listByGoal(ctx.goal.id, 5000);
  const mergedTaskIds = new Set(events.filter((e) => e.type === 'delivery.merged').map((e) => (e.payload as any).taskId as string | null).filter((x): x is string => !!x));
  const order: string[] = [];
  for (const e of events) {
    if (e.type !== 'task.committed') continue;
    const { taskId } = e.payload as { taskId: string };
    const i = order.indexOf(taskId);
    if (i >= 0) order.splice(i, 1);
    order.push(taskId);
  }
  const tasks = listTasks(store.db, ctx.goal.id);
  return order
    .map((id) => tasks.find((t) => t.id === id))
    .filter((t): t is Task => !!t && !!t.commitRef && t.state === 'done')
    .map((task, i) => ({ task, index: i + 1, merged: mergedTaskIds.has(task.id) }));
}
/** Task commits that still need delivering. */
const deliverableTasks = (ctx: Ctx) => committedTasks(ctx).filter((t) => !t.merged);

/**
 * Turn the task commits into stacked branches on top of the remote base: `goal/<id>/1-<slug>` holds
 * task 1, `goal/<id>/2-<slug>` holds tasks 1+2, … Returns null (and says why) when the goal should be
 * delivered as one PR instead: fewer than two task commits, no remote base yet, or a commit that
 * cannot be applied even with a Merge Attempt.
 */
async function buildStack(ctx: Ctx, step: StepFn): Promise<StackBranch[] | null> {
  const { engine, goal, policy } = ctx;
  const { store } = engine;
  const note = (message: string) => store.append({ type: 'delivery.note', goalId: goal.id, payload: { message } });
  const result = await step<StackBranch[] | null>('build-stack', async () => {
    const all = committedTasks(ctx);
    const tasks = all.filter((t) => !t.merged);
    if (all.length < 2) return { status: 'skipped', detail: `${all.length} task commit(s) to deliver — one PR is enough`, value: null };
    if (!tasks.length) return { status: 'skipped', detail: 'every task commit was already merged by a previous delivery', value: [] };
    const f = await run(ctx, 'build-stack', ['git', 'fetch', ctx.remote, ctx.base], ctx.goalWs, false);
    if (f.code !== 0) {
      note(`remote has no ${ctx.base} yet; delivering the goal as one PR`);
      return { status: 'skipped', detail: `remote has no ${ctx.base} yet`, value: null };
    }
    const baseRef = `${ctx.remote}/${ctx.base}`;
    const nameOf = (t: { task: Task; index: number }) => stackBranchName(goal.branch, t.index, branchSlug(headerOf(t.task.commitMessage ?? t.task.title)));
    const expected = tasks.map(nameOf);
    const baseFor = (i: number) => (i === 0 ? ctx.base : expected[i - 1]!);

    // a previous run already built (and maybe pushed) these branches: reuse them, never rebuild pushed history
    const existing = await listStackBranches(ctx.repoPath, goal.branch);
    if (expected.every((b) => existing.includes(b))) {
      const stack: StackBranch[] = [];
      for (const [i, t] of tasks.entries()) {
        const commit = await gitOk(['rev-parse', expected[i]!], ctx.repoPath);
        stack.push({ task: t.task, index: t.index, branch: expected[i]!, base: baseFor(i), commit, title: headerOf(t.task.commitMessage ?? t.task.title) });
      }
      await ensureDetachedWorktree(ctx.repoPath, ctx.deliveryWs, baseRef);
      store.append({ type: 'delivery.stack_built', goalId: goal.id, payload: { branches: stack.map((b) => ({ taskId: b.task.id, index: b.index, branch: b.branch, base: b.base, commit: b.commit, title: b.title })) } });
      return { status: 'ok', detail: `reusing ${stack.length} stacked branches from the previous run`, value: stack };
    }
    // stale stack from an older run: drop its branches locally and on the remote (closing their PRs) before rebuilding
    for (const b of existing) {
      await git(['branch', '-D', b], ctx.repoPath);
      await run(ctx, 'build-stack', ['git', 'push', ctx.remote, '--delete', `refs/heads/${b}`], ctx.goalWs, false);
    }

    await ensureDetachedWorktree(ctx.repoPath, ctx.deliveryWs, baseRef);
    const stack: StackBranch[] = [];
    const bail = async (why: string) => {
      await abortInProgress(ctx.deliveryWs);
      await removeWorktree(ctx.repoPath, ctx.deliveryWs);
      for (const b of stack) await git(['branch', '-D', b.branch], ctx.repoPath);
      note(`${why}; delivering the goal as one PR instead`);
      return { status: 'skipped' as const, detail: why, value: null };
    };
    for (const [i, { task: t, index }] of tasks.entries()) {
      const pick = async () => git([...(await gitIdent(ctx.deliveryWs)), 'cherry-pick', '-x', '--keep-redundant-commits', t.commitRef!], ctx.deliveryWs);
      const r = await pick();
      if (r.code !== 0) {
        const files = await conflictedFiles(ctx.deliveryWs);
        if (!files.length) return bail(`commit ${t.commitRef!.slice(0, 7)} (${headerOf(t.commitMessage ?? t.title)}) could not be applied on ${baseRef}: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
        if (!policy.autoResolveConflicts) return bail(`commit ${t.commitRef!.slice(0, 7)} conflicts with ${baseRef} in ${files.join(', ')} and the policy forbids automatic resolution`);
        store.append({ type: 'merge.conflict', goalId: goal.id, payload: { taskId: t.id, files } });
        const ok = await resolveConflicts(
          engine,
          goal,
          t,
          files,
          { ref: t.commitRef!, label: `${t.commitRef!.slice(0, 7)} (${headerOf(t.commitMessage ?? t.title)})`, intent: t.spec },
          {
            cwd: ctx.deliveryWs,
            redo: async () => void (await pick()),
            commitMessage: t.commitMessage ?? taskCommitMessage(goal, t),
            hint: `This commit is being re-applied on top of ${baseRef} to build a pull request for this task alone. The goal branch \`${goal.branch}\` already contains the intended end result of this task merged with everything before it — \`git show ${goal.branch}:<file>\` is the reference for how each file should end up, minus the changes of later tasks.`,
            runChecks: false,
            escalate: false,
          },
          r.stderr,
        );
        if (!ok) return bail(`commit ${t.commitRef!.slice(0, 7)} conflicts with ${baseRef} in ${files.join(', ')} and the merge attempts could not resolve it`);
      }
      // a rebuilt commit is written by the commit author Settings ask for, whoever wrote the original
      if (commitAuthorMode() !== 'foundry') {
        const msg = (await git(['log', '-1', '--format=%B'], ctx.deliveryWs)).stdout.trimEnd();
        await git([...(await gitIdent(ctx.deliveryWs)), 'commit', '--amend', '-q', '--allow-empty', '--reset-author', '-m', withCoauthor(msg)], ctx.deliveryWs);
      }
      const commit = await headRef(ctx.deliveryWs);
      await gitOk(['branch', '-f', expected[i]!, commit], ctx.deliveryWs);
      stack.push({ task: t, index, branch: expected[i]!, base: baseFor(i), commit, title: headerOf(t.commitMessage ?? t.title) });
    }
    store.append({ type: 'delivery.stack_built', goalId: goal.id, payload: { branches: stack.map((b) => ({ taskId: b.task.id, index: b.index, branch: b.branch, base: b.base, commit: b.commit, title: b.title })) } });
    return { status: 'ok', detail: `${stack.length} stacked branches on ${baseRef}: ${stack.map((b) => b.branch).join(' → ')}`, value: stack };
  });
  return result ?? null;
}

async function runStacked(ctx: Ctx, stack: StackBranch[], step: StepFn, done: (o: 'pushed' | 'pr_open' | 'automerge_armed' | 'merged') => Promise<void>): Promise<void> {
  const { engine, goal, policy } = ctx;
  const { store } = engine;
  const ev = <T extends Parameters<typeof store.append>[0]>(e: T) => store.append(e);

  await step('push', async () => {
    for (const b of stack) await pushRef(ctx, b.branch, b.task.id);
    return { status: 'ok', detail: `${stack.length} branches → ${ctx.remote}` };
  });
  if (policy.mode === 'push') {
    await removeWorktree(ctx.repoPath, ctx.deliveryWs).catch(() => {});
    return done('pushed');
  }

  const repo = ctx.repo!;
  const goalTitle = goalHeader(goal, getBrief(store.db, goal.id)?.brief.title, listTasks(store.db, goal.id));
  const prs = (await step<{ b: StackBranch; number: number; url: string }[]>('open-pr', async () => {
    const out: { b: StackBranch; number: number; url: string }[] = [];
    for (const [i, b] of stack.entries()) {
      const base = i === 0 ? ctx.base : stack[i - 1]!.branch;
      // a PR for this branch may already exist from a previous run — open, closed by GitHub when its base branch went away, or merged
      const existing = await ctx.gh.prFindAny(ctx.goalWs, { repo, head: b.branch });
      if (existing?.state === 'MERGED') {
        ev({ type: 'delivery.pr_opened', goalId: goal.id, payload: { number: existing.number, url: existing.url, base: existing.base, head: b.branch, taskId: b.task.id, title: b.title } });
        ev({ type: 'delivery.merged', goalId: goal.id, payload: { prNumber: existing.number, method: policy.mergeMethod, ref: null, taskId: b.task.id } });
        store.append({ type: 'delivery.note', goalId: goal.id, payload: { message: `PR #${existing.number} (${b.branch}) was already merged; skipping it` } });
        continue;
      }
      if (existing?.state === 'CLOSED') {
        const r = await ctx.gh.prReopen(ctx.goalWs, { repo, number: existing.number });
        logCmd(ctx, 'open-pr', ['gh', 'pr', 'reopen', String(existing.number)], ctx.goalWs, r, 0);
        if (r.code === 0) store.append({ type: 'delivery.note', goalId: goal.id, payload: { message: `reopened PR #${existing.number} (${b.branch}); GitHub had closed it when its base branch was deleted` } });
      }
      if (existing && (existing.state === 'OPEN' || existing.state === 'CLOSED')) {
        const view = await ctx.gh.prView(ctx.goalWs, { repo, number: existing.number }).catch(() => null);
        if (view?.state === 'OPEN') {
          ev({ type: 'delivery.pr_opened', goalId: goal.id, payload: { number: existing.number, url: existing.url, base: existing.base, head: b.branch, taskId: b.task.id, title: b.title } });
          out.push({ b, number: existing.number, url: existing.url });
          continue;
        }
      }
      const results = taskCheckResults(ctx, b.task);
      const reviewNote = [...store.listByGoal(goal.id, 5000)].reverse().find((e) => e.type === 'review.task.finished' && (e.payload as any).taskId === b.task.id)?.payload as any;
      const bodyFile = bodyPath(ctx, `pr-${b.index}.md`);
      writeFileSync(bodyFile, buildTaskPrBody(goal, b.task, { index: b.index, total: stack.length, goalTitle, prevPr: out[i - 1]?.number ?? null, prevBranch: i === 0 ? null : base }, results, reviewNote?.verdict?.summary ?? null));
      const created = await ctx.gh.prCreate(ctx.goalWs, { repo, head: b.branch, base, title: b.title, bodyFile });
      ev({ type: 'delivery.pr_opened', goalId: goal.id, payload: { number: created.number, url: created.url, base, head: b.branch, taskId: b.task.id, title: b.title } });
      out.push({ b, number: created.number, url: created.url });
    }
    return { status: 'ok', detail: `${out.length} PRs: ${out.map((p) => `#${p.number}`).join(' → ')}`, value: out };
  }))!;
  if (policy.mode === 'pr') {
    await removeWorktree(ctx.repoPath, ctx.deliveryWs).catch(() => {});
    return done('pr_open');
  }

  // ---- auto-merge: bottom-up, one PR at a time
  /** point a stacked PR at the base branch; a PR GitHub closed (its base branch vanished) is reopened first */
  const retarget = async (step_: DeliveryStep, pr: { b: StackBranch; number: number; url: string }) => {
    const { number } = pr;
    if (ctx.retargeted.has(number)) return; // cleanup of the PR below already pointed this one at the base
    let r = await ctx.gh.prEdit(ctx.goalWs, { repo, number, base: ctx.base });
    logCmd(ctx, step_, ['gh', 'pr', 'edit', String(number), '--base', ctx.base], ctx.goalWs, r, 0);
    if (r.code !== 0 && /closed/i.test(r.stderr + r.stdout)) {
      const o = await ctx.gh.prReopen(ctx.goalWs, { repo, number });
      logCmd(ctx, step_, ['gh', 'pr', 'reopen', String(number)], ctx.goalWs, o, 0);
      if (o.code === 0) {
        store.append({ type: 'delivery.note', goalId: goal.id, payload: { message: `reopened PR #${number}; GitHub had closed it when its base branch was deleted` } });
        r = await ctx.gh.prEdit(ctx.goalWs, { repo, number, base: ctx.base });
        logCmd(ctx, step_, ['gh', 'pr', 'edit', String(number), '--base', ctx.base], ctx.goalWs, r, 0);
      }
    }
    if (r.code !== 0) throw new DeliveryFailed(step_, `could not retarget PR #${number} to ${ctx.base}: ${(r.stderr || r.stdout).trim().slice(0, 200)}`);
    ctx.retargeted.add(number);
    // same PR, new base: the read model keys PRs by head branch, so this just updates `base`
    if (pr.b.base !== ctx.base) ev({ type: 'delivery.pr_opened', goalId: goal.id, payload: { number, url: pr.url, base: ctx.base, head: pr.b.branch, taskId: pr.b.task.id, title: pr.b.title } });
  };
  for (const [i, p] of prs.entries()) {
    const unit: PrUnit = { cwd: ctx.deliveryWs, branch: p.b.branch, taskId: p.b.task.id, resync: () => syncStackBranch(ctx, p.b) };
    await gitOk(['checkout', '-q', p.b.branch], ctx.deliveryWs);
    // every PR: point it at the base branch (the one below it merged — or, on a resumed run, was merged earlier) and bring the base in
    await step('sync-base', async () => {
      await retarget('sync-base', p);
      const ok = await syncStackBranch(ctx, p.b);
      if (!ok) throw new DeliveryFailed('sync-base', `could not bring ${ctx.base} into ${p.b.branch}${i > 0 ? ` after PR #${prs[i - 1]!.number} merged` : ''}`);
      return { status: 'ok', detail: `PR #${p.number} targets ${ctx.base}; ${p.b.branch} up to date with it` };
    });
    await step('push', async () => ({ status: 'ok', detail: `${p.b.branch} @ ${(await pushRef(ctx, p.b.branch, p.b.task.id)).slice(0, 7)}` }));
    const view = await settlePr(ctx, step, repo, p.number, unit);
    const merged = await mergePr(ctx, step, repo, p.number, view, unit);
    if (!merged) {
      await removeWorktree(ctx.repoPath, ctx.deliveryWs).catch(() => {});
      return done('automerge_armed');
    }
    // the PR above is based on this branch: retarget it BEFORE the branch goes away, or GitHub closes it
    const next = prs[i + 1];
    await step('cleanup', async () => {
      if (next) await retarget('cleanup', next);
      const r = await deleteRemoteBranch(ctx, p.b.branch);
      return { status: r.status, detail: `${next ? `PR #${next.number} retargeted to ${ctx.base}; ` : ''}${r.detail}` };
    });
  }
  await removeWorktree(ctx.repoPath, ctx.deliveryWs).catch(() => {});
  return done('merged');
}

/** Merge the (moved) remote base into one stacked branch, checked out in the delivery worktree. */
async function syncStackBranch(ctx: Ctx, b: StackBranch): Promise<boolean> {
  await gitOk(['checkout', '-q', b.branch], ctx.deliveryWs);
  await run(ctx, 'sync-base', ['git', 'fetch', ctx.remote, ctx.base], ctx.deliveryWs, true);
  const ref = `${ctx.remote}/${ctx.base}`;
  if ((await git(['merge-base', '--is-ancestor', ref, 'HEAD'], ctx.deliveryWs)).code === 0) return true;
  const task = syntheticMergeTask(ctx, ref, b.branch);
  await ensureDeps(ctx, ctx.deliveryWs);
  const ok = await mergeBranchInto(ctx.engine, ctx.goal, task, { ref, label: ref, intent: `The base branch ${ref} moved (the PR below this one merged, or other people pushed). Keep its changes AND this branch's changes.` }, { autoResolve: ctx.policy.autoResolveConflicts, cwd: ctx.deliveryWs, into: b.branch });
  const fresh = getTask(ctx.engine.store.db, task.id)!;
  if (ok && fresh.state === 'merging') ctx.engine.store.append({ type: 'task.state_changed', goalId: ctx.goal.id, payload: { taskId: task.id, from: 'merging', to: 'done', reason: 'base merged' } });
  return ok;
}

function taskCheckResults(ctx: Ctx, task: Task): { name: string; status: string }[] {
  const { store } = ctx.engine;
  const checks = listChecks(store.db, ctx.goal.id).filter((c) => c.taskId === task.id);
  const results = listCheckResultsByGoal(store.db, ctx.goal.id).filter((r) => r.taskId === task.id);
  const out: { name: string; status: string }[] = [];
  for (const c of checks) {
    const last = [...results].reverse().find((r) => r.checkId === c.id);
    if (last) out.push({ name: c.name, status: last.status });
  }
  return out;
}

// ---------- shared PR steps ----------

/** wait-checks (+ re-sync on conflict, + fix-CI) until the PR is ready to merge or delivery fails */
async function settlePr(ctx: Ctx, step: StepFn, repo: string, number: number, unit: PrUnit): Promise<PrView> {
  const { engine, goal, policy } = ctx;
  const { store } = engine;
  for (;;) {
    const view = (await step<PrView>('wait-checks', async () => {
      if (!policy.requireChecks) {
        const v = await ctx.gh.prView(ctx.goalWs, { repo, number });
        return { status: 'skipped', detail: 'checks not required by policy', value: v };
      }
      const v = await waitForChecks(ctx, repo, number);
      return { status: 'ok', detail: `PR #${number}: checks ${reduceChecks(v.checks)}`, value: v };
    }))!;
    const state = policy.requireChecks ? reduceChecks(view.checks) : 'passing';
    if (view.mergeable === 'CONFLICTING') {
      await step('sync-base', async () => {
        const ok = await unit.resync();
        if (!ok) throw new DeliveryFailed('sync-base', 'base branch moved and the conflict could not be resolved');
        return { status: 'ok', detail: 're-synced with base after it moved' };
      });
      await step('push', async () => ({ status: 'ok', detail: `re-pushed @ ${(await pushRef(ctx, unit.branch, unit.taskId)).slice(0, 7)}` }));
      continue;
    }
    if (state === 'failing') {
      const g = getGoal(store.db, goal.id)!;
      if (g.delivery.fixCycles >= policy.fixCiCycles) throw new DeliveryFailed('wait-checks', `CI checks are failing on PR #${number} and the fix budget (${policy.fixCiCycles}) is used up`);
      await step('fix-ci', async () => {
        const ok = await fixCi(ctx, repo, number, unit);
        if (!ok) throw new DeliveryFailed('fix-ci', 'the fix-CI task could not make the goal-level checks pass');
        return { status: 'ok', detail: 'fix task passed; pushing again' };
      });
      await step('push', async () => ({ status: 'ok', detail: `pushed fix @ ${(await pushRef(ctx, unit.branch, unit.taskId)).slice(0, 7)}` }));
      continue;
    }
    if (state === 'none' && policy.requireChecks && !policy.mergeIfNoChecks) throw new DeliveryFailed('wait-checks', 'no checks reported and the policy requires at least one');
    return view;
  }
}

/** merge one PR; true = merged, false = auto-merge armed under branch protection (GitHub merges later) */
async function mergePr(ctx: Ctx, step: StepFn, repo: string, number: number, view: PrView, unit: PrUnit): Promise<boolean> {
  const { engine, goal, policy, signal } = ctx;
  const { store, config } = engine;
  const ev = <T extends Parameters<typeof store.append>[0]>(e: T) => store.append(e);
  const merged = await step<boolean>('merge', async () => {
    if (view.state !== 'OPEN') return { status: 'skipped', detail: `PR #${number} is ${view.state}`, value: view.state === 'MERGED' };
    if (view.mergeable !== 'MERGEABLE' && view.mergeable !== 'UNKNOWN') throw new DeliveryFailed('merge', `PR #${number} is ${view.mergeable}`);
    const r = await ctx.gh.prMerge(config.dataDir, { repo, number, method: policy.mergeMethod, auto: false });
    logCmd(ctx, 'merge', ['gh', 'pr', 'merge', String(number), `--${policy.mergeMethod}`], config.dataDir, r, 0);
    if (r.code === 0) {
      const v = await ctx.gh.prView(ctx.goalWs, { repo, number }).catch(() => null);
      ev({ type: 'delivery.merged', goalId: goal.id, payload: { prNumber: number, method: policy.mergeMethod, ref: v?.mergeCommit ?? null, taskId: unit.taskId } });
      return { status: 'ok', detail: `PR #${number} merged with ${policy.mergeMethod}`, value: true };
    }
    const protectedBranch = /protect|review|required status|not mergeable|auto-merge/i.test(r.stderr + r.stdout);
    if (!protectedBranch) throw new DeliveryFailed('merge', `gh pr merge failed: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
    const a = await ctx.gh.prMerge(config.dataDir, { repo, number, method: policy.mergeMethod, auto: true });
    logCmd(ctx, 'merge', ['gh', 'pr', 'merge', String(number), `--${policy.mergeMethod}`, '--auto'], config.dataDir, a, 0);
    if (a.code !== 0) throw new DeliveryFailed('merge', `branch protection blocks the merge and auto-merge could not be enabled: ${(a.stderr || a.stdout).trim().slice(0, 300)}`);
    const deadline = Date.now() + ctx.opts.automergeWaitMs;
    while (Date.now() < deadline) {
      await sleep(ctx.opts.pollMs, signal);
      const v = await ctx.gh.prView(ctx.goalWs, { repo, number }).catch(() => null);
      if (v?.mergedAt) {
        ev({ type: 'delivery.merged', goalId: goal.id, payload: { prNumber: number, method: policy.mergeMethod, ref: v.mergeCommit, taskId: unit.taskId } });
        return { status: 'ok', detail: 'auto-merged once protections were satisfied', value: true };
      }
    }
    return { status: 'skipped', detail: `auto-merge armed on PR #${number}; GitHub will merge when branch protections are satisfied`, value: false };
  });
  return merged ?? false;
}

async function deleteRemoteBranch(ctx: Ctx, branch: string): Promise<{ status: 'ok' | 'skipped'; detail: string }> {
  if (!ctx.policy.deleteRemoteBranch) return { status: 'skipped', detail: 'policy keeps the remote branch' };
  if (branch === ctx.base) throw new DeliveryFailed('cleanup', 'refusing to delete the base branch');
  const r = await run(ctx, 'cleanup', ['git', 'push', ctx.remote, '--delete', `refs/heads/${branch}`], ctx.goalWs, false);
  return { status: r.code === 0 ? 'ok' : 'skipped', detail: r.code === 0 ? `deleted ${ctx.remote}/${branch}` : `remote branch already gone (${r.stderr.trim().slice(0, 80)})` };
}

// ---------- helpers ----------

async function probe(ctx: Ctx) {
  const { store } = ctx.engine;
  const url = await remoteUrl(ctx);
  const gh = needsGh(ctx.policy) ? await ctx.gh.available().catch(() => ({ installed: false, authenticated: false })) : null;
  let prExists: { number: number; url: string } | null = null;
  if (url && gh?.authenticated && (ctx.policy.mode === 'pr' || ctx.policy.mode === 'pr-automerge')) prExists = await ctx.gh.prFind(ctx.goalWs, { repo: repoSlug(url), head: ctx.goal.branch, base: ctx.base }).catch(() => null);
  const tasks = listTasks(store.db, ctx.goal.id);
  const title = goalHeader(ctx.goal, getBrief(store.db, ctx.goal.id)?.brief.title, tasks);
  const stackSize = deliverableTasks(ctx).length;
  return { remoteExists: !!url, remoteUrl: url, gh: gh ? { installed: gh.installed, authenticated: gh.authenticated } : null, prExists, title, stackSize };
}

export async function probeForPlan(engine: Engine, goal: Goal, policy: DeliveryPolicy) {
  const ctx: Ctx = { engine, goal, policy, goalWs: goalWorkspacePath(engine.config.dataDir, goal), deliveryWs: deliveryWorkspacePath(engine.config.dataDir, goal), repoPath: goal.repoPath, base: baseOf(goal, policy), remote: policy.remote, gh: engine.gh, opts: engine.config.delivery, signal: new AbortController().signal, repo: null, ci: null, retargeted: new Set<number>(), depsInstalled: new Set<string>() };
  return probe(ctx);
}

function bodyPath(ctx: Ctx, name: string): string {
  const dir = join(ctx.engine.config.dataDir, 'delivery', ctx.goal.id);
  mkdirSync(dir, { recursive: true });
  return join(dir, name);
}

async function remoteUrl(ctx: Ctx): Promise<string | null> {
  const r = await git(['remote', 'get-url', ctx.remote], ctx.repoPath);
  return r.code === 0 ? r.stdout.trim() : null;
}

function logCmd(ctx: Ctx, step: DeliveryStep, cmd: string[], cwd: string, r: ExecResult, ms: number) {
  ctx.engine.store.append({ type: 'delivery.command', goalId: ctx.goal.id, payload: { step, command: cmd.join(' '), cwd, exitCode: r.code, durationMs: ms, outputTail: (r.stdout + r.stderr).trim().slice(-600) } });
}

async function run(ctx: Ctx, step: DeliveryStep, cmd: string[], cwd: string, mustSucceed: boolean): Promise<ExecResult> {
  const t0 = Date.now();
  const r = await exec(cmd, cwd, { timeoutMs: 180_000 });
  logCmd(ctx, step, cmd, cwd, r, Date.now() - t0);
  if (mustSucceed && r.code !== 0) throw new DeliveryFailed(step, `${cmd.slice(0, 3).join(' ')} failed: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
  return r;
}

/**
 * The single place the engine pushes. Fixed argv: never force, never the base branch, and only the
 * goal branch or one of its stacked branches (`goal/<id>` or `goal/<id>/<n>-<slug>`).
 */
export async function pushRef(ctx: Ctx, branch: string, taskId: string | null): Promise<string> {
  if (branch !== ctx.goal.branch && !isStackBranch(ctx.goal.branch, branch)) throw new DeliveryFailed('push', `refusing to push ${branch}: not this goal's branch`);
  if (branch === ctx.base) throw new DeliveryFailed('push', 'refusing to push the base branch');
  const r = await run(ctx, 'push', ['git', 'push', '-u', ctx.remote, `refs/heads/${branch}:refs/heads/${branch}`], ctx.goalWs, false);
  if (r.code !== 0) {
    const nonFf = /non-fast-forward|fetch first|rejected/i.test(r.stderr);
    throw new DeliveryFailed('push', nonFf ? `remote ${ctx.remote}/${branch} has commits we do not have (someone pushed to it). Foundry never force-pushes; reconcile manually.` : `git push failed: ${r.stderr.trim().slice(0, 300)}`);
  }
  const ref = await gitOk(['rev-parse', branch], ctx.goalWs);
  ctx.engine.store.append({ type: 'delivery.pushed', goalId: ctx.goal.id, payload: { remote: ctx.remote, branch, ref, taskId } });
  return ref;
}

function syntheticMergeTask(ctx: Ctx, ref: string, into: string): Task {
  const now = new Date().toISOString();
  const task: Task = {
    id: newId(IdPrefix.task),
    goalId: ctx.goal.id,
    title: `sync ${into} with ${ref}`,
    spec: `Merge ${ref} (the base branch, which moved since this goal started) into ${into} so the goal's work applies cleanly on top of it.`,
    kind: 'chore',
    scope: 'sync',
    scenario: 'general',
    area: null, tdd: 'inherit',
    dependsOn: [],
    relevantFiles: [],
    parallelizable: false,
    retryBudget: 2,
    origin: 'merge', milestone: null, milestoneVisits: 0, checkpointOf: null, difficulty: 'standard' as const,
    state: 'merging',
    branch: null,
    worktreePath: null,
    baseRef: null,
    commitRef: null,
    commitMessage: null,
    hint: null,
    extraAttempts: 0,
    createdAt: now,
    updatedAt: now,
  };
  ctx.engine.store.append({ type: 'task.created', goalId: ctx.goal.id, payload: { task } });
  return task;
}

/** Merge the remote base into the goal branch via a synthetic merge task (visible on the task board). */
async function syncWithBase(ctx: Ctx, ref: string): Promise<boolean> {
  const { engine, goal } = ctx;
  const task = syntheticMergeTask(ctx, ref, goal.branch);
  const ok = await mergeBranchInto(engine, goal, task, { ref, label: ref, intent: `The base branch ${ref} received new commits from other people while this goal was being worked on. Keep their changes AND this goal's changes.` }, { autoResolve: ctx.policy.autoResolveConflicts });
  const fresh = getTask(engine.store.db, task.id)!;
  if (ok && fresh.state === 'merging') engine.store.append({ type: 'task.state_changed', goalId: goal.id, payload: { taskId: task.id, from: 'merging', to: 'done', reason: 'base merged' } });
  return ok;
}

async function waitForChecks(ctx: Ctx, repo: string, number: number): Promise<PrView> {
  const start = Date.now();
  let last: 'pending' | 'passing' | 'failing' | 'none' | null = null;
  // detected once per delivery: a repository with no workflows and no required checks never reports any, so waiting the
  // grace period for every PR (90 s × N stacked PRs) was the single biggest cost of a delivery
  if (ctx.ci === null && ctx.gh.hasCi) {
    ctx.ci = await ctx.gh.hasCi(ctx.goalWs, { repo, base: ctx.base }).catch(() => null);
    if (ctx.ci === false) ctx.engine.store.append({ type: 'delivery.note', goalId: ctx.goal.id, payload: { message: `${repo} runs no CI (no workflows, no required checks): PRs merge without waiting for checks` } });
  }
  for (;;) {
    const v = await ctx.gh.prView(ctx.goalWs, { repo, number });
    let state = reduceChecks(v.checks);
    if (state === 'none' && ctx.ci !== false && Date.now() - start < ctx.opts.noChecksGraceMs) state = 'pending';
    if (state !== last) {
      ctx.engine.store.append({ type: 'delivery.checks', goalId: ctx.goal.id, payload: { state, summary: v.checks.map((c) => `${c.name}: ${c.conclusion ?? c.status}`).join(', ') || 'no checks reported', prNumber: number } });
      last = state;
    }
    if (state !== 'pending' || v.mergedAt) return v;
    if (Date.now() - start > ctx.opts.checksTimeoutMs) throw new DeliveryFailed('wait-checks', `checks still pending after ${Math.round(ctx.opts.checksTimeoutMs / 60_000)} min; PR #${number} stays open`);
    // checks usually appear within a minute: poll fast at first, then settle to the configured interval
    await sleep(Date.now() - start < 120_000 ? Math.min(ctx.opts.pollMs, 10_000) : ctx.opts.pollMs, ctx.signal);
  }
}

/** Bounded "fix CI" task: runs directly in the unit's checkout (the goal is terminal, the scheduler is not involved). Its attempts end as one `fix(ci)` commit. */
async function fixCi(ctx: Ctx, repo: string, prNumber: number, unit: PrUnit): Promise<boolean> {
  const { engine, goal } = ctx;
  const { store } = engine;
  const log = await ctx.gh.failedLog(ctx.goalWs, { repo, branch: unit.branch }).catch(() => null);
  const goalChecks = listChecks(store.db, goal.id).filter((c) => c.taskId === null && c.tier === 'must' && c.spec.type === 'command');
  const now = new Date().toISOString();
  const base = await headRef(unit.cwd);
  await ensureDeps(ctx, unit.cwd);
  const task: Task = {
    id: newId(IdPrefix.task),
    goalId: goal.id,
    title: `make CI pass on PR #${prNumber}`,
    kind: 'bug',
    scope: 'ci',
    scenario: 'infra',
    area: null, tdd: 'inherit',
    spec: `CI checks on the pull request for this goal are failing. Make them pass without weakening or deleting any check.\n\n## Failing job log (excerpt)\n\`\`\`\n${log ? truncateOutput(log, { maxBytes: 6000 }) : '(log unavailable — inspect the CI configuration and run the project checks locally)'}\n\`\`\``,
    dependsOn: [],
    relevantFiles: [],
    parallelizable: false,
    retryBudget: goal.budgets.attemptsPerTask,
    origin: 'delivery-fix', milestone: null, milestoneVisits: 0, checkpointOf: null, difficulty: 'standard' as const,
    state: 'running',
    branch: null,
    worktreePath: null,
    baseRef: base,
    commitRef: null,
    commitMessage: null,
    hint: null,
    extraAttempts: 0,
    createdAt: now,
    updatedAt: now,
  };
  store.append({ type: 'task.created', goalId: goal.id, payload: { task } });
  store.append({ type: 'task.base_ref', goalId: goal.id, payload: { taskId: task.id, ref: base } });
  for (const c of goalChecks) {
    const copy: Check = { ...c, id: newId(IdPrefix.check), taskId: task.id };
    store.append({ type: 'check.created', goalId: goal.id, payload: { check: copy } });
  }
  engine.reserve(task.id);
  try {
    for (let i = 0; i < maxAttemptsFor(task); i++) {
      const out = await runAttempt(engine, getGoal(store.db, goal.id)!, getTask(store.db, task.id)!, unit.cwd);
      if (out.passed) {
        store.append({ type: 'task.state_changed', goalId: goal.id, payload: { taskId: task.id, from: 'running', to: 'observing', reason: 'fix attempt passed' } });
        // re-run goal-level must checks on the result
        for (const c of goalChecks) {
          const r = await runCommandCheck(c, { cwd: unit.cwd, outputDir: join(engine.config.dataDir, 'check-output'), attemptId: out.attempt.id });
          store.append({ type: 'check.finished', goalId: goal.id, payload: { result: r } });
          if (r.status !== 'pass') return false;
        }
        // squash the attempt snapshots into one Conventional Commit
        const message = taskCommitMessage(goal, task);
        if ((await headRef(unit.cwd)) !== base) {
          await gitOk(['reset', '--soft', base], unit.cwd);
          const c = await commitStaged(unit.cwd, message);
          store.append({ type: 'task.committed', goalId: goal.id, payload: { taskId: task.id, ref: c.committed ? c.ref : null, message } });
        } else store.append({ type: 'task.committed', goalId: goal.id, payload: { taskId: task.id, ref: null, message } });
        store.append({ type: 'task.state_changed', goalId: goal.id, payload: { taskId: task.id, from: 'observing', to: 'done', reason: 'CI fix applied' } });
        return true;
      }
    }
    store.append({ type: 'task.state_changed', goalId: goal.id, payload: { taskId: task.id, from: 'running', to: 'blocked', reason: 'fix attempts exhausted' } });
    raiseEscalation(engine, { goal, task: getTask(store.db, task.id)!, trigger: 'retries_exhausted', message: `Could not make CI pass for PR #${prNumber} within ${maxAttemptsFor(task)} attempts.`, payload: { kind: 'delivery-fix', prNumber } });
    return false;
  } finally {
    engine.release(task.id);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DeliveryCancelled('cancelled'));
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DeliveryCancelled('cancelled'));
    });
  });
}

/**
 * The delivery scratch worktree is a fresh checkout: its must checks (`npm run build`, `eslint .` …) fail with "command not
 * found" until dependencies are installed, and every such failure used to show up as a red Acceptance card. Install once
 * per checkout per delivery, with the command the Brief or package.json names.
 */
async function ensureDeps(ctx: Ctx, cwd: string): Promise<void> {
  if (ctx.depsInstalled.has(cwd)) return;
  ctx.depsInstalled.add(cwd);
  const brief = getBrief(ctx.engine.store.db, ctx.goal.id)?.brief;
  const install = brief?.run?.install ?? detectRun(cwd)?.install;
  if (!install || existsSync(join(cwd, 'node_modules'))) return;
  const t0 = Date.now();
  const r = await exec(['sh', '-lc', install], cwd, { timeoutMs: 10 * 60_000, env: { CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' } });
  ctx.engine.store.append({ type: 'delivery.command', goalId: ctx.goal.id, payload: { step: 'sync-base', command: install, cwd, exitCode: r.code, durationMs: Date.now() - t0, outputTail: (r.stdout + r.stderr).slice(-600) } });
  if (r.code !== 0) ctx.engine.store.append({ type: 'delivery.note', goalId: ctx.goal.id, payload: { message: `\`${install}\` failed in the delivery worktree (exit ${r.code}); must checks there may fail for want of dependencies` } });
}
