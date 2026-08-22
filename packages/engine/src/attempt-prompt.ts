import type { Check, Goal, ObservationReport, Task } from '@ai-engine/core';

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
}

export function buildAttemptPrompt(i: AttemptPromptInput): string {
  const lines: string[] = [];
  lines.push(`# Goal\n${i.goal.title}\n\n${i.goal.prompt.trim()}`);
  const area = i.task.area ? `Area: ${i.task.area}${i.areaDescription ? ` — ${i.areaDescription}` : ''}\n` : '';
  lines.push(`# Your task (${i.task.title})\n${area}Attempt ${i.attemptIndex} of ${i.maxAttempts}.\n\n${i.task.spec.trim()}`);
  if (i.task.relevantFiles.length) lines.push(`# Start here\n${i.task.relevantFiles.map((f) => `- ${f}`).join('\n')}`);
  if (i.attachments) lines.push(i.attachments);
  if (i.relevantContext) lines.push(`# Repository context\n${i.relevantContext}`);

  const must = i.checks.filter((c) => c.tier === 'must');
  const stretch = i.checks.filter((c) => c.tier === 'stretch');
  const fmt = (c: Check) => (c.spec.type === 'command' ? `- [${c.tier}] ${c.name}: \`${c.spec.cmd}\` must exit ${c.spec.expectExitCode}` : `- [${c.tier}] ${c.name} (${c.spec.type})`);
  if (must.length || stretch.length) {
    lines.push(`# Acceptance checks\nThe engine will run these after you finish. Run the command checks yourself before you stop.\n${[...must, ...stretch].map(fmt).join('\n')}`);
  }
  if (i.hint) lines.push(`# Hint from the human\n${i.hint}`);
  if (i.rolledBack) lines.push(`# Note\nThe workspace was rolled back to ${i.rolledBack.toRef.slice(0, 10)} because ${i.rolledBack.reason}. Take a different approach.`);
  if (i.prevReport) {
    lines.push(`# What happened in the previous attempt\n${i.prevReport.summary.trim()}`);
  }
  // the section carries its own heading (`# Workflow skills` or `# Skills`)
  if (i.skillsHint) lines.push(i.skillsHint.startsWith('#') ? i.skillsHint : `# Skills\n${i.skillsHint}`);
  lines.push(
    `# How to work\n1. Write a short plan (3-8 bullet points) as your first message, then execute it.\n2. Stay inside the scope of this task. Do not push, open PRs, deploy or touch anything outside this workspace.\n3. Do not commit; the engine commits for you (Conventional Commits — this task ends as one commit titled after it).\n4. When done, reply with a brief summary: what changed, which checks you ran and their outcome, anything left undone.${i.markitdownHint ? `\n5. ${i.markitdownHint}` : ''}`,
  );
  return lines.join('\n\n');
}

export function summarizeReport(r: { results: { status: string; summary: string }[]; reviewerVerdict: { pass: boolean; blockers: string[]; notes?: string } | null; changedFiles: { path: string }[] }, checks: Check[], workflow?: { mandated: { name: string; invoke: string }[]; used: string[] } | null): string {
  const byId = new Map(checks.map((c) => [c.id, c]));
  const lines: string[] = [];
  if (workflow?.mandated.length) {
    const hit = (n: string) => workflow.used.some((u) => u === n || u.endsWith(`:${n}`));
    lines.push(`Workflow: ${workflow.mandated.map((m) => `${m.invoke} ${hit(m.name) ? '✓' : 'not invoked — invoke it first next time'}`).join('; ')}.`);
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
