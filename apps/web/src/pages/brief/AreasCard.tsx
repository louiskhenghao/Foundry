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
import { SectionTitle } from './SectionTitle.tsx';

/**
 * The parts of the product this goal covers. Coverage = every Area has at least one task;
 * an empty one is the gap the Clarifier could not close — draft tasks for it or delete it.
 */
export function AreasCard({ brief, goalId, editable, draftable = editable, planning = false, edit }: { brief: Brief; goalId: string; editable: boolean; /** the Draft button applies (false while the planner still fills the Brief skeleton) */ draftable?: boolean; /** the planner is still at work: every Area is empty for now, nothing to warn about */ planning?: boolean; edit: (fn: (b: Brief) => Brief) => void }) {
  const counts = (a: BriefArea) => ({
    tasks: brief.tasks.filter((t) => t.areaKey === a.key).length,
    checks: brief.checks.filter((c) => c.areaKey === a.key || (c.taskKey && brief.tasks.find((t) => t.key === c.taskKey)?.areaKey === a.key)).length,
  });
  const unassigned = brief.tasks.filter((t) => !brief.areas.some((a) => a.key === t.areaKey)).length;
  const uncovered = planning ? [] : brief.areas.filter((a) => counts(a).tasks === 0);
  return (
    <Card
      title={<span className="flex items-start gap-1.5"><SectionTitle section="areas">{`Areas (${brief.areas.length})`}</SectionTitle><HelpLink to="approving-the-brief#areas" className="mt-0.5 shrink-0" /></span>}
      actions={
        editable && (
          <Button size="sm" onClick={() => edit((b) => ({ ...b, areas: [...b.areas, newArea(b)] }))}>
            <Plus size={13} /> Add Area
          </Button>
        )
      }
    >
      <p className="text-xs text-ink-faint mb-3">
        The parts of the product this goal covers (a user-facing role or app, or shared groundwork). Every task belongs to one; <b className="text-ink-soft">every Area needs at least one task</b> or that part will not be built.
        {uncovered.length > 0 && <span className="font-semibold text-bad-ink"> {uncovered.length} Area{uncovered.length > 1 ? 's have' : ' has'} no tasks.</span>}
        {planning && <span className="text-work-ink"> The tasks of each Area arrive with the plan.</span>}
      </p>
      {brief.areas.length === 0 && <div className="text-xs text-ink-faint">No Areas — this Brief predates Areas or the goal is a single piece of work. Add one to group tasks.</div>}
      <div className="space-y-2">
        {brief.areas.map((a) => (
          <AreaRow key={a.key} area={a} brief={brief} goalId={goalId} editable={editable} draftable={draftable} planning={planning} edit={edit} counts={counts(a)} />
        ))}
        {unassigned > 0 && brief.areas.length > 0 && (
          <div className="text-xs font-semibold text-you-ink">
            {unassigned} task{unassigned > 1 ? 's are' : ' is'} not assigned to any Area — pick one in the task card.
          </div>
        )}
      </div>
    </Card>
  );
}

function AreaRow({ area, brief, goalId, editable, draftable, planning, edit, counts }: { area: BriefArea; brief: Brief; goalId: string; editable: boolean; draftable: boolean; planning: boolean; edit: (fn: (b: Brief) => Brief) => void; counts: { tasks: number; checks: number } }) {
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
    // a box inside the card; an Area left without tasks is outlined in red (not while the planner still fills them in)
    <div className={cn('rounded-md border bg-sunken p-2.5 space-y-1.5', empty && !planning ? 'border-bad/50' : 'border-line')}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: style.dot }} aria-hidden="true" />
        {editable ? (
          <span className="w-48 max-w-full">
            <Input placeholder="Area name, e.g. Teacher portal" value={area.name} onChange={(e) => change({ name: e.target.value, slug: areaSlug(e.target.value, brief.areas.indexOf(area) + 1) })} />
          </span>
        ) : (
          <span className="text-sm font-bold text-ink">{area.name}</span>
        )}
        <span className="mono text-xs text-ink-faint" title="default commit scope of this Area's tasks">
          {area.slug}
        </span>
        {editable ? (
          <Input className="flex-1 min-w-[12rem] text-xs" placeholder="one sentence: what this Area covers" value={area.description} onChange={(e) => change({ description: e.target.value })} />
        ) : (
          // as wide as the field it was: a line of its own on a phone rather than a narrow column
          <span className="text-xs text-ink-soft flex-1 min-w-[12rem]">{area.description}</span>
        )}
        <span className={cn('mono text-xs whitespace-nowrap', empty && !planning ? 'font-semibold text-bad-ink' : 'text-ink-faint')}>
          {counts.tasks} task{counts.tasks === 1 ? '' : 's'} · {counts.checks} check{counts.checks === 1 ? '' : 's'}
        </span>
        {editable && draftable && empty && (
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
      {err && <div className="text-xs text-bad-ink">{err}</div>}
      {drafting && <LiveLog attemptId={`draft-${goalId}`} className="max-h-40" />}
      {proposal && <DraftPanel proposal={proposal} onApply={edit} onClose={() => setProposal(null)} />}
    </div>
  );
}
