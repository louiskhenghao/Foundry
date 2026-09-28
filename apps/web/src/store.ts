import type { EngineEvent, EscalationSuggestion } from '@foundry/core/browser';
import { create } from 'zustand';
import { api } from './api.ts';

export interface StreamItem {
  goalId: string;
  taskId: string | null;
  attemptId: string;
  ts: string;
  event: any;
  /** set when another session shares the channel (e.g. the task reviewer on an attempt's log) */
  role?: string;
}

interface LiveState {
  connected: boolean;
  /** bumped on every event for a goal; pages use it to refetch (debounced) */
  goalVersion: Record<string, number>;
  globalVersion: number;
  streams: Record<string, StreamItem[]>; // by attemptId
  lastEvent: EngineEvent | null;
  bump: (goalId: string | null, e: EngineEvent) => void;
  pushStream: (s: StreamItem) => void;
  /** prepend decoded history (from the transcript) for a channel that has nothing buffered yet */
  seedStream: (attemptId: string, events: any[]) => void;
  setConnected: (c: boolean) => void;
}

const MAX_STREAM = 400;

export const useLive = create<LiveState>((set) => ({
  connected: false,
  goalVersion: {},
  globalVersion: 0,
  streams: {},
  lastEvent: null,
  bump: (goalId, e) =>
    set((s) => ({
      globalVersion: s.globalVersion + 1,
      lastEvent: e,
      goalVersion: goalId ? { ...s.goalVersion, [goalId]: (s.goalVersion[goalId] ?? 0) + 1 } : s.goalVersion,
    })),
  pushStream: (item) =>
    set((s) => {
      const prev = s.streams[item.attemptId] ?? [];
      const next = prev.length >= MAX_STREAM ? [...prev.slice(prev.length - MAX_STREAM + 1), item] : [...prev, item];
      return { streams: { ...s.streams, [item.attemptId]: next } };
    }),
  seedStream: (attemptId, events) =>
    set((s) => {
      const live = s.streams[attemptId] ?? [];
      // keep anything that streamed in meanwhile after the history
      const seeded = events.map((event) => ({ goalId: '', taskId: null, attemptId, ts: '', event }));
      const merged = [...seeded, ...live.filter((x) => !seeded.some((h) => h.event === x.event))].slice(-MAX_STREAM);
      return { streams: { ...s.streams, [attemptId]: merged } };
    }),
  setConnected: (connected) => set({ connected }),
}));

let ws: WebSocket | null = null;
export function connectWs() {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  const open = () => {
    ws = new WebSocket(url);
    ws.onopen = () => useLive.getState().setConnected(true);
    ws.onclose = () => {
      useLive.getState().setConnected(false);
      setTimeout(open, 1500);
    };
    ws.onmessage = (m) => {
      const msg = JSON.parse(String(m.data));
      if (msg.kind === 'event') useLive.getState().bump(msg.event.goalId, msg.event);
      else if (msg.kind === 'stream') useLive.getState().pushStream(msg.stream);
    };
  };
  open();
}

/**
 * What the human is doing on one escalation card — the typed hint, the extra attempts, a running
 * AI analysis — shared by every screen that shows the card (Inbox, goal overview, task drawer),
 * so leaving one screen for another keeps it. Lives for the tab; the answer itself is the server's.
 */
export interface EscalationDraft {
  /** undefined = untouched: the card shows the AI's hint, if it suggested one */
  hint?: string;
  attempts: number;
  suggesting: null | 'suggest' | 'apply';
  /** the latest suggestion this tab received, until the refetched escalation carries it */
  suggestion: EscalationSuggestion | null;
  error: string | null;
}

const EMPTY_DRAFT: EscalationDraft = { attempts: 1, suggesting: null, suggestion: null, error: null };

export const useEscalationDrafts = create<{ drafts: Record<string, EscalationDraft>; patch: (id: string, p: Partial<EscalationDraft>) => void }>((set) => ({
  drafts: {},
  patch: (id, p) => set((s) => ({ drafts: { ...s.drafts, [id]: { ...(s.drafts[id] ?? EMPTY_DRAFT), ...p } } })),
}));

export const useEscalationDraft = (id: string) => useEscalationDrafts((s) => s.drafts[id]) ?? EMPTY_DRAFT;

/** Runs outside any component, so the screen that started it may unmount and every card still sees it finish. */
export async function suggestEscalation(id: string, apply: boolean): Promise<void> {
  const { patch } = useEscalationDrafts.getState();
  if (useEscalationDrafts.getState().drafts[id]?.suggesting) return;
  patch(id, { suggesting: apply ? 'apply' : 'suggest', error: null });
  try {
    const { suggestion } = await api.suggest(id, apply);
    patch(id, { suggesting: null, suggestion, ...(suggestion.action === 'retry_with_hint' ? { hint: suggestion.hint } : {}) });
  } catch (x: any) {
    patch(id, { suggesting: null, error: x.message });
  }
}
