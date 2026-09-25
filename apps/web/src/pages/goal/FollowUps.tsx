import { CornerDownRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type GoalDetail, type GoalRow } from '../../api.ts';
import { Badge, ConfirmDialog, Select } from '../../ui.tsx';

/** "Follows: A" and "Followed by: B, C" under the goal title; a deleted A keeps its title, without a link. */
export function FollowLinks({ d }: { d: GoalDetail }) {
  const f = d.goal.follows ?? null;
  const by = d.followUps?.followedBy ?? [];
  if (!f && !by.length) return null;
  return (
    <div className="text-xs text-zinc-500 flex items-center gap-x-3 gap-y-1 mt-1.5 flex-wrap">
      {f && (
        <span className="inline-flex items-center gap-1 min-w-0">
          <CornerDownRight size={12} className="shrink-0" />
          {d.followUps?.followsExists ? (
            <>
              Follows:{' '}
              <Link to={`/goals/${f.goalId}`} className="text-zinc-300 hover:underline truncate max-w-[18rem]" title={f.title}>
                {f.title}
              </Link>
            </>
          ) : (
            <span className="truncate max-w-[22rem]" title={f.title}>
              follows a deleted goal · {f.title}
            </span>
          )}
        </span>
      )}
      {by.length > 0 && (
        <span className="inline-flex items-center gap-1 flex-wrap min-w-0">
          Followed by:
          {by.map((g, i) => (
            <span key={g.id} className="inline-flex items-center">
              <Link to={`/goals/${g.id}`} className="text-zinc-300 hover:underline truncate max-w-[14rem]" title={g.title}>
                {g.title}
              </Link>
              {i < by.length - 1 && <span>,</span>}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

/** "Mark as follow-up of…": pick an earlier goal of the same repository. Records the relationship only. */
export function MarkFollowUpDialog({ d, open, onClose }: { d: GoalDetail; open: boolean; onClose: () => void }) {
  const g = d.goal;
  const [goals, setGoals] = useState<GoalRow[] | null>(null);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) api.goals().then(setGoals).catch(() => setGoals([]));
  }, [open]);
  const earlier = (goals ?? []).filter((x) => x.id !== g.id && x.repoPath === g.repoPath && x.createdAt < g.createdAt);
  const chosen = earlier.find((x) => x.id === pick);
  return (
    <ConfirmDialog
      open={open}
      title="Mark as follow-up of…"
      confirmLabel="Mark as follow-up"
      busy={busy}
      onClose={onClose}
      onConfirm={async () => {
        if (!pick) return;
        setBusy(true);
        setErr(null);
        try {
          await api.markFollowUp(g.id, pick);
          onClose();
        } catch (e: any) {
          setErr(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>Record that this goal continues an earlier goal of the same repository. Only the link is recorded: no code, branch or Brief changes.</p>
      {goals === null ? (
        <p className="text-zinc-500">Loading…</p>
      ) : earlier.length === 0 ? (
        <p className="text-zinc-500">No earlier goal on this repository.</p>
      ) : (
        <>
          <Select aria-label="Earlier goal" className="w-full" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Choose an earlier goal…</option>
            {earlier.map((x) => (
              <option key={x.id} value={x.id}>
                {x.title} ({x.state.replace('_', ' ')})
              </option>
            ))}
          </Select>
          {chosen && (
            <div className="flex items-center gap-2">
              <Badge state={chosen.state} /> <span className="text-zinc-400 truncate">{chosen.title}</span>
            </div>
          )}
        </>
      )}
      {err && <p className="text-rose-400">{err}</p>}
    </ConfirmDialog>
  );
}
