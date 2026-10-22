import type { DeploySmoke, Deployment } from '@foundry/core/browser';
import { ChevronRight, Loader2, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Button, ago, cn } from '../../ui.tsx';
import { EvidenceView } from './MilestoneEvidence.tsx';

/** a smoke's state as a small plate: ink while it runs, green once passed, red when it failed, quiet when there was none */
const STATUS: Record<DeploySmoke['status'], { label: string; className: string }> = {
  running: { label: 'smoke running…', className: 'text-ink ring-ink' },
  pass: { label: 'smoke passed', className: 'bg-ok/10 text-ok-ink ring-ok/30' },
  fail: { label: 'smoke failed', className: 'bg-bad/10 text-bad-ink ring-bad/40' },
  skipped: { label: 'no smoke', className: 'text-ink-soft ring-line-strong' },
};

/** the button a live address offers: a first smoke, or one more */
export const againLabel = (smoke: DeploySmoke | null | undefined) => (smoke && smoke.status !== 'skipped' ? 'Smoke again' : 'Try the scripts against it');

/**
 * A deploy's smoke (ADR-0058) under its row: how it went and what it said, each script's recording to fold open (its
 * videos, screenshots and log, the way a milestone's are shown), and Smoke again on a live address.
 */
export function SmokeView({ goalId, deployment, scripts, busy, onAgain }: { goalId: string; deployment: Deployment; scripts: number; busy: boolean; onAgain: () => void }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const s = deployment.smoke ?? null;
  const running = s?.status === 'running';
  const again = deployment.status === 'live' && !!deployment.url && scripts > 0 && !running;
  if (!s && !again) return null;
  return (
    <div className="ml-1 mt-1.5 space-y-1.5 border-l-2 border-line pl-2.5 text-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        {s && (
          <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-px text-[10.5px] font-bold uppercase tracking-[0.07em] ring-1 ring-inset', STATUS[s.status].className)}>
            {running && <Loader2 size={9} className="animate-spin" />}
            {STATUS[s.status].label}
          </span>
        )}
        {s && s.detail && (
          <span className={cn('min-w-0 truncate', s.status === 'fail' ? 'text-bad-ink' : 'text-ink-soft')} title={s.detail}>
            {s.detail}
          </span>
        )}
        {s?.endedAt && <span className="mono shrink-0 text-ink-faint">{ago(s.endedAt)}</span>}
        {again && (
          <Button size="sm" variant="info" className="shrink-0" disabled={busy} onClick={onAgain} title={`Run the goal's ${scripts} milestone script${scripts === 1 ? '' : 's'} against ${deployment.url} (a script writes what it tries)`}>
            <RotateCcw size={11} /> {againLabel(s)}
          </Button>
        )}
      </div>
      {s && s.scripts.length > 0 && (
        <ul className="space-y-1">
          {s.scripts.map((r) => {
            const expanded = open.has(r.script);
            const firstLine = r.error?.split('\n')[0] ?? '';
            return (
              <li key={r.script}>
                <button type="button" onClick={() => toggle(r.script)} aria-expanded={expanded} className="flex max-w-full items-center gap-1.5 text-left hover:underline underline-offset-2">
                  <ChevronRight size={11} className={cn('shrink-0 text-ink-faint transition-transform', expanded && 'rotate-90')} />
                  <span className={cn('font-bold', r.status === 'pass' ? 'text-ok-ink' : 'text-bad-ink')}>{r.status === 'pass' ? '✓' : '✗'}</span>
                  <span className="mono font-semibold text-ink">{r.script}</span>
                  {r.status === 'fail' && firstLine ? (
                    <span className="truncate text-bad-ink" title={r.error ?? undefined}>{firstLine}</span>
                  ) : r.summary ? (
                    <span className="truncate text-ink-faint">{r.summary}</span>
                  ) : null}
                </button>
                {expanded && (
                  <div className="ml-4 mt-1">
                    <EvidenceView goalId={goalId} evidence={{ taskId: r.taskId ?? '', video: null, shots: r.shots, summary: r.summary, error: r.error, script: r.script, status: r.status, clips: r.clips, outputs: r.outputs, log: r.log }} taskId={r.taskId ?? undefined} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
