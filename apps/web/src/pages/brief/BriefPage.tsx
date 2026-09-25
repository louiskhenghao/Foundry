import type { Brief } from '@foundry/core/browser';
import { pendingDecisions, proposeBudgetFromEstimate, topoSort, uncoveredAreas } from '@foundry/core/browser';
import { RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type GoalDetail } from '../../api.ts';
import { FollowLinks } from '../goal/FollowUps.tsx';
import { MarkdownPanel } from '../../components/Markdown.tsx';
import { useLive } from '../../store.ts';
import { Badge, Button, Card, Empty, Input, Textarea, cn, fmtLimitMin, fmtLimitUsd } from '../../ui.tsx';
import { LiveLog } from '../LiveLog.tsx';
import { AreasCard } from './AreasCard.tsx';
import { CompletionCard, type CompletionChoice } from './CompletionCard.tsx';
import { StyleCards } from './StyleCards.tsx';
import { DecisionsBar } from './DecisionsBar.tsx';
import { GoalAcceptanceCard } from './GoalAcceptanceCard.tsx';
import { RunCard } from './RunCard.tsx';
import { InterviewPanel } from '../goal/InterviewPanel.tsx';
import { PlanSection } from './PlanSection.tsx';
import { SimpleBrief } from './SimpleBrief.tsx';
import { areaOf, areaStyle, checkProblem, taskProblem } from './shared.ts';
import { HelpLink } from '../HelpPage.tsx';

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
  /** completion actions; null = untouched, the engine infers the defaults at approval */
  const [completionEdit, setCompletionEdit] = useState<CompletionChoice | null>(null);
  /** Simple-mode goals open the plain view; either view can be switched per goal (remembered in this browser) */
  const [expert, setExpert] = useState<boolean | null>(() => {
    const v = localStorage.getItem(`foundry.expert.${id}`);
    return v === null ? null : v === '1';
  });
  const setView = (e: boolean) => {
    setExpert(e);
    localStorage.setItem(`foundry.expert.${id}`, e ? '1' : '0');
  };

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

  /** functional edit so async accepts (drafts) never clobber what was typed meanwhile */
  const edit = useCallback((fn: (b: Brief) => Brief) => {
    setBrief((b) => (b ? fn(b) : b));
    setDirty(true);
  }, []);

  const graph = useMemo(() => {
    if (!brief) return { ok: true, error: '' };
    try {
      topoSort(brief.tasks.map((t) => ({ id: t.key, dependsOn: t.dependsOnKeys })));
      return { ok: true, error: '' };
    } catch (e: any) {
      return { ok: false, error: e.message as string };
    }
  }, [brief]);

  if (err && !detail) return <Empty>{err}</Empty>;
  if (!detail) return <Empty>Loading…</Empty>;
  const g = detail.goal;

  if (g.state === 'clarifying' || !brief) {
    return (
      <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6 space-y-4">
        <Header detail={detail} />
        {g.interview ? (
          <InterviewPanel goal={g} />
        ) : (
          <Card title="Clarifying…">
            <p className="text-sm text-zinc-400 mb-3">The Clarifier is exploring the repository, listing the Areas the goal covers and drafting the Brief. This page updates automatically.</p>
            <LiveLog attemptId={`clarify-${id}`} />
          </Card>
        )}
      </div>
    );
  }

  const editable = g.state === 'awaiting_brief_approval';
  const update = (patch: Partial<Brief>) => edit((b) => ({ ...b, ...patch }));
  const blockingUnanswered = brief.questions.filter((q) => q.blocking && !q.answer?.trim());
  const badChecks = brief.checks.filter((c) => checkProblem(c));
  const badTasks = brief.tasks.filter((t) => taskProblem(t));
  const gaps = uncoveredAreas(brief);
  const pending = pendingDecisions(brief);
  const blockers = [
    blockingUnanswered.length ? `${blockingUnanswered.length} blocking question${blockingUnanswered.length > 1 ? 's' : ''} unanswered` : '',
    !graph.ok ? 'task graph has a cycle' : '',
    brief.tasks.length === 0 ? 'no tasks' : '',
    badTasks.length ? `${badTasks.length} task${badTasks.length > 1 ? 's' : ''} without a title` : '',
    badChecks.length ? `${badChecks.length} incomplete check${badChecks.length > 1 ? 's' : ''}` : '',
  ].filter(Boolean);

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
      await api.approveBrief(id, brief, budgetChanged ? budgetDraft : undefined, completionEdit ?? undefined);
      nav(`/goals/${id}`);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const simple = (expert ?? g.mode !== 'simple') === false;
  if (simple) {
    return (
      <SimpleBrief
        brief={brief}
        goal={g}
        editable={editable}
        update={update}
        budgetDraft={budgetDraft}
        setBudgetEdit={setBudgetEdit}
        proposed={proposed}
        blockers={blockers}
        pendingDecisions={pending.length}
        busy={busy}
        dirty={dirty}
        err={err}
        onApprove={approve}
        onSave={save}
        onCancel={() => api.cancelGoal(id).then(() => nav('/'))}
        onExpert={() => setView(true)}
      />
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6 space-y-4">
      <Header detail={detail} onSimple={() => setView(false)} />
      <Card title={<>Understanding<HelpLink to="approving-the-brief#understanding" className="ml-1.5" /></>}>
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
        <Card title={<>{`Questions (${blockingUnanswered.length} blocking unanswered)`}<HelpLink to="approving-the-brief#questions" className="ml-1.5" /></>}>
          <div className="space-y-3">
            {brief.questions.map((q, i) => {
              const area = areaOf(brief, q.areaKey);
              if (q.kind === 'style' && brief.styleOptions.length) return <StyleCards key={q.id} goalId={id} brief={brief} question={q} editable={editable} update={update} />;
              return (
                <div key={q.id}>
                  <div className="text-sm text-zinc-200 mb-1 flex items-start gap-2 flex-wrap">
                    {q.blocking && <Badge state="must">blocking</Badge>}
                    {area && <span className={cn('text-[10px] rounded-full border px-2 py-0.5', areaStyle(brief, q.areaKey).chip)}>{area.name}</span>}
                    <span>{q.text}</span>
                  </div>
                  {q.options.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-1.5">
                      {q.options.map((opt, oi) => (
                        <button
                          key={opt}
                          type="button"
                          disabled={!editable}
                          title={oi === 0 ? 'Recommended by the Clarifier' : undefined}
                          className={cn('text-[11px] rounded-full border px-2 py-0.5', (q.answer ?? '') === opt ? 'border-emerald-500 text-emerald-300 bg-emerald-500/10' : 'border-zinc-700 text-zinc-300 hover:border-zinc-500')}
                          onClick={() => update({ questions: brief.questions.map((x, j) => (j === i ? { ...x, answer: opt, applied: false } : x)) })}
                        >
                          {opt}
                          {oi === 0 ? ' ★' : ''}
                        </button>
                      ))}
                    </div>
                  )}
                  <Input disabled={!editable} placeholder={q.options.length ? 'Pick an option above or type your own answer' : 'Your answer'} value={q.answer ?? ''} onChange={(e) => update({ questions: brief.questions.map((x, j) => (j === i ? { ...x, answer: e.target.value, applied: false } : x)) })} />
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card title={<>Assumptions (accepted unless you uncheck)<HelpLink to="approving-the-brief#assumptions" className="ml-1.5" /></>}>
        {brief.assumptions.length === 0 && <div className="text-sm text-zinc-500">None.</div>}
        <div className="space-y-1.5">
          {brief.assumptions.map((a, i) => (
            <label key={a.id} className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" disabled={!editable} checked={a.accepted} onChange={(e) => update({ assumptions: brief.assumptions.map((x, j) => (j === i ? { ...x, accepted: e.target.checked, applied: false } : x)) })} />
              <span className={cn(!a.accepted && 'line-through text-zinc-500')}>{a.text}</span>
            </label>
          ))}
        </div>
      </Card>

      <DecisionsBar brief={brief} goalId={id} editable={editable} edit={edit} />
      <AreasCard brief={brief} goalId={id} editable={editable} edit={edit} />
      <PlanSection brief={brief} goalId={id} editable={editable} edit={edit} />
      <GoalAcceptanceCard brief={brief} editable={editable} edit={edit} />
      <RunCard brief={brief} editable={editable} edit={edit} goalId={g.id} selfCheck={g.selfCheck} />
      <CompletionCard brief={brief} editable={editable} value={completionEdit} onChange={setCompletionEdit} />

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
        <div className="flex items-center justify-end gap-2 flex-wrap sticky bottom-0 py-3 bg-zinc-950/90 backdrop-blur">
          {(gaps.length > 0 || pending.length > 0) && (
            <span className="text-[11px] text-amber-300 mr-auto">
              {gaps.length > 0 && <span title="Areas without tasks will simply not be built">{gaps.map((a) => a.name).join(', ')} {gaps.length > 1 ? 'have' : 'has'} no tasks. </span>}
              {pending.length > 0 && <span title="Workers receive your decisions, but the tasks and checks were planned before them">{pending.length} decision{pending.length > 1 ? 's' : ''} not applied to the plan — Revise, or approve anyway.</span>}
            </span>
          )}
          {blockers.length > 0 && <span className="text-[11px] text-zinc-500">{blockers.join(' · ')}</span>}
          <Button variant="danger" onClick={() => api.cancelGoal(id).then(() => nav('/'))}>
            Cancel goal
          </Button>
          <Button disabled={!dirty || busy} onClick={save}>
            Save edits
          </Button>
          <Button variant="primary" disabled={busy || blockers.length > 0} onClick={approve} title={blockers.join('; ')}>
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

function Header({ detail, onSimple }: { detail: GoalDetail; onSimple?: () => void }) {
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
      <Link to={`/goals/${g.id}`} className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-200 mb-1" title="Back to the goal's run view">
        ← Goal
      </Link>
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-lg font-semibold">{g.title}</h1>
        <Badge state={g.state} />
        <HelpLink to="approving-the-brief" label="How to read and approve the Brief (new tab)" />
        {onSimple && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={onSimple} title="Back to the plain-language view">
            Simple view
          </Button>
        )}
        {g.state === 'awaiting_brief_approval' && (
          <Button size="sm" variant="ghost" className={onSimple ? '' : 'ml-auto'} disabled={busy} onClick={reclarify} title="Throw this Brief away, fetch the base branch again and let the Clarifier explore the fresh tip (attachments, budget and delivery policy are kept)">
            <RotateCcw size={13} /> {busy ? 'Starting…' : 'Re-run Clarify'}
          </Button>
        )}
      </div>
      <div className="text-xs text-zinc-500 mono">{g.repoPath} · {g.baseBranch} → {g.branch}</div>
      <FollowLinks d={detail} />
      {g.state === 'awaiting_brief_approval' && (
        <div className="text-[11px] text-zinc-500 mt-1">
          {sync ? (
            sync.startedFrom === 'remote' ? (
              <>
                Explored <span className="mono text-zinc-300">{sync.remote}/{sync.base}</span> (your local {sync.base} was {sync.behind} behind).
              </>
            ) : sync.startedFrom === 'previous' ? (
              <>Explored the previous goal's branch — {sync.detail}.</>
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
