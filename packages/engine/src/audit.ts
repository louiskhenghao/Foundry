import { join } from 'node:path';
import type { AuditFinding, Goal } from '@foundry/core';
import { getGoal } from '@foundry/core';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { attachmentsDir, renderAttachments } from './attachments.ts';
import { budgetStatus } from './budget.ts';
import { tryJson } from './checks/reviewer.ts';
import type { Engine } from './engine.ts';
import { createFixTasks } from './fix-tasks.ts';
import { git } from './git/git.ts';
import { READONLY_DISALLOWED, READONLY_TOOLS, boundarySettings } from './guards/boundary.ts';
import { metaFor, modelFor } from './models/roles.ts';
import { SATISFIED } from './skills/catalog.ts';
import { goalWorkspacePath } from './workspace.ts';

/** at most this many must-fix findings become fix tasks: an audit that finds more has found a repository, not a goal */
export const AUDIT_MAX_FIX_TASKS = 8;

const AuditOutput = z.object({
  summary: z.string().describe('Two or three sentences in plain English: what the repository does, and what to fix first.'),
  findings: z
    .array(
      z.object({
        severity: z.enum(['must', 'should', 'nice']).describe('must = a bug, a security hole, data loss, breaking at the expected load; should = risky code without a test, real slowness, duplication, code that should not exist; nice = small speed-ups, shorter forms'),
        title: z.string().describe('One line naming what is wrong, e.g. "office batches with 1,200 rows fail completely"'),
        problem: z.string().describe('What the code does, the concrete case that goes wrong, and what happens if it is not fixed'),
        fix: z.string().describe('The smallest fix that works'),
        files: z.array(z.string()).describe('Repository-relative paths the finding is about'),
      }),
    )
    .max(40),
});

/** the files a goal changed: its branch against the base branch, by name */
export async function touchedFiles(ws: string, baseBranch: string): Promise<Set<string>> {
  const r = await git(['diff', '--name-only', baseBranch, 'HEAD'], ws);
  return new Set(r.code === 0 ? r.stdout.split('\n').map((l) => l.trim()).filter(Boolean) : []);
}

const norm = (p: string) => p.replace(/^\.\//, '').replace(/\/+$/, '');

/** a finding is in the goal's scope when it names a file the goal changed, or a folder holding one */
export function inScope(files: string[], touched: Set<string>): boolean {
  return files.some((f) => {
    const p = norm(f);
    if (!p) return false;
    if (touched.has(p)) return true;
    for (const t of touched) if (t.startsWith(`${p}/`)) return true;
    return false;
  });
}

/**
 * The audit at the end of a goal: once every task has landed, ponytail-audit maps the finished branch and ranks what to
 * fix. Must-fix findings in the code the goal changed become fix tasks (bounded), run before the final review; every
 * finding is kept on the goal for the person, who can start a follow-up with the rest. Runs once per goal, whatever
 * the outcome; a missing skill is a skipped audit, not an error. Never throws.
 */
export async function runAudit(engine: Engine, goal: Goal): Promise<void> {
  const { store, config } = engine;
  const ws = goalWorkspacePath(config.dataDir, goal);
  const finish = (p: { status: 'ok' | 'skipped' | 'failed'; summary: string; findings: AuditFinding[]; fixTaskIds: string[]; costUsd: number; detail: string }) =>
    store.append({ type: 'goal.audit_finished', goalId: goal.id, payload: p });
  const statuses = await engine
    .skillsFor(goal)
    .status(goal.repoPath)
    .catch(() => []);
  const skill = statuses.find((s) => s.entry.name === 'ponytail-audit' && SATISFIED.includes(s.status));
  if (!skill) {
    finish({ status: 'skipped', summary: '', findings: [], fixTaskIds: [], costUsd: 0, detail: 'the ponytail-audit skill is not installed (Setup → Less code — Ponytail)' });
    return;
  }
  const invoke = skill.entry.invoke ?? skill.installedInvoke ?? `/${skill.entry.name}`;
  const codex = (goal.provider ?? config.provider) === 'codex';
  const touched = await touchedFiles(ws, goal.baseBranch);
  const reviewer = modelFor(config, goal, 'goalReviewer');
  const prompt = [
    `# Goal\n${goal.title}\n\n${goal.prompt}`,
    renderAttachments(goal, config.dataDir),
    `# Files this goal changed\n${[...touched].slice(0, 200).map((f) => `- ${f}`).join('\n') || '(none)'}`,
    `# Your job\n${codex ? 'Follow the `ponytail-audit` skill (open its SKILL.md and do what it says)' : `Invoke \`${invoke}\``} on this repository as it is now, on the branch checked out here. Then report the audit as JSON matching the schema: \`summary\`, and \`findings\` ranked must fix first, each with its concrete case, the smallest fix and the files involved. Must-fix findings in the files this goal changed become fix tasks before the final review; the rest is shown to the person for a later goal. Do not modify anything.`,
  ]
    .filter(Boolean)
    .join('\n\n');
  // the room a goal review gets: reading a repository is at least that much work
  const remaining = budgetStatus(goal).remainingUsd;
  const cap = Math.max(6, remaining == null ? config.attemptMaxCostUsd : Math.min(config.attemptMaxCostUsd, remaining));
  const channel = `audit-${goal.id}`;
  let costUsd = 0;
  try {
    const base = {
      cwd: ws,
      model: reviewer.model,
      meta: metaFor(goal.id, reviewer),
      permissionMode: 'dontAsk' as const,
      allowedTools: READONLY_TOOLS,
      disallowedTools: READONLY_DISALLOWED,
      jsonSchema: zodToJsonSchema(AuditOutput, { $refStrategy: 'none' }),
      settings: boundarySettings(config.hooksDir),
      settingSources: config.settingSources,
      addDirs: goal.attachments.length ? [attachmentsDir(config.dataDir, goal.id)] : undefined,
      transcriptPath: join(config.dataDir, 'transcripts', `audit-${goal.id}.jsonl`),
    };
    const handle = await engine.runner.run({ ...base, prompt, maxTurns: 80, maxBudgetUsd: cap, appendSystemPromptFile: engine.roles.path('auditor'), timeoutMs: 30 * 60_000, label: `audit ${goal.title}` });
    for await (const ev of handle.events) engine.broadcast({ goalId: goal.id, taskId: null, attemptId: channel, event: ev, ts: new Date().toISOString() });
    let r = await handle.result;
    costUsd += r.costUsd;
    store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: r.costUsd, source: 'audit' } });
    engine.recordSessionUsage(r, { goalId: goal.id, kind: 'audit', model: reviewer.model });
    let parsed = AuditOutput.safeParse(r.structuredOutput ?? tryJson(r.finalText));
    if (!parsed.success && r.sessionId) {
      // the session ended (budget/turns) before the JSON: resume it with a small fresh budget and ask for the report only
      const again = await engine.runner.run({ ...base, prompt: 'Stop exploring. Reply now with ONLY the JSON audit matching the schema, from what you have already read.', maxTurns: 3, maxBudgetUsd: 2, resumeSessionId: r.sessionId, timeoutMs: 5 * 60_000, label: `audit ${goal.title} (nudge)` });
      for await (const ev of again.events) engine.broadcast({ goalId: goal.id, taskId: null, attemptId: channel, event: ev, ts: new Date().toISOString() });
      const r2 = await again.result;
      costUsd += r2.costUsd;
      store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: r2.costUsd, source: 'audit' } });
      engine.recordSessionUsage(r2, { goalId: goal.id, kind: 'audit', model: reviewer.model });
      parsed = AuditOutput.safeParse(r2.structuredOutput ?? tryJson(r2.finalText));
      if (!parsed.success) r = r2;
    }
    if (!parsed.success) throw new Error(`${r.subtype}${r.errorMessage ? ` (${r.errorMessage.slice(0, 120)})` : ''}: no JSON audit`);
    const findings: AuditFinding[] = parsed.data.findings.map((f) => ({ ...f, inScope: inScope(f.files, touched) }));
    const fixable = findings.filter((f) => f.severity === 'must' && f.inScope).slice(0, AUDIT_MAX_FIX_TASKS);
    const now = getGoal(store.db, goal.id);
    const fixTaskIds = now && now.state === 'running' && fixable.length ? createFixTasks(engine, now, fixable.map((f) => ({ title: `audit: ${f.title}`.slice(0, 60), spec: `${f.problem}\n\nFix: ${f.fix}\n\nFiles: ${f.files.join(', ') || '(see the finding)'}`, relevantFiles: f.files })), null, { origin: 'audit-fix' }) : [];
    const counts = (['must', 'should', 'nice'] as const).map((s) => `${findings.filter((f) => f.severity === s).length} ${s}`).join(', ');
    finish({ status: 'ok', summary: parsed.data.summary, findings, fixTaskIds, costUsd, detail: fixTaskIds.length ? `${counts}; ${fixTaskIds.length} must-fix finding(s) in the code this goal changed became fix tasks` : findings.length ? `${counts}; nothing to fix in the code this goal changed` : 'nothing found' });
    if (fixTaskIds.length) store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'info', message: `the audit found ${fixTaskIds.length} must-fix problem(s) in the code this goal changed; fix tasks run before the final review` } });
  } catch (err) {
    finish({ status: 'failed', summary: '', findings: [], fixTaskIds: [], costUsd, detail: String((err as Error).message ?? err).slice(0, 300) });
  }
}
