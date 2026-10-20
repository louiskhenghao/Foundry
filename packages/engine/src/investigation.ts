import { lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { Goal } from '@foundry/core';
import { getGoal } from '@foundry/core';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { attachmentsDir, renderAttachments, stageFile } from './attachments.ts';
import { tryJson } from './checks/reviewer.ts';
import type { Engine } from './engine.ts';
import { commitStaged, git, gitOk, headRef, isGitRepo } from './git/git.ts';
import { READONLY_DISALLOWED, READONLY_TOOLS, boundaryEnv, boundarySettings } from './guards/boundary.ts';
import { metaFor, modelFor } from './models/roles.ts';
import { REA_PREFIX, REFERENCE_RULES, REPORT_NOTE, renderReferences } from './references.ts';
import { SATISFIED } from './skills/catalog.ts';

const Output = z.object({
  summary: z.string().describe('Two or three sentences: what the reference does for the feature studied, and the one thing that matters most for building it.'),
  report: z.string().describe('The report in Markdown: for each reference a section with what it does, how it works (the evidence: files, functions, requests, screens), what could not be verified, and what to build. Plain English; no code or assets copied from the reference.'),
});

/** the states in which a goal's references may be investigated (again): until the Brief is approved */
export const INVESTIGABLE_STATES: readonly string[] = ['draft', 'clarifying', 'awaiting_brief_approval'];

/** a target as it may be written down: a URL without the credentials someone typed into it (the report and its commit are shared) */
export const displayTarget = (target: string) => target.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/i, '$1');

const slugOf = (target: string) =>
  displayTarget(target)
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 40) || 'reference';

/**
 * Undo whatever a session left in the workspace: a commit it made, and every change on disk. The investigation session
 * may not write (Write and Edit are denied) but it has a shell; anything it left would ride the next task's commit.
 * Returns how many paths went.
 */
async function discardStray(ws: string, before: string): Promise<number> {
  if ((await headRef(ws)) !== before) await git(['reset', '-q', before], ws);
  const status = (await git(['status', '--porcelain', '-z', '--untracked-files=all'], ws)).stdout.split('\0').filter(Boolean);
  if (!status.length) return 0;
  await git(['reset', '-q', '--hard', before], ws);
  await git(['clean', '-qfd'], ws);
  return status.length;
}

/** write the report under docs/reference and commit that file alone; throws when the folder or the file leads out of the workspace */
async function commitReport(ws: string, file: string, text: string, subject: string): Promise<{ docPath: string; docRef: string | null }> {
  const rel = join('docs', 'reference', file);
  const dir = join(ws, 'docs', 'reference');
  mkdirSync(dir, { recursive: true });
  // a checked-out link under docs/ must not turn the write into one somewhere else on this computer
  if (!(realpathSync(dir) + sep).startsWith(realpathSync(ws) + sep)) throw new Error('docs/reference points outside the workspace');
  let link = false;
  try {
    link = lstatSync(join(ws, rel)).isSymbolicLink();
  } catch {}
  if (link) throw new Error(`${rel} is a symbolic link`);
  writeFileSync(join(ws, rel), text);
  // only the report is staged: nothing else rides this commit
  await gitOk(['add', '--', rel], ws);
  const c = await commitStaged(ws, subject);
  return { docPath: rel, docRef: c.committed ? c.ref : null };
}

/**
 * Before Clarify, a session studies the goal's references with REA and writes a report with its evidence: how each one
 * does what the person wants to look at, and what to build. The report becomes an attachment (every later session
 * reads it) and a document on the goal branch (it ships with the code). Capped by Settings; a skipped or failed
 * investigation is recorded and Clarify goes on without it. Never throws.
 */
export async function runInvestigation(engine: Engine, goal: Goal): Promise<void> {
  const { store, config } = engine;
  const finish = (p: { status: 'ok' | 'failed' | 'skipped'; summary: string; attachmentId: string | null; docPath: string | null; docRef?: string | null; costUsd: number; detail: string }) =>
    store.append({ type: 'goal.investigation_finished', goalId: goal.id, payload: p });
  const provider = goal.provider ?? config.provider;
  const policy = engine.mcpToolPolicy(provider, engine.mcpAllowedFor(goal));
  if (!policy.allowed.includes(REA_PREFIX)) {
    const why = policy.catalogUnreadable ? 'the MCP catalog cannot be read (Setup page), so REA stays out of sessions until it is fixed' : 'REA is not installed, or not allowed in goals (Extensions → MCP servers)';
    finish({ status: 'skipped', summary: '', attachmentId: null, docPath: null, costUsd: 0, detail: `${why}; Clarify goes on without the investigation` });
    return;
  }
  store.append({ type: 'clarify.stage', goalId: goal.id, payload: { stage: 'investigating' } });
  let costUsd = 0;
  try {
    const ws = await engine.ensureSyncedWorkspace(goal);
    const inGit = await isGitRepo(ws).catch(() => false);
    const before = inGit ? await headRef(ws) : null;
    const statuses = await engine
      .skillsFor(goal)
      .status(goal.repoPath)
      .catch(() => []);
    const skill = statuses.find((s) => s.entry.name === 'reverse-engineer-anything' && SATISFIED.includes(s.status));
    const codex = provider !== 'claude';
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
    const denied = policy.denied ?? [];
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
      env: boundaryEnv(config, goal.id),
      addDirs: goal.attachments.length ? [attachmentsDir(config.dataDir, goal.id)] : undefined,
      transcriptPath: join(config.dataDir, 'transcripts', `investigate-${goal.id}-${Date.now()}.jsonl`),
    };
    // one session, tracked so that cancelling the goal kills it; its cost lands on the goal as it ends
    const run = async (spec: Parameters<Engine['runner']['run']>[0]) => {
      const handle = await engine.runner.run(spec);
      const untrack = engine.trackBackground(goal.id, handle);
      try {
        for await (const ev of handle.events) engine.broadcast({ goalId: goal.id, taskId: null, attemptId: channel, event: ev, ts: new Date().toISOString() });
        const r = await handle.result;
        costUsd += r.costUsd;
        store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: r.costUsd, source: 'investigation' } });
        engine.recordSessionUsage(r, { goalId: goal.id, kind: 'investigation', model: model.model });
        return r;
      } finally {
        untrack();
      }
    };
    const cap = config.investigationMaxCostUsd;
    let r = await run({ ...base, prompt, maxTurns: 60, maxBudgetUsd: cap, timeoutMs: config.investigationMaxMinutes * 60_000, label: `investigate ${goal.title}` });
    let parsed = Output.safeParse(r.structuredOutput ?? tryJson(r.finalText));
    if (!parsed.success && r.sessionId && !engine.isStopped) {
      // the session ended (budget/turns) before the JSON: resume it with what is left of the cap and ask for the report only
      const r2 = await run({ ...base, prompt: 'Stop exploring. Reply now with ONLY the JSON report matching the schema, from what you have found so far; say what you could not verify.', maxTurns: 3, maxBudgetUsd: Math.max(0.5, Math.min(2, cap - r.costUsd)), resumeSessionId: r.sessionId, timeoutMs: 5 * 60_000, label: `investigate ${goal.title} (nudge)` });
      parsed = Output.safeParse(r2.structuredOutput ?? tryJson(r2.finalText));
      if (!parsed.success) r = r2;
    }
    const stray = inGit ? await discardStray(ws, before!) : 0;
    if (!parsed.success) throw new Error(`${r.subtype}${r.errorMessage ? ` (${r.errorMessage.slice(0, 120)})` : ''}: no report`);
    // the goal may have moved on while the session ran (cancelled, or the Brief approved by an API caller)
    const current = getGoal(store.db, goal.id);
    if (!current || !INVESTIGABLE_STATES.includes(current.state)) {
      finish({ status: 'skipped', summary: '', attachmentId: null, docPath: null, costUsd, detail: `the goal is ${current?.state ?? 'gone'}: the report was not kept` });
      return;
    }
    const shown = goal.references.map((x) => displayTarget(x.target));
    const first = goal.references[0]!;
    const file = `${slugOf(first.target)}.md`;
    const name = `reference-${file}`;
    let text = `# How ${shown.join(', ')} works\n\n_Investigated with REA for the goal "${goal.title}": evidence of how the reference behaves, not its source. Build the goal's own implementation from it._\n\n${parsed.data.report.trim()}\n`;
    // a target typed with credentials is written down without them, wherever the report repeats it
    for (const [i, x] of goal.references.entries()) if (x.target !== shown[i]) text = text.split(x.target).join(shown[i]!);
    const notes: string[] = [];
    if (stray) notes.push(`${stray} change(s) the session left in the workspace were discarded`);
    // on the goal branch first, as a document that ships with the code
    let doc: { docPath: string | null; docRef: string | null } = { docPath: null, docRef: null };
    if (inGit) {
      try {
        doc = await commitReport(ws, file, text, `docs(reference): how ${shown[0]} ${first.lookAt ? `does ${first.lookAt}` : 'works'}`.slice(0, 72));
      } catch (err) {
        config.log(`[investigate] ${goal.id}: the report was not committed: ${String((err as Error).message ?? err)}`);
        notes.push(`the report was not committed: ${String((err as Error).message ?? err).slice(0, 120)}`);
      }
    } else notes.push('the report was not committed: not a git repository');
    // then the attachment every later session reads; the one from the last investigation goes once the new one is in
    let attachmentId: string | null = null;
    try {
      const att = engine.addAttachment(goal.id, engine.stage({ ...stageFile(config.dataDir, { name, mime: 'text/markdown', bytes: Buffer.from(text) }), note: REPORT_NOTE }, { convert: false }));
      attachmentId = att.id;
      for (const a of current.attachments) if (a.kind === 'file' && a.name === name && a.id !== att.id) engine.removeAttachment(goal.id, a.id);
    } catch (err) {
      notes.push(`the report was not attached: ${String((err as Error).message ?? err).slice(0, 120)}`);
    }
    const n = goal.references.length;
    finish({ status: 'ok', summary: parsed.data.summary, attachmentId, docPath: doc.docPath, docRef: doc.docRef, costUsd, detail: [`${n} reference${n > 1 ? 's' : ''} investigated`, ...notes].join('; ') });
  } catch (err) {
    finish({ status: 'failed', summary: '', attachmentId: null, docPath: null, costUsd, detail: String((err as Error).message ?? err).slice(0, 300) });
  }
}
