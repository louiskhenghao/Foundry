import { MessageCircle, MessageSquarePlus } from 'lucide-react';
import { useState } from 'react';
import { BetaChip } from '../../components/conversation/ConversationBubble.tsx';
import { ConversationThread } from '../../components/conversation/ConversationThread.tsx';
import { askQuestion, conversationChannel, stopAnswer, useConversationStore, useConversations } from '../../components/conversation/store.ts';
import { useLive } from '../../store.ts';
import { clock } from '../../time.ts';
import { Card, EmptyState, Loading, cn } from '../../ui.tsx';

/**
 * Every Conversation of the goal (ADR-0073): the list, newest first, and the one chosen beside it. The newest is the one
 * that goes on; an earlier one is read, not continued. New starts another.
 */
export function ConversationTab({ goalId }: { goalId: string }) {
  const view = useConversations(goalId);
  const selected = useConversationStore((s) => s.selected[goalId] ?? null);
  const select = useConversationStore((s) => s.select);
  const [fresh, setFresh] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const current = view?.conversations.at(-1) ?? null;
  const shown = fresh ? null : (view?.conversations.find((c) => c.id === selected) ?? current);
  const items = useLive((s) => (shown ? s.streams[conversationChannel(shown.id)] : undefined)) ?? [];
  if (!view) return <Loading label="Loading the Conversation…" />;
  if (!view.enabled)
    return (
      <EmptyState icon={MessageCircle} title="The Conversation is off">
        Settings → Beta switches it on: a read-only Explainer that answers your questions about this goal's code and Foundry's records of it.
      </EmptyState>
    );
  const ask = async (text: string) => {
    setBusy(true);
    setErr(null);
    try {
      await askQuestion(goalId, text, { conversationId: fresh ? null : (shown?.id ?? null), fresh });
      setFresh(false);
      select(goalId, null);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    if (!shown) return;
    try {
      await stopAnswer(goalId, shown.id);
    } catch (e: any) {
      setErr(e.message);
    }
  };
  const readOnly = !!shown && shown.id !== current?.id;
  const questions = (n: number) => `${n} question${n === 1 ? '' : 's'}`;
  return (
    <div className="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start">
      <Card
        title={
          <span className="flex items-center gap-2">
            Conversations <BetaChip />
          </span>
        }
        bodyClassName="!p-2"
      >
        {!fresh && (
          <button
            type="button"
            onClick={() => {
              setFresh(true);
              select(goalId, null);
            }}
            title="Start a new Conversation; the earlier ones stay readable"
            className="mb-1 flex w-full items-center gap-2 rounded-md border border-dashed border-line-strong px-2.5 py-2 text-left text-[13px] font-semibold text-ink-soft transition-colors hover:border-accent hover:text-ink"
          >
            <MessageSquarePlus size={15} aria-hidden="true" />
            New Conversation
          </button>
        )}
        {!view.conversations.length && !fresh && <p className="px-2 py-3 text-xs text-ink-faint">None yet: the first question starts one.</p>}
        <ul className="space-y-0.5">
          {fresh && (
            <li className="rounded-md bg-panel px-2.5 py-2 text-[13px] font-bold text-ink shadow-[inset_3px_0_0_var(--color-accent),0_0_0_1px_var(--color-line)]">
              New Conversation <span className="block text-[11px] font-normal text-ink-faint">the first question starts it</span>
            </li>
          )}
          {[...view.conversations].reverse().map((c) => {
            const active = !fresh && shown?.id === c.id;
            const asked = c.messages.filter((m) => m.role === 'person').length;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    setFresh(false);
                    select(goalId, c.id);
                  }}
                  className={cn('block w-full rounded-md px-2.5 py-2 text-left transition-colors', active ? 'bg-panel shadow-[inset_3px_0_0_var(--color-accent),0_0_0_1px_var(--color-line)]' : 'hover:bg-sunken')}
                >
                  <span className={cn('block truncate text-[13px]', active ? 'font-bold text-ink' : 'font-semibold text-ink-soft')} title={c.title || 'Untitled'}>
                    {c.title || 'Untitled'}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-faint">
                    {clock(c.startedAt)} · {questions(asked)}
                    {c.id === current?.id && <span className="rounded-sm bg-work/12 px-1 font-semibold text-work-ink ring-1 ring-inset ring-work/40">current</span>}
                    {view.live[c.id]?.answering && <span className="rounded-sm bg-work/12 px-1 font-semibold text-work-ink ring-1 ring-inset ring-work/40">answering</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Card>
      <Card
        title={
          <span className="flex min-w-0 items-baseline gap-2.5">
            <span className="shrink-0">Conversation</span>
            <span className="no-caps min-w-0 truncate text-[13px] font-semibold text-ink-soft" title={fresh ? undefined : shown?.title}>
              {fresh ? 'new: the first question starts it' : shown?.title || ''}
            </span>
          </span>
        }
        actions={shown && !fresh ? <span className="text-[11px] text-ink-faint">{questions(shown.messages.filter((m) => m.role === 'person').length)} · {clock(shown.startedAt)}</span> : undefined}
        bodyClassName="!p-0 flex h-[70vh] min-h-[28rem] flex-col"
      >
        {err && <p className="border-b border-bad/30 bg-bad/5 px-3 py-1.5 text-xs text-bad-ink">{err}</p>}
        <ConversationThread conversation={shown} live={shown ? view.live[shown.id] : undefined} items={items} readOnly={readOnly} busy={busy} onAsk={ask} onStop={stop} />
      </Card>
    </div>
  );
}
