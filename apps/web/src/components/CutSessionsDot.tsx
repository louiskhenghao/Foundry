import type { GoalDetail } from '../api.ts';
import { InfoDot, fmtUsd } from '../ui.tsx';

/** the cost meter's dot: sessions cut before Claude Code reported their cost, and what they probably cost */
export function CutSessionsDot({ n, est }: { n: number; est: GoalDetail['costEstimate'] }) {
  const sessions = `${n} session${n === 1 ? '' : 's'}`;
  return (
    <InfoDot label={`${sessions} ended before Claude Code reported a cost${est?.estimated ? `: about ${fmtUsd(est.usd)} more, estimated` : ''}`}>
      <p>
        {sessions} ended before Claude Code reported what {n === 1 ? 'it' : 'they'} cost (cut at a time limit, or stopped). This total leaves {n === 1 ? 'it' : 'them'} out.
      </p>
      {est?.estimated ? (
        <p>
          Estimated from {n === 1 ? 'its' : 'their'} tokens at the rate the same model cost in sessions that reported it: about <span className="mono text-zinc-100">≈{fmtUsd(est.usd)}</span>
          {est.estimated < n ? ` for ${est.estimated} of them (the rest ran a model with no reported cost yet)` : ''}. Estimates never count against the budget.
        </p>
      ) : (
        <p>No estimate: their model has no session with a reported cost yet.</p>
      )}
    </InfoDot>
  );
}
