import type { ReviewRound } from '@foundry/core/browser';
import { CheckCircle2, Eye, Loader2, MessageSquare, XCircle } from 'lucide-react';
import { Button, cn } from '../../ui.tsx';

/** what one round came to, in a few words */
export function roundLine(r: ReviewRound): string {
  const n = `${r.comments.length} comment${r.comments.length === 1 ? '' : 's'}`;
  switch (r.status) {
    case 'pending':
      return r.requested ? `${n} · asked for, starting` : `${n} · waiting for you`;
    case 'fixing':
      return `${n} · a fix task addresses them`;
    case 'addressed':
      return `${n} · addressed in ${r.commit ? r.commit.slice(0, 7) : 'a pushed fix'}${r.replied ? `, replied under ${r.replied === r.comments.length ? 'each' : `${r.replied} of ${r.comments.length}`}` : ''}`;
    case 'nochange':
      return `${n} · looked at, nothing to change${r.replied ? ', replied' : ''}`;
    case 'failed':
      return `${n} · could not be addressed`;
  }
}

/**
 * The rounds of review comments on one pull request (ADR-0053), under its row on the Delivery tab: what came in, what
 * Foundry did with it, and the button for a round that waits for the person.
 */
export function ReviewRounds({ rounds, open, busy, onFix }: { rounds: ReviewRound[]; open: boolean; busy: boolean; onFix: () => void }) {
  if (!rounds.length) return null;
  const waiting = open && rounds.some((r) => r.status === 'pending' && !r.requested);
  return (
    <ul className="mt-1.5 ml-8 space-y-0.5">
      {rounds.map((r) => {
        const Icon = r.status === 'addressed' ? CheckCircle2 : r.status === 'nochange' ? Eye : r.status === 'failed' ? XCircle : r.status === 'fixing' ? Loader2 : MessageSquare;
        // in the signal colours: green once settled (addressed, or nothing to change), blue while a fix works on it or one
        // asked for starts, red when it could not be addressed; yellow only for a round that waits for you
        const tone = r.status === 'addressed' || r.status === 'nochange' ? 'text-ok-ink' : r.status === 'failed' ? 'text-bad-ink' : r.status === 'fixing' || r.requested ? 'text-work-ink' : 'text-you-ink';
        const who = [...new Set(r.comments.map((c) => c.author).filter(Boolean))].map((a) => `@${a}`).join(', ');
        return (
          // the icon stays beside the words, which wrap under one another on a narrow screen with the link at their end
          <li key={r.id} className="text-xs text-ink-soft flex items-start gap-1.5" title={r.detail ?? undefined}>
            <Icon size={11} className={cn('mt-0.5 shrink-0', tone, r.status === 'fixing' && 'animate-spin')} />
            <span className="min-w-0">
              {roundLine(r)}
              {who && <span className="text-ink-faint"> · {who}</span>}
              <span className="mono whitespace-nowrap text-ink-faint"> · {r.at.slice(0, 10)}</span>
              {r.comments[0]?.url && (
                <>
                  {' '}
                  <a className="inline-flex items-center max-sm:min-h-8 font-semibold text-work-ink hover:underline" href={r.comments[0].url} target="_blank" rel="noreferrer">
                    first comment
                  </a>
                </>
              )}
            </span>
          </li>
        );
      })}
      {waiting && (
        <li className="pt-0.5">
          <Button size="sm" disabled={busy} onClick={onFix} title="Address the waiting review comments now, beyond the policy's budget: a fix task changes the branch, pushes, and replies under each comment">
            Fix review comments
          </Button>
        </li>
      )}
    </ul>
  );
}
