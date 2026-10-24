import { VERDICT_AXES, type VerdictScores } from '@foundry/core/browser';
import { cn } from '../ui.tsx';

/** how a score reads: the bar is 8 (the motion-studio rubric's), 6 and 7 are close, below that the axis failed */
const tone = (n: number) => (n >= 8 ? 'text-ok-ink' : n >= 6 ? 'text-you-ink' : 'text-bad-ink');

/**
 * A reviewer's scores on the axes its rubric named (ADR-0076), one chip per axis, with the move since the attempt
 * before when there was one: `hook 8 ↑2`.
 */
export function ScoreRow({ scores, prev, className }: { scores: VerdictScores; prev?: VerdictScores | null; className?: string }) {
  const axes = VERDICT_AXES.filter((a) => scores[a] != null);
  if (!axes.length) return null;
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)} data-testid="score-row">
      {axes.map((a) => {
        const n = scores[a]!;
        const was = prev?.[a];
        const delta = was != null ? n - was : null;
        return (
          <span key={a} className="inline-flex items-baseline gap-1 rounded-sm px-1.5 py-px text-[11px] ring-1 ring-inset ring-line-strong" title={`${a}: ${n} of 10${delta != null ? `, ${delta >= 0 ? '+' : ''}${delta} since the attempt before` : ''}`}>
            <span className="text-ink-soft">{a}</span>
            <b className={cn('mono font-bold', tone(n))}>{n}</b>
            {delta != null && delta !== 0 && <span className={cn('mono text-[10px]', delta > 0 ? 'text-ok-ink' : 'text-bad-ink')}>{delta > 0 ? `↑${delta}` : `↓${-delta}`}</span>}
          </span>
        );
      })}
    </div>
  );
}
