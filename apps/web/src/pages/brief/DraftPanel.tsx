import type { Brief, BriefCheck, BriefTask } from '@foundry/core/browser';
import { Check, ChevronDown, ChevronUp, Columns2, Sparkles, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { DraftProposal } from '../../api.ts';
import { OpenFull } from '../../components/FullTextDialog.tsx';
import { Markdown } from '../../components/Markdown.tsx';
import { Badge, Button, cn } from '../../ui.tsx';
import { fmtCost } from './shared.ts';

/** how one field of a proposal is shown */
export type FieldKind = 'markdown' | 'text' | 'list' | 'command';

/** one field a proposal changes or fills: what it was (null = nothing yet) and what it would be */
export interface FieldChange {
  label: string;
  kind: FieldKind;
  before: string | string[] | null;
  after: string | string[] | null;
}

/** the part of the Brief page an item belongs to, in the page's order */
export type Section = 'understanding' | 'areas' | 'tasks' | 'checks' | 'assumptions' | 'questions';
const SECTIONS: { id: Section; label: string }[] = [
  { id: 'understanding', label: 'Understanding' },
  { id: 'areas', label: 'Areas' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'checks', label: 'Checks' },
  { id: 'assumptions', label: 'Assumptions' },
  { id: 'questions', label: 'Questions' },
];

/** One acceptable piece of a proposal: applying it returns the next Brief. */
export interface ProposalItem {
  id: string;
  section: Section;
  /** what the item does to the Brief */
  op: 'add' | 'drop' | 'change' | 'fill';
  /** the thing: "Task T5", "Check C2", "Area A1", "Understanding", "PR title", "3 assumptions" */
  what: string;
  /** its title, when it has one */
  title?: string;
  /** the fields shown under the header; a drop shows none */
  fields: FieldChange[];
  apply: (b: Brief) => Brief;
}

/** items grouped by section, in the Brief page's order; empty sections left out */
export function sectionsOf(items: ProposalItem[]): { section: Section; label: string; items: ProposalItem[] }[] {
  return SECTIONS.map((s) => ({ section: s.id, label: s.label, items: items.filter((it) => it.section === s.id) })).filter((g) => g.items.length);
}

export type DiffSegment = { kind: 'same' | 'add' | 'del'; text: string };

/**
 * A word-level diff of two texts: what stays, what goes, what comes — whitespace kept with the words, so the
 * segments concatenate back to either text. Longest common subsequence over whitespace-separated tokens.
 */
export function diffWords(before: string, after: string): DiffSegment[] {
  const tok = (s: string) => s.split(/(\s+)/).filter((t) => t.length);
  const a = tok(before);
  const b = tok(after);
  const n = a.length;
  const m = b.length;
  // lcs[i][j] = length of the LCS of a[i:] and b[j:]
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: DiffSegment[] = [];
  const push = (kind: DiffSegment['kind'], text: string) => {
    const last = out.at(-1);
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      push('same', a[i]!);
      i++;
      j++;
    } else if (i < n && (j >= m || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) push('del', a[i++]!); // what goes is said before what comes
    else push('add', b[j++]!);
  }
  // whitespace alone never reads as a change: fold it into the run before it
  return out.reduce<DiffSegment[]>((acc, s) => {
    const last = acc.at(-1);
    if (s.kind !== 'same' && !s.text.trim() && last) last.text += s.text;
    else if (last && last.kind === s.kind) last.text += s.text;
    else acc.push({ ...s });
    return acc;
  }, []);
}

const LABELS: Record<string, string> = { spec: 'Spec', title: 'Title', kind: 'Kind', scope: 'Scope', scenario: 'Scenario', areaKey: 'Area', dependsOnKeys: 'Runs after', parallelizable: 'Parallel', relevantFiles: 'Start files', milestone: 'Milestone', milestoneScript: 'Milestone script', delivers: 'Delivers', difficulty: 'Difficulty', name: 'Name', tier: 'Tier', taskKey: 'Task', description: 'Description', slug: 'Scope slug' };
const LIST_FIELDS = new Set(['dependsOnKeys', 'relevantFiles', 'delivers']);
const PROSE_FIELDS = new Set(['spec', 'milestone', 'description', 'milestoneScript']);
const label = (field: string) => LABELS[field] ?? field;
const kindOf = (field: string): FieldKind => (LIST_FIELDS.has(field) ? 'list' : PROSE_FIELDS.has(field) ? 'markdown' : 'text');
const str = (v: unknown): string | null => (v == null || v === '' ? null : typeof v === 'string' ? v : typeof v === 'boolean' || typeof v === 'number' ? String(v) : JSON.stringify(v));
const field = (name: string, before: unknown, after: unknown): FieldChange => (LIST_FIELDS.has(name) ? { label: label(name), kind: 'list', before: Array.isArray(before) ? (before as string[]) : null, after: Array.isArray(after) ? (after as string[]) : null } : { label: label(name), kind: kindOf(name), before: str(before), after: str(after) });

/** a check's spec as a field: the command, or the reviewer's rubric */
function checkField(before: BriefCheck['spec'] | null, after: BriefCheck['spec']): FieldChange {
  const txt = (s: BriefCheck['spec'] | null) => (!s ? null : s.type === 'command' ? s.cmd : s.type === 'reviewer' ? s.rubric : JSON.stringify(s));
  return { label: after.type === 'command' ? 'Command' : after.type === 'reviewer' ? 'Reviewer rubric' : 'Check', kind: after.type === 'command' ? 'command' : 'markdown', before: txt(before), after: txt(after) };
}

/** a new task's fields, the spec first */
function taskFields(t: BriefTask, checks: BriefCheck[]): FieldChange[] {
  const fs: FieldChange[] = [field('spec', null, t.spec), { label: 'Kind · scenario · difficulty', kind: 'text', before: null, after: [t.kind, t.scenario, t.difficulty ?? 'standard'].join(' · ') }];
  if (t.areaKey) fs.push(field('areaKey', null, t.areaKey));
  if (t.dependsOnKeys.length) fs.push(field('dependsOnKeys', null, t.dependsOnKeys));
  if (t.relevantFiles.length) fs.push(field('relevantFiles', null, t.relevantFiles));
  if (t.delivers?.length) fs.push(field('delivers', null, t.delivers));
  if (t.milestone) fs.push(field('milestone', null, t.milestone));
  for (const c of checks) fs.push({ ...checkField(null, c.spec), label: `${c.tier === 'must' ? 'Must' : 'Stretch'} check — ${c.name}` });
  return fs;
}

const tierOf = (c: BriefCheck) => (c.tier === 'must' ? 'Must' : 'Stretch');

/** A revision becomes one item per changed thing, each applying only its own key. */
function revisionItems(p: DraftProposal): ProposalItem[] {
  const r = p.revision!;
  const d = r.diff;
  const items: ProposalItem[] = [];
  if (d.understanding) items.push({ id: 'understanding', section: 'understanding', op: 'change', what: 'Understanding', fields: [{ label: 'Understanding', kind: 'markdown', before: d.understanding.before, after: d.understanding.after }], apply: (b) => ({ ...b, understanding: r.revised.understanding }) });
  if (d.title) items.push({ id: 'title', section: 'understanding', op: d.title.before ? 'change' : 'fill', what: 'PR title', fields: [{ label: 'Title', kind: 'text', before: d.title.before || null, after: d.title.after }], apply: (b) => ({ ...b, title: r.revised.title }) });
  for (const a of d.areas.added) items.push({ id: `area+${a.key}`, section: 'areas', op: 'add', what: `Area ${a.key}`, title: a.name, fields: [field('description', null, a.description), field('slug', null, a.slug)], apply: (b) => ({ ...b, areas: b.areas.some((x) => x.key === a.key) ? b.areas : [...b.areas, a] }) });
  for (const a of d.areas.removed) items.push({ id: `area-${a.key}`, section: 'areas', op: 'drop', what: `Area ${a.key}`, title: `${a.name} (its tasks become unassigned)`, fields: [], apply: (b) => ({ ...b, areas: b.areas.filter((x) => x.key !== a.key), tasks: b.tasks.map((t) => (t.areaKey === a.key ? { ...t, areaKey: null } : t)) }) });
  for (const c of d.areas.changed) items.push({ id: `area~${c.key}`, section: 'areas', op: 'change', what: `Area ${c.key}`, title: c.after.name, fields: c.fields.map((f) => field(f.field, f.before, f.after)), apply: (b) => ({ ...b, areas: b.areas.map((x) => (x.key === c.key ? c.after : x)) }) });
  for (const t of d.tasks.added) {
    const own = r.revised.checks.filter((c) => c.taskKey === t.key);
    items.push({ id: `task+${t.key}`, section: 'tasks', op: 'add', what: `Task ${t.key}`, title: t.title, fields: taskFields(t, own), apply: (b) => ({ ...b, tasks: b.tasks.some((x) => x.key === t.key) ? b.tasks : [...b.tasks, t], checks: [...b.checks, ...own.filter((c) => !b.checks.some((x) => x.key === c.key))] }) });
  }
  for (const t of d.tasks.removed) items.push({ id: `task-${t.key}`, section: 'tasks', op: 'drop', what: `Task ${t.key}`, title: `${t.title} (and its checks)`, fields: [], apply: (b) => ({ ...b, tasks: b.tasks.filter((x) => x.key !== t.key).map((x) => ({ ...x, dependsOnKeys: x.dependsOnKeys.filter((k) => k !== t.key) })), checks: b.checks.filter((c) => c.taskKey !== t.key) }) });
  for (const c of d.tasks.changed) items.push({ id: `task~${c.key}`, section: 'tasks', op: 'change', what: `Task ${c.key}`, title: c.after.title, fields: c.fields.map((f) => field(f.field, f.before, f.after)), apply: (b) => ({ ...b, tasks: b.tasks.map((x) => (x.key === c.key ? { ...x, ...Object.fromEntries(c.fields.map((f) => [f.field, f.after])) } : x)) }) });
  const known = (b: Brief, key: string | null) => !key || b.tasks.some((t) => t.key === key) || r.diff.tasks.added.some((t) => t.key === key);
  for (const c of d.checks.added.filter((c) => !d.tasks.added.some((t) => t.key === c.taskKey))) items.push({ id: `check+${c.key}`, section: 'checks', op: 'add', what: `${tierOf(c)} check ${c.key}${c.taskKey ? ` on ${c.taskKey}` : ' on the goal'}`, title: c.name, fields: [checkField(null, c.spec)], apply: (b) => (known(b, c.taskKey) && !b.checks.some((x) => x.key === c.key) ? { ...b, checks: [...b.checks, c] } : b) });
  for (const c of d.checks.removed.filter((c) => !d.tasks.removed.some((t) => t.key === c.taskKey))) items.push({ id: `check-${c.key}`, section: 'checks', op: 'drop', what: `Check ${c.key}`, title: c.name, fields: [], apply: (b) => ({ ...b, checks: b.checks.filter((x) => x.key !== c.key) }) });
  for (const c of d.checks.changed) items.push({ id: `check~${c.key}`, section: 'checks', op: 'change', what: `Check ${c.key}`, title: c.after.name, fields: c.fields.map((f) => (f.field === 'spec' ? checkField(c.before.spec, c.after.spec) : field(f.field, f.before, f.after))), apply: (b) => ({ ...b, checks: b.checks.map((x) => (x.key === c.key ? c.after : x)) }) });
  if (d.newAssumptions.length) items.push({ id: 'assumptions', section: 'assumptions', op: 'add', what: `${d.newAssumptions.length} assumption${d.newAssumptions.length > 1 ? 's' : ''}`, fields: [{ label: 'Assumptions', kind: 'list', before: null, after: d.newAssumptions }], apply: (b) => ({ ...b, assumptions: [...b.assumptions, ...r.revised.assumptions.filter((a) => d.newAssumptions.includes(a.text) && !b.assumptions.some((x) => x.text === a.text))] }) });
  const newQ = r.revised.questions.filter((q) => !q.answer && !q.applied);
  const fresh = (b: Brief) => newQ.filter((q) => !b.questions.some((x) => x.id === q.id || x.text === q.text));
  if (newQ.length) items.push({ id: 'questions', section: 'questions', op: 'add', what: `${newQ.length} question${newQ.length > 1 ? 's' : ''} (non-blocking)`, fields: [{ label: 'Questions', kind: 'list', before: null, after: newQ.map((q) => q.text) }], apply: (b) => (fresh(b).length ? { ...b, questions: [...b.questions, ...fresh(b)] } : b) });
  return items;
}

/** Split a proposal into items the human accepts one by one. Nothing touches the Brief until accepted. */
export function proposalItems(p: DraftProposal): ProposalItem[] {
  if (p.revision) return revisionItems(p);
  const items: ProposalItem[] = [];
  if (p.task && p.taskKey) {
    const fields = p.task;
    const keys = Object.keys(fields) as (keyof typeof fields)[];
    if (keys.length) {
      items.push({
        id: 'task',
        section: 'tasks',
        op: 'fill',
        what: `Task ${p.taskKey}`,
        fields: keys.map((k) => field(k, null, fields[k])),
        apply: (b) => ({ ...b, tasks: b.tasks.map((t) => (t.key === p.taskKey ? { ...t, ...fields, ...(fields.spec && t.spec.trim() ? { spec: t.spec } : {}) } : t)) }),
      });
    }
  }
  for (const t of p.tasks) {
    const own = p.checks.filter((c) => c.taskKey === t.key);
    items.push({ id: `task:${t.key}`, section: 'tasks', op: 'add', what: `Task ${t.key}`, title: t.title, fields: taskFields(t, own), apply: (b) => ({ ...b, tasks: b.tasks.some((x) => x.key === t.key) ? b.tasks : [...b.tasks, t], checks: [...b.checks, ...own.filter((c) => !b.checks.some((x) => x.key === c.key))] }) });
  }
  for (const c of p.checks.filter((c) => !p.tasks.some((t) => t.key === c.taskKey))) {
    items.push({ id: `check:${c.key}`, section: 'checks', op: 'add', what: `${tierOf(c)} check${c.taskKey ? ` on ${c.taskKey}` : ''}`, title: c.name, fields: [checkField(null, c.spec)], apply: (b) => ({ ...b, checks: b.checks.some((x) => x.key === c.key) ? b.checks : [...b.checks, c] }) });
  }
  return items;
}

const OP: Record<ProposalItem['op'], { state: string; text: string }> = { add: { state: 'created', text: 'new' }, drop: { state: 'cancelled', text: 'drop' }, change: { state: 'pending', text: 'change' }, fill: { state: 'ready', text: 'fill in' } };

/** a small uppercase field label, as the task card has them */
const FieldLabel = ({ children }: { children: ReactNode }) => <div className="text-[11px] uppercase tracking-wide text-zinc-500">{children}</div>;

/** the words of a text with what went or came marked: not by colour alone, struck through and underlined too */
function Words({ segments, side }: { segments: DiffSegment[]; side: 'before' | 'after' }) {
  return (
    <>
      {segments.map((s, i) =>
        s.kind === 'same' ? (
          <span key={i}>{s.text}</span>
        ) : s.kind === 'del' && side === 'before' ? (
          <del key={i} className="rounded-sm bg-rose-500/15 px-0.5 text-rose-300 no-underline line-through decoration-rose-400/70">
            {s.text}
          </del>
        ) : s.kind === 'add' && side === 'after' ? (
          <ins key={i} className="rounded-sm bg-emerald-500/15 px-0.5 text-emerald-200 no-underline">
            {s.text}
          </ins>
        ) : null,
      )}
    </>
  );
}

/** when a prose field is long enough to clamp */
const LONG = 280;

/**
 * Prose: the new text as markdown, clamped with Show more when long; when there was a text before, Compare puts
 * the two side by side with the words that changed marked.
 */
function Prose({ f }: { f: FieldChange }) {
  const after = typeof f.after === 'string' ? f.after : '';
  const before = typeof f.before === 'string' ? f.before : null;
  const long = after.length > LONG || after.split('\n').length > 4;
  const [open, setOpen] = useState(!long);
  const [compare, setCompare] = useState(false);
  const segments = before != null && compare ? diffWords(before, after) : null;
  return (
    <div className="space-y-1.5">
      {segments ? (
        <div className="grid gap-2 md:grid-cols-2">
          {(['before', 'after'] as const).map((side) => (
            <div key={side} className={cn('rounded-md border border-zinc-800 surface-inset bg-zinc-950/60 px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap max-w-prose', side === 'before' && 'text-zinc-400')}>
              <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-1">{side}</div>
              <Words segments={segments} side={side} />
            </div>
          ))}
        </div>
      ) : (
        <div className="relative rounded-md border border-zinc-800 surface-inset bg-zinc-950/60 px-3 py-2 max-w-prose">
          <Markdown source={after} className={cn('text-sm', !open && 'line-clamp-4')} />
          <div className="absolute right-1 top-1">
            <OpenFull value={{ title: f.label, text: before ? `## After\n\n${after}\n\n## Before\n\n${before}` : after }} />
          </div>
        </div>
      )}
      <div className="flex items-center gap-3">
        {long && !segments && (
          <button type="button" className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />} {open ? 'Show less' : 'Show more'}
          </button>
        )}
        {before != null && (
          <button type="button" className={cn('inline-flex items-center gap-1 text-xs hover:text-zinc-200', compare ? 'text-sky-300' : 'text-zinc-400')} aria-pressed={compare} onClick={() => setCompare((v) => !v)}>
            <Columns2 size={12} aria-hidden="true" /> {compare ? 'Hide comparison' : 'Compare with before'}
          </button>
        )}
      </div>
    </div>
  );
}

/** a list field: what stays, what goes (struck through, –), what comes (+) */
function ListDiff({ f }: { f: FieldChange }) {
  const before = Array.isArray(f.before) ? f.before : [];
  const after = Array.isArray(f.after) ? f.after : [];
  const removed = before.filter((x) => !after.includes(x));
  const chips = [...after.map((x) => ({ x, tone: before.length && !before.includes(x) ? 'added' : 'kept' })), ...removed.map((x) => ({ x, tone: 'removed' }))];
  if (!chips.length) return <span className="text-sm text-zinc-500">none</span>;
  const prose = chips.some((c) => c.x.length > 60);
  if (prose) {
    return (
      <ul className="space-y-1 max-w-prose">
        {chips.map((c) => (
          <li key={`${c.tone}:${c.x}`} className={cn('flex gap-2 text-sm leading-relaxed', c.tone === 'removed' ? 'text-zinc-500 line-through' : c.tone === 'added' ? 'text-emerald-200' : 'text-zinc-200')}>
            <span className="shrink-0 w-3 text-zinc-500" aria-hidden="true">
              {c.tone === 'added' ? '+' : c.tone === 'removed' ? '–' : '•'}
            </span>
            <span>{c.x}</span>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <li key={`${c.tone}:${c.x}`} className={cn('mono text-xs rounded-md border px-2 py-1', c.tone === 'added' && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200', c.tone === 'kept' && 'border-zinc-700 text-zinc-300', c.tone === 'removed' && 'border-zinc-800 text-zinc-500 line-through')} title={c.tone === 'added' ? 'added' : c.tone === 'removed' ? 'removed' : undefined}>
          {c.tone === 'added' ? '+ ' : c.tone === 'removed' ? '– ' : ''}
          {c.x}
        </li>
      ))}
    </ul>
  );
}

/** one field of an item, in the shape its kind asks for */
function FieldView({ f }: { f: FieldChange }) {
  if (f.kind === 'markdown') return <Prose f={f} />;
  if (f.kind === 'list') return <ListDiff f={f} />;
  const before = typeof f.before === 'string' ? f.before : null;
  const after = typeof f.after === 'string' ? f.after : null;
  if (f.kind === 'command') {
    return (
      <div className="space-y-1 mono text-xs">
        {before && before !== after && (
          <div className="rounded-md border border-zinc-800 surface-inset bg-zinc-950/60 px-2.5 py-1.5 text-zinc-500 line-through break-all">$ {before}</div>
        )}
        <div className="rounded-md border border-zinc-800 surface-inset bg-zinc-950/60 px-2.5 py-1.5 text-zinc-200 break-all">$ {after}</div>
      </div>
    );
  }
  if (!after) return <div className="text-sm text-zinc-500">none{before ? <span className="ml-2 line-through text-zinc-500">{before}</span> : ''}</div>;
  if (before && before !== after) {
    const segs = diffWords(before, after);
    return (
      <div className="text-sm text-zinc-200 leading-relaxed max-w-prose">
        <Words segments={segs} side="before" />
        {segs.some((s) => s.kind === 'del') && <span className="mx-1.5 text-zinc-500" aria-hidden="true">→</span>}
        <Words segments={segs} side="after" />
      </div>
    );
  }
  return <div className="text-sm text-zinc-200 max-w-prose">{after}</div>;
}

/**
 * A proposal as a review checklist: every change grouped as the Brief page is (Understanding, Areas, Tasks, Checks,
 * Assumptions, Questions), each with what it does, the fields it touches and the words that change; the person
 * unticks what they do not want and applies the rest in one go. Nothing touches the Brief until Apply; applied and
 * skipped rows stay, marked, so what happened stays visible.
 */
export function DraftPanel({ proposal, onApply, onClose }: { proposal: DraftProposal; onApply: (fn: (b: Brief) => Brief) => void; onClose: () => void }) {
  const [items] = useState(() => proposalItems(proposal));
  const [picked, setPicked] = useState<Set<string>>(() => new Set(items.map((it) => it.id)));
  const [applied, setApplied] = useState<Set<string> | null>(null);
  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const apply = () => {
    const chosen = items.filter((it) => picked.has(it.id));
    onApply((b) => chosen.reduce((acc, it) => it.apply(acc), b));
    setApplied(new Set(chosen.map((it) => it.id)));
  };
  const cost = proposal.costAvailable === false ? 'cost unavailable' : fmtCost(proposal.costUsd);
  const groups = sectionsOf(items);
  return (
    <section className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 sm:p-4 space-y-4" aria-label="Proposal">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-200">
            <Sparkles size={14} aria-hidden="true" /> Proposal
          </div>
          <div className="text-xs text-zinc-500">
            {cost} · {items.length} change{items.length === 1 ? '' : 's'} · {applied ? `${applied.size} applied, ${items.length - applied.size} skipped` : `${picked.size} selected`}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {applied ? (
            <Button size="sm" variant="ghost" onClick={onClose}>
              <X size={12} aria-hidden="true" /> Close
            </Button>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={onClose} title="Close without changing the Brief">
                <X size={12} aria-hidden="true" /> Discard
              </Button>
              <Button size="sm" variant="primary" disabled={!picked.size} onClick={apply} title="Put the selected changes into the Brief; press Save edits afterwards to keep them">
                <Check size={12} aria-hidden="true" /> Apply {picked.size ? `${picked.size} selected` : 'selected'}
              </Button>
            </>
          )}
        </div>
      </div>
      {proposal.rationale && <p className="text-sm text-zinc-300 leading-relaxed max-w-prose">{proposal.rationale}</p>}
      {applied && (
        <p className="flex items-center gap-1.5 text-sm text-emerald-200" role="status">
          <Check size={14} aria-hidden="true" /> {applied.size ? `${applied.size} change${applied.size === 1 ? '' : 's'} put into the Brief. Press Save edits to keep them.` : 'Nothing was applied.'}
        </p>
      )}
      {items.length === 0 && <div className="text-sm text-zinc-500">Nothing to change.</div>}
      {groups.map((g) => (
        <div key={g.section} className="space-y-2">
          <h4 className="text-[11px] uppercase tracking-wide text-zinc-500">
            {g.label} <span className="text-zinc-600">· {g.items.length}</span>
          </h4>
          {g.items.map((it) => {
            const on = picked.has(it.id);
            const done = applied ? (applied.has(it.id) ? 'applied' : 'skipped') : null;
            // which fields a change touches, when there are several: one field says its own name right below
            const fieldNames = it.op === 'change' && it.fields.length > 1 ? it.fields.map((f) => f.label.toLowerCase()).join(', ') : null;
            return (
              <div key={it.id} className={cn('rounded-md border surface-card bg-zinc-900/60', done === 'skipped' || (!done && !on) ? 'border-zinc-800/60 opacity-60' : 'border-zinc-800')}>
                <label className={cn('flex items-start gap-3 px-3 py-2.5 min-h-11', !done && 'cursor-pointer')}>
                  {done ? (
                    <span className="pt-0.5">{done === 'applied' ? <Badge state="passed">applied</Badge> : <Badge state="skipped">skipped</Badge>}</span>
                  ) : (
                    <input type="checkbox" className="mt-1 size-4 shrink-0 accent-emerald-500" checked={on} onChange={() => toggle(it.id)} aria-label={`Include ${it.what}${it.title ? ` — ${it.title}` : ''}`} />
                  )}
                  <span className="min-w-0 flex-1 space-y-0.5">
                    <span className="flex items-center gap-2 flex-wrap">
                      <Badge state={OP[it.op].state}>{OP[it.op].text}</Badge>
                      <span className="text-sm font-medium text-zinc-100">{it.what}</span>
                      {it.title && <span className="text-sm text-zinc-300">— {it.title}</span>}
                    </span>
                    {fieldNames && <span className="block text-xs text-zinc-500">{fieldNames}</span>}
                  </span>
                </label>
                {!done && on && it.fields.length > 0 && (
                  <div className="px-3 pb-3 pl-10 space-y-3">
                    {it.fields.map((f, i) => (
                      <div key={`${f.label}-${i}`} className="space-y-1">
                        <FieldLabel>{f.label}</FieldLabel>
                        <FieldView f={f} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}
