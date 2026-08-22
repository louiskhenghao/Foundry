import type { Brief, CheckResult, DeliveryPlanStep, DeliveryPolicy, Goal, Task } from '@ai-engine/core';
import { headerOf } from '../git/conventional.ts';

export const needsGh = (p: DeliveryPolicy) => p.mode === 'pr' || p.mode === 'pr-automerge' || !!p.createRepo;
export const baseOf = (goal: Goal, p: DeliveryPolicy) => p.baseBranch ?? goal.baseBranch;

export interface PlanProbes {
  remoteExists: boolean;
  remoteUrl: string | null;
  gh: { installed: boolean; authenticated: boolean } | null;
  prExists: { number: number; url: string } | null;
  /** PR title the pipeline will use for a whole-goal delivery */
  title?: string;
  /** number of task commits a stacked delivery would turn into branches/PRs */
  stackSize?: number;
}

/** Pure, read-only dry run: the exact commands the pipeline will run, for the Deliver dialog and the audit log. */
export function planDelivery(goal: Goal, p: DeliveryPolicy, probes: PlanProbes): DeliveryPlanStep[] {
  const base = baseOf(goal, p);
  const steps: DeliveryPlanStep[] = [];
  const title = probes.title ?? goal.title;
  const n = probes.stackSize ?? 0;
  if (p.unit === 'task' && n >= 2 && p.mode !== 'local') return planStacked(goal, p, probes, base, n, steps);
  if (p.mode === 'local') return [{ step: 'preflight', command: null, note: 'Local only: nothing leaves this machine.' }];
  steps.push({ step: 'preflight', command: null, note: needsGh(p) ? (probes.gh?.authenticated ? 'gh available and authenticated' : probes.gh?.installed ? 'gh installed but NOT authenticated — run: gh auth login --web' : 'GitHub CLI (gh) NOT installed — run: brew install gh && gh auth login --web, or choose mode "push"') : 'git only' });
  if (probes.remoteExists) steps.push({ step: 'ensure-remote', command: null, note: `remote ${p.remote} → ${probes.remoteUrl}` });
  else if (p.remoteUrl) steps.push({ step: 'ensure-remote', command: `git remote add ${p.remote} ${p.remoteUrl}`, note: 'add remote by URL' });
  else if (p.createRepo) steps.push({ step: 'ensure-remote', command: `gh repo create ${p.createRepo.owner}/${p.createRepo.name} --${p.createRepo.visibility} --source <repo> --remote ${p.remote} && git push -u ${p.remote} ${base}`, note: 'create the GitHub repository and push the base branch' });
  else steps.push({ step: 'ensure-remote', command: null, note: `remote ${p.remote} missing — add a remote URL or choose an owner to create the repository` });
  steps.push({ step: 'sync-base', command: `git fetch ${p.remote} ${base} && git merge ${p.remote}/${base}`, note: p.autoResolveConflicts ? 'conflicts are resolved by a Merge Attempt' : 'conflicts stop delivery' });
  steps.push({ step: 'push', command: `git push -u ${p.remote} refs/heads/${goal.branch}:refs/heads/${goal.branch}`, note: 'never force, never the base branch' });
  if (p.mode === 'push') return steps;
  const repo = probes.remoteUrl ? repoSlug(probes.remoteUrl) : p.createRepo ? `${p.createRepo.owner}/${p.createRepo.name}` : '<owner/name>';
  steps.push(probes.prExists ? { step: 'open-pr', command: null, note: `reuse open PR #${probes.prExists.number}` } : { step: 'open-pr', command: `gh pr create -R ${repo} --base ${base} --head ${goal.branch} --title "${title}" --body-file <brief+checks>`, note: p.unit === 'task' ? `PR body = Brief + check results (${n < 2 ? 'only one task commit, so one PR' : 'one PR'})` : 'PR body = Brief + check results' });
  if (p.mode === 'pr') return steps;
  steps.push({ step: 'wait-checks', command: `gh pr view <n> -R ${repo} --json statusCheckRollup,mergeable`, note: p.requireChecks ? `wait for checks (${p.mergeIfNoChecks ? 'merge if none configured' : 'require at least one'})` : 'checks not required' });
  if (p.fixCiCycles > 0) steps.push({ step: 'fix-ci', command: null, note: `up to ${p.fixCiCycles} "fix CI" task(s) if checks fail` });
  steps.push({ step: 'merge', command: `gh pr merge <n> -R ${repo} --${p.mergeMethod}`, note: 'only when checks pass and the PR is mergeable; falls back to --auto under branch protection' });
  if (p.deleteRemoteBranch) steps.push({ step: 'cleanup', command: `git push ${p.remote} --delete refs/heads/${goal.branch}`, note: 'remote goal branch only' });
  return steps;
}

function planStacked(goal: Goal, p: DeliveryPolicy, probes: PlanProbes, base: string, n: number, steps: DeliveryPlanStep[]): DeliveryPlanStep[] {
  steps.push({ step: 'preflight', command: null, note: needsGh(p) ? (probes.gh?.authenticated ? 'gh available and authenticated' : probes.gh?.installed ? 'gh installed but NOT authenticated — run: gh auth login --web' : 'GitHub CLI (gh) NOT installed — run: brew install gh && gh auth login --web, or choose mode "push"') : 'git only' });
  if (probes.remoteExists) steps.push({ step: 'ensure-remote', command: null, note: `remote ${p.remote} → ${probes.remoteUrl}` });
  else if (p.remoteUrl) steps.push({ step: 'ensure-remote', command: `git remote add ${p.remote} ${p.remoteUrl}`, note: 'add remote by URL' });
  else if (p.createRepo) steps.push({ step: 'ensure-remote', command: `gh repo create ${p.createRepo.owner}/${p.createRepo.name} --${p.createRepo.visibility} --source <repo> --remote ${p.remote} && git push -u ${p.remote} ${base}`, note: 'create the GitHub repository and push the base branch' });
  else steps.push({ step: 'ensure-remote', command: null, note: `remote ${p.remote} missing — add a remote URL or choose an owner to create the repository` });
  steps.push({ step: 'build-stack', command: `git fetch ${p.remote} ${base} && git worktree add --detach <_delivery> ${p.remote}/${base} && git cherry-pick -x <task commit> × ${n} → ${goal.branch}-1-<slug> … ${goal.branch}-${n}-<slug>`, note: `${n} stacked branches, one per task commit; ${p.autoResolveConflicts ? 'conflicts are resolved by a Merge Attempt' : 'a conflict'} — if a commit cannot be applied the goal is delivered as one PR instead` });
  steps.push({ step: 'push', command: `git push -u ${p.remote} refs/heads/${goal.branch}-<n>-<slug>:refs/heads/${goal.branch}-<n>-<slug> × ${n}`, note: 'never force, never the base branch' });
  if (p.mode === 'push') return steps;
  const repo = probes.remoteUrl ? repoSlug(probes.remoteUrl) : p.createRepo ? `${p.createRepo.owner}/${p.createRepo.name}` : '<owner/name>';
  steps.push({ step: 'open-pr', command: `gh pr create -R ${repo} --base ${base} --head ${goal.branch}-1-<slug> --title "<task 1 commit header>" … --base ${goal.branch}-${n - 1}-<slug> --head ${goal.branch}-${n}-<slug>`, note: `${n} PRs bottom-up, each based on the one below; titles are the tasks' Conventional Commit headers` });
  if (p.mode === 'pr') return steps;
  steps.push({ step: 'wait-checks', command: `gh pr view <n> -R ${repo} --json statusCheckRollup,mergeable`, note: `for each PR in order: ${p.requireChecks ? `wait for checks (${p.mergeIfNoChecks ? 'merge if none configured' : 'require at least one'})` : 'checks not required'}` });
  if (p.fixCiCycles > 0) steps.push({ step: 'fix-ci', command: null, note: `up to ${p.fixCiCycles} "fix CI" task(s) in total if checks fail` });
  steps.push({ step: 'merge', command: `gh pr edit <n> --base ${base} && git merge ${p.remote}/${base} && gh pr merge <n> -R ${repo} --${p.mergeMethod}`, note: `PR 1 … PR ${n} in order: retarget to ${base}, bring ${base} in, merge when green` });
  if (p.deleteRemoteBranch) steps.push({ step: 'cleanup', command: `git push ${p.remote} --delete refs/heads/${goal.branch}-<n>-<slug>`, note: 'each stacked branch after its PR merged' });
  return steps;
}

/** Body of one PR of a stacked delivery. */
export function buildTaskPrBody(goal: Goal, task: Task, i: { index: number; total: number; goalTitle: string; prevPr: number | null; prevBranch: string | null }, results: { name: string; status: string }[], reviewNote: string | null): string {
  const lines: string[] = [];
  lines.push(`_Part ${i.index}/${i.total} of **${i.goalTitle}**${i.prevPr ? ` · stacked on #${i.prevPr}` : i.prevBranch ? ` · stacked on \`${i.prevBranch}\`` : ''}. Merge bottom-up; once the PR below merges, use **Update branch** (or let ai-engine do it) before merging this one._`);
  lines.push(`## ${headerOf(task.commitMessage ?? task.title)}\n\n${task.spec.trim()}`);
  if (results.length) lines.push(`## Checks\n\n| check | result |\n|---|---|\n${results.map((r) => `| ${r.name} | ${r.status === 'pass' ? '✅ pass' : `❌ ${r.status}`} |`).join('\n')}`);
  if (reviewNote) lines.push(`## Reviewer\n\n${reviewNote.trim()}`);
  lines.push(`## Goal\n\n${goal.prompt.trim()}`);
  lines.push(`---\n_Opened by ai-engine · goal \`${goal.id}\` · task \`${task.id}\`_`);
  return lines.join('\n\n');
}

/** owner/name from an https or ssh GitHub URL; null when not GitHub-shaped. */
export function repoSlug(url: string): string {
  const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?/);
  return m ? `${m[1]}/${m[2]}` : url;
}

export function buildPrBody(goal: Goal, brief: Brief | null, review: { mustResults: CheckResult[]; stretchResults: CheckResult[]; notes: string; overDelivered: boolean } | null, checkNames: Map<string, string>): string {
  const lines: string[] = [];
  lines.push(`## Goal\n\n${goal.prompt.trim()}`);
  if (brief) lines.push(`## Understanding\n\n${brief.understanding.trim()}`);
  if (review) {
    const row = (r: CheckResult) => `| ${checkNames.get(r.checkId) ?? r.checkId} | ${r.status === 'pass' ? '✅ pass' : `❌ ${r.status}`} |`;
    lines.push(`## Acceptance\n\n| Must | result |\n|---|---|\n${review.mustResults.map(row).join('\n') || '| — | |'}`);
    if (review.stretchResults.length) lines.push(`| Stretch | result |\n|---|---|\n${review.stretchResults.map(row).join('\n')}`);
    if (review.overDelivered) lines.push('**Over-delivered**: all stretch checks pass as well.');
    if (review.notes) lines.push(`## Reviewer notes\n\n${review.notes.trim()}`);
  }
  lines.push(`---\n_Opened by ai-engine · goal \`${goal.id}\` · est. cost $${goal.costUsd.toFixed(2)}_`);
  return lines.join('\n\n');
}
