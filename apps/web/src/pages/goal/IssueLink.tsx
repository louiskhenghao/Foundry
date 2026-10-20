import type { GoalIssue } from '@foundry/core/browser';
import { Github } from 'lucide-react';

/** "From issue owner/name#12 · title" under the goal title: the GitHub issue the goal was made from (ADR-0052). */
export function IssueLink({ issue }: { issue: GoalIssue | null | undefined }) {
  if (!issue) return null;
  return (
    <div className="text-xs text-zinc-500 flex items-center gap-1 mt-1.5 min-w-0">
      <Github size={12} className="shrink-0" />
      <span className="shrink-0">From issue</span>
      <a href={issue.url} target="_blank" rel="noreferrer" className="text-zinc-300 hover:underline truncate max-w-[24rem]" title={`${issue.repo}#${issue.number}: ${issue.title} (${issue.state} when read)`}>
        {issue.repo}#{issue.number} · {issue.title}
      </a>
    </div>
  );
}
