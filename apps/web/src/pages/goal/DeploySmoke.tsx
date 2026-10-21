import type { DeploySmoke, Deployment } from '@foundry/core/browser';
import { ChevronRight, Loader2, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Button, ago, cn } from '../../ui.tsx';
import { EvidenceView } from './MilestoneEvidence.tsx';

const STATUS: Record<DeploySmoke['status'], { label: string; className: string }> = {
  running: { label: 'smoke running…', className: 'text-sky-300 border-sky-800' },
  pass: { label: 'smoke passed', className: 'text-emerald-300 border-emerald-800' },
  fail: { label: 'smoke failed', className: 'text-rose-300 border-rose-800' },
  skipped: { label: 'no smoke', className: 'text-zinc-400 border-zinc-700' },
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
    <div className="ml-1 mt-1 space-y-1 border-l border-zinc-800 pl-2 text-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        {s && (
          <span className={cn('inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-px text-[10px]', STATUS[s.status].className)}>
            {running && <Loader2 size={9} className="animate-spin" />}
            {STATUS[s.status].label}
          </span>
        )}
        {s && s.detail && (
          <span className={cn('min-w-0 truncate', s.status === 'fail' ? 'text-rose-300/90' : 'text-zinc-400')} title={s.detail}>
            {s.detail}
          </span>
        )}
        {s?.endedAt && <span className="shrink-0 text-zinc-500">{ago(s.endedAt)}</span>}
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
                <button type="button" onClick={() => toggle(r.script)} aria-expanded={expanded} className="flex max-w-full items-center gap-1.5 text-left hover:text-zinc-50">
                  <ChevronRight size={11} className={cn('shrink-0 text-zinc-500 transition-transform', expanded && 'rotate-90')} />
                  <span className={r.status === 'pass' ? 'text-emerald-400' : 'text-rose-400'}>{r.status === 'pass' ? '✓' : '✗'}</span>
                  <span className="mono text-zinc-300">{r.script}</span>
                  {r.status === 'fail' && firstLine ? (
                    <span className="truncate text-rose-300/90" title={r.error ?? undefined}>{firstLine}</span>
                  ) : r.summary ? (
                    <span className="truncate text-zinc-500">{r.summary}</span>
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
