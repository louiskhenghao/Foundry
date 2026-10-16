import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Goal } from '@foundry/core';
import { getGoal } from '@foundry/core';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { attachmentsDir, renderAttachments, stageFile } from './attachments.ts';
import { tryJson } from './checks/reviewer.ts';
import type { Engine } from './engine.ts';
import { commitAll } from './git/git.ts';
import { READONLY_DISALLOWED, READONLY_TOOLS, boundarySettings } from './guards/boundary.ts';
import { metaFor, modelFor } from './models/roles.ts';
import { REA_PREFIX, REFERENCE_RULES, renderReferences } from './references.ts';
import { SATISFIED } from './skills/catalog.ts';

export { needsInvestigation, renderReferences } from './references.ts';

const Output = z.object({
  summary: z.string().describe('Two or three sentences: what the reference does for the feature studied, and the one thing that matters most for building it.'),
  report: z.string().describe('The report in Markdown: for each reference a section with what it does, how it works (the evidence: files, functions, requests, screens), what could not be verified, and what to build. Plain English; no code or assets copied from the reference.'),
});

const slugOf = (target: string) =>
  target
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 40) || 'reference';

/**
 * Before Clarify, a session studies the goal's references with REA and writes a report with its evidence: how each one
 * does what the person wants to look at, and what to build. The report becomes an attachment (every later session
 * reads it) and a document on the goal branch (it ships with the code). Capped by Settings; a skipped or failed
 * investigation is recorded and Clarify goes on without it. Never throws.
 */
export async function runInvestigation(engine: Engine, goal: Goal): Promise<void> {
  const { store, config } = engine;
  const finish = (p: { status: 'ok' | 'failed' | 'skipped'; summary: string; attachmentId: string | null; docPath: string | null; costUsd: number; detail: string }) =>
    store.append({ type: 'goal.investigation_finished', goalId: goal.id, payload: p });
  const provider = goal.provider ?? config.provider;
  const allowed = engine.mcpAllowedFor(goal);
  if (!allowed.includes(REA_PREFIX)) {
    finish({ status: 'skipped', summary: '', attachmentId: null, docPath: null, costUsd: 0, detail: 'REA is not installed, or not allowed in goals (Extensions → MCP servers); Clarify goes on without the investigation' });
    return;
  }
  store.append({ type: 'clarify.stage', goalId: goal.id, payload: { stage: 'investigating' } });
  let costUsd = 0;
  try {
    const ws = await engine.ensureSyncedWorkspace(goal);
    const statuses = await engine
      .skillsFor(goal)
      .status(goal.repoPath)
      .catch(() => []);
    const skill = statuses.find((s) => s.entry.name === 'reverse-engineer-anything' && SATISFIED.includes(s.status));
    const codex = provider === 'codex';
    const method = skill ? `${codex ? 'Follow the `reverse-engineer-anything` skill (open its SKILL.md)' : `Invoke \`${skill.entry.invoke ?? skill.installedInvoke ?? '/reverse-engineer-anything'}\``} and use the rea tools` : 'Use the rea tools (mcp__rea)';
    const prompt = [
      `# Goal from the user\n${goal.prompt}`,
      renderReferences(goal),
      renderAttachments(goal, config.dataDir),
      `# Your job\n${method} to find out how each reference does what the person wants to look at. A path is a file or folder on this computer (an app bundle, a package, an extracted app); a URL is a website or a web app. ${REFERENCE_RULES} Stop when you know enough to write the report, or when the budget runs out: then write up what you have. Do not modify this repository. Answer with JSON matching the schema.`,
    ]
      .filter(Boolean)
      .join('\n\n');
    const model = modelFor(config, goal, 'clarifier');
    const denied = engine.deniedMcpTools(provider, allowed) ?? [];
    const channel = `investigate-${goal.id}`;
    const base = {
      cwd: ws,
      model: model.model,
      meta: metaFor(goal.id, model),
      permissionMode: 'dontAsk' as const,
      allowedTools: [...READONLY_TOOLS, REA_PREFIX],
      disallowedTools: [...READONLY_DISALLOWED, ...denied],
      jsonSchema: zodToJsonSchema(Output, { $refStrategy: 'none' }),
      settings: boundarySettings(config.hooksDir),
      settingSources: config.settingSources,
      addDirs: goal.attachments.length ? [attachmentsDir(config.dataDir, goal.id)] : undefined,
      transcriptPath: join(config.dataDir, 'transcripts', `investigate-${goal.id}-${Date.now()}.jsonl`),
    };
    const handle = await engine.runner.run({ ...base, prompt, maxTurns: 60, maxBudgetUsd: config.investigationMaxCostUsd, timeoutMs: config.investigationMaxMinutes * 60_000, label: `investigate ${goal.title}` });
    for await (const ev of handle.events) engine.broadcast({ goalId: goal.id, taskId: null, attemptId: channel, event: ev, ts: new Date().toISOString() });
    let r = await handle.result;
    costUsd += r.costUsd;
    store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: r.costUsd, source: 'investigation' } });
    engine.recordSessionUsage(r, { goalId: goal.id, kind: 'investigation', model: model.model });
    let parsed = Output.safeParse(r.structuredOutput ?? tryJson(r.finalText));
    if (!parsed.success && r.sessionId) {
      // the session ended (budget/turns) before the JSON: resume it with a small fresh budget and ask for the report only
      const again = await engine.runner.run({ ...base, prompt: 'Stop exploring. Reply now with ONLY the JSON report matching the schema, from what you have found so far; say what you could not verify.', maxTurns: 3, maxBudgetUsd: 2, resumeSessionId: r.sessionId, timeoutMs: 5 * 60_000, label: `investigate ${goal.title} (nudge)` });
      for await (const ev of again.events) engine.broadcast({ goalId: goal.id, taskId: null, attemptId: channel, event: ev, ts: new Date().toISOString() });
      const r2 = await again.result;
      costUsd += r2.costUsd;
      store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: r2.costUsd, source: 'investigation' } });
      engine.recordSessionUsage(r2, { goalId: goal.id, kind: 'investigation', model: model.model });
      parsed = Output.safeParse(r2.structuredOutput ?? tryJson(r2.finalText));
      if (!parsed.success) r = r2;
    }
    if (!parsed.success) throw new Error(`${r.subtype}${r.errorMessage ? ` (${r.errorMessage.slice(0, 120)})` : ''}: no report`);
    const first = goal.references[0]!;
    const file = `${slugOf(first.target)}.md`;
    const name = `reference-${file}`;
    const text = `# How ${goal.references.map((x) => x.target).join(', ')} works\n\n_Investigated with REA for the goal "${goal.title}": evidence of how the reference behaves, not its source. Build the goal's own implementation from it._\n\n${parsed.data.report.trim()}\n`;
    // a new report replaces the one from the last investigation
    const current = getGoal(store.db, goal.id) ?? goal;
    for (const a of current.attachments) if (a.kind === 'file' && a.name === name) engine.removeAttachment(goal.id, a.id);
    const att = engine.addAttachment(goal.id, engine.stage(stageFile(config.dataDir, { name, mime: 'text/markdown', bytes: Buffer.from(text) }), { convert: false }));
    // and on the goal branch, as a document that ships with the code
    let docPath: string | null = null;
    try {
      mkdirSync(join(ws, 'docs', 'reference'), { recursive: true });
      writeFileSync(join(ws, 'docs', 'reference', file), text);
      const c = await commitAll(ws, `docs(reference): how ${first.target} ${first.lookAt ? `does ${first.lookAt}` : 'works'}`.slice(0, 72));
      if (c.committed) docPath = `docs/reference/${file}`;
    } catch (err) {
      config.log(`[investigate] ${goal.id}: the report was not committed: ${String((err as Error).message ?? err)}`);
    }
    finish({ status: 'ok', summary: parsed.data.summary, attachmentId: att.id, docPath, costUsd, detail: `${goal.references.length} reference${goal.references.length > 1 ? 's' : ''} investigated` });
  } catch (err) {
    finish({ status: 'failed', summary: '', attachmentId: null, docPath: null, costUsd, detail: String((err as Error).message ?? err).slice(0, 300) });
  }
}
