import type { Attachment } from '@foundry/core/browser';
import { MessageCircle, PanelsTopLeft, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLive } from '../../store.ts';
import { cn } from '../../ui.tsx';
import { ConversationThread } from './ConversationThread.tsx';
import { askQuestion, conversationChannel, stopAnswer, useConversationOpen, useConversations, useSeenAnswer } from './store.ts';

/** the mark of a feature on trial (Settings → Beta) */
export function BetaChip({ className }: { className?: string }) {
  return (
    <span className={cn('rounded-sm bg-work/12 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-work-ink ring-1 ring-inset ring-work/40', className)} title="A feature on trial: Settings → Beta">
      Beta
    </span>
  );
}

/**
 * The bubble at the bottom right of a goal's page and its Brief page (ADR-0073): it opens the goal's newest Conversation
 * in a window above it (the page stays usable), pulses in the colour of work while an answer is being written, and
 * shows a dot when an answer came while it was closed. The window and the bubble share one corner, the window stacked
 * over the bubble, so neither can cover the other. Nothing while the feature is off.
 */
export function ConversationBubble({ goalId }: { goalId: string }) {
  const view = useConversations(goalId);
  const [open, setOpen] = useConversationOpen(goalId);
  const [seen, markSeen] = useSeenAnswer(goalId);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** the person asked for a new Conversation: the window empties, and the next question starts it */
  const [fresh, setFresh] = useState(false);
  const current = view?.conversations.at(-1) ?? null;
  const shown = fresh ? null : current;
  const live = shown ? view?.live[shown.id] : undefined;
  const items = useLive((s) => (shown ? s.streams[conversationChannel(shown.id)] : undefined)) ?? [];
  const lastAnswer = current?.messages.filter((m) => m.role === 'explainer').at(-1)?.id ?? null;
  const working = !!live?.answering || !!live?.queued.length;
  const unseen = !open && !!lastAnswer && seen !== lastAnswer;
  useEffect(() => {
    if (open && lastAnswer && seen !== lastAnswer) markSeen(lastAnswer);
  }, [open, lastAnswer, seen]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  if (!view?.enabled) return null;
  const ask = async (text: string, attachments: Attachment[]) => {
    setBusy(true);
    setErr(null);
    try {
      await askQuestion(goalId, text, { conversationId: fresh ? null : (current?.id ?? null), fresh, attachments });
      setFresh(false);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    if (!current) return;
    try {
      await stopAnswer(goalId, current.id);
    } catch (e: any) {
      setErr(e.message);
    }
  };
  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-3">
      {open && (
        <section aria-label="Conversation about this goal" className="flex h-[70vh] max-h-[calc(100vh-6rem)] w-[420px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl max-sm:fixed max-sm:inset-0 max-sm:h-auto max-sm:max-h-none max-sm:w-auto max-sm:max-w-none max-sm:rounded-none">
          <header className="flex items-center gap-2 border-b border-line px-3 py-2">
            <MessageCircle size={15} className="shrink-0 text-ink-soft" aria-hidden="true" />
            <h3 className="min-w-0 flex-1 truncate text-sm font-bold text-ink" title={shown?.title || 'Conversation'}>
              {fresh ? 'New Conversation' : shown?.title || 'Conversation'}
            </h3>
            <BetaChip />
            {current && current.messages.length > 0 && !fresh && (
              <button type="button" className="rounded-md p-1.5 text-ink-soft hover:bg-sunken hover:text-ink disabled:opacity-40" title="Start a new Conversation; this one stays readable on the Conversation tab" aria-label="New Conversation" disabled={busy} onClick={() => setFresh(true)}>
                <Plus size={15} aria-hidden="true" />
              </button>
            )}
            <Link to={`/goals/${goalId}#conversation`} className="rounded-md p-1.5 text-ink-soft hover:bg-sunken hover:text-ink" title="Every Conversation of this goal, on its tab" aria-label="Open the Conversation tab" onClick={() => setOpen(false)}>
              <PanelsTopLeft size={15} aria-hidden="true" />
            </Link>
            <button type="button" className="rounded-md p-1.5 text-ink-soft hover:bg-sunken hover:text-ink sm:hidden" aria-label="Close" onClick={() => setOpen(false)}>
              <X size={16} aria-hidden="true" />
            </button>
          </header>
          {err && <p className="border-b border-bad/30 bg-bad/5 px-3 py-1.5 text-xs text-bad-ink">{err}</p>}
          <ConversationThread conversation={shown} live={live} items={items} compact busy={busy} onAsk={ask} onStop={stop} />
        </section>
      )}
      {/* 48px round; a ring pings behind it in the colour of work while an answer is written */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={open ? 'Close the Conversation' : 'Ask about this goal'}
        aria-expanded={open}
        title={working ? 'An answer is being written' : 'Ask about this goal'}
        className={cn('relative grid h-12 w-12 shrink-0 place-items-center rounded-full shadow-xl ring-1 ring-inset transition-colors', open ? 'bg-panel text-ink ring-line-strong hover:bg-line' : 'bg-accent text-on-accent ring-accent hover:bg-accent/85')}
      >
        {working && <span aria-hidden="true" className="absolute inset-0 -z-10 rounded-full bg-work motion-safe:animate-ping" />}
        {open ? <X size={20} aria-hidden="true" /> : <MessageCircle size={22} aria-hidden="true" />}
        {unseen && <span aria-label="an answer came" className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full bg-work ring-2 ring-page" />}
      </button>
    </div>
  );
}
