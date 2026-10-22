import type { DeliveryRevert, Goal } from '@foundry/core/browser';
import { ExternalLink, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type RevertInfo } from '../../api.ts';
import { Badge, Button, ConfirmDialog, Textarea, ago, cn } from '../../ui.tsx';

/**
 * what each state of a Revert is called on the Delivery tab (ADR-0059), and the badge's signal: an open pull request
 * waits for you to merge it, an armed one merges by itself
 */
export const REVERT_STATUS: Record<DeliveryRevert['status'], { label: string; state: 'running' | 'open' | 'done' | 'cancelled' | 'failed' }> = {
  running: { label: 'reverting…', state: 'running' },
  open: { label: 'revert PR open', state: 'open' },
  armed: { label: 'revert auto-merge armed', state: 'running' },
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
          <li key={r.id} className="rounded-lg border border-line bg-sunken p-3 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Undo2 size={13} className="text-ink-faint" />
              <Badge state={s.state}>{s.label}</Badge>
              {r.pr && (
                <a className="font-semibold text-work-ink hover:underline flex items-center gap-1" href={r.pr.url} target="_blank" rel="noreferrer">
                  <ExternalLink size={12} /> PR #{r.pr.number}
                </a>
              )}
              {r.mergedRef && <span className="mono text-ink-faint">merged {r.mergedRef.slice(0, 7)}</span>}
              <span className="mono text-ink-faint ml-auto" title={r.finishedAt ?? r.at}>{ago(r.finishedAt ?? r.at)}</span>
            </div>
            <div className="text-ink-soft">
              Undoes the merge{r.reverts.length === 1 ? '' : 's'} of {r.reverts.map((m) => (m.prNumber != null ? `#${m.prNumber}` : m.ref.slice(0, 7))).join(', ')}
              {r.reason && (
                <>
                  {' — '}
                  <span className="text-ink">{r.reason}</span>
                </>
              )}
            </div>
            {r.detail && <div className={cn('break-words', r.status === 'failed' ? 'text-bad-ink' : 'text-ink-faint')}>{r.detail}</div>}
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
        {info && !info.ok && info.why && <span className="text-ink-faint">{info.why}</span>}
        {err && <span className="text-bad-ink">{err}</span>}
      </div>
      {info && (
        <ConfirmDialog open={open} title="Revert this goal?" confirmLabel={merge ? 'Open the revert PR and merge it' : 'Open the revert PR'} danger busy={working} onConfirm={() => void go()} onClose={() => setOpen(false)}>
          <p className="text-sm text-ink-soft">
            Foundry starts a branch from <span className="mono text-ink">{info.remote}/{info.base}</span>, undoes {n === 1 ? 'the merge of its pull request' : `the merges of its ${n} pull requests, newest first`} with one commit each, pushes it and opens a pull request:
          </p>
          <ul className="text-xs text-ink-soft space-y-0.5">
            {info.reverts.map((r) => (
              <li key={r.ref}>
                <span className="mono font-semibold text-ink">{r.prNumber != null ? `#${r.prNumber}` : 'merge'}</span> {r.title} <span className="mono text-ink-faint">{r.ref.slice(0, 7)}</span>
              </li>
            ))}
          </ul>
          <label className="block text-xs font-semibold text-ink-soft">
            Why? <span className="font-normal text-ink-faint">(it goes into the pull request)</span>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="What went wrong" className="mt-1" />
          </label>
          <label className="flex items-center gap-2 text-xs text-ink">
            <input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} />
            Merge it right away ({info.method}) <span className="text-ink-faint">(otherwise you merge the pull request yourself)</span>
          </label>
          <p className="text-xs text-ink-faint">
            Your own folder is not touched; once the revert merges, your local {info.base} is fast-forwarded the way a merge is. The goal, its branch and its page stay; reverting the revert on GitHub, or a follow-up goal, brings the work back.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
