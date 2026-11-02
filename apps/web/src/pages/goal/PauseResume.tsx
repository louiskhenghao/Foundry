import { reportsDollars } from '@foundry/core/browser';
import type { GoalState } from '@foundry/core/browser';
import { useEffect, useState } from 'react';
import { api, type GoalDetail } from '../../api.ts';
import { ConfirmDialog, Input, Textarea } from '../../ui.tsx';

/**
 * Pause… on a goal at work (ADR-0080). A running goal pauses gently by default: nothing more starts and it is paused once
 * the running tasks have landed; Stop now stops their sessions instead, and Resume… takes each up where it was. A Clarify
 * is always stopped now and runs again on Resume.
 */
export function PauseDialog({ goalId, state, running, open, onClose }: { goalId: string; state: GoalState; /** tasks running now */ running: number; open: boolean; onClose: () => void }) {
  const [now, setNow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const clarifying = state === 'clarifying';
  useEffect(() => {
    if (open) {
      setNow(false);
      setErr(null);
    }
  }, [open]);
  const pause = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.pauseGoal(goalId, { now: clarifying || now });
      onClose();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <ConfirmDialog open={open} title="Pause the goal" confirmLabel={clarifying || now ? 'Pause now' : 'Pause'} busy={busy} onClose={onClose} onConfirm={() => void pause()}>
      {clarifying ? (
        <p>The Clarify session is stopped. Resume… runs Clarify again from the start; what you answered so far is kept.</p>
      ) : (
        <>
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="radio" name="pause" className="mt-0.5" checked={!now} onChange={() => setNow(false)} />
            <span>
              <b className="text-ink">Let the running work land first.</b> Nothing more starts; {running ? `the ${running} running task${running === 1 ? '' : 's'} finish${running === 1 ? 'es' : ''} and land${running === 1 ? 's' : ''}` : 'the goal is paused as soon as nothing is in flight'}.
            </span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="radio" name="pause" className="mt-0.5" checked={now} onChange={() => setNow(true)} />
            <span>
              <b className="text-ink">Stop now.</b> The running sessions are stopped and what they did so far is kept; Resume… takes each session up where it was.
            </span>
          </label>
          <p className="text-ink-faint">While it is paused the clock stops. Resume… takes the goal on from here.</p>
        </>
      )}
      {err && <p className="text-bad-ink">{err}</p>}
    </ConfirmDialog>
  );
}

/**
 * Resume… on a paused, cancelled, failed or blocked goal (ADR-0080): what will happen to its tasks, a word for the
 * remaining ones, and higher limits when the budget held it (without more it would stop again at once).
 */
export function ResumeDialog({ d, open, onClose }: { d: GoalDetail; open: boolean; onClose: () => void }) {
  const g = d.goal;
  const b = d.budget;
  const exceeded = !!b.exceeded;
  const dollars = reportsDollars(g.provider);
  const [hint, setHint] = useState('');
  const [raise, setRaise] = useState(exceeded);
  const [cost, setCost] = useState('');
  const [mins, setMins] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setHint('');
    setRaise(exceeded);
    // the limits doubled, as Raise budget in the Inbox proposes
    setCost(b.maxCostUsd != null ? String(b.maxCostUsd * 2) : '');
    setMins(b.maxDurationMin != null ? String(b.maxDurationMin * 2) : '');
    setErr(null);
  }, [open]);
  const done = d.tasks.filter((t) => t.state === 'done').length;
  const goOn = d.tasks.filter((t) => t.state === 'pending' || t.state === 'ready').length;
  const again = d.tasks.filter((t) => ['failed', 'blocked', 'merging', 'running', 'observing'].includes(t.state)).length;
  const resume = async () => {
    setBusy(true);
    setErr(null);
    try {
      const budgets = raise ? { ...(dollars && cost.trim() ? { maxCostUsd: Number(cost) } : {}), ...(mins.trim() ? { maxDurationMin: Number(mins) } : {}) } : undefined;
      await api.resumeGoal(g.id, { hint: hint.trim() || null, ...(budgets && Object.keys(budgets).length ? { budgets } : {}) });
      onClose();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <ConfirmDialog open={open} title="Resume the goal" confirmLabel="Resume" busy={busy} onClose={onClose} onConfirm={() => void resume()}>
      <p>{g.state === 'paused' ? (g.pausedFrom === 'clarifying' ? 'Clarify runs again from the start.' : 'It goes on from where it was paused; a stopped session takes up where it was.') : 'It goes on from where it stopped, on the same branch.'}</p>
      {d.tasks.length > 0 && (
        <ul className="list-disc pl-4 space-y-0.5">
          {done > 0 && (
            <li>
              {done} task{done === 1 ? '' : 's'} done stay{done === 1 ? 's' : ''} done.
            </li>
          )}
          {goOn > 0 && (
            <li>
              {goOn} not started yet run{goOn === 1 ? 's' : ''}.
            </li>
          )}
          {again > 0 && (
            <li>
              {again} that failed, waited for you or {again === 1 ? 'was' : 'were'} cut short run{again === 1 ? 's' : ''} again, with one more attempt.
            </li>
          )}
        </ul>
      )}
      <label className="block">
        <span className="mb-1 block font-semibold text-ink-soft">A word for the remaining tasks (optional)</span>
        <Textarea rows={2} value={hint} onChange={(e) => setHint(e.target.value)} placeholder="e.g. use the helper the first tasks added; leave the docs for later" />
      </label>
      {exceeded && (
        <div className="space-y-1.5 rounded-md border border-you/50 bg-you/10 p-2.5">
          <p className="font-semibold text-ink">
            {b.exceeded === 'cost' ? `Its budget is used up: $${b.costUsd.toFixed(2)} of $${(b.maxCostUsd ?? 0).toFixed(2)}.` : `Its time is used up: ${Math.round(b.elapsedMin)} of ${b.maxDurationMin} min.`} Without more it stops again at once.
          </p>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={raise} onChange={(e) => setRaise(e.target.checked)} /> Raise the limits to
          </label>
          {raise && (
            <div className="flex flex-wrap gap-2">
              {dollars && b.maxCostUsd != null && (
                <label className="flex items-center gap-1.5">
                  <span className="text-ink-faint">$</span>
                  <Input type="number" min={1} step={1} className="w-24" value={cost} onChange={(e) => setCost(e.target.value)} aria-label="Max cost (USD)" />
                </label>
              )}
              {b.maxDurationMin != null && (
                <label className="flex items-center gap-1.5">
                  <Input type="number" min={5} step={5} className="w-24" value={mins} onChange={(e) => setMins(e.target.value)} aria-label="Max time (minutes)" />
                  <span className="text-ink-faint">min</span>
                </label>
              )}
            </div>
          )}
        </div>
      )}
      {err && <p className="text-bad-ink">{err}</p>}
    </ConfirmDialog>
  );
}
