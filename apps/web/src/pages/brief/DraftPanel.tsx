import type { Brief, BriefCheck, BriefTask } from '@foundry/core/browser';
import { Check, ChevronRight, CircleCheck, Sparkles, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { DraftProposal } from '../../api.ts';
import { Button, ButtonGroup, EmptyState, Modal, cn } from '../../ui.tsx';
import { type BriefSection, SECTION_STYLE, fmtCost } from './shared.ts';

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
  /** the fields shown in the item's window; a drop shows none */
  fields: FieldChange[];
  apply: (b: Brief) => Brief;
}

/** the Brief page section (and so the icon and the colour) each proposal section belongs to */
const PART_OF: Record<Section, BriefSection> = { understanding: 'understanding', areas: 'areas', tasks: 'plan', checks: 'acceptance', assumptions: 'assumptions', questions: 'questions' };

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

/** what an item does, as a dot and a word: colour and text together, never colour alone (added green, dropped red, changed blue) */
const OP: Record<ProposalItem['op'], { dot: string; text: string }> = { add: { dot: 'bg-ok', text: 'new' }, drop: { dot: 'bg-bad', text: 'dropped' }, change: { dot: 'bg-work', text: 'changed' }, fill: { dot: 'bg-extra', text: 'filled in' } };
const OpMark = ({ op }: { op: ProposalItem['op'] }) => (
  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-soft w-16 shrink-0">
    <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', OP[op].dot)} aria-hidden="true" />
    {OP[op].text}
  </span>
);

/** one line on what an item touches, for its row */
function summaryOf(it: ProposalItem): string {
  if (it.op === 'drop') return 'removed from the Brief';
  if (it.op === 'change') return it.fields.map((f) => f.label.toLowerCase()).join(', ');
  const first = it.fields[0];
  const text = typeof first?.after === 'string' ? first.after : Array.isArray(first?.after) ? first.after.join(', ') : '';
  return text.replace(/\s+/g, ' ').slice(0, 140);
}

/** the words of a text with what went and came marked: struck through and underlined as well as coloured */
function Words({ segments, show }: { segments: DiffSegment[]; show: 'before' | 'after' | 'both' }) {
  return (
    <>
      {segments.map((s, i) => {
        if (s.kind === 'same') return <span key={i}>{s.text}</span>;
        if (s.kind === 'del' && show !== 'after')
          return (
            <del key={i} className="rounded-sm bg-bad/15 px-0.5 text-bad-ink line-through decoration-bad/70">
              {s.text}
            </del>
          );
        if (s.kind === 'add' && show !== 'before')
          return (
            <ins key={i} className="rounded-sm bg-ok/15 px-0.5 text-ok-ink no-underline">
              {s.text}
            </ins>
          );
        return null;
      })}
    </>
  );
}

type ViewMode = 'inline' | 'split';

const pane = 'rounded-md border border-line bg-sunken px-3 py-2 text-sm leading-relaxed text-ink whitespace-pre-wrap break-words';
const PaneLabel = ({ children }: { children: ReactNode }) => <div className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-faint mb-1">{children}</div>;

/** one field in the item's window: inline marks in one flow, or the old and the new side by side */
function FieldView({ f, mode }: { f: FieldChange; mode: ViewMode }) {
  if (f.kind === 'list') {
    const before = Array.isArray(f.before) ? f.before : [];
    const after = Array.isArray(f.after) ? f.after : [];
    const removed = before.filter((x) => !after.includes(x));
    const line = (x: string, tone: 'added' | 'removed' | 'kept') => (
      <li key={`${tone}:${x}`} className={cn('flex gap-2 text-sm leading-relaxed', tone === 'removed' ? 'text-ink-faint line-through' : tone === 'added' ? 'text-ok-ink' : 'text-ink')}>
        <span className="w-3 shrink-0 text-ink-faint" aria-hidden="true">
          {tone === 'added' ? '+' : tone === 'removed' ? '–' : '•'}
        </span>
        <span className={cn(x.length <= 60 && 'mono text-xs leading-relaxed')}>{x}</span>
      </li>
    );
    if (mode === 'split' && before.length)
      return (
        <div className="grid gap-2 md:grid-cols-2">
          <div className={pane}>
            <PaneLabel>Before</PaneLabel>
            <ul className="space-y-0.5">{before.map((x) => line(x, 'kept'))}</ul>
          </div>
          <div className={pane}>
            <PaneLabel>After</PaneLabel>
            <ul className="space-y-0.5">{after.map((x) => line(x, before.includes(x) ? 'kept' : 'added'))}</ul>
          </div>
        </div>
      );
    return (
      <ul className="space-y-0.5">
        {after.map((x) => line(x, before.length && !before.includes(x) ? 'added' : 'kept'))}
        {removed.map((x) => line(x, 'removed'))}
        {!after.length && !removed.length && <li className="text-sm text-ink-faint">none</li>}
      </ul>
    );
  }
  const before = typeof f.before === 'string' ? f.before : null;
  const after = typeof f.after === 'string' ? f.after : null;
  const mono = f.kind === 'command';
  const cls = cn(pane, mono && 'mono text-xs');
  if (!before || before === after) {
    return <div className={cls}>{mono && after ? `$ ${after}` : after ?? <span className="text-ink-faint">none</span>}</div>;
  }
  const segments = diffWords(before, after ?? '');
  if (mode === 'split')
    return (
      <div className="grid gap-2 md:grid-cols-2">
        <div className={cn(cls, 'text-ink-soft')}>
          <PaneLabel>Before</PaneLabel>
          {mono && '$ '}
          <Words segments={segments} show="before" />
        </div>
        <div className={cls}>
          <PaneLabel>After</PaneLabel>
          {mono && '$ '}
          <Words segments={segments} show="after" />
        </div>
      </div>
    );
  return (
    <div className={cls}>
      {mono && '$ '}
      <Words segments={segments} show="both" />
    </div>
  );
}

/** an item's window: its fields with the words that change, inline or side by side, and whether it goes in */
function ItemDialog({ it, included, done, onInclude, onClose }: { it: ProposalItem; included: boolean; done: 'applied' | 'skipped' | null; onInclude: (v: boolean) => void; onClose: () => void }) {
  const comparable = it.fields.some((f) => f.before != null && JSON.stringify(f.before) !== JSON.stringify(f.after));
  const [mode, setMode] = useState<ViewMode>('inline');
  return (
    <Modal open title={`${it.what}${it.title ? ` — ${it.title}` : ''}`} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <OpMark op={it.op} />
          {comparable && (
            <ButtonGroup
              label="How to show the change"
              value={mode}
              onChange={setMode}
              options={[
                { id: 'inline', label: 'Inline', title: 'One text, what goes struck through and what comes marked' },
                { id: 'split', label: 'Side by side', title: 'The old text and the new text next to each other' },
              ]}
            />
          )}
          {it.op === 'drop' && <span className="text-sm text-ink-soft">This is removed from the Brief when applied.</span>}
        </div>
        {it.fields.map((f, i) => (
          <div key={`${f.label}-${i}`} className="space-y-1">
            <div className="text-xs font-semibold text-ink-soft">{f.label}</div>
            <FieldView f={f} mode={mode} />
          </div>
        ))}
        <div className="flex items-center gap-3 flex-wrap border-t border-line pt-3">
          {done ? (
            <span className="text-sm text-ink-soft">{done === 'applied' ? 'Applied to the Brief.' : 'Skipped.'}</span>
          ) : (
            <label className="flex items-center gap-2 text-sm text-ink cursor-pointer min-h-11">
              <input type="checkbox" className="size-4" checked={included} onChange={(e) => onInclude(e.target.checked)} /> Include when applying
            </label>
          )}
          <Button size="sm" className="ml-auto" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * A proposal as a short checklist: one row per change (what it does, what it is, what it touches), a checkbox each,
 * one Apply for the ticked ones; a row opens its window with the words that change, inline or side by side. Nothing
 * touches the Brief until Apply; applied and skipped rows stay, marked.
 */
export function DraftPanel({ proposal, onApply, onClose }: { proposal: DraftProposal; onApply: (fn: (b: Brief) => Brief) => void; onClose: () => void }) {
  const [items] = useState(() => proposalItems(proposal));
  const [picked, setPicked] = useState<Set<string>>(() => new Set(items.map((it) => it.id)));
  const [applied, setApplied] = useState<Set<string> | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const include = (id: string, on: boolean) =>
    setPicked((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const apply = () => {
    const chosen = items.filter((it) => picked.has(it.id));
    onApply((b) => chosen.reduce((acc, it) => it.apply(acc), b));
    setApplied(new Set(chosen.map((it) => it.id)));
  };
  const cost = proposal.costAvailable === false ? 'cost unavailable' : fmtCost(proposal.costUsd);
  const groups = sectionsOf(items);
  const open = openId ? items.find((it) => it.id === openId) : null;
  const doneOf = (id: string): 'applied' | 'skipped' | null => (applied ? (applied.has(id) ? 'applied' : 'skipped') : null);
  return (
    <section className="rounded-lg border border-line bg-panel" aria-label="Proposal">
      <div className="flex items-center gap-3 flex-wrap px-3 sm:px-4 py-3 border-b border-line">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[12.5px] font-extrabold caps text-ink">
            <Sparkles size={14} aria-hidden="true" /> Proposal
          </div>
          <div className="mt-0.5 text-xs text-ink-faint">
            <span className={cn(proposal.costAvailable !== false && 'mono')}>{cost}</span> · {items.length} change{items.length === 1 ? '' : 's'} · {applied ? `${applied.size} applied, ${items.length - applied.size} skipped` : `${picked.size} selected`}
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
      {(proposal.rationale || applied) && (
        <div className="px-3 sm:px-4 py-3 border-b border-line space-y-2">
          {proposal.rationale && <p className="text-sm text-ink-soft leading-relaxed max-w-prose">{proposal.rationale}</p>}
          {applied && (
            <p className="flex items-center gap-1.5 text-sm font-semibold text-ok-ink" role="status">
              <Check size={14} aria-hidden="true" /> {applied.size ? `${applied.size} change${applied.size === 1 ? '' : 's'} put into the Brief. Press Save edits to keep them.` : 'Nothing was applied.'}
            </p>
          )}
        </div>
      )}
      {items.length === 0 && <EmptyState size="card" icon={CircleCheck} tone="ok" title="Nothing to change">This proposal leaves the Brief as it is.</EmptyState>}
      {groups.map((g) => {
        const { Icon, ink, bar } = SECTION_STYLE[PART_OF[g.section]];
        return (
        <div key={g.section} className="pb-1">
          <div className="flex items-center gap-1.5 px-3 sm:px-4 pt-3 pb-1.5 text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-faint">
            <Icon size={12} className={ink} aria-hidden="true" /> {g.label} <span className="mono tracking-normal">· {g.items.length}</span>
          </div>
          {/* each row edged in its section's colour, the one the Brief page codes that section with; hovering one tints it */}
          <ul className="px-2 sm:px-3 space-y-0.5">
            {g.items.map((it) => {
              const done = doneOf(it.id);
              const on = picked.has(it.id);
              const dim = done === 'skipped' || (!done && !on);
              return (
                <li key={it.id} className={cn('flex items-center gap-3 rounded-md border-l-[3px] pl-3 pr-2 min-h-11 transition-colors hover:bg-sunken', bar, dim && 'opacity-60')}>
                  {done ? (
                    <span className={cn('w-4 shrink-0 text-center text-xs', done === 'applied' ? 'text-ok-ink' : 'text-ink-faint')} title={done}>
                      {done === 'applied' ? <Check size={14} aria-label="applied" /> : <X size={14} aria-label="skipped" />}
                    </span>
                  ) : (
                    <input type="checkbox" className="size-4 shrink-0" checked={on} onChange={(e) => include(it.id, e.target.checked)} aria-label={`Include ${it.what}${it.title ? ` — ${it.title}` : ''}`} />
                  )}
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left" onClick={() => setOpenId(it.id)} title="Open this change">
                    <OpMark op={it.op} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">
                        <span className="font-bold">{it.what}</span>
                        {it.title && <span className="text-ink-soft"> · {it.title}</span>}
                      </span>
                      <span className="block truncate text-xs text-ink-faint">{summaryOf(it)}</span>
                    </span>
                    <ChevronRight size={14} className="shrink-0 text-ink-faint" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        );
      })}
      {open && <ItemDialog key={open.id} it={open} included={picked.has(open.id)} done={doneOf(open.id)} onInclude={(v) => include(open.id, v)} onClose={() => setOpenId(null)} />}
    </section>
  );
}
