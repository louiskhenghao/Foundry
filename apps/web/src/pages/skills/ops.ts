import { useEffect } from 'react';
import { create } from 'zustand';
import { ApiError, api, type SkillOp } from '../../api.ts';

/**
 * The Skills page's operations, one tab each in the operations dock (OpsDock.tsx). Each tab follows the server
 * operation of the same id: its output streams to `skills-op:<id>` and its status comes from the request's answer
 * or, for background ones (source updates, tool installs) and after a reload, from polling /api/skills/ops/:id.
 * Kept in a store (and in sessionStorage) so tabs survive the side panel's tab switches, refetches and reloads.
 */
export interface OpTab {
  /** same id as the server operation */
  id: string;
  channel: string;
  kind: SkillOp['kind'];
  label: string;
  /** what it acts on (source id, catalog id, skill names, `tier`) so rows can show that it is running */
  targets: string[];
  status: SkillOp['status'];
  startedAt: string;
  endedAt: string | null;
  summary: string | null;
  /** the server refused to start it (e.g. 409 while another update runs): no output, nothing to poll */
  refused?: boolean;
}

interface OpsState {
  tabs: OpTab[];
  active: string | null;
  /** the dock is expanded (else a one-line bar with counts) */
  open: boolean;
  /** bumped whenever an operation ends, so the page refetches */
  finished: number;
  add: (t: OpTab) => void;
  patch: (id: string, p: Partial<OpTab>) => void;
  dismiss: (id: string) => void;
  clearFinished: () => void;
  show: (id: string) => void;
  setOpen: (open: boolean) => void;
}

const KEY = 'foundry.skills.ops';
type Saved = Pick<OpsState, 'tabs' | 'active' | 'open'>;
function restore(): Saved {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Saved | null;
    if (s && Array.isArray(s.tabs)) return { tabs: s.tabs, active: s.active ?? null, open: !!s.open };
  } catch {}
  return { tabs: [], active: null, open: false };
}

export const useSkillOps = create<OpsState>((set) => ({
  ...restore(),
  finished: 0,
  add: (t) => set((s) => ({ tabs: [...s.tabs, t], active: t.id, open: true })),
  patch: (id, p) =>
    set((s) => {
      const prev = s.tabs.find((t) => t.id === id);
      if (!prev) return s;
      const ended = prev.status === 'running' && p.status !== undefined && p.status !== 'running';
      return { tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...p } : t)), finished: s.finished + (ended ? 1 : 0) };
    }),
  dismiss: (id) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id || t.status === 'running');
      const i = s.tabs.findIndex((t) => t.id === id);
      const active = s.active === id ? (tabs[Math.min(i, tabs.length - 1)]?.id ?? null) : s.active;
      return { tabs, active };
    }),
  clearFinished: () =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.status === 'running');
      return { tabs, active: tabs.some((t) => t.id === s.active) ? s.active : (tabs[0]?.id ?? null) };
    }),
  show: (id) => set({ active: id, open: true }),
  setOpen: (open) => set({ open }),
}));

useSkillOps.subscribe((s) => {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ tabs: s.tabs, active: s.active, open: s.open } satisfies Saved));
  } catch {}
});

/** requests still waiting for their answer: the poller leaves those alone */
const inFlight = new Set<string>();
const newId = () => `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const fromServer = (op: SkillOp): Partial<OpTab> => ({ status: op.status, summary: op.summary, endedAt: op.endedAt, channel: op.channel });

/**
 * Start an operation in a new tab. `call` sends the request with the tab's id; its answer (or the error's) carries the
 * server operation. A refusal without one (409, 400) ends the tab as refused; a network error leaves it to the poller.
 */
export async function startOp(o: { kind: SkillOp['kind']; label: string; targets: string[]; call: (opId: string) => Promise<{ op?: SkillOp } | unknown> }): Promise<void> {
  const id = newId();
  const { add, patch } = useSkillOps.getState();
  add({ id, channel: `skills-op:${id}`, kind: o.kind, label: o.label, targets: o.targets, status: 'running', startedAt: new Date().toISOString(), endedAt: null, summary: null });
  inFlight.add(id);
  try {
    const r = (await o.call(id)) as { op?: SkillOp } | undefined;
    if (r?.op) patch(id, fromServer(r.op));
  } catch (e) {
    if (e instanceof ApiError && e.body?.op) patch(id, fromServer(e.body.op));
    else if (e instanceof ApiError) patch(id, { status: 'failed', refused: true, summary: `refused (${e.status}): ${e.message}`, endedAt: new Date().toISOString() });
  } finally {
    inFlight.delete(id);
  }
}

/** the running tab acting on `key`, if any */
export const useRunningOp = () => {
  const tabs = useSkillOps((s) => s.tabs);
  return (key: string) => tabs.find((t) => t.status === 'running' && t.targets.includes(key)) ?? null;
};

/**
 * Follow the running tabs whose request has already answered (background operations, or any after a reload), and on
 * mount pick up operations started elsewhere (another browser tab, the Setup page) that are still running.
 */
export function useOpsPoller() {
  useEffect(() => {
    let alive = true;
    api
      .skillOps()
      .then(({ ops }) => {
        if (!alive) return;
        const { tabs, add } = useSkillOps.getState();
        for (const op of ops.reverse()) if (op.status === 'running' && !tabs.some((t) => t.id === op.id)) add({ ...op, targets: [] });
      })
      .catch(() => {});
    const tick = async () => {
      for (const t of useSkillOps.getState().tabs) {
        if (t.status !== 'running' || t.refused || inFlight.has(t.id)) continue;
        try {
          useSkillOps.getState().patch(t.id, fromServer(await api.skillOp(t.id)));
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) useSkillOps.getState().patch(t.id, { status: 'failed', summary: 'lost — the server no longer knows this operation (it restarted?)', endedAt: new Date().toISOString() });
        }
      }
    };
    const timer = setInterval(() => void tick(), 2000);
    void tick();
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
}
