import type { Task } from '@foundry/core/browser';
import { useMemo, useState } from 'react';
import { api } from '../api.ts';
import { Badge, ConfirmDialog, cn } from '../ui.tsx';

/** Pick where to restart a goal from: one task (plus everything downstream) or all tasks. */
export function RestartDialog({ goalId, tasks, initial, open, onClose, onDone }: { goalId: string; tasks: (Task & { depth?: number })[]; initial?: string | null; open: boolean; onClose: () => void; onDone: () => void }) {
  const [from, setFrom] = useState<string | 'all'>(initial ?? 'all');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ordered = useMemo(() => [...tasks].sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0) || a.createdAt.localeCompare(b.createdAt)), [tasks]);
  const downstream = (id: string) => {
    const set = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const t of tasks) if (!set.has(t.id) && t.dependsOn.some((d) => set.has(d))) (set.add(t.id), (grew = true));
    }
    return set;
  };
  const affected = from === 'all' ? new Set(tasks.map((t) => t.id)) : downstream(from);
  return (
    <ConfirmDialog
      open={open}
      title="Restart goal"
      confirmLabel={`Restart ${affected.size} task${affected.size === 1 ? '' : 's'}`}
      busy={busy}
      onClose={onClose}
      onConfirm={async () => {
        setBusy(true);
        setErr(null);
        try {
          await api.restartGoal(goalId, from === 'all' ? undefined : from);
          onDone();
        } catch (e: any) {
          setErr(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>Restarted tasks go back to pending with a fresh attempt budget. Tasks above the chosen one keep their results; if one of them had failed, it is treated as skipped so the chain can continue. The goal branch keeps the work done so far, so restarted tasks build on it.</p>
      <div className="rounded-md border border-zinc-800 divide-y divide-zinc-800/70 max-h-64 overflow-auto">
        <label className={cn('flex items-center gap-2 px-2 py-1.5 cursor-pointer', from === 'all' && 'bg-emerald-500/5')}>
          <input type="radio" name="from" checked={from === 'all'} onChange={() => setFrom('all')} /> <span>All tasks from the beginning</span>
        </label>
        {ordered.map((t) => (
          <label key={t.id} className={cn('flex items-center gap-2 px-2 py-1.5 cursor-pointer', affected.has(t.id) ? 'bg-emerald-500/5' : '')} style={{ paddingLeft: `${8 + (t.depth ?? 0) * 14}px` }}>
            <input type="radio" name="from" checked={from === t.id} onChange={() => setFrom(t.id)} />
            <Badge state={t.state} />
            <span className={cn('truncate', affected.has(t.id) ? 'text-zinc-100' : 'text-zinc-500')}>{t.title}</span>
            {from === t.id && <span className="ml-auto text-[10px] text-emerald-300 shrink-0">from here ↓</span>}
          </label>
        ))}
      </div>
      {err && <div className="text-rose-300">{err}</div>}
    </ConfirmDialog>
  );
}
