import type { Attachment, GoalIssue } from '@foundry/core/browser';

/** what POST /api/issues/read returns: the issue, the title and description to start from, and its thread as a staged attachment */
export interface IssueRead {
  issue: GoalIssue;
  title: string;
  prompt: string;
  attachment: Attachment;
}

/** the parts of the New goal form an issue fills */
export interface IssueFormState {
  prompt: string;
  title: string;
  attachments: Attachment[];
  /** the issue the form was last filled from, with the text it put in: what the person has not touched since is replaced */
  issue: { read: IssueRead; filled: { prompt: string; title: string } } | null;
}

/**
 * Fill the form from an issue the person just read. The description and title are replaced when they are empty or still
 * what an earlier issue put there; text the person typed is kept, and the thread is attached either way. Reading another
 * issue drops the earlier one's thread.
 */
export function applyIssueRead(form: IssueFormState, read: IssueRead): IssueFormState {
  const keepPrompt = form.prompt.trim() !== '' && form.prompt !== form.issue?.filled.prompt;
  const keepTitle = form.title.trim() !== '' && form.title !== form.issue?.filled.title;
  const prompt = keepPrompt ? form.prompt : read.prompt;
  const title = keepTitle ? form.title : read.title;
  const attachments = [...form.attachments.filter((a) => a.id !== form.issue?.read.attachment.id), read.attachment];
  return { prompt, title, attachments, issue: { read, filled: { prompt, title } } };
}

/** Unlink the issue: its thread leaves the attachments; the description and title stay as they are. */
export function clearIssue(form: IssueFormState): IssueFormState {
  if (!form.issue) return form;
  return { ...form, attachments: form.attachments.filter((a) => a.id !== form.issue!.read.attachment.id), issue: null };
}

/** true when the person kept their own words instead of the issue's (so the form can say the thread is attached anyway) */
export const keptOwnText = (form: IssueFormState): boolean => !!form.issue && form.prompt !== form.issue.read.prompt && form.issue.filled.prompt !== form.issue.read.prompt;
