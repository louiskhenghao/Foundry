import type { EngineEvent } from '../events.ts';
import type { Goal, Task } from '../schema/index.ts';

/**
 * What a stretch of a goal's time went to: Clarify (its sessions and its phase), waiting for the person, a worker's
 * session, a review (a task's, the goal's, a milestone's), landing a task, the delivery, anything else Foundry ran; and
 * `run`, a goal working or a Delegated goal doing its task, the bar the others sit on.
 */
export type SpanKind = 'clarify' | 'waiting' | 'work' | 'review' | 'merge' | 'delivery' | 'other' | 'run';

export interface TimelineSpan {
  kind: SpanKind;
  label: string;
  start: string;
  end: string;
  /** still going: `end` is the time the timeline was made */
  open?: boolean;
  costUsd?: number | null;
}

export interface TimelineRow {
  id: string;
  label: string;
  /** 0: the goal; 1: its sessions and tasks, or a Delegated goal; 2: a Delegated goal's own sessions and tasks */
  level: number;
  kind: 'goal' | 'sessions' | 'task' | 'delegated';
  goalId: string;
  taskId: string | null;
  spans: TimelineSpan[];
}

export interface GoalTimeline {
  goalId: string;
  start: string;
  end: string;
  /** the goal, or one of its Delegated goals, still works: `end` is now */
  live: boolean;
  rows: TimelineRow[];
  /**
   * Where the time went, in milliseconds. `wall`: start to end. `waiting`: the time someone waited for the person (when
   * several things waited at once, counted once). The rest add up session time, which runs side by side: they can
   * together exceed `wall`. `delivery` is the delivery's own time.
   */
  totals: { wall: number; waiting: number; clarify: number; work: number; review: number; merge: number; delivery: number; other: number };
  /** the longest steps, longest first: a wait, a session, a phase, a whole Delegated goal */
  longest: { row: string; span: TimelineSpan; ms: number }[];
}

/** what the timeline of one goal is made from */
export interface TimelineInput {
  goal: Pick<Goal, 'id' | 'title' | 'createdAt' | 'state'>;
  /** in plan order */
  tasks: Pick<Task, 'id' | 'title' | 'delegatedGoalId'>[];
  /** its events, oldest first (the types TIMELINE_EVENTS lists are enough) */
  events: EngineEvent[];
}

/** the event types a timeline is made from */
export const TIMELINE_EVENTS = ['goal.created', 'goal.state_changed', 'interview.round_asked', 'interview.round_answered', 'session.usage', 'attempt.started', 'attempt.session_finished', 'attempt.concluded', 'merge.started', 'merge.completed', 'task.delegated', 'task.state_changed', 'delivery.started', 'delivery.completed'] as const;

const TERMINAL = new Set(['done', 'over_delivered', 'failed', 'cancelled']);
/** sessions a task's row shows (from its attempts), and sessions too small to show */
const TASK_SESSIONS = new Set(['attempt', 'review-task', 'merge', 'distill', 'probe']);
/** a goal's own sessions, by the kind Foundry records them under */
const SESSION_KINDS: Record<string, { kind: SpanKind; label: string }> = {
  clarify: { kind: 'clarify', label: 'Clarify' },
  planner: { kind: 'clarify', label: 'Planner' },
  investigation: { kind: 'clarify', label: 'Investigation of the references' },
  'style-sample': { kind: 'other', label: 'Style sample' },
  'subject-search': { kind: 'other', label: 'Subject pictures' },
  'review-goal': { kind: 'review', label: 'Goal review' },
  walkthrough: { kind: 'review', label: 'Milestone walkthrough' },
  likeness: { kind: 'review', label: 'Likeness review' },
  feedback: { kind: 'review', label: 'Feedback triage' },
  audit: { kind: 'review', label: 'Audit' },
  docs: { kind: 'other', label: 'Docs' },
  suggest: { kind: 'other', label: 'Suggest a hint' },
  learnings: { kind: 'other', label: 'Learnings' },
};
/** what a goal's state means on its row; null: no bar (it has not started, or it ended) */
const PHASES: Record<string, { kind: SpanKind; label: string } | null> = {
  draft: null,
  clarifying: { kind: 'clarify', label: 'Clarify' },
  awaiting_brief_approval: { kind: 'waiting', label: 'The Brief waits for you' },
  running: { kind: 'run', label: 'Running' },
  goal_review: { kind: 'review', label: 'Goal review' },
  blocked: { kind: 'waiting', label: 'Blocked' },
  awaiting_feedback: { kind: 'waiting', label: 'Have a look' },
};

const ms = (s: TimelineSpan) => Date.parse(s.end) - Date.parse(s.start);
const later = (a: string, b: string) => (a > b ? a : b);

/** the stretches of a goal by its state, the interview's open rounds cut out of Clarify as waits for the person */
function phases(input: TimelineInput, now: string): TimelineSpan[] {
  const changes = input.events.filter((e): e is Extract<EngineEvent, { type: 'goal.state_changed' }> => e.type === 'goal.state_changed');
  const out: TimelineSpan[] = [];
  let state: string = 'draft';
  let since = input.goal.createdAt;
  const close = (until: string, open: boolean) => {
    const p = PHASES[state];
    if (p && until > since) out.push({ ...p, label: state === 'blocked' && blockedWhy ? `Blocked: ${blockedWhy}` : p.label, start: since, end: until, ...(open ? { open: true } : {}) });
  };
  let blockedWhy = '';
  for (const e of changes) {
    close(e.ts, false);
    state = e.payload.to;
    since = e.ts;
    blockedWhy = state === 'blocked' ? e.payload.reason.slice(0, 80) : '';
  }
  if (!TERMINAL.has(state)) close(now, true);
  // an interview round asked and not yet answered is a wait inside Clarify
  const waits: TimelineSpan[] = [];
  for (const e of input.events) {
    if (e.type !== 'interview.round_asked') continue;
    const answered = input.events.find((a) => a.type === 'interview.round_answered' && a.payload.round === e.payload.round && a.ts >= e.ts);
    waits.push({ kind: 'waiting', label: `Interview round ${e.payload.round} waits for you`, start: e.ts, end: answered?.ts ?? now, ...(answered ? {} : { open: true }) });
  }
  return carve(out, waits);
}

/** spans with the waits laid over them: a span the waits cover in part is cut around them */
function carve(spans: TimelineSpan[], waits: TimelineSpan[]): TimelineSpan[] {
  let out = spans;
  for (const w of waits) {
    out = out.flatMap((s) => {
      if (w.end <= s.start || w.start >= s.end) return [s];
      const parts: TimelineSpan[] = [];
      if (w.start > s.start) parts.push({ ...s, end: w.start, open: undefined });
      if (w.end < s.end) parts.push({ ...s, start: w.end });
      return parts;
    });
  }
  return [...out, ...waits].sort((a, b) => a.start.localeCompare(b.start));
}

/** Foundry's own sessions of a goal (Clarify, reviews, docs…), from what it recorded of each */
function sessions(input: TimelineInput): TimelineSpan[] {
  const out: TimelineSpan[] = [];
  for (const e of input.events) {
    if (e.type !== 'session.usage' || TASK_SESSIONS.has(e.payload.kind)) continue;
    const k = SESSION_KINDS[e.payload.kind] ?? { kind: 'other' as const, label: e.payload.kind };
    const start = new Date(Date.parse(e.ts) - Math.max(0, e.payload.durationMs)).toISOString();
    out.push({ ...k, start, end: e.ts, costUsd: e.payload.costUsd });
  }
  return out;
}

/** one task's sessions (its attempts, their reviews, merge attempts) and its landing; a task still working shows to now */
function taskSpans(input: TimelineInput, taskId: string, now: string, live: boolean): TimelineSpan[] {
  const attempts = new Map<string, { index: number; startedAt: string }>();
  for (const e of input.events) if (e.type === 'attempt.started' && e.payload.attempt.taskId === taskId) attempts.set(e.payload.attempt.id, { index: e.payload.attempt.index, startedAt: e.payload.attempt.startedAt });
  const out: TimelineSpan[] = [];
  const ended = new Set<string>();
  /** where each attempt's recorded sessions got to: what runs now started after it */
  const reached = new Map<string, string>();
  for (const e of input.events) {
    if (e.type === 'attempt.session_finished' && attempts.has(e.payload.attemptId)) {
      const s = e.payload.session;
      const a = attempts.get(e.payload.attemptId)!;
      reached.set(e.payload.attemptId, later(reached.get(e.payload.attemptId) ?? a.startedAt, s.endedAt));
      out.push({ kind: s.role === 'worker' ? 'work' : s.role === 'reviewer' ? 'review' : 'merge', label: s.role === 'worker' ? `Attempt ${a.index}${s.segment ? ` (continued)` : ''}` : s.role === 'reviewer' ? `Review of attempt ${a.index}` : 'Merge attempt', start: s.startedAt, end: s.endedAt, costUsd: s.costUsd });
    }
    if (e.type === 'attempt.concluded' && attempts.has(e.payload.attemptId)) ended.add(e.payload.attemptId);
    if (e.type === 'merge.started' && e.payload.taskId === taskId) {
      // this landing ends at the first completion after it, unless the task started landing again before that
      const next = input.events.find((x) => x.type === 'merge.started' && x.payload.taskId === taskId && x.ts > e.ts);
      const done = input.events.find((x) => x.type === 'merge.completed' && x.payload.taskId === taskId && x.ts >= e.ts && (!next || x.ts <= next.ts));
      if (done || (live && !next)) out.push({ kind: 'merge', label: 'Landing', start: e.ts, end: done?.ts ?? now, ...(done ? {} : { open: true }) });
    }
  }
  // the attempt working now: from its start to now
  if (live) for (const [id, a] of attempts) if (!ended.has(id)) out.push({ kind: 'work', label: `Attempt ${a.index}`, start: reached.get(id) ?? a.startedAt, end: now, open: true });
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/** the rows of one goal: its phases, its own sessions, and its tasks (a delegated task followed by its goal's rows) */
function rowsOf(input: TimelineInput, level: number, now: string, delegated: Map<string, TimelineInput>, live: (g: TimelineInput) => boolean): TimelineRow[] {
  const g = input.goal;
  const isLive = live(input);
  const rows: TimelineRow[] = [
    { id: `goal:${g.id}`, label: level === 0 ? g.title : `Delegated goal: ${g.title}`, level, kind: level === 0 ? 'goal' : 'delegated', goalId: g.id, taskId: null, spans: phases(input, now) },
  ];
  const own = sessions(input);
  if (own.length) rows.push({ id: `sessions:${g.id}`, label: 'Clarify, reviews and other sessions', level: level + 1, kind: 'sessions', goalId: g.id, taskId: null, spans: own });
  for (const t of input.tasks) {
    const child = t.delegatedGoalId ? delegated.get(t.delegatedGoalId) : undefined;
    const spans = taskSpans(input, t.id, now, isLive);
    if (child) {
      // the task's own bar is the Delegated goal's whole run, from its start until the task landed
      const startedAt = input.events.find((e) => e.type === 'task.delegated' && e.payload.taskId === t.id)?.ts ?? child.goal.createdAt;
      const landed = input.events.find((e) => e.type === 'task.state_changed' && e.payload.taskId === t.id && e.payload.to === 'done' && e.ts >= startedAt)?.ts;
      if (landed || isLive) spans.unshift({ kind: 'run', label: `Delegated goal: ${child.goal.title}`, start: startedAt, end: landed ?? now, ...(landed ? {} : { open: true }) });
    }
    rows.push({ id: `task:${t.id}`, label: t.title, level: level + 1, kind: 'task', goalId: g.id, taskId: t.id, spans });
    if (child && level === 0) rows.push(...rowsOf(child, level + 1, now, delegated, live));
  }
  return rows;
}

/** the union of a set of spans' time, overlaps counted once */
function union(spans: TimelineSpan[]): number {
  const sorted = [...spans].sort((a, b) => a.start.localeCompare(b.start));
  let total = 0;
  let curStart = '';
  let curEnd = '';
  for (const s of sorted) {
    if (!curEnd || s.start > curEnd) {
      if (curEnd) total += Date.parse(curEnd) - Date.parse(curStart);
      curStart = s.start;
      curEnd = s.end;
    } else curEnd = later(curEnd, s.end);
  }
  if (curEnd) total += Date.parse(curEnd) - Date.parse(curStart);
  return total;
}

/**
 * A goal's timeline with its Delegated goals: when each step ran and how long it took, so the step that took longest
 * shows at a glance. `now` ends whatever is still going.
 */
export function buildTimeline(main: TimelineInput, delegated: TimelineInput[], now: string): GoalTimeline {
  const byId = new Map(delegated.map((d) => [d.goal.id, d]));
  const live = (g: TimelineInput) => !TERMINAL.has(g.goal.state);
  const rows = rowsOf(main, 0, now, byId, live);
  const anyLive = live(main) || delegated.some(live);
  // the delivery runs after the goal is done: its own bar on the goal's row, still going until it completes
  const deliveries: TimelineSpan[] = main.events.filter((e) => e.type === 'delivery.started').map((e) => {
    const next = main.events.find((x) => x.type === 'delivery.started' && x.ts > e.ts);
    const done = main.events.find((x) => x.type === 'delivery.completed' && x.ts >= e.ts && (!next || x.ts <= next.ts));
    return done ? { kind: 'delivery', label: 'Delivery', start: e.ts, end: done.ts } : { kind: 'delivery', label: 'Delivery', start: e.ts, end: next?.ts ?? now, ...(next ? {} : { open: true }) };
  });
  const delivering = deliveries.some((d) => d.open);
  if (deliveries.length) rows[0]!.spans = [...rows[0]!.spans, ...deliveries].sort((a, b) => a.start.localeCompare(b.start));
  const all = rows.flatMap((r) => r.spans.map((span) => ({ row: r, span })));
  const start = [main.goal.createdAt, ...all.map((x) => x.span.start)].reduce((a, b) => (b < a ? b : a));
  const lastChange = main.events.filter((e) => e.type === 'goal.state_changed').at(-1)?.ts ?? main.goal.createdAt;
  const end = anyLive || delivering ? now : [lastChange, ...all.map((x) => x.span.end)].reduce(later);
  const sum = (k: SpanKind, kinds: TimelineRow['kind'][] = ['sessions', 'task']) => all.filter((x) => x.span.kind === k && kinds.includes(x.row.kind)).reduce((n, x) => n + ms(x.span), 0);
  return {
    goalId: main.goal.id,
    start,
    end,
    live: anyLive || delivering,
    rows,
    totals: {
      wall: Date.parse(end) - Date.parse(start),
      waiting: union(all.filter((x) => x.span.kind === 'waiting').map((x) => x.span)),
      clarify: sum('clarify'),
      work: sum('work'),
      review: sum('review'),
      merge: sum('merge'),
      delivery: deliveries.reduce((n, d) => n + ms(d), 0),
      other: sum('other'),
    },
    // a goal working is the bar the others sit on, not a step; a Delegated goal's whole run is one
    longest: all
      .filter((x) => !(x.span.kind === 'run' && (x.row.kind === 'goal' || x.row.kind === 'delegated')))
      .map((x) => ({ row: x.row.label, span: x.span, ms: ms(x.span) }))
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 6),
  };
}
