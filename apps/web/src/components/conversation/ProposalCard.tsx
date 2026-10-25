import type { Proposal } from '@foundry/core/browser';
import { ArrowUpRight, Check, ListPlus, FileText, Gavel, HandHelping, Lightbulb, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.ts';
import { Button, cn } from '../../ui.tsx';
import { Markdown } from '../Markdown.tsx';
import { refreshConversations } from './store.ts';

/** a kind's look: its icon and the word on the chip */
const KIND: Record<Proposal['type'], { Icon: typeof ListPlus; word: string; verb: string }> = {
  task: { Icon: ListPlus, word: 'new task', verb: 'Add the task' },
  decision: { Icon: Gavel, word: 'decision', verb: 'Record the decision' },
  note: { Icon: Lightbulb, word: 'note on the Brief', verb: 'Add the note' },
  'follow-up': { Icon: ArrowUpRight, word: 'follow-up goal', verb: 'Open the New goal form' },
  fulfil: { Icon: HandHelping, word: 'hand-over', verb: 'Hand it over' },
};

/** what a proposal would do, in detail, under its summary */
function Details({ p }: { p: Proposal }) {
  if (p.type === 'task' && p.task)
    return (
      <div className="space-y-1 text-[12px] text-ink-soft">
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          <span>{p.task.kind} · {p.task.scenario} · {p.task.difficulty}</span>
          {p.task.dependsOn.length > 0 && <span>after {p.task.dependsOn.join(', ')}</span>}
          {p.task.checks.length > 0 && <span>{p.task.checks.length} check{p.task.checks.length === 1 ? '' : 's'}</span>}
        </div>
        <details>
          <summary className="cursor-pointer text-ink-faint hover:text-ink">the task's spec</summary>
          <Markdown source={p.task.spec} className="mt-1 text-[12px]" />
        </details>
      </div>
    );
  if (p.type === 'decision' && p.decision) return <Markdown source={p.decision.text} className="text-[12px] text-ink-soft" />;
  if (p.type === 'note' && p.note) return <Markdown source={p.note.text} className="text-[12px] text-ink-soft" />;
  if (p.type === 'follow-up' && p.followUp) return <Markdown source={p.followUp.prompt} className="text-[12px] text-ink-soft" />;
  if (p.type === 'fulfil' && p.fulfil) return <p className="text-[12px] text-ink-soft">{p.fulfil.attachmentIds.length} file{p.fulfil.attachmentIds.length === 1 ? '' : 's'} → {p.fulfil.requestId ? 'the open Request' : `material ${p.fulfil.materialKey}`}{p.fulfil.note ? ` — ${p.fulfil.note}` : ''}</p>;
  return null;
}

/**
 * What the Explainer proposed (ADR-0075), as a card under its answer: the kind, the title and summary, the detail, and
 * Apply — nothing happens before it is pressed. Applied, it says what came of it; dismissed, it is hidden on this page.
 */
export function ProposalCard({ goalId, conversationId, proposal: p, compact = false }: { goalId: string; conversationId: string; proposal: Proposal; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const navigate = useNavigate();
  const { Icon, word, verb } = KIND[p.type];
  if (hidden) return null;
  const apply = async () => {
    setBusy(true);
    setErr(null);
    try {
      const { result } = await api.applyProposal(goalId, conversationId, p.id);
      await refreshConversations(goalId);
      if (p.type === 'follow-up' && result.startsWith('/')) navigate(result);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={cn('max-w-full rounded-lg border bg-panel ring-1 ring-inset', p.applied ? 'border-ok/40 ring-ok/20' : 'border-accent/40 ring-accent/15', compact ? 'p-2.5' : 'p-3')} data-proposal={p.id}>
      <div className="flex items-start gap-2">
        <span className={cn('mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md', p.applied ? 'bg-ok/12 text-ok-ink' : 'bg-accent/10 text-accent')}>
          <Icon size={14} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[13px] font-bold text-ink">{p.title}</span>
            <span className="rounded-sm bg-sunken px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-ink-soft ring-1 ring-inset ring-line">{word}</span>
            {p.applied && (
              <span className="inline-flex items-center gap-1 rounded-sm bg-ok/12 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-ok-ink ring-1 ring-inset ring-ok/40">
                <Check size={10} aria-hidden="true" /> applied
              </span>
            )}
          </div>
          {p.summary && <p className="mt-0.5 text-[13px] text-ink-soft">{p.summary}</p>}
          <div className="mt-1.5">
            <Details p={p} />
          </div>
          {p.applied ? (
            <p className="mt-2 text-[12px] text-ink-soft">
              {p.type === 'follow-up' ? 'The New goal form was opened, prefilled.' : p.applied.result}
              {p.applied.by ? <span className="text-ink-faint"> · by {p.applied.by}</span> : null}
            </p>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="primary" disabled={busy} onClick={() => void apply()} title="Nothing changes until you press this">
                {busy ? 'Applying…' : verb}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setHidden(true)} title="Hide this card here; the answer keeps it">
                <X size={12} aria-hidden="true" /> Dismiss
              </Button>
              {err && <span className="text-[12px] text-bad-ink">{err}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
