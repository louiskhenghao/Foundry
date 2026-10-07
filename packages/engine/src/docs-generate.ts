/**
 * Docs generation: one writable session after the goal review passed and before the goal turns done,
 * so the docs commit lands on the goal branch and ships in the same PR as the code.
 * Which documents are written was chosen at Brief approval (`goal.completion.docs`); a failure is
 * recorded on `goal.docs_generated` and never blocks the goal.
 */
import { rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DocType, Goal } from '@foundry/core';
import { getBrief, getGoal, renderDecisions } from '@foundry/core';
import type { Engine } from './engine.ts';
import { repoSlug } from './delivery/policy.ts';
import { commitStaged, git, gitOk, headRef, removeWorktree } from './git/git.ts';
import { workerTools, boundarySettings } from './guards/boundary.ts';
import { docsWorkspacePath, goalWorkspacePath } from './workspace.ts';
import { metaFor, modelFor } from './models/roles.ts';

export const DOCS_MAX_BUDGET_USD = 3;

const DOC_INSTRUCTIONS: Record<DocType, string> = {
  'to-prd': 'Write or update a PRD under `docs/prd/` (one markdown file named after this goal): objective, scope, acceptance criteria, what was actually implemented and any deviations from the plan.',
  'readme-update': 'Update README and existing docs where this goal changed behaviour: new commands, configuration, APIs, setup steps. Touch only sections the diff affects; do not rewrite unrelated prose.',
  changelog: 'Append an entry to CHANGELOG.md summarising this goal, one bullet per task commit (Conventional Commits subjects are listed below). Follow the existing file format.',
  'to-questionnaire': 'Write a stakeholder confirmation sheet under `docs/` (markdown): what this goal delivered, the assumptions and decisions that still need the stakeholder\'s confirmation (listed below), and open questions. Written for a non-technical reader.',
};

/**
 * Generate the chosen documents in the goal workspace and commit them as one `docs:` commit. Never throws. `rerun` is
 * the human's "Re-run" after a run that failed or wrote nothing. `cwd` and `range` write them elsewhere: in a branch
 * of their own after the goal's work merged, describing the commits from `range.from` to `range.to`.
 */
export async function runDocsGeneration(engine: Engine, goalIn: Goal, opts: { rerun?: boolean; cwd?: string; range?: { from: string; to: string } | null } = {}): Promise<void> {
  const { store, config } = engine;
  const goal = getGoal(store.db, goalIn.id)!;
  const types = goal.completion.docs;
  if (!types.length || (goal.completion.docsRun && !opts.rerun)) return;
  const record = (payload: { status: 'ok' | 'skipped' | 'failed'; files: string[]; costUsd: number; detail: string; ref?: string | null }) => store.append({ type: 'goal.docs_generated', goalId: goal.id, payload: { types, ...payload } });
  try {
    const ws = opts.cwd ?? goalWorkspacePath(config.dataDir, goal);
    const brief = getBrief(store.db, goal.id)?.brief ?? null;
    const range = opts.range ?? null;
    const stat = await git(['diff', '--stat', ...(range ? [range.from, range.to] : [`${goal.baseBranch}...HEAD`])], ws).catch(() => null);
    const log = await git(['log', '--no-merges', '--format=%s', range ? `${range.from}..${range.to}` : `${goal.baseBranch}..HEAD`], ws).catch(() => null);
    const before = await headRef(ws);
    const prompt = [
      `# Goal\n${goal.title}\n\n${goal.prompt}`,
      brief ? `# Approved understanding\n${brief.understanding}` : '',
      brief ? renderDecisions(brief) : '',
      log?.stdout.trim() ? `# Task commits of this goal\n${log.stdout.trim()}` : '',
      range ? `# Where you are\nThis goal's work is already merged into ${goal.delivery.policy.baseBranch ?? goal.baseBranch}, which is checked out here; document it as it is now.` : '',
      stat?.stdout.trim() ? `# Changed files (diffstat ${range ? 'of the merged work' : `against ${goal.baseBranch}`})\n\`\`\`\n${stat.stdout.trim().slice(0, 4000)}\n\`\`\`` : '',
      `# Documents to produce\n${types.map((t) => `- **${t}**: ${DOC_INSTRUCTIONS[t]}`).join('\n')}`,
      `Read the changed code where the diffstat alone is not enough. Write ONLY documentation (markdown); never change code, configuration or tests. Do not commit — the engine commits for you. Reply with a one-paragraph summary of what you wrote.`,
    ]
      .filter(Boolean)
      .join('\n\n');
    const channel = `docs-${goal.id}`;
    const handle = await engine.runner.run({
      prompt,
      cwd: ws,
      model: modelFor(config, goal, 'documenter').model,
      meta: metaFor(goal.id, modelFor(config, goal, 'documenter')),
      maxTurns: 50,
      maxBudgetUsd: DOCS_MAX_BUDGET_USD,
      permissionMode: 'dontAsk',
      allowedTools: workerTools(engine.mcpAllowedFor(goal)),
      appendSystemPromptFile: engine.roles.path('documenter'),
      settings: boundarySettings(config.hooksDir),
      settingSources: config.settingSources,
      timeoutMs: 10 * 60_000,
      transcriptPath: join(config.dataDir, 'transcripts', `docs-${goal.id}.jsonl`),
      label: `docs ${goal.title}`,
    });
    for await (const ev of handle.events) engine.broadcast({ goalId: goal.id, taskId: null, attemptId: channel, event: ev, ts: new Date().toISOString() });
    const r = await handle.result;
    store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: r.costUsd, source: 'docs' } });
    engine.recordSessionUsage(r, { goalId: goal.id, kind: 'docs', model: modelFor(config, goal, 'documenter').model });
    // the session may only add docs; anything else it wrote is discarded rather than committed
    if ((await headRef(ws)) !== before) await git(['reset', '-q', before], ws);
    await git(['add', '-A'], ws);
    const staged = (await git(['diff', '--cached', '--name-only'], ws)).stdout.trim().split('\n').filter(Boolean);
    const files = staged.filter((f) => /\.(md|mdx|txt|rst|adoc)$/i.test(f));
    const rejected = staged.filter((f) => !files.includes(f));
    if (rejected.length) {
      await git(['reset', '-q', 'HEAD', '--', ...rejected], ws);
      await git(['checkout', '-q', '--', ...rejected], ws).catch(() => {});
      await git(['clean', '-qfd', '--', ...rejected], ws).catch(() => {});
    }
    if (!files.length) {
      record({ status: r.isError ? 'failed' : 'skipped', files: [], costUsd: r.costUsd, detail: r.isError ? `session ended with ${r.subtype}${r.errorMessage ? `: ${r.errorMessage.slice(0, 160)}` : ''}` : 'the session wrote no documentation files' });
      return;
    }
    const c = await commitStaged(ws, `docs: ${goal.title}`);
    record({ status: 'ok', files, costUsd: r.costUsd, ref: c.committed ? c.ref : null, detail: c.committed ? `committed ${c.ref.slice(0, 7)} (${files.length} file(s))${rejected.length ? `; discarded ${rejected.length} non-doc change(s)` : ''}` : 'nothing to commit' });
    config.log(`[docs] ${goal.id}: ${files.length} file(s) committed`);
  } catch (err) {
    record({ status: 'failed', files: [], costUsd: 0, detail: String((err as Error).message ?? err).slice(0, 300) });
    store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'warn', message: `docs generation failed: ${String((err as Error).message ?? err).slice(0, 200)}` } });
  }
}

/**
 * Docs for a goal whose work merged and whose progress folder was cleaned up: written in a folder of their own on a new
 * branch from the base (which holds the work), then pushed and opened as a pull request of their own, since the goal's
 * pull request is closed. Never throws; the outcome is recorded like any docs run.
 */
export async function runDocsAfterMerge(engine: Engine, goal: Goal): Promise<void> {
  const { store, config } = engine;
  const policy = goal.delivery.policy;
  const base = policy.baseBranch ?? goal.baseBranch;
  const branch = `${goal.branch}-docs`;
  const ws = docsWorkspacePath(config.dataDir, goal);
  const fail = (detail: string) => store.append({ type: 'goal.docs_generated', goalId: goal.id, payload: { status: 'failed', types: goal.completion.docs, files: [], costUsd: 0, detail } });
  try {
    await removeWorktree(goal.repoPath, ws).catch(() => {});
    rmSync(ws, { recursive: true, force: true });
    await gitOk(['worktree', 'add', '-q', '-B', branch, ws, base], goal.repoPath);
  } catch (err) {
    fail(`could not start a docs branch from ${base}: ${String((err as Error).message ?? err).slice(0, 200)}`);
    return;
  }
  // the merged work: from before the first merged pull request to the last merge
  const merged = goal.delivery.prs.map((p) => p.mergedRef).filter((r): r is string => !!r);
  const to = goal.delivery.mergedRef ?? merged.at(-1) ?? null;
  const from = merged[0] ?? to;
  await runDocsGeneration(engine, goal, { rerun: true, cwd: ws, range: to && from ? { from: `${from}^1`, to } : null });
  const run = getGoal(store.db, goal.id)!.completion.docsRun;
  if (run?.status !== 'ok' || !run.ref) return;
  const note = (level: 'info' | 'warn', message: string): void => {
    store.append({ type: 'engine.note', goalId: goal.id, payload: { level, message } });
  };
  try {
    const push = await git(['push', '-u', policy.remote, `refs/heads/${branch}:refs/heads/${branch}`], ws);
    if (push.code !== 0) return note('warn', `docs were committed on ${branch} but could not be pushed: ${push.stderr.trim().slice(0, 200)}`);
    const repo = repoSlug(policy.remoteUrl ?? (await gitOk(['remote', 'get-url', policy.remote], ws)).trim());
    const bodyFile = join(dirname(ws), 'docs-pr.md');
    writeFileSync(bodyFile, `Docs for **${goal.title}**, whose work already merged.\n\n${run.files.map((f) => `- \`${f}\``).join('\n')}\n`);
    const pr = (await engine.gh.prFind(ws, { repo, head: branch, base })) ?? (await engine.gh.prCreate(ws, { repo, head: branch, base, title: `docs: ${goal.title}`, bodyFile }));
    store.append({ type: 'goal.docs_pr_opened', goalId: goal.id, payload: { number: pr.number, url: pr.url, branch } });
    note('info', `docs pull request #${pr.number} opened from ${branch}`);
  } catch (err) {
    note('warn', `docs were committed on ${branch} but no pull request was opened: ${String((err as Error).message ?? err).slice(0, 200)}`);
  }
}
