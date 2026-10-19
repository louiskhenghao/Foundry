import type { Brief, BriefCheck, BriefTask } from '@foundry/core/browser';
import { Check, ChevronDown, ChevronRight, Sparkles, X } from 'lucide-react';
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

/** One acceptable piece of a proposal: applying it returns the next Brief. */
export interface ProposalItem {
  id: string;
  /** what the item does to the Brief */
  op: 'add' | 'drop' | 'change' | 'fill';
  /** the thing: "Task T5", "Check C2", "Area", "Understanding", "PR title", "Assumptions", "Questions" */
  what: string;
  /** its title, when it has one */
  title?: string;
  /** the fields shown under the header; a drop shows none */
  fields: FieldChange[];
  apply: (b: Brief) => Brief;
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

/** A revision becomes one item per changed thing, each applying only its own key. */
function revisionItems(p: DraftProposal): ProposalItem[] {
  const r = p.revision!;
  const d = r.diff;
  const items: ProposalItem[] = [];
  if (d.understanding) items.push({ id: 'understanding', op: 'change', what: 'Understanding', fields: [{ label: 'Understanding', kind: 'markdown', before: d.understanding.before, after: d.understanding.after }], apply: (b) => ({ ...b, understanding: r.revised.understanding }) });
  if (d.title) items.push({ id: 'title', op: d.title.before ? 'change' : 'fill', what: 'PR title', fields: [{ label: 'Title', kind: 'text', before: d.title.before || null, after: d.title.after }], apply: (b) => ({ ...b, title: r.revised.title }) });
  for (const a of d.areas.added) items.push({ id: `area+${a.key}`, op: 'add', what: `Area ${a.key}`, title: a.name, fields: [field('description', null, a.description), field('slug', null, a.slug)], apply: (b) => ({ ...b, areas: b.areas.some((x) => x.key === a.key) ? b.areas : [...b.areas, a] }) });
  for (const a of d.areas.removed) items.push({ id: `area-${a.key}`, op: 'drop', what: `Area ${a.key}`, title: `${a.name} (its tasks become unassigned)`, fields: [], apply: (b) => ({ ...b, areas: b.areas.filter((x) => x.key !== a.key), tasks: b.tasks.map((t) => (t.areaKey === a.key ? { ...t, areaKey: null } : t)) }) });
  for (const c of d.areas.changed) items.push({ id: `area~${c.key}`, op: 'change', what: `Area ${c.key}`, title: c.after.name, fields: c.fields.map((f) => field(f.field, f.before, f.after)), apply: (b) => ({ ...b, areas: b.areas.map((x) => (x.key === c.key ? c.after : x)) }) });
  for (const t of d.tasks.added) {
    const own = r.revised.checks.filter((c) => c.taskKey === t.key);
    items.push({ id: `task+${t.key}`, op: 'add', what: `Task ${t.key}`, title: t.title, fields: taskFields(t, own), apply: (b) => ({ ...b, tasks: b.tasks.some((x) => x.key === t.key) ? b.tasks : [...b.tasks, t], checks: [...b.checks, ...own.filter((c) => !b.checks.some((x) => x.key === c.key))] }) });
  }
  for (const t of d.tasks.removed) items.push({ id: `task-${t.key}`, op: 'drop', what: `Task ${t.key}`, title: `${t.title} (and its checks)`, fields: [], apply: (b) => ({ ...b, tasks: b.tasks.filter((x) => x.key !== t.key).map((x) => ({ ...x, dependsOnKeys: x.dependsOnKeys.filter((k) => k !== t.key) })), checks: b.checks.filter((c) => c.taskKey !== t.key) }) });
  for (const c of d.tasks.changed) items.push({ id: `task~${c.key}`, op: 'change', what: `Task ${c.key}`, title: c.after.title, fields: c.fields.map((f) => field(f.field, f.before, f.after)), apply: (b) => ({ ...b, tasks: b.tasks.map((x) => (x.key === c.key ? { ...x, ...Object.fromEntries(c.fields.map((f) => [f.field, f.after])) } : x)) }) });
  const known = (b: Brief, key: string | null) => !key || b.tasks.some((t) => t.key === key) || r.diff.tasks.added.some((t) => t.key === key);
  for (const c of d.checks.added.filter((c) => !d.tasks.added.some((t) => t.key === c.taskKey))) items.push({ id: `check+${c.key}`, op: 'add', what: `${c.tier === 'must' ? 'Must' : 'Stretch'} check ${c.key}${c.taskKey ? ` on ${c.taskKey}` : ' on the goal'}`, title: c.name, fields: [checkField(null, c.spec)], apply: (b) => (known(b, c.taskKey) && !b.checks.some((x) => x.key === c.key) ? { ...b, checks: [...b.checks, c] } : b) });
  for (const c of d.checks.removed.filter((c) => !d.tasks.removed.some((t) => t.key === c.taskKey))) items.push({ id: `check-${c.key}`, op: 'drop', what: `Check ${c.key}`, title: c.name, fields: [], apply: (b) => ({ ...b, checks: b.checks.filter((x) => x.key !== c.key) }) });
  for (const c of d.checks.changed) items.push({ id: `check~${c.key}`, op: 'change', what: `Check ${c.key}`, title: c.after.name, fields: c.fields.map((f) => (f.field === 'spec' ? checkField(c.before.spec, c.after.spec) : field(f.field, f.before, f.after))), apply: (b) => ({ ...b, checks: b.checks.map((x) => (x.key === c.key ? c.after : x)) }) });
  if (d.newAssumptions.length) items.push({ id: 'assumptions', op: 'add', what: `${d.newAssumptions.length} assumption${d.newAssumptions.length > 1 ? 's' : ''}`, fields: [{ label: 'Assumptions', kind: 'list', before: null, after: d.newAssumptions }], apply: (b) => ({ ...b, assumptions: [...b.assumptions, ...r.revised.assumptions.filter((a) => d.newAssumptions.includes(a.text) && !b.assumptions.some((x) => x.text === a.text))] }) });
  const newQ = r.revised.questions.filter((q) => !q.answer && !q.applied);
  const fresh = (b: Brief) => newQ.filter((q) => !b.questions.some((x) => x.id === q.id || x.text === q.text));
  if (newQ.length) items.push({ id: 'questions', op: 'add', what: `${newQ.length} question${newQ.length > 1 ? 's' : ''} (non-blocking)`, fields: [{ label: 'Questions', kind: 'list', before: null, after: newQ.map((q) => q.text) }], apply: (b) => (fresh(b).length ? { ...b, questions: [...b.questions, ...fresh(b)] } : b) });
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
        op: 'fill',
        what: `Task ${p.taskKey}`,
        fields: keys.map((k) => field(k, null, fields[k])),
        apply: (b) => ({ ...b, tasks: b.tasks.map((t) => (t.key === p.taskKey ? { ...t, ...fields, ...(fields.spec && t.spec.trim() ? { spec: t.spec } : {}) } : t)) }),
      });
    }
  }
  for (const t of p.tasks) {
    const own = p.checks.filter((c) => c.taskKey === t.key);
    items.push({ id: `task:${t.key}`, op: 'add', what: `Task ${t.key}`, title: t.title, fields: taskFields(t, own), apply: (b) => ({ ...b, tasks: b.tasks.some((x) => x.key === t.key) ? b.tasks : [...b.tasks, t], checks: [...b.checks, ...own.filter((c) => !b.checks.some((x) => x.key === c.key))] }) });
  }
  for (const c of p.checks.filter((c) => !p.tasks.some((t) => t.key === c.taskKey))) {
    items.push({ id: `check:${c.key}`, op: 'add', what: `${c.tier === 'must' ? 'Must' : 'Stretch'} check${c.taskKey ? ` on ${c.taskKey}` : ''}`, title: c.name, fields: [checkField(null, c.spec)], apply: (b) => ({ ...b, checks: b.checks.some((x) => x.key === c.key) ? b.checks : [...b.checks, c] }) });
  }
  return items;
}

const OP: Record<ProposalItem['op'], { state: string; text: string }> = { add: { state: 'created', text: 'new' }, drop: { state: 'cancelled', text: 'drop' }, change: { state: 'pending', text: 'change' }, fill: { state: 'ready', text: 'fill in' } };

/** a small uppercase field label, as the task card has them */
const FieldLabel = ({ children }: { children: ReactNode }) => <span className="text-[10px] uppercase tracking-wide text-zinc-500">{children}</span>;

/** prose: the new text as markdown (clamped, Open full for the rest), the old one behind a toggle */
function Prose({ f }: { f: FieldChange }) {
  const [showBefore, setShowBefore] = useState(false);
  const after = typeof f.after === 'string' ? f.after : '';
  const before = typeof f.before === 'string' ? f.before : null;
  return (
    <div className="space-y-1">
      <div className="relative rounded border border-zinc-800 bg-zinc-950/60 px-3 py-2">
        <Markdown source={after} className="text-sm max-h-48 overflow-hidden [mask-image:linear-gradient(to_bottom,black_80%,transparent)]" />
        <div className="absolute right-1 top-1">
          <OpenFull value={{ title: f.label, text: before ? `## After\n\n${after}\n\n## Before\n\n${before}` : after }} />
        </div>
      </div>
      {before && (
        <button type="button" className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300" onClick={() => setShowBefore((v) => !v)}>
          {showBefore ? <ChevronDown size={11} /> : <ChevronRight size={11} />} before
        </button>
      )}
      {showBefore && before && (
        <div className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-2 opacity-70">
          <Markdown source={before} className="text-sm max-h-48 overflow-auto" />
        </div>
      )}
    </div>
  );
}

/** a list field: what stays, what goes (struck through), what comes (green) */
function ListDiff({ f }: { f: FieldChange }) {
  const before = Array.isArray(f.before) ? f.before : [];
  const after = Array.isArray(f.after) ? f.after : [];
  const removed = before.filter((x) => !after.includes(x));
  const chips = [...after.map((x) => ({ x, tone: before.length && !before.includes(x) ? 'added' : 'kept' })), ...removed.map((x) => ({ x, tone: 'removed' }))];
  if (!chips.length) return <span className="text-xs text-zinc-500">none</span>;
  const prose = chips.some((c) => c.x.length > 60);
  return (
    <ul className={cn(prose ? 'space-y-1' : 'flex flex-wrap gap-1')}>
      {chips.map((c) => (
        <li key={`${c.tone}:${c.x}`} className={cn(prose ? 'text-sm text-zinc-200' : 'mono text-[11px] rounded border px-1.5 py-0.5', c.tone === 'added' && (prose ? 'text-emerald-200' : 'border-emerald-500/40 text-emerald-200 bg-emerald-500/10'), c.tone === 'kept' && (prose ? '' : 'border-zinc-700 text-zinc-300'), c.tone === 'removed' && 'line-through text-zinc-500 border-zinc-800')}>
          {prose ? `– ${c.x}` : c.x}
        </li>
      ))}
    </ul>
  );
}

/** one field of an item, in the shape its kind asks for */
function FieldView({ f }: { f: FieldChange }) {
  if (f.kind === 'markdown') return <Prose f={f} />;
  if (f.kind === 'list') return <ListDiff f={f} />;
  if (f.kind === 'command') {
    const before = typeof f.before === 'string' ? f.before : null;
    return (
      <div className="space-y-1 mono text-[11px]">
        {before && before !== f.after && <div className="text-zinc-500 line-through break-all">$ {before}</div>}
        <div className="text-zinc-200 break-all">$ {f.after}</div>
      </div>
    );
  }
  const before = typeof f.before === 'string' ? f.before : null;
  const after = typeof f.after === 'string' ? f.after : null;
  return (
    <div className="text-sm text-zinc-200">
      {before && before !== after && <span className="text-zinc-500 line-through mr-2">{before}</span>}
      {after ? <span>{after}</span> : <span className="text-zinc-500">none</span>}
    </div>
  );
}

type Verdict = 'accepted' | 'discarded' | null;

/**
 * A proposal, one row per item: what it is and what it does (new / drop / change / fill in), the fields it touches
 * with the new value and the old one, and Accept / Discard for each. Accepted and discarded rows stay, marked, so the
 * person sees what they did; nothing touches the Brief until accepted.
 */
export function DraftPanel({ proposal, onApply, onClose }: { proposal: DraftProposal; onApply: (fn: (b: Brief) => Brief) => void; onClose: () => void }) {
  const [items] = useState(() => proposalItems(proposal));
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const open = items.filter((it) => !verdicts[it.id]);
  const accept = (it: ProposalItem) => {
    onApply(it.apply);
    setVerdicts((v) => ({ ...v, [it.id]: 'accepted' }));
  };
  const acceptAll = () => {
    onApply((b) => open.reduce((acc, it) => it.apply(acc), b));
    setVerdicts((v) => ({ ...v, ...Object.fromEntries(open.map((it) => [it.id, 'accepted' as const])) }));
  };
  const discard = (it: ProposalItem) => setVerdicts((v) => ({ ...v, [it.id]: 'discarded' }));
  const cost = proposal.costAvailable === false ? 'cost unavailable' : fmtCost(proposal.costUsd);
  return (
    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-200">
          <Sparkles size={14} /> Proposal
        </span>
        <span className="text-xs text-zinc-500">
          {cost} · {open.length ? `${open.length} of ${items.length} left to decide; nothing is written until you accept` : 'all decided'}
        </span>
        <span className="ml-auto flex gap-1.5">
          {open.length > 1 && (
            <Button size="sm" variant="primary" onClick={acceptAll}>
              <Check size={12} /> Accept all
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClose} title={open.length ? 'Close and discard what is left' : 'Close'}>
            <X size={12} /> {open.length ? 'Discard the rest' : 'Close'}
          </Button>
        </span>
      </div>
      {proposal.rationale && <p className="text-sm text-zinc-300">{proposal.rationale}</p>}
      {items.length === 0 && <div className="text-xs text-zinc-500">Nothing to change.</div>}
      <div className="space-y-2">
        {items.map((it) => {
          const v = verdicts[it.id];
          return (
            <div key={it.id} className={cn('rounded-md border bg-zinc-950/60 p-3 space-y-2', v ? 'border-zinc-800/60 opacity-60' : 'border-zinc-800')}>
              <div className="flex items-start gap-2 flex-wrap">
                <Badge state={OP[it.op].state}>{OP[it.op].text}</Badge>
                <div className="min-w-0 flex-1 text-sm text-zinc-100">
                  <span className="font-medium">{it.what}</span>
                  {it.title && <span className="text-zinc-300"> — {it.title}</span>}
                  {it.op === 'change' && (it.fields.length > 1 || (it.fields[0] && it.fields[0].label.toLowerCase() !== it.what.toLowerCase())) && <span className="text-xs text-zinc-500"> · {it.fields.map((f) => f.label.toLowerCase()).join(', ')}</span>}
                </div>
                <span className="flex items-center gap-1.5 shrink-0">
                  {v === 'accepted' && <Badge state="passed">accepted</Badge>}
                  {v === 'discarded' && <Badge state="skipped">discarded</Badge>}
                  {!v && (
                    <>
                      <Button size="sm" onClick={() => accept(it)} title="Put this into the Brief">
                        <Check size={12} className="text-emerald-300" /> Accept
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => discard(it)} title="Leave the Brief as it is here">
                        <X size={12} /> Discard
                      </Button>
                    </>
                  )}
                </span>
              </div>
              {!v && it.fields.length > 0 && (
                <div className="space-y-2 pl-0.5">
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
    </div>
  );
}
