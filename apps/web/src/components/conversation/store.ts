import type { Attachment } from '@foundry/core/browser';
/**
 * The Conversations of the goals this browser looks at (ADR-0073): each goal's view from the server, fetched when a page
 * shows it and again whenever one of its Conversation events arrives (never on the goal's other events: a question is
 * not the goal's work); whether the bubble's window is open, per goal, kept in this browser; the last answer seen, so
 * the bubble can say one came while it was closed.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import { api, type ConversationsView } from '../../api.ts';
import { useLive } from '../../store.ts';

/** the live channel of a Conversation, as the engine names it */
export const conversationChannel = (conversationId: string) => `conversation-${conversationId}`;

const OPEN_KEY = (goalId: string) => `foundry.conversation.open.${goalId}`;
const SEEN_KEY = (goalId: string) => `foundry.conversation.seen.${goalId}`;
const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
};

interface ConversationState {
  views: Record<string, ConversationsView>;
  open: Record<string, boolean>;
  seen: Record<string, string | null>;
  /** the Conversation the tab shows, per goal; absent = the newest */
  selected: Record<string, string | null>;
  setView: (goalId: string, view: ConversationsView) => void;
  setOpen: (goalId: string, open: boolean) => void;
  markSeen: (goalId: string, messageId: string) => void;
  select: (goalId: string, conversationId: string | null) => void;
}

export const useConversationStore = create<ConversationState>((set) => ({
  views: {},
  open: {},
  seen: {},
  selected: {},
  setView: (goalId, view) => set((s) => ({ views: { ...s.views, [goalId]: view } })),
  setOpen: (goalId, open) => {
    write(OPEN_KEY(goalId), open ? '1' : null);
    set((s) => ({ open: { ...s.open, [goalId]: open } }));
  },
  markSeen: (goalId, messageId) => {
    write(SEEN_KEY(goalId), messageId);
    set((s) => ({ seen: { ...s.seen, [goalId]: messageId } }));
  },
  select: (goalId, conversationId) => set((s) => ({ selected: { ...s.selected, [goalId]: conversationId } })),
}));

/** whether the bubble's window is open for this goal: what this browser remembered, else closed */
export function useConversationOpen(goalId: string): [boolean, (open: boolean) => void] {
  const open = useConversationStore((s) => s.open[goalId]);
  const setOpen = useConversationStore((s) => s.setOpen);
  return [open ?? read(OPEN_KEY(goalId)) === '1', (o) => setOpen(goalId, o)];
}

/** the last answer this browser saw for the goal */
export function useSeenAnswer(goalId: string): [string | null, (messageId: string) => void] {
  const seen = useConversationStore((s) => s.seen[goalId]);
  const markSeen = useConversationStore((s) => s.markSeen);
  return [seen ?? read(SEEN_KEY(goalId)), (id) => markSeen(goalId, id)];
}

/** fetch the goal's Conversations into the store; failures leave what is there */
export function refreshConversations(goalId: string): Promise<void> {
  return api
    .conversations(goalId)
    .then((v) => useConversationStore.getState().setView(goalId, v))
    .catch(() => {});
}

/** the goal's view: loaded when a page first shows it, and again on each of its Conversation events (and a Settings change) */
export function useConversations(goalId: string): ConversationsView | null {
  const view = useConversationStore((s) => s.views[goalId] ?? null);
  const last = useLive((s) => s.lastEvent);
  useEffect(() => {
    void refreshConversations(goalId);
  }, [goalId]);
  useEffect(() => {
    if (!last) return;
    if ((last.goalId === goalId && last.type.startsWith('conversation.')) || last.type === 'settings.changed') void refreshConversations(goalId);
  }, [last, goalId]);
  return view;
}

/** a question: kept by the server at once, so the view is refreshed right after it is accepted */
export async function askQuestion(goalId: string, text: string, opts: { conversationId?: string | null; fresh?: boolean; attachments?: Attachment[] } = {}): Promise<{ conversationId: string; messageId: string; channel: string }> {
  const r = await api.ask(goalId, { text, ...opts });
  await refreshConversations(goalId);
  return r;
}

export async function stopAnswer(goalId: string, conversationId: string): Promise<boolean> {
  const { stopped } = await api.stopConversation(goalId, conversationId);
  await refreshConversations(goalId);
  return stopped;
}
