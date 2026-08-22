import { join } from 'node:path';
import type { Brief, Goal } from '@ai-engine/core';
import { BriefOutput, IdPrefix, getGoal, newId } from '@ai-engine/core';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { attachmentsDir, markitdownHint, renderAttachments } from './attachments.ts';
import { tryJson } from './checks/reviewer.ts';
import type { Engine } from './engine.ts';
import { git, isDirty } from './git/git.ts';
import { READONLY_DISALLOWED, READONLY_TOOLS, boundarySettings } from './guards/boundary.ts';

/**
 * Clarify: explore the repo, produce a Brief, hand it to the human once.
 */
export async function runClarify(engine: Engine, goal: Goal): Promise<void> {
  const { store, config } = engine;
  engine.clarifying.add(goal.id);
  try {
    store.append({ type: 'clarify.started', goalId: goal.id, payload: { attemptId: null } });
    const questions: Brief['questions'] = [];
    if (await isDirty(goal.repoPath).catch(() => false)) {
      questions.push({
        id: newId('q'),
        text: `The repository at ${goal.repoPath} has uncommitted changes. The goal branch is created from the last commit of '${goal.baseBranch}' (or its remote tip when that is newer), so those changes will NOT be visible to the workers. Continue anyway? (answer "yes" to continue, or commit/stash first and recreate the goal)`,
        answer: null,
        blocking: true,
      });
    }
    // explore the goal worktree, not the user's checkout: it was just fetched and may be ahead of the local base
    const ws = await engine.ensureSyncedWorkspace(goal);
    await engine.context.prepare(ws).catch((err) => config.log(`[clarify] context prepare failed: ${err}`));
    let overview = await engine.context.overview(ws).catch(() => null);
    const sync = getGoal(store.db, goal.id)?.baseSync;
    if (sync && sync.startedFrom === 'remote') overview = `${overview ?? ''}\n\n## Base branch\nThis checkout is ${sync.remote}/${sync.base} (${sync.behind} commit(s) newer than the local ${sync.base}).`.trim();
    // recent commit subjects: the clarifier matches their language and style for task titles
    const log = await git(['log', '--no-merges', '--format=%s', '-n', '8', '--', '.'], ws).catch(() => null);
    if (log && log.code === 0 && log.stdout.trim()) overview = `${overview ?? ''}\n\n## Recent commits\n${log.stdout.trim()}`.trim();

    const [clarifierHint, plannerHint] = await Promise.all([engine.skills.hints.sectionFor('clarifier'), engine.skills.hints.sectionFor('planner')]);
    const prompt = buildClarifyPrompt(goal, overview, clarifierHint, [renderAttachments(goal, config.dataDir), markitdownHint(engine.markitdown.available(), engine.markitdown.binary())].filter(Boolean).join('\n\n'));
    const addDirs = goal.attachments.length ? [attachmentsDir(config.dataDir, goal.id)] : undefined;
    const schema = zodToJsonSchema(BriefOutput, { $refStrategy: 'none' });
    const transcriptPath = join(config.dataDir, 'transcripts', `clarify-${goal.id}.jsonl`);
    const run = async (p: string, resume?: string) =>
      engine.runner.run({
        prompt: p,
        cwd: ws,
        model: goal.models.strong,
        meta: { goalId: goal.id, tier: 'strong' },
        maxTurns: 60,
        maxBudgetUsd: 3,
        permissionMode: 'dontAsk',
        allowedTools: READONLY_TOOLS,
        disallowedTools: READONLY_DISALLOWED,
        appendSystemPromptFile: engine.roles.path('clarifier'),
        agents: { planner: { description: 'Plans the task DAG for a goal. Use after exploring the repo.', prompt: engine.roles.text('planner') + (plannerHint ? `\n\n${plannerHint}` : ''), model: goal.models.strong } },
        jsonSchema: schema,
        settings: boundarySettings(config.hooksDir),
        settingSources: config.settingSources,
        addDirs,
        resumeSessionId: resume,
        timeoutMs: 15 * 60_000,
        transcriptPath,
        label: `clarify ${goal.title}`,
      });

    let handle = await run(prompt);
    for await (const ev of handle.events) engine.broadcast({ goalId: goal.id, taskId: null, attemptId: `clarify-${goal.id}`, event: ev, ts: new Date().toISOString() });
    let result = await handle.result;
    store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: result.costUsd, source: 'clarify' } });
    engine.recordSessionUsage(result, { goalId: goal.id, kind: 'clarify', model: goal.models.strong });

    let parsed = BriefOutput.safeParse(result.structuredOutput ?? tryJson(result.finalText));
    if (!parsed.success && result.sessionId) {
      handle = await run(`Your previous answer did not match the required JSON schema (${parsed.error.issues.slice(0, 3).map((i) => i.path.join('.') + ': ' + i.message).join('; ')}). Output ONLY the JSON object now.`, result.sessionId);
      for await (const ev of handle.events) engine.broadcast({ goalId: goal.id, taskId: null, attemptId: `clarify-${goal.id}`, event: ev, ts: new Date().toISOString() });
      result = await handle.result;
      store.append({ type: 'goal.cost_added', goalId: goal.id, payload: { costUsd: result.costUsd, source: 'clarify-repair' } });
      engine.recordSessionUsage(result, { goalId: goal.id, kind: 'clarify', model: goal.models.strong });
      parsed = BriefOutput.safeParse(result.structuredOutput ?? tryJson(result.finalText));
    }

    let brief: Brief;
    if (parsed.success) {
      brief = toBrief(goal, parsed.data, questions);
    } else {
      brief = {
        goalId: goal.id,
        title: '',
        understanding: result.finalText ?? `(clarifier ended with ${result.subtype}${result.errorMessage ? ': ' + result.errorMessage : ''})`,
        assumptions: [],
        checks: [],
        tasks: [{ key: 'T1', title: goal.title, spec: goal.prompt, kind: 'feature', scope: null, scenario: 'general', dependsOnKeys: [], parallelizable: false, relevantFiles: [] }],
        costEstimateUsd: 0,
        timeEstimateMin: 0,
        questions: [
          ...questions,
          { id: newId('q'), text: 'The clarifier could not produce a structured Brief. Edit the tasks and checks manually, then answer "ok" here.', answer: null, blocking: true },
        ],
      };
    }
    store.append({ type: 'brief.proposed', goalId: goal.id, payload: { brief } });
    store.append({ type: 'goal.state_changed', goalId: goal.id, payload: { from: 'clarifying', to: 'awaiting_brief_approval', reason: 'brief proposed' } });
  } catch (err) {
    store.append({ type: 'engine.note', goalId: goal.id, payload: { level: 'error', message: `clarify crashed: ${String((err as Error)?.stack ?? err)}` } });
    store.append({ type: 'goal.state_changed', goalId: goal.id, payload: { from: 'clarifying', to: 'failed', reason: `clarify crashed: ${String(err)}` } });
  } finally {
    engine.clarifying.delete(goal.id);
  }
}

function buildClarifyPrompt(goal: Goal, overview: string | null, skillsHint: string | null = null, attachments = ''): string {
  return [
    `# Goal from the user\n${goal.prompt}`,
    attachments ? `${attachments}\nWhen an attachment matters for a specific task, name it (by file name) in that task's spec.` : '',
    overview ? `# Repository overview\n${overview}` : '',
    skillsHint ?? '',
    `# Your job\nExplore this repository (read-only) enough to understand how the goal should be implemented here: build/test commands, conventions, the files involved. Then use the \`planner\` agent to split the goal into a small DAG of tasks, and produce the Brief as JSON matching the schema.\n\nRequirements for the Brief:\n- **Must checks** come ONLY from what the user explicitly asked for plus the repo's existing quality gates (its test/typecheck/lint/build commands, if any). Every command check must be a real command that works in this repo from its root.\n- **Stretch checks** are improvements you propose on top (docs, edge-case tests, performance, accessibility…). Never fold them into must.\n- Prefer 1–6 tasks. Each task must be completable by one engineer-session without talking to anyone; give concrete file paths in relevantFiles.\n- Tasks that touch disjoint files can be parallelizable; tasks that must build on each other use dependsOnKeys.\n- Put test/typecheck/lint commands as task-level checks on the task that must make them pass, AND as goal-level checks (taskKey null) so the merged result is verified.\n- Prefer assumptions over questions. A question is blocking only if a wrong guess would waste the whole goal.
- Set each task's \`kind\`: bug (something is broken — the worker must reproduce it first), feature, refactor, research (a spike whose output is knowledge), chore.
- Set each task's \`scenario\` (frontend / backend / fullstack / data / mobile / infra / docs / general): it decides which specialised skills the worker is handed — UI work gets the design skills, for instance — so be precise and never leave a UI task as "general".
- Commits and pull requests follow Conventional Commits. Each task's \`title\` is its commit subject: imperative, ≤ 60 chars, no trailing period, NO type prefix (the type comes from \`kind\`); set \`scope\` to the module touched when obvious. \`title\` (top level) is one Conventional Commits header for the whole goal (e.g. \`feat(site): add resort landing page\`) — it becomes the PR title. Write titles in the language of the repository's recent commits (see the overview); default to English.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function toBrief(goal: Goal, o: BriefOutput, extraQuestions: Brief['questions']): Brief {
  return {
    goalId: goal.id,
    title: o.title?.trim() ?? '',
    understanding: o.understanding,
    assumptions: o.assumptions.map((text) => ({ id: newId('as'), text, accepted: true })),
    checks: o.checks.map((c) => ({
      key: c.key,
      name: c.name,
      tier: c.tier,
      taskKey: c.taskKey,
      spec:
        c.type === 'command'
          ? { type: 'command', cmd: c.cmd ?? 'true', timeoutMs: 300_000, expectExitCode: 0 }
          : { type: 'reviewer', scope: c.taskKey ? 'task-diff' : 'goal-diff', rubric: c.rubric ?? c.name },
    })),
    tasks: o.tasks.map((t) => ({ key: t.key, title: t.title, spec: t.spec, kind: t.kind ?? 'feature', scope: t.scope ?? null, scenario: t.scenario ?? 'general', dependsOnKeys: t.dependsOnKeys, parallelizable: t.parallelizable, relevantFiles: t.relevantFiles })),
    costEstimateUsd: o.costEstimateUsd,
    timeEstimateMin: o.timeEstimateMin,
    questions: [...extraQuestions, ...o.questions.map((q) => ({ id: newId('q'), text: q.text, answer: null, blocking: q.blocking }))],
  };
}

export { IdPrefix };
