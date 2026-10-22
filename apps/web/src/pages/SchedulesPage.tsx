import { cadenceLabel } from '@foundry/core/browser';
import { Pencil, Play, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ScheduleRow } from '../api.ts';
import { BOARD_ROW, Button, ConfirmDialog, PageHeader, ago, cn } from '../ui.tsx';
import { BOARD_PANEL, EmptyPanel, PLATE, shortCwd, traitChip } from './agents/rows.tsx';
import { HelpLink } from './HelpPage.tsx';

/** a schedule that fires, as a solid plate of ink (the colour of what Foundry does); one turned off stays a quiet outline */
const ON = 'inline-flex items-center whitespace-nowrap rounded-sm border border-ink bg-ink px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-on-ink';

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
        <EmptyPanel title="No schedules yet.">Fill in the New goal form as usual, then press Schedule… instead of creating the goal.</EmptyPanel>
      ) : (
        // the page's title names the list, so its board has no heading of its own
        <div className={BOARD_PANEL}>
          <ul className="divide-y divide-line">
            {rows.map((s) => (
              <li key={s.id} className={cn(BOARD_ROW, 'px-4 md:px-5 py-4 space-y-2', !s.enabled && 'opacity-70')}>
                <div className="flex items-center gap-x-2.5 gap-y-1.5 flex-wrap">
                  <span className="text-[15px] font-bold text-ink">{s.name}</span>
                  <span className={s.enabled ? ON : PLATE}>{s.enabled ? 'on' : 'off'}</span>
                  {s.autoApprove && <span className={traitChip()}>approves its Briefs</span>}
                  <span className="text-xs text-ink-soft">{cadenceLabel(s.cadence)}</span>
                  <span className="ml-auto flex items-center gap-1">
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
                </div>
                <div className="text-xs text-ink-faint flex items-center gap-x-4 gap-y-1 flex-wrap">
                  <span className="mono min-w-0 max-w-full truncate" title={s.recipe.repoPath}>{shortCwd(s.recipe.repoPath)}</span>
                  <span>next: <span className="text-ink-soft">{nextRunLabel(s.nextRunAt)}</span></span>
                  <span>
                    last: {s.lastGoal ? <Link to={`/goals/${s.lastGoal.id}`} className="font-semibold text-ink hover:underline" title={s.lastGoal.title}>{lastRunLabel(s)}</Link> : <span className="text-ink-soft">{lastRunLabel(s)}</span>}
                  </span>
                  {s.runs > 0 && <span><span className="mono">{s.runs}</span> run{s.runs === 1 ? '' : 's'}</span>}
                </div>
                <div className="text-[13px] text-ink-soft line-clamp-2" title={s.recipe.prompt}>{s.recipe.prompt}</div>
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
