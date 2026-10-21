import type { DeliveryRevert, Goal } from '@foundry/core/browser';
import { ExternalLink, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type RevertInfo } from '../../api.ts';
import { Badge, Button, ConfirmDialog, Textarea, ago, cn } from '../../ui.tsx';

/** what each state of a Revert is called on the Delivery tab (ADR-0059) */
export const REVERT_STATUS: Record<DeliveryRevert['status'], { label: string; state: 'running' | 'pending' | 'done' | 'cancelled' | 'failed' }> = {
  running: { label: 'reverting…', state: 'running' },
  open: { label: 'revert PR open', state: 'pending' },
  armed: { label: 'revert auto-merge armed', state: 'pending' },
  merged: { label: 'reverted', state: 'done' },
  closed: { label: 'revert PR closed', state: 'cancelled' },
  failed: { label: 'revert failed', state: 'failed' },
};

/** The Reverts of a delivery, oldest first: how each went, its pull request, what it undoes and why. */
export function RevertRows({ reverts }: { reverts: DeliveryRevert[] }) {
  if (!reverts.length) return null;
  return (
    <ul className="space-y-1.5 text-xs">
      {reverts.map((r) => {
        const s = REVERT_STATUS[r.status];
        return (
          <li key={r.id} className="rounded-md border border-zinc-800 bg-zinc-950/40 p-2.5 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Undo2 size={13} className="text-zinc-500" />
              <Badge state={s.state}>{s.label}</Badge>
              {r.pr && (
                <a className="underline text-sky-300 flex items-center gap-1" href={r.pr.url} target="_blank" rel="noreferrer">
                  <ExternalLink size={12} /> PR #{r.pr.number}
                </a>
              )}
              {r.mergedRef && <span className="mono text-zinc-500">merged {r.mergedRef.slice(0, 7)}</span>}
              <span className="text-zinc-500 ml-auto" title={r.finishedAt ?? r.at}>{ago(r.finishedAt ?? r.at)}</span>
            </div>
            <div className="text-zinc-400">
              Undoes the merge{r.reverts.length === 1 ? '' : 's'} of {r.reverts.map((m) => (m.prNumber != null ? `#${m.prNumber}` : m.ref.slice(0, 7))).join(', ')}
              {r.reason && (
                <>
                  {' — '}
                  <span className="text-zinc-300">{r.reason}</span>
                </>
              )}
            </div>
            {r.detail && <div className={cn('break-words', r.status === 'failed' ? 'text-rose-300' : 'text-zinc-500')}>{r.detail}</div>}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Revert… under a merged delivery (ADR-0059): the reverts so far, and the dialog that says what a new one would undo,
 * asks why, and whether to merge its pull request right away.
 */
export function RevertSection({ goal, busy }: { goal: Goal; busy?: boolean }) {
  const d = goal.delivery;
  const [info, setInfo] = useState<RevertInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [merge, setMerge] = useState(d.policy.mode === 'pr-automerge');
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const statuses = d.reverts.map((r) => r.status).join(',');
  useEffect(() => {
    if (d.outcome !== 'merged') return;
    api.revertInfo(goal.id).then(setInfo).catch((e) => setErr(e.message));
  }, [goal.id, d.outcome, statuses]);
  if (d.outcome !== 'merged') return null;
  const n = info?.reverts.length ?? 0;
  const go = async () => {
    setWorking(true);
    setErr(null);
    try {
      await api.revert(goal.id, reason, merge);
      setOpen(false);
      setReason('');
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setWorking(false);
    }
  };
  return (
    <div className="mt-3 space-y-2">
      <RevertRows reverts={d.reverts} />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Button size="sm" variant="ghost" disabled={busy || working || !info?.ok} onClick={() => setOpen(true)} title={info?.ok ? "Open a pull request that undoes this goal's merge" : (info?.why ?? 'checking what a revert would undo…')}>
          <Undo2 size={13} /> Revert…
        </Button>
        {info && !info.ok && info.why && <span className="text-zinc-500">{info.why}</span>}
        {err && <span className="text-rose-300">{err}</span>}
      </div>
      {info && (
        <ConfirmDialog open={open} title="Revert this goal?" confirmLabel={merge ? 'Open the revert PR and merge it' : 'Open the revert PR'} danger busy={working} onConfirm={() => void go()} onClose={() => setOpen(false)}>
          <p className="text-sm text-zinc-300">
            Foundry starts a branch from <span className="mono">{info.remote}/{info.base}</span>, undoes {n === 1 ? 'the merge of its pull request' : `the merges of its ${n} pull requests, newest first`} with one commit each, pushes it and opens a pull request:
          </p>
          <ul className="text-xs text-zinc-400 space-y-0.5">
            {info.reverts.map((r) => (
              <li key={r.ref}>
                <span className="text-zinc-200">{r.prNumber != null ? `#${r.prNumber}` : 'merge'}</span> {r.title} <span className="mono text-zinc-500">{r.ref.slice(0, 7)}</span>
              </li>
            ))}
          </ul>
          <label className="block text-xs text-zinc-400">
            Why? <span className="text-zinc-500">(it goes into the pull request)</span>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="What went wrong" className="mt-1" />
          </label>
          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input type="checkbox" className="accent-emerald-500" checked={merge} onChange={(e) => setMerge(e.target.checked)} />
            Merge it right away ({info.method}) <span className="text-zinc-500">(otherwise you merge the pull request yourself)</span>
          </label>
          <p className="text-xs text-zinc-500">
            Your own folder is not touched; once the revert merges, your local {info.base} is fast-forwarded the way a merge is. The goal, its branch and its page stay; reverting the revert on GitHub, or a follow-up goal, brings the work back.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
