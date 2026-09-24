import type { Brief, BriefArea } from '@foundry/core/browser';
import { areaSlug } from '@foundry/core/browser';
import { Plus, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api, type DraftProposal } from '../../api.ts';
import { Button, Card, Input, cn } from '../../ui.tsx';
import { LiveLog } from '../LiveLog.tsx';
import { DraftPanel } from './DraftPanel.tsx';
import { areaStyle, newArea } from './shared.ts';
import { HelpLink } from '../HelpPage.tsx';

/**
 * The parts of the product this goal covers. Coverage = every Area has at least one task;
 * an empty one is the gap the Clarifier could not close — draft tasks for it or delete it.
 */
export function AreasCard({ brief, goalId, editable, edit }: { brief: Brief; goalId: string; editable: boolean; edit: (fn: (b: Brief) => Brief) => void }) {
  const counts = (a: BriefArea) => ({
    tasks: brief.tasks.filter((t) => t.areaKey === a.key).length,
    checks: brief.checks.filter((c) => c.areaKey === a.key || (c.taskKey && brief.tasks.find((t) => t.key === c.taskKey)?.areaKey === a.key)).length,
  });
  const unassigned = brief.tasks.filter((t) => !brief.areas.some((a) => a.key === t.areaKey)).length;
  const uncovered = brief.areas.filter((a) => counts(a).tasks === 0);
  return (
    <Card
      title={<>{`Areas (${brief.areas.length})`}<HelpLink to="approving-the-brief#areas" className="ml-1.5" /></>}
      actions={
        editable && (
          <Button size="sm" onClick={() => edit((b) => ({ ...b, areas: [...b.areas, newArea(b)] }))}>
            <Plus size={13} /> Add Area
          </Button>
        )
      }
    >
      <p className="text-xs text-zinc-500 mb-3">
        The parts of the product this goal covers (a user-facing role or app, or shared groundwork). Every task belongs to one; <b>every Area needs at least one task</b> or that part will not be built.
        {uncovered.length > 0 && <span className="text-rose-300"> {uncovered.length} Area{uncovered.length > 1 ? 's have' : ' has'} no tasks.</span>}
      </p>
      {brief.areas.length === 0 && <div className="text-xs text-zinc-500">No Areas — this Brief predates Areas or the goal is a single piece of work. Add one to group tasks.</div>}
      <div className="space-y-2">
        {brief.areas.map((a) => (
          <AreaRow key={a.key} area={a} brief={brief} goalId={goalId} editable={editable} edit={edit} counts={counts(a)} />
        ))}
        {unassigned > 0 && brief.areas.length > 0 && (
          <div className="text-[11px] text-amber-300">
            {unassigned} task{unassigned > 1 ? 's are' : ' is'} not assigned to any Area — pick one in the task card.
          </div>
        )}
      </div>
    </Card>
  );
}

function AreaRow({ area, brief, goalId, editable, edit, counts }: { area: BriefArea; brief: Brief; goalId: string; editable: boolean; edit: (fn: (b: Brief) => Brief) => void; counts: { tasks: number; checks: number } }) {
  const [proposal, setProposal] = useState<DraftProposal | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const style = areaStyle(brief, area.key);
  const change = (patch: Partial<BriefArea>) => edit((b) => ({ ...b, areas: b.areas.map((x) => (x.key === area.key ? { ...x, ...patch } : x)) }));
  const remove = () =>
    edit((b) => ({
      ...b,
      areas: b.areas.filter((x) => x.key !== area.key),
      tasks: b.tasks.map((t) => (t.areaKey === area.key ? { ...t, areaKey: null } : t)),
      checks: b.checks.map((c) => (c.areaKey === area.key ? { ...c, areaKey: null } : c)),
      questions: b.questions.filter((q) => q.areaKey !== area.key),
    }));
  const draft = async () => {
    setDrafting(true);
    setErr(null);
    try {
      const { proposal } = await api.draftBrief(goalId, { mode: 'area', brief, areaKey: area.key });
      setProposal(proposal);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setDrafting(false);
    }
  };
  const empty = counts.tasks === 0;
  return (
    <div className={cn('rounded-md border bg-zinc-950/50 p-2 space-y-1.5', empty ? 'border-rose-500/40' : 'border-zinc-800')}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: style.dot }} />
        {editable ? (
          <Input className="w-48" placeholder="Area name, e.g. Teacher portal" value={area.name} onChange={(e) => change({ name: e.target.value, slug: areaSlug(e.target.value, brief.areas.indexOf(area) + 1) })} />
        ) : (
          <span className="text-sm text-zinc-100">{area.name}</span>
        )}
        <span className="mono text-[11px] text-zinc-500" title="default commit scope of this Area's tasks">
          {area.slug}
        </span>
        {editable ? (
          <Input className="flex-1 min-w-[12rem] text-xs" placeholder="one sentence: what this Area covers" value={area.description} onChange={(e) => change({ description: e.target.value })} />
        ) : (
          <span className="text-xs text-zinc-400 flex-1">{area.description}</span>
        )}
        <span className={cn('text-[11px] whitespace-nowrap', empty ? 'text-rose-300' : 'text-zinc-500')}>
          {counts.tasks} task{counts.tasks === 1 ? '' : 's'} · {counts.checks} check{counts.checks === 1 ? '' : 's'}
        </span>
        {editable && empty && (
          <Button size="sm" disabled={drafting || !area.name.trim()} onClick={draft} title="A read-only AI session proposes 1–6 tasks (with checks) for this Area">
            <Sparkles size={12} /> {drafting ? 'Drafting…' : 'Draft tasks for this Area'}
          </Button>
        )}
        {editable && (
          <Button size="sm" variant="ghost" onClick={remove} title="Delete this Area (its tasks become unassigned)">
            <Trash2 size={13} />
          </Button>
        )}
      </div>
      {err && <div className="text-xs text-rose-300">{err}</div>}
      {drafting && <LiveLog attemptId={`draft-${goalId}`} className="max-h-40" />}
      {proposal && <DraftPanel proposal={proposal} onApply={edit} onClose={() => setProposal(null)} />}
    </div>
  );
}
