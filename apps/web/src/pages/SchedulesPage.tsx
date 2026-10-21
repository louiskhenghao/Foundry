import { cadenceLabel } from '@foundry/core/browser';
import { AlarmClock, Pencil, Play, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ScheduleRow } from '../api.ts';
import { Badge, Button, ConfirmDialog, Empty, Page, ago, cn } from '../ui.tsx';
import { shortCwd } from './agents/rows.tsx';
import { HelpLink } from './HelpPage.tsx';

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
    <Page width="md">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <h1 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
          <AlarmClock size={18} /> Schedules<HelpLink to="schedules" className="ml-1" />
        </h1>
        <Link to="/goals/new">
          <Button size="sm" variant="primary">New goal → Schedule…</Button>
        </Link>
      </div>
      <p className="text-xs text-zinc-500 mb-4">Goals that run on their own: a saved New goal form that fires every day, week or month, one run at a time. Save one from the New goal form with <span className="text-zinc-300">Schedule…</span>.</p>
      {err && <div className="text-sm text-rose-400 mb-3">{err}</div>}
      {rows === null ? (
        <div className="text-xs text-zinc-500">loading…</div>
      ) : rows.length === 0 ? (
        <Empty>No schedules yet. Fill in the New goal form as usual, then press Schedule… instead of creating the goal.</Empty>
      ) : (
        <div className="rounded-lg border border-zinc-800 divide-y divide-zinc-800/70">
          {rows.map((s) => (
            <div key={s.id} className={cn('p-3 space-y-1.5', !s.enabled && 'opacity-70')}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-zinc-100 font-medium">{s.name}</span>
                <Badge state={s.enabled ? 'running' : 'cancelled'}>{s.enabled ? 'on' : 'off'}</Badge>
                {s.autoApprove && <span className="text-[10px] rounded-full border border-emerald-900 text-emerald-300 px-1.5 py-px">approves its Briefs</span>}
                <span className="text-xs text-zinc-500">{cadenceLabel(s.cadence)}</span>
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
              <div className="text-xs text-zinc-400 flex items-center gap-x-4 gap-y-1 flex-wrap">
                <span className="mono text-zinc-500" title={s.recipe.repoPath}>{shortCwd(s.recipe.repoPath)}</span>
                <span>next: {nextRunLabel(s.nextRunAt)}</span>
                <span>
                  last: {s.lastGoal ? <Link to={`/goals/${s.lastGoal.id}`} className="text-zinc-200 hover:underline" title={s.lastGoal.title}>{lastRunLabel(s)}</Link> : lastRunLabel(s)}
                </span>
                {s.runs > 0 && <span className="text-zinc-600">{s.runs} run{s.runs === 1 ? '' : 's'}</span>}
              </div>
              <div className="text-xs text-zinc-500 line-clamp-2" title={s.recipe.prompt}>{s.recipe.prompt}</div>
            </div>
          ))}
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
        <p className="text-sm text-zinc-300">It will not fire again. The goals it made stay as they are.</p>
      </ConfirmDialog>
    </Page>
  );
}
