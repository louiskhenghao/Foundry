import type { Brief, BriefCheck, BriefTask } from '@ai-engine/core/browser';
import { proposeBudgetFromEstimate, topoSort } from '@ai-engine/core/browser';
import { ArrowRight, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type GoalDetail } from '../api.ts';
import { MarkdownPanel } from '../components/Markdown.tsx';
import { useLive } from '../store.ts';
import { Badge, Button, Card, Empty, Input, Textarea, cn, fmtLimitMin, fmtLimitUsd } from '../ui.tsx';
import { LiveLog } from './LiveLog.tsx';

export function BriefPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const version = useLive((s) => s.goalVersion[id] ?? 0);
  const [detail, setDetail] = useState<GoalDetail | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** budget the human will approve with the Brief (Auto preset proposes it from the estimate) */
  const [budgetEdit, setBudgetEdit] = useState<{ maxCostUsd: number | null; maxDurationMin: number | null } | null>(null);

  useEffect(() => {
    const t = setTimeout(
      () =>
        api
          .goal(id)
          .then((d) => {
            setDetail(d);
            if (!dirty && d.brief) setBrief(d.brief.brief);
          })
          .catch((e) => setErr(e.message)),
      150,
    );
    return () => clearTimeout(t);
  }, [id, version]);

  const order = useMemo(() => {
    if (!brief) return { ok: true, order: [] as string[] };
    try {
      return { ok: true, order: topoSort(brief.tasks.map((t) => ({ id: t.key, dependsOn: t.dependsOnKeys }))) };
    } catch (e: any) {
      return { ok: false, order: [], error: e.message as string };
    }
  }, [brief]);

  if (err) return <Empty>{err}</Empty>;
  if (!detail) return <Empty>Loading…</Empty>;
  const g = detail.goal;

  if (g.state === 'clarifying' || !brief) {
    return (
      <div className="max-w-5xl mx-auto p-3 sm:p-4 md:p-6 space-y-4">
        <Header detail={detail} />
        <Card title="Clarifying…">
          <p className="text-sm text-zinc-400 mb-3">The Clarifier is exploring the repository and drafting the Brief. This page updates automatically.</p>
          <LiveLog attemptId={`clarify-${id}`} />
        </Card>
      </div>
    );
  }

  const editable = g.state === 'awaiting_brief_approval';
  const update = (patch: Partial<Brief>) => {
    setBrief({ ...brief, ...patch });
    setDirty(true);
  };
  const blockingUnanswered = brief.questions.filter((q) => q.blocking && !q.answer?.trim());

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.editBrief(id, brief);
      setDirty(false);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const isAuto = g.budgetPreset === 'auto';
  const proposed = proposeBudgetFromEstimate(brief);
  // Auto: start from the proposal; otherwise from the goal's own budget
  const budgetDraft = budgetEdit ?? (isAuto && g.budgets.maxCostUsd == null && g.budgets.maxDurationMin == null ? proposed : { maxCostUsd: g.budgets.maxCostUsd, maxDurationMin: g.budgets.maxDurationMin });
  const budgetChanged = budgetDraft.maxCostUsd !== g.budgets.maxCostUsd || budgetDraft.maxDurationMin !== g.budgets.maxDurationMin;
  const overCost = g.budgets.maxCostUsd != null && brief.costEstimateUsd > g.budgets.maxCostUsd;
  const overTime = g.budgets.maxDurationMin != null && brief.timeEstimateMin > g.budgets.maxDurationMin;

  const approve = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.approveBrief(id, brief, budgetChanged ? budgetDraft : undefined);
      nav(`/goals/${id}`);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-3 sm:p-4 md:p-6 space-y-4">
      <Header detail={detail} />
      <Card title="Understanding">
        <div className="mb-3">
          <label className="text-[11px] text-zinc-500">
            pull request title <span className="text-zinc-600">· Conventional Commits header for the whole goal (one-PR delivery); per-task PRs use each task's header</span>
          </label>
          {editable ? (
            <Input className="mono" value={brief.title ?? ''} onChange={(e) => update({ title: e.target.value })} placeholder="feat(scope): what this goal adds" />
          ) : (
            <div className="mono text-sm text-zinc-200">{brief.title || <span className="text-zinc-500">derived from the goal title</span>}</div>
          )}
        </div>
        {editable ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Textarea rows={10} value={brief.understanding} onChange={(e) => update({ understanding: e.target.value })} />
            <MarkdownPanel title="preview" source={brief.understanding} maxHeight={260} />
          </div>
        ) : (
          <MarkdownPanel title="understanding" source={brief.understanding} />
        )}
      </Card>

      {brief.questions.length > 0 && (
        <Card title={`Questions (${blockingUnanswered.length} blocking unanswered)`}>
          <div className="space-y-3">
            {brief.questions.map((q, i) => (
              <div key={q.id}>
                <div className="text-sm text-zinc-200 mb-1">
                  {q.blocking && <Badge state="must">blocking</Badge>} {q.text}
                </div>
                <Input disabled={!editable} placeholder="Your answer" value={q.answer ?? ''} onChange={(e) => update({ questions: brief.questions.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)) })} />
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title="Assumptions (accepted unless you uncheck)">
        {brief.assumptions.length === 0 && <div className="text-sm text-zinc-500">None.</div>}
        <div className="space-y-1.5">
          {brief.assumptions.map((a, i) => (
            <label key={a.id} className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" disabled={!editable} checked={a.accepted} onChange={(e) => update({ assumptions: brief.assumptions.map((x, j) => (j === i ? { ...x, accepted: e.target.checked } : x)) })} />
              <span className={cn(!a.accepted && 'line-through text-zinc-500')}>{a.text}</span>
            </label>
          ))}
        </div>
      </Card>

      <Card
        title="Tasks"
        actions={
          editable && (
            <Button size="sm" onClick={() => update({ tasks: [...brief.tasks, { key: `T${brief.tasks.length + 1}`, title: 'New task', spec: '', dependsOnKeys: [], parallelizable: true, relevantFiles: [] }] })}>
              <Plus size={13} /> Add
            </Button>
          )
        }
      >
        {!order.ok && <div className="text-xs text-rose-400 mb-2">Graph error: {(order as any).error}</div>}
        <div className="text-xs text-zinc-500 mb-3 flex items-center gap-1 flex-wrap">
          Execution order: {order.order.map((k, i) => (
            <span key={k} className="flex items-center gap-1">
              <span className="mono text-zinc-300">{k}</span>
              {i < order.order.length - 1 && <ArrowRight size={11} />}
            </span>
          ))}
        </div>
        <div className="space-y-3">
          {brief.tasks.map((t, i) => (
            <TaskEditor key={i} task={t} all={brief.tasks} editable={editable} onChange={(nt) => update({ tasks: brief.tasks.map((x, j) => (j === i ? nt : x)) })} onRemove={() => update({ tasks: brief.tasks.filter((_, j) => j !== i), checks: brief.checks.filter((c) => c.taskKey !== t.key) })} />
          ))}
        </div>
      </Card>

      <Card
        title="Acceptance checks"
        actions={
          editable && (
            <Button size="sm" onClick={() => update({ checks: [...brief.checks, { key: `C${brief.checks.length + 1}`, name: 'new check', tier: 'must', taskKey: null, spec: { type: 'command', cmd: 'true', timeoutMs: 300000, expectExitCode: 0 } }] })}>
              <Plus size={13} /> Add
            </Button>
          )
        }
      >
        <p className="text-xs text-zinc-500 mb-3">
          <Badge state="must" /> = what you asked for (all must pass → <b>done</b>). <Badge state="stretch" /> = proposed extras (also pass → <b>over-delivered</b>). Toggle the tier to move a check.
        </p>
        <div className="space-y-2">
          {brief.checks.map((c, i) => (
            <CheckEditor key={i} check={c} tasks={brief.tasks} editable={editable} onChange={(nc) => update({ checks: brief.checks.map((x, j) => (j === i ? nc : x)) })} onRemove={() => update({ checks: brief.checks.filter((_, j) => j !== i) })} />
          ))}
        </div>
      </Card>

      <Card title={isAuto && editable ? 'Estimate → proposed budget' : 'Estimate & budget'}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            Estimated cost <span className="mono">${brief.costEstimateUsd}</span>
            <span className={cn('ml-1', overCost ? 'text-amber-300' : 'text-zinc-500')}>(budget {fmtLimitUsd(g.budgets.maxCostUsd)})</span>
          </div>
          <div>
            Estimated time <span className="mono">{brief.timeEstimateMin} min</span>
            <span className={cn('ml-1', overTime ? 'text-amber-300' : 'text-zinc-500')}>(budget {fmtLimitMin(g.budgets.maxDurationMin)})</span>
          </div>
        </div>
        {editable && (
          <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/50 p-3">
            <div className="text-xs text-zinc-400 mb-2">
              {isAuto ? (
                <>
                  <span className="text-emerald-300">Auto budget preset:</span> no cap was set while clarifying; this proposal (estimate ×2) becomes the goal's budget when you approve. Edit it, or keep it unlimited — the engine pauses and asks you if a limit is reached.
                </>
              ) : overCost || overTime ? (
                <span className="text-amber-300">The estimate exceeds the budget you set. Raise it here or approve anyway (the engine will pause when it is reached).</span>
              ) : (
                'Budget applied when you approve. Blank = no limit.'
              )}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs text-zinc-400">
                max cost $
                <Input type="number" min={0.5} step={0.5} className="w-28 mt-1" value={budgetDraft.maxCostUsd ?? ''} placeholder="∞" onChange={(e) => setBudgetEdit({ ...budgetDraft, maxCostUsd: e.target.value === '' ? null : Number(e.target.value) })} />
              </label>
              <label className="text-xs text-zinc-400">
                max minutes
                <Input type="number" min={5} step={5} className="w-28 mt-1" value={budgetDraft.maxDurationMin ?? ''} placeholder="∞" onChange={(e) => setBudgetEdit({ ...budgetDraft, maxDurationMin: e.target.value === '' ? null : Number(e.target.value) })} />
              </label>
              {(overCost || overTime || budgetChanged) && (
                <Button size="sm" variant="ghost" onClick={() => setBudgetEdit(proposed)}>
                  Use estimate ×2 (${proposed.maxCostUsd} / {proposed.maxDurationMin} min)
                </Button>
              )}
              {isAuto && (budgetDraft.maxCostUsd != null || budgetDraft.maxDurationMin != null) && (
                <Button size="sm" variant="ghost" onClick={() => setBudgetEdit({ maxCostUsd: null, maxDurationMin: null })} title="No cost or time cap; attempts per task and parallelism still apply">
                  Keep unlimited
                </Button>
              )}
              {budgetChanged && <span className="text-[11px] text-emerald-300">will be applied on approve</span>}
            </div>
          </div>
        )}
      </Card>

      {err && <div className="text-sm text-rose-400">{err}</div>}
      {editable ? (
        <div className="flex justify-end gap-2 flex-wrap sticky bottom-0 py-3 bg-zinc-950/90 backdrop-blur">
          <Button variant="danger" onClick={() => api.cancelGoal(id).then(() => nav('/'))}>
            Cancel goal
          </Button>
          <Button disabled={!dirty || busy} onClick={save}>
            Save edits
          </Button>
          <Button variant="primary" disabled={busy || blockingUnanswered.length > 0 || !order.ok || brief.tasks.length === 0} onClick={approve} title={blockingUnanswered.length ? 'Answer blocking questions first' : ''}>
            Approve & run{editable && budgetChanged ? ` · budget ${fmtLimitUsd(budgetDraft.maxCostUsd)} / ${fmtLimitMin(budgetDraft.maxDurationMin)}` : ''}
          </Button>
        </div>
      ) : (
        <div className="text-sm text-zinc-400">
          This brief was {detail.brief?.approved ? 'approved' : 'superseded'}. <Link className="underline" to={`/goals/${id}`}>Go to run view</Link>.
        </div>
      )}
    </div>
  );
}

function Header({ detail }: { detail: GoalDetail }) {
  const g = detail.goal;
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const reclarify = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.reclarify(g.id, 'fetch the latest base branch and explore again');
      nav(`/goals/${g.id}`);
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  };
  const sync = g.baseSync;
  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-lg font-semibold">{g.title}</h1>
        <Badge state={g.state} />
        {g.state === 'awaiting_brief_approval' && (
          <Button size="sm" variant="ghost" className="ml-auto" disabled={busy} onClick={reclarify} title="Throw this Brief away, fetch the base branch again and let the Clarifier explore the fresh tip (attachments, budget and delivery policy are kept)">
            <RotateCcw size={13} /> {busy ? 'Starting…' : 'Re-run Clarify'}
          </Button>
        )}
      </div>
      <div className="text-xs text-zinc-500 mono">{g.repoPath} · {g.baseBranch} → {g.branch}</div>
      {g.state === 'awaiting_brief_approval' && (
        <div className="text-[11px] text-zinc-500 mt-1">
          {sync ? (
            sync.startedFrom === 'remote' ? (
              <>
                Explored <span className="mono text-zinc-300">{sync.remote}/{sync.base}</span> (your local {sync.base} was {sync.behind} behind).
              </>
            ) : (
              <>Explored local {sync.base} — {sync.detail}.</>
            )
          ) : (
            <span className="text-amber-300">This Brief was produced from your local checkout without fetching the remote; if upstream moved, re-run Clarify.</span>
          )}
        </div>
      )}
      {err && <div className="text-xs text-rose-300 mt-1">{err}</div>}
      <div className="mt-2">
        <MarkdownPanel title="goal" source={g.prompt} maxHeight={220} />
      </div>
    </div>
  );
}

function TaskEditor({ task, all, editable, onChange, onRemove }: { task: BriefTask; all: BriefTask[]; editable: boolean; onChange: (t: BriefTask) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/50 p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="mono text-xs text-zinc-400 w-8">{task.key}</span>
        {editable ? <Input className="flex-1 min-w-[10rem]" value={task.title} onChange={(e) => onChange({ ...task, title: e.target.value })} /> : <span className="text-sm flex-1">{task.title}</span>}
        <label className="text-xs text-zinc-400 flex items-center gap-1 whitespace-nowrap">
          <input type="checkbox" disabled={!editable} checked={task.parallelizable} onChange={(e) => onChange({ ...task, parallelizable: e.target.checked })} /> parallel
        </label>
        <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>
          {open ? 'less' : 'more'}
        </Button>
        {editable && (
          <Button size="sm" variant="ghost" onClick={onRemove}>
            <Trash2 size={13} />
          </Button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1 items-center text-xs">
        <span className="text-zinc-500 mr-1">after:</span>
        {all
          .filter((t) => t.key !== task.key)
          .map((t) => {
            const on = task.dependsOnKeys.includes(t.key);
            return (
              <button key={t.key} disabled={!editable} onClick={() => onChange({ ...task, dependsOnKeys: on ? task.dependsOnKeys.filter((k) => k !== t.key) : [...task.dependsOnKeys, t.key] })} className={cn('mono rounded px-1.5 py-0.5 border', on ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300' : 'border-zinc-700 text-zinc-500')}>
                {t.key}
              </button>
            );
          })}
        {all.length <= 1 && <span className="text-zinc-600">—</span>}
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          {editable ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <Textarea rows={8} className="mono text-xs" value={task.spec} onChange={(e) => onChange({ ...task, spec: e.target.value })} />
              <MarkdownPanel title="spec preview" source={task.spec} maxHeight={220} />
            </div>
          ) : (
            <MarkdownPanel title="spec" source={task.spec} maxHeight={300} />
          )}
          <Input className="mono text-xs" disabled={!editable} placeholder="relevant files, comma-separated" value={task.relevantFiles.join(', ')} onChange={(e) => onChange({ ...task, relevantFiles: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
        </div>
      )}
    </div>
  );
}

function CheckEditor({ check, tasks, editable, onChange, onRemove }: { check: BriefCheck; tasks: BriefTask[]; editable: boolean; onChange: (c: BriefCheck) => void; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-2 flex-wrap rounded-md border border-zinc-800 bg-zinc-950/50 p-2">
      <button disabled={!editable} onClick={() => onChange({ ...check, tier: check.tier === 'must' ? 'stretch' : 'must' })} title="toggle tier">
        <Badge state={check.tier} />
      </button>
      <select disabled={!editable} className="bg-zinc-900 border border-zinc-700 rounded text-xs px-1 py-1 mono" value={check.taskKey ?? ''} onChange={(e) => onChange({ ...check, taskKey: e.target.value || null })}>
        <option value="">goal</option>
        {tasks.map((t) => (
          <option key={t.key} value={t.key}>
            {t.key}
          </option>
        ))}
      </select>
      <Input className="flex-1 min-w-[8rem]" disabled={!editable} value={check.name} onChange={(e) => onChange({ ...check, name: e.target.value })} />
      {check.spec.type === 'command' ? (
        <Input className="flex-[2] min-w-[12rem] mono text-xs" disabled={!editable} value={check.spec.cmd} onChange={(e) => onChange({ ...check, spec: { ...check.spec, type: 'command', cmd: e.target.value } as any })} />
      ) : (
        <Input className="flex-[2] min-w-[12rem] text-xs" disabled={!editable} placeholder="reviewer rubric" value={(check.spec as any).rubric ?? ''} onChange={(e) => onChange({ ...check, spec: { ...check.spec, rubric: e.target.value } as any })} />
      )}
      <span className="text-[10px] uppercase text-zinc-500 w-14">{check.spec.type}</span>
      {editable && (
        <Button size="sm" variant="ghost" onClick={onRemove}>
          <Trash2 size={13} />
        </Button>
      )}
    </div>
  );
}
