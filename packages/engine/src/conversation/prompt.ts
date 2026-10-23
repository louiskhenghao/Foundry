/**
 * What the Explainer is told (ADR-0073): where the code and the records are, the goal in short, the question; on a
 * later turn, what happened to the goal since its last answer and the next question; and, when a session could not be
 * resumed, the conversation so far for the fresh one.
 */
import type { ConversationMessage, Goal } from '@foundry/core';
import type { ConversationPlace } from './workspace.ts';
import { RECORDS_DIR } from './workspace.ts';

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** how the records folder is introduced, once per session */
const recordsSection = () =>
  `- Foundry's records of the goal: \`${RECORDS_DIR}/\` in this folder, written for you and refreshed before every answer. Its README.md lists them: goal.md, brief.md (what was understood and planned, the person's Decisions), tasks/<id>.md (each task's spec, attempts, reports and review), timeline.md, escalations.md, review.md, delivery.md, attachments.md, learnings.md and transcripts/ (what each session said and did, in short). Grep them like code; read a task's file and its transcript before you say why something was done.`;

export function openingPrompt(i: { goal: Goal; summary: string; place: ConversationPlace; question: string; history: string | null; memoryBank: string | null }): string {
  return [
    `# A Conversation about the goal "${i.goal.title}"`,
    'The person who owns this goal is asking about it on its page in Foundry. You are its Explainer: you read and explain, and nothing you say changes the goal. Answer the question at the end.',
    [
      '# Where to look',
      i.place.code ? `- The code: ${i.place.note}. It is this folder, your working directory.` : `- The code: ${i.place.note}. Answer from the records.`,
      recordsSection(),
      i.memoryBank ? `- Memory bank \`${i.memoryBank}\`: the hindsight tools (recall, reflect, search_knowledge_base, get_knowledge_page) hold what earlier goals and sessions in this repository did and learned; ask them when the question reaches beyond this goal, passing this bank_id.` : '',
    ].filter(Boolean).join('\n'),
    i.summary,
    i.history ? `# What was said so far\nAn earlier session of yours answered these; the person reads the whole conversation.\n\n${i.history}` : '',
    `# The question\n${i.question.trim()}`,
  ].filter(Boolean).join('\n\n');
}

export function turnPrompt(i: { delta: string[]; question: string }): string {
  const since = i.delta.length ? i.delta.slice(-60).map((l) => `- ${l}`).join('\n') : 'Nothing new happened to the goal.';
  return [`# Since your last answer\n${since}\nThe records in \`${RECORDS_DIR}/\` were refreshed to the goal as it stands.`, `# The next question\n${i.question.trim()}`].join('\n\n');
}

/** the questions and answers so far, for a fresh session; null when there is nothing yet */
export function conversationSoFar(messages: ConversationMessage[]): string | null {
  const said = messages.filter((m) => m.text.trim());
  if (!said.length) return null;
  return said.map((m) => (m.role === 'person' ? `**Person:** ${clip(m.text.trim(), 4_000)}` : `**You${m.status && m.status !== 'done' ? ` (${m.status})` : ''}:** ${clip(m.text.trim(), 6_000)}`)).join('\n\n');
}
