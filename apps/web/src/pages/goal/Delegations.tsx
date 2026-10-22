import { CornerDownRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { GoalDetail } from '../../api.ts';
import { Badge } from '../../ui.tsx';

/**
 * "Delegated from: M" under a Delegated goal's title (a link to the main goal's task), and "Delegated goals: A, B" under
 * a main goal's; a deleted main goal keeps its title, without a link.
 */
export function DelegationLinks({ d }: { d: GoalDetail }) {
  const from = d.goal.delegatedFrom ?? null;
  const goals = d.delegations?.goals ?? [];
  if (!from && !goals.length) return null;
  return (
    <div className="text-xs text-ink-faint flex items-center gap-x-3 gap-y-1 mt-1.5 flex-wrap">
      {from && (
        <span className="inline-flex items-center gap-1 min-w-0">
          <CornerDownRight size={12} className="shrink-0 text-extra-ink" />
          {d.delegations?.fromExists ? (
            <>
              Delegated from:{' '}
              <Link to={`/goals/${from.goalId}?task=${from.taskId}#tasks`} className="font-semibold text-ink-soft hover:text-ink hover:underline truncate max-w-[18rem]" title={from.title}>
                {from.title}
              </Link>
            </>
          ) : (
            <span className="truncate max-w-[22rem]" title={from.title}>
              delegated from a deleted goal · {from.title}
            </span>
          )}
        </span>
      )}
      {goals.length > 0 && (
        <span className="inline-flex items-center gap-1 flex-wrap min-w-0">
          Delegated goals:
          {goals.map((g, i) => (
            <span key={g.id} className="inline-flex items-center gap-1">
              <Link to={`/goals/${g.id}`} className="font-semibold text-ink-soft hover:text-ink hover:underline truncate max-w-[14rem]" title={g.title}>
                {g.title}
              </Link>
              <Badge state={g.state} />
              {g.repoPath && g.repoPath !== d.goal.repoPath && (
                <span className="mono text-[11px] text-ink-faint" title={`works in the companion repository ${g.repoPath}`}>
                  in {g.repoPath.split('/').pop()}
                </span>
              )}
              {i < goals.length - 1 && <span>,</span>}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

/**
 * The companions' deliveries on the Delivery tab (ADR-0063): each companion repository's delegated goal, how its own
 * delivery stands and its pull request, with a link to that goal, where it can be re-checked, resumed or reverted.
 */
export function CompanionDeliveries({ d }: { d: GoalDetail }) {
  const mine = (d.delegations?.goals ?? []).filter((g) => g.repoPath && g.repoPath !== d.goal.repoPath);
  if (!mine.length) return null;
  return (
    <div className="mt-3 rounded-lg border border-line bg-sunken p-3 text-xs space-y-1.5">
      <div className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink">Companion repositories</div>
      <p className="text-[11px] text-ink-faint">Each is delivered with this goal, the same way, by its delegated goal; its pull request is its own.</p>
      <ul className="space-y-1">
        {mine.map((g) => (
          <li key={g.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="mono font-semibold text-ink" title={g.repoPath}>{g.repoPath!.split('/').pop()}</span>
            <Badge state={g.state} />
            {g.delivery && <span className="text-ink-soft">delivery: {g.delivery.status}{g.delivery.outcome ? ` · ${g.delivery.outcome.replace('_', ' ')}` : ''}</span>}
            {g.delivery?.pr && (
              <a className="mono font-semibold text-work-ink hover:underline" href={g.delivery.pr.url} target="_blank" rel="noreferrer">
                PR #{g.delivery.pr.number}
              </a>
            )}
            <Link to={`/goals/${g.id}#delivery`} className="font-semibold text-ink-soft hover:text-ink hover:underline">its goal →</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
