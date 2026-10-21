import { reportsDollars } from '@foundry/core/browser';
import type { Goal } from '@foundry/core/browser';
import { ExternalLink, Loader2, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api.ts';
import { Button, Card, ago, fmtUsd } from '../../ui.tsx';
import { HelpLink } from '../HelpPage.tsx';

/** the shipped software this goal learns from, and what REA found out about it: the report every session reads */
export function ReferenceCard({ goal, investigating = false }: { goal: Goal; investigating?: boolean }) {
  const inv = goal.investigation;
  const running = investigating || !inv;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const report = inv?.attachmentId ? goal.attachments.find((a) => a.id === inv.attachmentId) : null;
  const again = ['draft', 'clarifying', 'awaiting_brief_approval'].includes(goal.state);
  const rerun = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.investigate(goal.id);
    } catch (e: any) {
      setErr(e.body?.error ?? e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title={<>Reference<HelpLink to="approving-the-brief#reference" className="ml-1.5" /></>}
      actions={
        again && (
          <Button size="sm" variant="info" disabled={busy || running} onClick={() => void rerun()} title="Study the references again with REA and replace the report; the Brief changes only with Re-run Clarify">
            <RotateCcw size={12} /> Investigate again
          </Button>
        )
      }
    >
      <ul className="text-xs text-zinc-300 space-y-0.5">
        {goal.references.map((r, i) => (
          <li key={i}>
            <span className="mono break-all">{r.target}</span>
            {r.lookAt && <span className="text-zinc-500"> — {r.lookAt}</span>}
          </li>
        ))}
      </ul>
      <div className="mt-2 text-xs">
        {running ? (
          <span className="inline-flex items-center gap-1.5 text-zinc-400">
            <Loader2 size={12} className="animate-spin" /> REA is studying the reference and writing the report…
          </span>
        ) : inv!.status === 'ok' ? (
          <div className="space-y-1">
            <p className="text-zinc-200">{inv.summary}</p>
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
              {report && (
                <a href={api.attachmentUrl(goal.id, report.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sky-300 hover:underline">
                  {report.name} <ExternalLink size={10} />
                </a>
              )}
              {inv.docPath && <span className="mono">{inv.docPath} on the goal branch</span>}
              <span>
                {ago(inv.at)}
                {reportsDollars(goal.provider) && inv.costUsd > 0 ? ` · ${fmtUsd(inv.costUsd)}` : ''}
              </span>
            </div>
          </div>
        ) : (
          <p className={inv.status === 'failed' ? 'text-rose-300' : 'text-amber-300'}>
            {inv.status === 'failed' ? 'The investigation failed' : 'The investigation was skipped'}: {inv.detail}
          </p>
        )}
      </div>
      <p className="mt-2 text-[11px] text-zinc-500">Only software you are allowed to examine; the goal builds its own version from the evidence, never a copy.</p>
      {err && <div className="mt-1 text-[11px] text-rose-300">{err}</div>}
    </Card>
  );
}
