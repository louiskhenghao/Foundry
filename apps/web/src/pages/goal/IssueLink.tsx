import type { GoalIssue, GoalSchedule } from '@foundry/core/browser';
import { AlarmClock, Github } from 'lucide-react';
import { Link } from 'react-router-dom';

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

/** "From schedule: name · when" under the goal title: the Schedule the goal is a run of (ADR-0054). */
export function ScheduleLink({ schedule }: { schedule: GoalSchedule | null | undefined }) {
  if (!schedule) return null;
  return (
    <div className="text-xs text-zinc-500 flex items-center gap-1 mt-1.5 min-w-0">
      <AlarmClock size={12} className="shrink-0" />
      <span className="shrink-0">From schedule</span>
      <Link to="/schedules" className="text-zinc-300 hover:underline truncate max-w-[24rem]" title={`fired ${schedule.at.slice(0, 16).replace('T', ' ')}${schedule.autoApprove ? '; the engine approves its Brief' : ''}`}>
        {schedule.name}
      </Link>
      {schedule.autoApprove && <span className="text-zinc-600">· Brief approved by the engine</span>}
    </div>
  );
}
