import type { Brief, CheckResult, DeliveryPlanStep, DeliveryPolicy, Goal, Task } from '@foundry/core';
import { decisionsOf } from '@foundry/core';
import { headerOf } from '../git/conventional.ts';
import { issueRefFor } from '../issue.ts';

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
  const closes = goal.issue ? `; closes issue ${issueRefFor(goal.issue, repo)} when it merges` : '';
  steps.push(probes.prExists ? { step: 'open-pr', command: null, note: `reuse open PR #${probes.prExists.number}` } : { step: 'open-pr', command: `gh pr create -R ${repo} --base ${base} --head ${goal.branch} --title "${title}" --body-file <summary+evidence+merge-danger>`, note: p.unit === 'task' ? `PR body = summary, decisions, evidence (the checks), merge danger (${n < 2 ? 'only one task commit, so one PR' : 'one PR'})${closes}` : `PR body = summary, decisions, evidence (the checks), merge danger${closes}` });
  if (p.fixReviewCycles > 0) steps.push({ step: 'fix-review', command: null, note: `review comments on the PR (inline, or a review that requests changes): up to ${p.fixReviewCycles} round(s) addressed by a fix task, pushed and replied to` });
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
  steps.push({ step: 'open-pr', command: `gh pr create -R ${repo} --base ${base} --head ${goal.branch}-1-<slug> --title "<task 1 commit header>" … --base ${goal.branch}-${n - 1}-<slug> --head ${goal.branch}-${n}-<slug>`, note: `${n} PRs bottom-up, each based on the one below; titles are the tasks' Conventional Commit headers${goal.issue ? `; the last one closes issue ${issueRefFor(goal.issue, repo)} when it merges` : ''}` });
  if (p.fixReviewCycles > 0) steps.push({ step: 'fix-review', command: null, note: `review comments on a PR (inline, or a review that requests changes): up to ${p.fixReviewCycles} round(s) addressed on its branch, pushed and replied to` });
  if (p.mode === 'pr') return steps;
  steps.push({ step: 'wait-checks', command: `gh pr view <n> -R ${repo} --json statusCheckRollup,mergeable`, note: `for each PR in order: ${p.requireChecks ? `wait for checks (${p.mergeIfNoChecks ? 'merge if none configured' : 'require at least one'})` : 'checks not required'}` });
  if (p.fixCiCycles > 0) steps.push({ step: 'fix-ci', command: null, note: `up to ${p.fixCiCycles} "fix CI" task(s) in total if checks fail` });
  steps.push({ step: 'merge', command: `gh pr edit <n> --base ${base} && git merge ${p.remote}/${base} && gh pr merge <n> -R ${repo} --${p.mergeMethod}`, note: `PR 1 … PR ${n} in order: retarget to ${base}, bring ${base} in, merge when green` });
  if (p.deleteRemoteBranch) steps.push({ step: 'cleanup', command: `git push ${p.remote} --delete refs/heads/${goal.branch}-<n>-<slug>`, note: 'each stacked branch after its PR merged' });
  return steps;
}

/** what a pull request changes, in numbers: from `git diff --shortstat` and the commit count */
export interface DiffStats {
  commits?: number;
  files: number;
  insertions: number;
  deletions: number;
}

/** the blast radius of a change in one word, by the lines it touches */
export function blastRadius(stats: Pick<DiffStats, 'insertions' | 'deletions'> | null | undefined): 'unknown' | 'small' | 'medium' | 'large' {
  if (!stats) return 'unknown';
  const lines = stats.insertions + stats.deletions;
  return lines < 200 ? 'small' : lines < 1000 ? 'medium' : 'large';
}

/**
 * The `## Merge Danger` section of a PR body (the `pr` skill's template, ADR-0047): the door — a merge of a branch is
 * reverted by reverting its merge commit, so two-way — and the blast radius from the diff's size.
 */
function mergeDanger(base: string, stats: DiffStats | null | undefined): string {
  const commits = stats?.commits != null ? `${stats.commits} commit${stats.commits === 1 ? '' : 's'} on the branch; ` : '';
  const size = stats ? `${stats.files} file${stats.files === 1 ? '' : 's'}, +${stats.insertions} −${stats.deletions}` : 'the diff was not measured';
  return `## Merge Danger\n\n**Door:** two-way · ${commits}reverting the merge commit restores \`${base}\` as it was.\n\n**Blast Radius:** ${blastRadius(stats)} · ${size}.`;
}

/** Body of one PR of a stacked delivery: summary, evidence and merge danger for that task alone. */
export function buildTaskPrBody(goal: Goal, task: Task, i: { index: number; total: number; goalTitle: string; prevPr: number | null; prevBranch: string | null; /** owner/name the PR is opened in: decides how the goal's issue is referred to */ repo?: string | null }, results: { name: string; status: string }[], reviewNote: string | null, stats?: DiffStats | null): string {
  const lines: string[] = [];
  // the issue the goal came from (ADR-0052): the last PR of the stack closes it, the others only refer to it
  if (goal.issue) lines.push(`${i.index === i.total ? 'Closes' : 'Part of'} ${issueRefFor(goal.issue, i.repo)}`);
  lines.push(`_Part ${i.index}/${i.total} of **${i.goalTitle}**${i.prevPr ? ` · stacked on #${i.prevPr}` : i.prevBranch ? ` · stacked on \`${i.prevBranch}\`` : ''}. Merge bottom-up; once the PR below merges, use **Update branch** (or let Foundry do it) before merging this one._`);
  lines.push(`## Summary\n\n**${headerOf(task.commitMessage ?? task.title)}**\n\n${task.spec.trim()}\n\nPart of the goal: ${goal.prompt.trim()}`);
  const evidence = results.length ? `| check | result |\n|---|---|\n${results.map((r) => `| ${r.name} | ${r.status === 'pass' ? '✅ pass' : `❌ ${r.status}`} |`).join('\n')}` : 'No checks were run for this task.';
  lines.push(`## Evidence\n\n${evidence}${reviewNote ? `\n\n**Reviewer:** ${reviewNote.trim()}` : ''}`);
  lines.push(mergeDanger(i.prevBranch ?? goal.baseBranch, stats));
  lines.push(`---\n_Opened by Foundry · goal \`${goal.id}\` · task \`${task.id}\`_`);
  return lines.join('\n\n');
}

/** owner/name from an https or ssh GitHub URL; null when not GitHub-shaped. */
export function repoSlug(url: string): string {
  const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?/);
  return m ? `${m[1]}/${m[2]}` : url;
}

/** the goal's tasks as a tree under their Areas, by their commit headers: the smallest view of what changed and where */
function taskTree(goal: Goal, brief: Brief | null, tasks: Pick<Task, 'title' | 'area' | 'commitMessage' | 'origin'>[]): string {
  const title = (t: Pick<Task, 'title' | 'commitMessage'>) => headerOf(t.commitMessage ?? t.title);
  const lines = [goal.title];
  const areas = brief?.areas ?? [];
  const placed = new Set<Pick<Task, 'title'>>();
  for (const a of areas) {
    const mine = tasks.filter((t) => t.area === a.key || t.area === a.name);
    if (!mine.length) continue;
    lines.push(`  ${a.name}`);
    for (const t of mine) {
      lines.push(`    ${title(t)}`);
      placed.add(t);
    }
  }
  for (const t of tasks) if (!placed.has(t)) lines.push(`  ${title(t)}`);
  return lines.join('\n');
}

/**
 * The PR body of a whole-goal delivery, after the `pr` skill's template (ADR-0047): a Summary (what was understood and
 * the tasks as a tree under their Areas), the Decisions the person made, the Evidence (the acceptance checks and the
 * reviewer's notes) and the Merge Danger (door and blast radius). No model writes it; the engine knows all of it.
 */
export function buildPrBody(goal: Goal, brief: Brief | null, review: { mustResults: CheckResult[]; stretchResults: CheckResult[]; notes: string; overDelivered: boolean } | null, checkNames: Map<string, string>, extra: { tasks?: Pick<Task, 'title' | 'area' | 'commitMessage' | 'origin'>[]; stats?: DiffStats | null; /** owner/name the PR is opened in: decides how the goal's issue is referred to */ repo?: string | null } = {}): string {
  const lines: string[] = [];
  // the issue the goal came from (ADR-0052): GitHub closes it when the PR merges into the default branch
  if (goal.issue) lines.push(`Closes ${issueRefFor(goal.issue, extra.repo)}`);
  const tasks = (extra.tasks ?? []).filter((t) => t.origin !== 'merge');
  lines.push(`## Summary\n\n${brief ? brief.understanding.trim() : goal.prompt.trim()}${tasks.length ? `\n\n\`\`\`text\n${taskTree(goal, brief, tasks)}\n\`\`\`` : ''}${brief ? `\n\n**Asked for:** ${goal.prompt.trim()}` : ''}`);
  if (brief) {
    const ds = decisionsOf(brief);
    if (ds.length) lines.push(`## Decisions\n\n${ds.map((d) => (d.kind === 'answer' ? `- **${d.text}** — ${d.answer}` : d.kind === 'note' ? `- ${d.text}` : `- ~~${d.text}~~ (assumption rejected)`)).join('\n')}`);
  }
  if (review) {
    const row = (r: CheckResult) => `| ${checkNames.get(r.checkId) ?? r.checkId} | ${r.status === 'pass' ? '✅ pass' : `❌ ${r.status}`} |`;
    const parts = [`| Must | result |\n|---|---|\n${review.mustResults.map(row).join('\n') || '| — | |'}`];
    if (review.stretchResults.length) parts.push(`| Stretch | result |\n|---|---|\n${review.stretchResults.map(row).join('\n')}`);
    if (review.overDelivered) parts.push('**Over-delivered**: all stretch checks pass as well.');
    if (review.notes) parts.push(`**Reviewer:** ${review.notes.trim()}`);
    lines.push(`## Evidence\n\n${parts.join('\n\n')}`);
  } else lines.push('## Evidence\n\nNo checks were run.');
  lines.push(mergeDanger(goal.baseBranch, extra.stats));
  lines.push(`---\n_Opened by Foundry · goal \`${goal.id}\` · est. cost $${goal.costUsd.toFixed(2)}_`);
  return lines.join('\n\n');
}
