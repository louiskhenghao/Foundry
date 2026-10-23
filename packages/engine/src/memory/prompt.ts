import type { MemoryStage } from './types.ts';

export const MEMORY_HEADING = '# What Memory recalls';

/**
 * The section a session gets when the folder's memory answered (ADR-0071), beside the Learnings notebook. A worker is
 * also told its bank, since it has the hindsight tools and may ask more mid-way; read-only roles only get the text.
 */
export function memorySection(text: string, opts: { bankId: string; tools: boolean }): string {
  return [
    MEMORY_HEADING,
    "From this repository's long-term memory — what earlier goals and sessions here did, learned and were refused. A starting point, not the truth: where the code says otherwise, the code wins.",
    text.trim(),
    opts.tools ? `Memory bank: \`${opts.bankId}\`. The hindsight tools answer more when asked — recall for memories, reflect for an answer; pass this bank_id with every call.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** what each stage asks the bank, in the words the server reflects on */
export function memoryQuestion(stage: MemoryStage, i: { goalTitle: string; goalPrompt?: string; taskTitle?: string; taskSpec?: string; area?: string | null; files?: string[] }): string {
  const files = i.files?.length ? ` It touches ${i.files.slice(0, 12).join(', ')}.` : '';
  switch (stage) {
    case 'attempt':
      return `Before working on the task "${i.taskTitle}"${i.area ? ` (area: ${i.area})` : ''} of the goal "${i.goalTitle}" in this repository: what earlier work here says about this kind of change — the conventions it must follow, the pitfalls met, how it was built and tested, what reviews refused.${files} The task: ${clip(i.taskSpec ?? '', 600)}`;
    case 'clarify':
      return `A new goal in this repository: "${i.goalTitle}". ${clip(i.goalPrompt ?? '', 800)} What should be known before understanding and planning it: how similar goals went here, where their Briefs had to be corrected, which decisions were later reversed, what plans failed and why.`;
    case 'plan':
      return `Planning the goal "${i.goalTitle}" in this repository: ${clip(i.goalPrompt ?? '', 600)} What earlier plans here taught — how work in these areas was best split, which tasks failed or had to be replanned, what a task tends to forget.`;
    case 'replan':
      return `Replanning the remaining tasks of the goal "${i.goalTitle}" after "${i.taskTitle}" landed in this repository: what earlier work here says about what follows from such a change, and what replans here taught.`;
    case 'review_task':
      return `Reviewing the task "${i.taskTitle}" of the goal "${i.goalTitle}" in this repository.${files} What earlier reviews here refused or required for this kind of change, and what tends to break in these files.`;
    case 'review_goal':
      return `Reviewing the finished goal "${i.goalTitle}" in this repository as a whole: what earlier goal reviews here found, which acceptance checks were missed before, and what the person expects of work in this repository.`;
  }
}
