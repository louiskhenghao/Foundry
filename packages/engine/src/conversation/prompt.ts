/**
 * What the Explainer is told (ADR-0073): where the code and the records are, the goal in short, the question; on a
 * later turn, what happened to the goal since its last answer and the next question; and, when a session could not be
 * resumed, the conversation so far for the fresh one.
 */
import type { ConversationMessage, Goal } from '@foundry/core';
import { attachmentKindLabel } from '@foundry/core';
import type { ConversationPlace } from './workspace.ts';
import { RECORDS_DIR } from './workspace.ts';

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** where a question's attachments are put for the session: under the records, by the question's id */
export const questionFilesDir = (messageId: string) => `${RECORDS_DIR}/asked/${messageId}`;

/** one line per attachment of a question: its path in the folder (or the link), what it is, and a rendition when there is one */
export function attachedLines(m: Pick<ConversationMessage, 'id' | 'attachments'>): string[] {
  return (m.attachments ?? []).map((a) => {
    const rendition = a.markdown?.status === 'ready' ? ` — a markdown rendition beside it: \`${questionFilesDir(m.id)}/${a.kind === 'link' ? 'snapshot.md' : `${a.name}.md`}\`` : '';
    if (a.kind === 'link') return `- link ${a.url} (id ${a.id})${a.note ? ` (${a.note})` : ''}${rendition}`;
    const size = a.size != null ? `, ${a.size >= 1_048_576 ? `${(a.size / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(a.size / 1024))} KB`}` : '';
    return `- \`${questionFilesDir(m.id)}/${a.name}\` (${attachmentKindLabel(a)}${size}; id ${a.id})${a.note ? ` — ${a.note}` : ''}${rendition}`;
  });
}

/** the section of a prompt about what the person attached to the question, when they did */
const attachedSection = (m: Pick<ConversationMessage, 'id' | 'attachments'>): string => {
  const lines = attachedLines(m);
  return lines.length ? `## Attached to this question\nThe person put these on the question; open them with your file-reading tool before you answer (a picture is shown to you by it):\n${lines.join('\n')}` : '';
};

/** how the records folder is introduced, once per session */
const recordsSection = () =>
  `- Foundry's records of the goal: \`${RECORDS_DIR}/\` in this folder, written for you and refreshed before every answer. Its README.md lists them: goal.md, brief.md (what was understood and planned, the person's Decisions), tasks/<id>.md (each task's spec, attempts, reports and review), timeline.md, escalations.md, materials.md (what the person promised to provide, with keys, and the open Requests, with ids), review.md, delivery.md, attachments.md, learnings.md and transcripts/ (what each session said and did, in short). Grep them like code; read a task's file and its transcript before you say why something was done.`;

export function openingPrompt(i: { goal: Goal; summary: string; place: ConversationPlace; question: string; /** the question itself, for what is attached to it */ asked?: Pick<ConversationMessage, 'id' | 'attachments'>; history: string | null; memoryBank: string | null }): string {
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
    i.asked ? attachedSection(i.asked) : '',
  ].filter(Boolean).join('\n\n');
}

export function turnPrompt(i: { delta: string[]; question: string; asked?: Pick<ConversationMessage, 'id' | 'attachments'> }): string {
  const since = i.delta.length ? i.delta.slice(-60).map((l) => `- ${l}`).join('\n') : 'Nothing new happened to the goal.';
  return [`# Since your last answer\n${since}\nThe records in \`${RECORDS_DIR}/\` were refreshed to the goal as it stands.`, `# The next question\n${i.question.trim()}`, i.asked ? attachedSection(i.asked) : ''].filter(Boolean).join('\n\n');
}

/** the questions and answers so far, for a fresh session; null when there is nothing yet */
export function conversationSoFar(messages: ConversationMessage[]): string | null {
  const said = messages.filter((m) => m.text.trim());
  if (!said.length) return null;
  return said.map((m) => (m.role === 'person' ? `**Person:** ${clip(m.text.trim(), 4_000)}${m.attachments?.length ? `\nAttached:\n${attachedLines(m).join('\n')}` : ''}` : `**You${m.status && m.status !== 'done' ? ` (${m.status})` : ''}:** ${clip(m.text.trim(), 6_000)}`)).join('\n\n');
}
