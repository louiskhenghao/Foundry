import { cadenceLabel } from '@foundry/core/browser';
import { CalendarClock, Pencil, Play, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ScheduleRow } from '../api.ts';
import { BOARD_ROW, Button, ConfirmDialog, EmptyState, PageHeader, ago, cn, code } from '../ui.tsx';
import { STATE_INK, stateDot, statePlate, type Tone } from './agents/marks.ts';
import { BOARD_PANEL, shortCwd } from './agents/rows.tsx';
import { HelpLink } from './HelpPage.tsx';

/** a schedule that approves its own Briefs: a trait, in the category green it had before themes */
const AUTO = cn('inline-flex items-center whitespace-nowrap rounded-sm px-1.5 py-px text-[11px] font-semibold leading-tight', code(1).chip);

/**
 * What the last run came to, as its goal stands: done green, failed red, waiting for you (a Brief to approve, a result
 * to look at, a block) yellow, still at work blue; cancelled, skipped or gone is no signal.
 */
function lastTone(s: Pick<ScheduleRow, 'lastRun' | 'lastGoal'>): Tone {
  const state = s.lastRun && !s.lastRun.skipped ? s.lastGoal?.state : undefined;
  if (!state || state === 'cancelled' || state === 'draft') return 'none';
  if (state === 'done' || state === 'over_delivered') return 'ok';
  if (state === 'failed') return 'bad';
  if (state === 'awaiting_brief_approval' || state === 'awaiting_feedback' || state === 'blocked') return 'you';
  return 'work';
}

/** when a schedule fires next, as this computer shows times; a disabled one has no next run */
export function nextRunLabel(iso: string | null, now = new Date()): string {
  if (!iso) return 'off';
  const d = new Date(iso);
  const ms = d.getTime() - now.getTime();
  const when = d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  if (ms <= 60_000) return `now (${when})`;
  const h = Math.round(ms / 3_600_000);
  return h < 48 ? `in ${h < 1 ? `${Math.round(ms / 60_000)} min` : `${h} h`} (${when})` : `in ${Math.round(h / 24)} days (${when})`;
}

/** what the last firing came to, in a few words */
export function lastRunLabel(s: Pick<ScheduleRow, 'lastRun' | 'lastGoal'>): string {
  if (!s.lastRun) return 'never ran';
  if (s.lastRun.skipped) return `skipped ${ago(s.lastRun.at)}: ${s.lastRun.skipped}`;
  if (s.lastGoal) return `${ago(s.lastRun.at)}: ${s.lastGoal.state.replace(/_/g, ' ')}`;
  return `${ago(s.lastRun.at)} (the goal was deleted)`;
}

/** The Schedules page (ADR-0054): every schedule, when it fires next, what its last run came to, and the buttons for it. */
export function SchedulesPage() {
  const [rows, setRows] = useState<ScheduleRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [del, setDel] = useState<ScheduleRow | null>(null);
  const load = () => api.schedules().then((r) => setRows(r.schedules)).catch((e) => setErr(e.message));
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, []);
  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setErr(null);
    try {
      await fn();
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 pt-6 md:pt-9 pb-16 space-y-4">
      <PageHeader
        title="Schedules"
        help={<HelpLink to="schedules" />}
        summary={
          <>
            Goals that run on their own: a saved New goal form that fires every day, week or month, one run at a time. Save one from the New goal form with <span className="font-semibold text-ink-soft">Schedule…</span>.
          </>
        }
        actions={
          <Link to="/goals/new">
            <Button size="sm" variant="primary">New goal → Schedule…</Button>
          </Link>
        }
      />
      {err && <div className="text-sm text-bad-ink">{err}</div>}
      {rows === null ? (
        <div className="text-xs text-ink-faint">loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={CalendarClock} title="No schedules yet">
          Fill in the New goal form as usual, then press Schedule… instead of creating the goal.
        </EmptyState>
      ) : (
        // the page's title names the list, so its board has no heading of its own
        <div className={BOARD_PANEL}>
          <ul className="divide-y divide-line">
            {rows.map((s) => (
              // what it is on the left, its buttons in a column of their own on the right; under it all on a phone
              <li key={s.id} className={cn(BOARD_ROW, 'px-4 md:px-5 py-4 flex flex-col sm:flex-row sm:items-start gap-x-6 gap-y-3', !s.enabled && 'opacity-70')}>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-x-2.5 gap-y-1.5 flex-wrap">
                    <span className="min-w-0 break-words text-[15px] font-bold text-ink">{s.name}</span>
                    {/* on: it fires by itself (at work, blue); off: hollow */}
                    <span className={statePlate(s.enabled ? 'work' : 'none')}>{s.enabled ? 'on' : 'off'}</span>
                    {s.autoApprove && <span className={AUTO}>approves its Briefs</span>}
                    <span className="text-xs text-ink-soft">{cadenceLabel(s.cadence)}</span>
                  </div>
                  <div className="text-xs text-ink-faint flex items-center gap-x-4 gap-y-1 flex-wrap">
                    <span className="mono min-w-0 max-w-full truncate" title={s.recipe.repoPath}>{shortCwd(s.recipe.repoPath)}</span>
                    <span>next: <span className="text-ink-soft">{nextRunLabel(s.nextRunAt)}</span></span>
                    <span className="inline-flex items-center gap-1.5">
                      last: {s.lastRun && <span className={stateDot(lastTone(s))} />}
                      {s.lastGoal ? <Link to={`/goals/${s.lastGoal.id}`} className={cn('font-semibold hover:underline', lastTone(s) === 'none' ? 'text-ink' : STATE_INK[lastTone(s)])} title={s.lastGoal.title}>{lastRunLabel(s)}</Link> : <span className="text-ink-soft">{lastRunLabel(s)}</span>}
                    </span>
                    {s.runs > 0 && <span><span className="mono">{s.runs}</span> run{s.runs === 1 ? '' : 's'}</span>}
                  </div>
                  <div className="text-[13px] text-ink-soft line-clamp-2" title={s.recipe.prompt}>{s.recipe.prompt}</div>
                </div>
                <span className="flex flex-wrap items-center gap-1 shrink-0 -ml-2.5 sm:ml-0">
                  <Button size="sm" variant="ghost" disabled={busy === s.id} onClick={() => act(s.id, () => api.runSchedule(s.id))} title="Fire it now: one goal from the recipe (refused while its previous run is still going)">
                    <Play size={12} /> Run now
                  </Button>
                  <Link to={`/goals/new?schedule=${s.id}`}>
                    <Button size="sm" variant="ghost" title="Open the New goal form filled with this schedule's recipe; Save schedule writes it back">
                      <Pencil size={12} /> Edit
                    </Button>
                  </Link>
                  <Button size="sm" variant="ghost" disabled={busy === s.id} onClick={() => act(s.id, () => api.setScheduleEnabled(s.id, !s.enabled))} title={s.enabled ? 'Stop it from firing; the recipe stays' : 'Let it fire again, counting from now'}>
                    {s.enabled ? 'Turn off' : 'Turn on'}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy === s.id} onClick={() => setDel(s)} title="Delete the schedule; the goals it made stay">
                    <Trash2 size={12} />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ConfirmDialog
        open={!!del}
        title={`Delete schedule "${del?.name}"?`}
        confirmLabel="Delete schedule"
        danger
        busy={busy === del?.id}
        onClose={() => setDel(null)}
        onConfirm={async () => {
          if (!del) return;
          await act(del.id, () => api.deleteSchedule(del.id));
          setDel(null);
        }}
      >
        <p className="text-sm text-ink-soft">It will not fire again. The goals it made stay as they are.</p>
      </ConfirmDialog>
    </div>
  );
}
