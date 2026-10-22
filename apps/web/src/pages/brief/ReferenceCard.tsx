import { reportsDollars } from '@foundry/core/browser';
import type { Goal } from '@foundry/core/browser';
import { ExternalLink, Loader2, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api.ts';
import { Button, Card, ago, fmtUsd } from '../../ui.tsx';
import { HelpLink } from '../HelpPage.tsx';
import { SectionTitle } from './SectionTitle.tsx';

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
      title={<><SectionTitle section="reference">Reference</SectionTitle><HelpLink to="approving-the-brief#reference" className="ml-1.5" /></>}
      actions={
        again && (
          <Button size="sm" variant="info" disabled={busy || running} onClick={() => void rerun()} title="Study the references again with REA and replace the report; the Brief changes only with Re-run Clarify">
            <RotateCcw size={12} /> Investigate again
          </Button>
        )
      }
    >
      <ul className="text-xs text-ink-soft space-y-0.5">
        {goal.references.map((r, i) => (
          <li key={i}>
            <span className="mono break-all text-ink">{r.target}</span>
            {r.lookAt && <span className="text-ink-faint"> — {r.lookAt}</span>}
          </li>
        ))}
      </ul>
      <div className="mt-2.5 text-xs">
        {running ? (
          <span className="inline-flex items-center gap-1.5 text-ink-soft">
            <Loader2 size={12} className="animate-spin shrink-0" /> REA is studying the reference and writing the report…
          </span>
        ) : inv!.status === 'ok' ? (
          <div className="space-y-1">
            <p className="text-ink">{inv.summary}</p>
            <div className="flex flex-wrap items-center gap-3 text-xs text-ink-faint">
              {report && (
                <a href={api.attachmentUrl(goal.id, report.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-work-ink hover:underline">
                  {report.name} <ExternalLink size={10} />
                </a>
              )}
              {inv.docPath && <span className="mono">{inv.docPath} on the goal branch</span>}
              <span className="mono">
                {ago(inv.at)}
                {reportsDollars(goal.provider) && inv.costUsd > 0 ? ` · ${fmtUsd(inv.costUsd)}` : ''}
              </span>
            </div>
          </div>
        ) : (
          // a failure is red; a skipped investigation only says why
          <p className={inv.status === 'failed' ? 'font-semibold text-bad-ink' : 'text-ink-soft'}>
            {inv.status === 'failed' ? 'The investigation failed' : 'The investigation was skipped'}: {inv.detail}
          </p>
        )}
      </div>
      <p className="mt-2.5 text-xs text-ink-faint">Only software you are allowed to examine; the goal builds its own version from the evidence, never a copy.</p>
      {err && <div className="mt-1 text-xs text-bad-ink">{err}</div>}
    </Card>
  );
}
