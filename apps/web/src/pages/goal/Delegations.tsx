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
    <div className="text-xs text-zinc-500 flex items-center gap-x-3 gap-y-1 mt-1.5 flex-wrap">
      {from && (
        <span className="inline-flex items-center gap-1 min-w-0">
          <CornerDownRight size={12} className="shrink-0" />
          {d.delegations?.fromExists ? (
            <>
              Delegated from:{' '}
              <Link to={`/goals/${from.goalId}?task=${from.taskId}#tasks`} className="text-zinc-300 hover:underline truncate max-w-[18rem]" title={from.title}>
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
              <Link to={`/goals/${g.id}`} className="text-zinc-300 hover:underline truncate max-w-[14rem]" title={g.title}>
                {g.title}
              </Link>
              <Badge state={g.state} />
              {i < goals.length - 1 && <span>,</span>}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
