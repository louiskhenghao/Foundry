/**
 * Style samples: one cheap real image per click so the human can SEE a Style Proposal before
 * approving the Brief. Regenerating appends a new file — earlier samples are never overwritten,
 * so the human can change their mind and pick any of them as the reference image (chosenSample).
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BriefStyleOption } from '@foundry/core';
import { getBrief, getGoal } from '@foundry/core';
import { renderStyle } from './attempt-prompt.ts';
import type { Engine } from './engine.ts';
import { WORKER_TOOLS, boundarySettings } from './guards/boundary.ts';
import { excludeFromGit } from './skills/autoskills.ts';
import { goalWorkspacePath } from './workspace.ts';

/** soft cap per proposal: keeps a stuck regenerate loop from burning money */
export const STYLE_SAMPLE_MAX = 8;
export const STYLE_SAMPLE_BUDGET_USD = 0.5;

export class StyleSampleError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

const running = new Set<string>();

/**
 * Validate and start one sample generation (fire-and-forget). The result arrives as a
 * `brief.style_sampled` event — the web refreshes off it; progress streams on the returned channel.
 */
export function startStyleSample(engine: Engine, goalId: string, styleKey: string): { channel: string; file: string } {
  const goal = getGoal(engine.store.db, goalId);
  if (!goal) throw new StyleSampleError(`goal ${goalId} not found`, 404);
  if (goal.state !== 'awaiting_brief_approval') throw new StyleSampleError(`goal is ${goal.state}; samples are generated while the Brief awaits approval`, 409);
  const brief = getBrief(engine.store.db, goalId)?.brief;
  const opt = brief?.styleOptions.find((o) => o.key === styleKey);
  if (!brief || !opt) throw new StyleSampleError(`style option ${styleKey} not found on this Brief`, 404);
  if (opt.samples.length >= STYLE_SAMPLE_MAX) throw new StyleSampleError(`this direction already has ${STYLE_SAMPLE_MAX} samples — pick one, or edit the Brief`, 409);
  const key = `${goalId}:${styleKey}`;
  if (running.has(key)) throw new StyleSampleError('a sample for this direction is already being generated', 409);
  const file = `artifacts/samples/${styleKey}-${opt.samples.length + 1}.png`;
  running.add(key);
  void generate(engine, goalId, opt, file)
    .catch((err) => engine.store.append({ type: 'brief.style_sampled', goalId, payload: { styleKey, file, costUsd: 0, status: 'failed', detail: String((err as Error).message ?? err).slice(0, 300) } }))
    .finally(() => running.delete(key));
  return { channel: `style-sample-${goalId}`, file };
}

async function generate(engine: Engine, goalId: string, opt: BriefStyleOption, file: string): Promise<void> {
  const { store, config } = engine;
  const goal = getGoal(store.db, goalId)!;
  const ws = goalWorkspacePath(config.dataDir, goalId);
  await excludeFromGit(ws, ['/artifacts/'], (m) => config.log(m));
  mkdirSync(join(ws, 'artifacts', 'samples'), { recursive: true });
  const skillsHint = await engine.skills.hints.sectionFor('worker', { scenario: 'image' });
  const prompt = [
    `# Goal (for context)\n${goal.prompt.slice(0, 2000)}`,
    renderStyle({ ...opt, chosenSample: null }),
    skillsHint ?? '',
    `# Your job\nGenerate exactly ONE sample image (~512px) that captures this style direction applied to this goal — a taste, not a deliverable. Save it EXACTLY at \`${file}\` (relative to the workspace root). Create nothing else and do not commit.`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const handle = await engine.runner.run({
    prompt,
    cwd: ws,
    model: goal.models.worker,
    meta: { goalId, tier: 'worker' },
    maxTurns: 15,
    maxBudgetUsd: STYLE_SAMPLE_BUDGET_USD,
    permissionMode: 'dontAsk',
    allowedTools: WORKER_TOOLS,
    settings: boundarySettings(config.hooksDir),
    settingSources: config.settingSources,
    timeoutMs: 5 * 60_000,
    transcriptPath: join(config.dataDir, 'transcripts', `style-sample-${goalId}-${opt.key}.jsonl`),
    label: `style sample ${opt.name}`,
  });
  for await (const ev of handle.events) engine.broadcast({ goalId, taskId: null, attemptId: `style-sample-${goalId}`, event: ev, ts: new Date().toISOString() });
  const r = await handle.result;
  store.append({ type: 'goal.cost_added', goalId, payload: { costUsd: r.costUsd, source: 'style-sample' } });
  engine.recordSessionUsage(r, { goalId, kind: 'style-sample', model: goal.models.worker });
  const ok = existsSync(join(ws, file));
  store.append({
    type: 'brief.style_sampled',
    goalId,
    payload: { styleKey: opt.key, file, costUsd: r.costUsd, status: ok ? 'ok' : 'failed', detail: ok ? `sample ${opt.samples.length + 1} generated` : `session ended (${r.subtype}${r.errorMessage ? `: ${r.errorMessage.slice(0, 120)}` : ''}) without writing ${file}` },
  });
  config.log(`[style-sample] ${goalId} ${opt.key}: ${ok ? file : 'failed'}`);
}
