import type { BriefStyleOption, Check, Goal, ObservationReport, Task } from '@foundry/core';
import { renderReferences } from './references.ts';

/** Scenarios whose deliverables have no look — the chosen Style Proposal is noise to them. Everything else (UI, mobile, media, general) must follow it. */
const STYLE_FREE_SCENARIOS: ReadonlySet<string> = new Set(['backend', 'infra', 'docs', 'data', 'research', 'cad']);
export const styleApplies = (scenario: string): boolean => !STYLE_FREE_SCENARIOS.has(scenario);

/** The chosen Style Proposal rendered for workers and reviewers; '' when none. */
export function renderStyle(style: BriefStyleOption | null | undefined, opts: { forReviewer?: boolean } = {}): string {
  if (!style) return '';
  const lines = [
    `# Style direction (chosen by the human): ${style.name}`,
    style.palette.length ? `- Palette: ${style.palette.join(', ')}` : '',
    style.fonts.length ? `- Typefaces: ${style.fonts.join(', ')}` : '',
    style.keywords.length ? `- Keywords: ${style.keywords.join(', ')}` : '',
    style.description ? `- Feel: ${style.description}` : '',
    style.chosenSample ? `- Reference image: \`${style.chosenSample}\` — open it with the Read tool; the deliverables must match its feel.` : '',
    opts.forReviewer ? 'Deliverables that do not follow this direction are a BLOCKER.' : 'Follow this direction in everything you produce, and record the style parameters actually used in the manifest.',
  ];
  return lines.filter(Boolean).join('\n');
}

export interface AttemptPromptInput {
  goal: Goal;
  task: Task;
  checks: Check[];
  attemptIndex: number;
  maxAttempts: number;
  prevReport: ObservationReport | null;
  rolledBack: { toRef: string; reason: string } | null;
  hint: string | null;
  relevantContext: string | null;
  /** one line from SkillsHints, or null */
  skillsHint?: string | null;
  /** rendered `# Attachments from the user` section (see attachments.ts), or '' */
  attachments?: string;
  /** one line from markitdownHint() when the tool is installed, or '' */
  markitdownHint?: string;
  /** description of the task's Area from the Brief, or '' */
  areaDescription?: string;
  /** rendered `# Decisions from the human` section (see renderDecisions), or '' */
  decisions?: string;
  /** rendered `# What the steps before this one delivered` section (delegation.ts renderUpstream), or '' */
  upstream?: string;
  /** what earlier goals in this folder learned (ADR-0040), in short */
  learnings?: string;
  /** the chosen Style Proposal (media/UI tasks), or null */
  style?: BriefStyleOption | null;
  /** rendered `# Subjects` section (see subjects.ts renderSubjects): the real things the result depicts, with their pictures; or '' */
  subjects?: string;
  /** the goal branch moved since this task's worktree was created (see catchup.ts), or null */
  baseMoved?: { merged: boolean; commits: string[]; conflictFiles: string[] } | null;
}

/** scenarios whose milestones are shown by a walkthrough in a browser */
const SHOWN_SCENARIOS = new Set(['frontend', 'fullstack', 'mobile']);

/** what a task that closes a feature milestone writes: the Playwright script that shows the feature */
export function milestoneScriptSection(milestone: string, script: string): string {
  return `# This task is a milestone: write its script
When it lands, Foundry runs \`${script}\` to show the person this feature: ${milestone}
- Write it with Playwright Test (\`@playwright/test\`). Add it as a dev dependency when the repository lacks it, and run \`npx playwright install chromium\` once.
- \`playwright.config.ts\` at the repository root (create it, or extend the one there): \`testDir\` covers \`e2e/\`, \`use.baseURL\` is the app's address, and \`webServer\` starts everything the feature needs on a bare checkout: the app, its backend, databases and other services, migrations and seed data. A \`webServer\` command must keep running, so chain what only prepares in front of the server that needs it (\`docker compose up -d --wait && npm run db:seed && npm run start:api\`). The web app listens on \`process.env.PORT\` and a backend on \`process.env.API_PORT\` when they are set (Foundry sets both to free ports), with \`reuseExistingServer: !process.env.CI\`. Use commands any machine with the repository's tools has (npx, its package manager), not ones only your shell knows.
- Walk through the feature the way a person would try it, through every state worth seeing (an empty list, a filled form, a validation error, a phone width with \`page.setViewportSize({ width: 375, height: 812 })\`…). At each, attach a captioned screenshot: \`await test.info().attach('<one line on what it shows>', { body: await page.screenshot(), contentType: 'image/png' })\`. For an HTTP API, call it with the \`request\` fixture and attach each response: \`await test.info().attach('POST /api/users → 201', { body: JSON.stringify(body, null, 2), contentType: 'application/json' })\`.
- Assert what it shows (\`expect\`), so the script fails when the feature breaks. Use seeded or test accounts, never real credentials, payments or messages.
- The acceptance check below runs it; it must pass before you stop. It is committed with your work and stays in the repository as the feature's end-to-end test.`;
}

export function buildAttemptPrompt(i: AttemptPromptInput): string {
  const lines: string[] = [];
  lines.push(`# Goal\n${i.goal.title}\n\n${i.goal.prompt.trim()}`);
  const area = i.task.area ? `Area: ${i.task.area}${i.areaDescription ? ` — ${i.areaDescription}` : ''}\n` : '';
  lines.push(`# Your task (${i.task.title})\n${area}Attempt ${i.attemptIndex} of ${i.maxAttempts}.\n\n${i.task.spec.trim()}`);
  if (i.decisions) lines.push(i.decisions);
  if (i.upstream) lines.push(i.upstream);
  const styleSection = renderStyle(i.style);
  if (styleSection) lines.push(styleSection);
  if (i.subjects) lines.push(i.subjects);
  if (i.task.relevantFiles.length) lines.push(`# Start here\n${i.task.relevantFiles.map((f) => `- ${f}`).join('\n')}`);
  if (i.task.delivers?.length) lines.push(`# Deliverables\nThe tasks after this one read these files; each must exist when you stop (the engine checks):\n${i.task.delivers.map((f) => `- ${f}`).join('\n')}`);
  if (i.attachments) lines.push(i.attachments);
  // the shipped software the goal learns from: the report is among the attachments, the rules travel with it
  if (i.goal.references?.length) lines.push(renderReferences(i.goal));
  if (i.relevantContext) lines.push(`# Repository context\n${i.relevantContext}`);
  if (i.learnings) lines.push(i.learnings);

  const must = i.checks.filter((c) => c.tier === 'must');
  const stretch = i.checks.filter((c) => c.tier === 'stretch');
  const fmt = (c: Check) => (c.spec.type === 'command' ? `- [${c.tier}] ${c.name}: \`${c.spec.cmd}\` must exit ${c.spec.expectExitCode}` : `- [${c.tier}] ${c.name} (${c.spec.type})`);
  if (must.length || stretch.length) {
    lines.push(`# Acceptance checks\nThe engine will run these after you finish. Run the command checks yourself before you stop.\n${[...must, ...stretch].map(fmt).join('\n')}`);
  }
  if (i.hint) lines.push(`# Hint from the human\n${i.hint}`);
  // a feature milestone is shown by its own script: the task writes it, and it must pass on a bare checkout
  if (i.task.milestone && i.task.milestoneScript) {
    lines.push(milestoneScriptSection(i.task.milestone, i.task.milestoneScript));
  } else if (i.task.milestone && SHOWN_SCENARIOS.has(i.task.scenario)) {
    // a milestone is shown to the person by a walkthrough in the preview: it must be able to run on a bare machine
    lines.push(`# This task is a milestone\nWhen it lands, Foundry starts the app in its preview and records a walkthrough for the person: ${i.task.milestone}\nMake sure that can be shown. If the app cannot run without a backend, Docker or secrets, add a \`dev:mock\` script to the app's package.json that serves the same screens against fake data (reuse the fakes the e2e tests use when there are some) and listens on \`PORT\`; Foundry uses it when the real app cannot be shown. It is committed with your work.`);
  }
  if (i.baseMoved) {
    const list = i.baseMoved.commits.slice(0, 12).map((c) => `- ${c}`).join('\n');
    lines.push(
      i.baseMoved.merged
        ? `# The goal branch moved while this task was waiting\nThese commits from other tasks were merged into your worktree before you started; build on them, do not undo them:\n${list}`
        : `# The goal branch moved and the automatic merge could not finish\nThese commits from other tasks landed on ${i.goal.branch}:\n${list}\nThe conflict is in ${i.baseMoved.conflictFiles.join(', ') || 'some files'}. Before you finish, run \`git merge ${i.goal.branch}\` in this worktree yourself and resolve it keeping both sides' intent (the goal branch's version of shared files is the current truth — add your changes on top).`,
    );
  }
  if (i.rolledBack) lines.push(`# Note\nThe workspace was rolled back to ${i.rolledBack.toRef.slice(0, 10)} because ${i.rolledBack.reason}. Take a different approach.`);
  if (i.prevReport) {
    lines.push(`# What happened in the previous attempt\n${i.prevReport.summary.trim()}`);
  }
  // the section carries its own heading (`# Workflow skills` or `# Skills`)
  if (i.skillsHint) lines.push(i.skillsHint.startsWith('#') ? i.skillsHint : `# Skills\n${i.skillsHint}`);
  if (i.task.scenario === 'cad') {
    lines.push(
      `# CAD conventions\n- The model's source (build123d Python) lives in the repository where its layout says (else under \`cad/\`); running it builds and exports STEP. Exports (STEP always; STL, 3MF, GLB, DXF or a drawing PDF when the spec asks) go into \`artifacts/\` in this workspace, which never reaches git — the engine delivers it when the goal finishes. This overrides the cad skill's example layout (\`STEP/\`, \`STL/\`, \`snapshots/\` beside the source): point \`@step(out=…)\` and every export or snapshot command at the workspace's \`artifacts/\` folder (a decorator's \`out=\` is relative to the model script: from \`cad/part.py\` it is \`../artifacts/part.step\`), and commit no STEP, STL, 3MF, GLB or snapshot file.\n- Write the geometry checks first (key dimensions, interference, wall thickness) as a Python script the task's command checks run; the model is done when they pass.\n- Render front, top, right and isometric snapshots of every deliverable (\`cadgen snapshot\`) next to it under \`artifacts/\`: the review reads them and treats a missing snapshot as a blocker.\n- Keep the manifest named in your task spec (\`docs/artifacts/…\`) up to date: one entry per deliverable — file name, what it is, key dimensions with units, process and material, the checks and their results, the snapshots.\n- Nothing you commit may reach into the coding agent's plugin folder (\`~/.claude/plugins/…\`, \`~/.codex/plugins/…\`): the path changes with every plugin update and differs per machine. When a check needs one of the skills' tools (the DfAM measurer), copy it into the repository next to the checks, its licence with it.\n- Never open a desktop app or send anything to a printer: slicing is headless; a hand-off to Bambu or a slicer's window is the person's.`,
    );
  } else if (i.task.scenario === 'image' || i.task.scenario === 'video') {
    lines.push(
      `# Media conventions\n- Every generated file goes into \`artifacts/\` in this workspace. That folder never reaches git — the engine delivers it to the user when the goal finishes.\n- Keep the manifest named in your task spec (\`docs/artifacts/…\`) up to date: one bullet per artifact — file name, what it shows, and the prompt/parameters used. The manifest is committed and is what the reviewer reads first.\n- Codebase conventions and test suites do not apply here; the craft is the artifacts themselves and an honest manifest.`,
    );
  } else if (i.task.scenario === 'docs' || i.task.scenario === 'research') {
    lines.push(
      `# Writing conventions\n- The deliverable is committed prose (markdown unless the spec says otherwise). Match the repository's existing documents in tone and structure.${i.task.scenario === 'research' ? '\n- Every claim needs a source: link it where the claim is made. Conclusions must follow from the cited evidence.' : ''}\n- Test-suite rules do not apply; run only the command checks your task lists.`,
    );
  }
  lines.push(
    `# How to work\n1. Write a short plan (3-8 bullet points) as your first message, then execute it.\n2. Stay inside the scope of this task. Do not push, open PRs, deploy or touch anything outside this workspace.\n3. Do not commit; the engine commits for you (Conventional Commits — this task ends as one commit titled after it).\n4. When done, reply with a brief summary: what changed, which checks you ran and their outcome, anything left undone.${i.markitdownHint ? `\n5. ${i.markitdownHint}` : ''}`,
  );
  return lines.join('\n\n');
}

export function summarizeReport(r: { results: { status: string; summary: string }[]; reviewerVerdict: { pass: boolean; blockers: string[]; notes?: string } | null; changedFiles: { path: string }[] }, checks: Check[], workflow?: { mandated: { name: string; invoke: string }[]; used: string[]; observable?: boolean } | null): string {
  const byId = new Map(checks.map((c) => [c.id, c]));
  const lines: string[] = [];
  if (workflow?.mandated.length) {
    const hit = (n: string) => workflow.used.some((u) => u === n || u.endsWith(`:${n}`));
    // a backend that reports no skill invocations (Codex): the workflow is restated, never called skipped
    if (workflow.observable === false) lines.push(`Workflow: ${workflow.mandated.map((m) => m.invoke).join('; ')} — whether they were invoked is not recorded for this backend; follow them again.`);
    else lines.push(`Workflow: ${workflow.mandated.map((m) => `${m.invoke} ${hit(m.name) ? '✓' : 'not invoked — invoke it first next time'}`).join('; ')}.`);
  }
  const failed = r.results.filter((x) => x.status !== 'pass');
  lines.push(`${r.results.length - failed.length}/${r.results.length} checks passed.`);
  for (const res of r.results as any[]) {
    const c = byId.get(res.checkId);
    const name = c ? `${c.name} (${c.spec.type === 'command' ? c.spec.cmd : c.spec.type})` : res.checkId;
    if (res.status === 'pass') lines.push(`- ✅ ${name}`);
    else if (res.status === 'skipped') lines.push(`- ⏭ ${name} → skipped (${res.summary.slice(0, 120)})`);
    else lines.push(`- ❌ ${name} → ${res.status}\n\`\`\`\n${res.summary.slice(0, 1500)}\n\`\`\``);
  }
  if (r.reviewerVerdict) {
    lines.push(r.reviewerVerdict.pass ? 'Reviewer: no blockers.' : `Reviewer blockers:\n${r.reviewerVerdict.blockers.map((b) => `- ${b}`).join('\n')}`);
    if (r.reviewerVerdict.notes?.trim()) lines.push(`Reviewer notes: ${r.reviewerVerdict.notes.trim().slice(0, 600)}`);
  }
  if (r.changedFiles.length) lines.push(`Files changed so far: ${r.changedFiles.map((f) => f.path).slice(0, 30).join(', ')}${r.changedFiles.length > 30 ? ' …' : ''}`);
  return lines.join('\n');
}
