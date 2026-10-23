import type { MemoryStage } from './types.ts';

export const MEMORY_HEADING = '# What Memory recalls';

/**
 * The section a session gets when the folder's memory answered (ADR-0071), beside the Learnings notebook. A worker that
 * has the hindsight tools is also told its bank, so it may ask more mid-way; read-only roles only get the text.
 */
export function memorySection(text: string, opts: ({ tools: false } | { tools: true; bankId: string }) & { about?: 'person'; kind?: 'reflect' | 'recall' }): string {
  // the memories themselves, when the bank's answer did not come in time: facts, not a synthesis
  const plain = opts.kind === 'recall';
  if (opts.about === 'person') {
    return [
      `${MEMORY_HEADING} about the person`,
      plain
        ? 'The memories themselves of what this person decided, answered and asked for across every repository they had work done in (the memory could not sum them up in time). A starting point for how to understand and plan this goal for them; what they say in this goal\'s own Decisions and answers comes first.'
        : "From the memory of what this person decided, answered and asked for across every repository they had work done in. A starting point for how to understand and plan this goal for them; what they say in this goal's own Decisions and answers comes first.",
      text.trim(),
    ].join('\n');
  }
  return [
    MEMORY_HEADING,
    plain
      ? "The memories themselves from this repository's long-term memory that bear on this — what earlier goals and sessions here did, learned and were refused (the memory could not sum them up in time). A starting point, not the truth: where the code says otherwise, the code wins."
      : "From this repository's long-term memory — what earlier goals and sessions here did, learned and were refused. A starting point, not the truth: where the code says otherwise, the code wins.",
    text.trim(),
    opts.tools ? `Memory bank: \`${opts.bankId}\`. The hindsight tools answer more when asked — search_knowledge_base and get_knowledge_page for the repository's pages, recall for memories, reflect for an answer; pass this bank_id with every call.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** what each stage asks the bank, in the words the server reflects on; Clarify's answer serves the planner too */
export function memoryQuestion(stage: MemoryStage, i: { goalTitle: string; goalPrompt?: string; taskTitle?: string; taskSpec?: string; area?: string | null; files?: string[] }): string {
  const files = i.files?.length ? ` It touches ${i.files.slice(0, 12).join(', ')}.` : '';
  switch (stage) {
    case 'attempt':
      return `Before working on the task "${i.taskTitle}"${i.area ? ` (area: ${i.area})` : ''} of the goal "${i.goalTitle}" in this repository: what earlier work here says about this kind of change — the conventions it must follow, the pitfalls met, how it was built and tested, what reviews refused.${files} The task: ${clip(i.taskSpec ?? '', 600)}`;
    case 'clarify':
      return `A new goal in this repository: "${i.goalTitle}". ${clip(i.goalPrompt ?? '', 800)} What should be known before understanding and planning it: how similar goals went here, where their Briefs had to be corrected, which decisions were later reversed, how work in these areas was best split, what plans failed and why.`;
    case 'person':
      return `What this person wants of work done for them, whatever the repository — how they decide when asked, what they refuse, what they ask for again and again, how they like work done and reported — as it bears on a new goal of theirs, "${i.goalTitle}": ${clip(i.goalPrompt ?? '', 400)}`;
    case 'replan':
      return `Replanning the remaining tasks of the goal "${i.goalTitle}" after "${i.taskTitle}" landed in this repository: what earlier work here says about what follows from such a change, and what replans here taught.`;
    case 'review_task':
      return `Reviewing the task "${i.taskTitle}" of the goal "${i.goalTitle}" in this repository.${files} What earlier reviews here refused or required for this kind of change, and what tends to break in these files.`;
    case 'review_goal':
      return `Reviewing the finished goal "${i.goalTitle}" in this repository as a whole: what earlier goal reviews here found, which acceptance checks were missed before, and what the person expects of work in this repository.`;
  }
}
