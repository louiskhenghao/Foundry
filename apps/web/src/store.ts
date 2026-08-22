import type { EngineEvent } from '@ai-engine/core/browser';
import { create } from 'zustand';

export interface StreamItem {
  goalId: string;
  taskId: string | null;
  attemptId: string;
  ts: string;
  event: any;
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
