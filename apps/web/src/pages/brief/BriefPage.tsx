import type { Brief } from '@foundry/core/browser';
import { calibratedEstimate, decisionsOf, describeCalibration, pendingDecisions, proposeBudgetFromEstimate, topoSort, uncoveredAreas } from '@foundry/core/browser';
import { Loader2, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type GoalDetail } from '../../api.ts';
import { FollowLinks } from '../goal/FollowUps.tsx';
import { OpenFull } from '../../components/FullTextDialog.tsx';
import { MarkdownPanel } from '../../components/Markdown.tsx';
import { useLive } from '../../store.ts';
import { Badge, Button, Card, Empty, Input, Textarea, cn, fmtLimitMin, fmtLimitUsd } from '../../ui.tsx';
import { LiveLog } from '../LiveLog.tsx';
import { ReferenceCard } from './ReferenceCard.tsx';
import { AreasCard } from './AreasCard.tsx';
import { CompletionCard, type CompletionChoice } from './CompletionCard.tsx';
import { StyleCards } from './StyleCards.tsx';
import { useUnsaved } from '../../unsaved.ts';
import { SubjectsCard } from './SubjectsCard.tsx';
import { DecisionsBar } from './DecisionsBar.tsx';
import { SecondOpinionBar } from './SecondOpinionBar.tsx';
import { GoalAcceptanceCard } from './GoalAcceptanceCard.tsx';
import { RunCard } from './RunCard.tsx';
import { InterviewPanel } from '../goal/InterviewPanel.tsx';
import { ClarifyProgress, clarifyChannel } from '../goal/ClarifyProgress.tsx';
import { PlanSection } from './PlanSection.tsx';
import { BriefChipNav, BriefSideNav, type BriefNavItem } from './BriefNav.tsx';
import { SimpleBrief } from './SimpleBrief.tsx';
import { areaOf, areaStyle, checkProblem, taskProblem, withPlan } from './shared.ts';
import { ProviderBadge } from '../agents/rows.tsx';
import { HelpLink } from '../HelpPage.tsx';
import { SectionTitle } from './SectionTitle.tsx';

export function BriefPage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const version = useLive((s) => s.goalVersion[id] ?? 0);
  const [detail, setDetail] = useState<GoalDetail | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [dirty, setDirty] = useState(false);
  useUnsaved(`brief:${id}`, dirty);
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

  /** the page showed the Brief skeleton at the last load: when the plan then arrives, it is merged into unsaved edits */
  const wasSkeleton = useRef(false);
  useEffect(() => {
    const t = setTimeout(
      () =>
        api
          .goal(id)
          .then((d) => {
            setDetail(d);
            const skeletonNow = d.goal.state === 'clarifying' && !!d.brief?.skeleton;
            if (d.brief) {
              if (!dirty) setBrief(d.brief.brief);
              // the plan arrived while this page held edits: the tasks, their checks and the estimate come in, the edits stay
              else if (wasSkeleton.current && !skeletonNow) setBrief((b) => (b ? withPlan(b, d.brief!.brief) : d.brief!.brief));
            }
            wasSkeleton.current = skeletonNow;
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
  /** the Clarifier's Brief without its tasks: read and edit it while the planner works; approval and the AI buttons wait for the plan */
  const skeleton = g.state === 'clarifying' && !!detail.brief?.skeleton;

  if ((g.state === 'clarifying' && !skeleton) || !brief) {
    return (
      <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6 space-y-4">
        <Header detail={detail} />
        {g.interview ? (
          <InterviewPanel goal={g} events={detail.events} />
        ) : (
          <Card title="Clarifying…">
            <p className="text-sm text-zinc-400 mb-3">The Clarifier is exploring the repository, listing the Areas the goal covers and drafting the Brief. This page shows the Brief as soon as its skeleton is written, and updates by itself.</p>
            <div className="mb-3 text-xs">
              <ClarifyProgress goal={g} writingBrief events={detail.events} />
            </div>
            <LiveLog attemptId={clarifyChannel(g)} />
          </Card>
        )}
      </div>
    );
  }

  /** the fields can be changed: the Brief awaits approval, or it is the skeleton the planner is still filling */
  const editable = g.state === 'awaiting_brief_approval' || skeleton;
  /** the plan is in: approval, Revise, Draft and the Subjects' tools apply */
  const settled = g.state === 'awaiting_brief_approval';
  const update = (patch: Partial<Brief>) => edit((b) => ({ ...b, ...patch }));
  /** what the Questions card shows: a note is a Decision, listed with the others */
  const asked = brief.questions.filter((q) => q.kind !== 'note');
  const blockingUnanswered = brief.questions.filter((q) => q.blocking && !q.answer?.trim());
  const badChecks = brief.checks.filter((c) => checkProblem(c));
  const badTasks = brief.tasks.filter((t) => taskProblem(t));
  const gaps = uncoveredAreas(brief);
  const pending = pendingDecisions(brief);
  const blockers = [
    skeleton ? 'the planner is still splitting the goal into tasks' : '',
    blockingUnanswered.length ? `${blockingUnanswered.length} blocking question${blockingUnanswered.length > 1 ? 's' : ''} unanswered` : '',
    !graph.ok ? 'task graph has a cycle' : '',
    brief.tasks.length === 0 && !skeleton ? 'no tasks' : '',
    badTasks.length ? `${badTasks.length} task${badTasks.length > 1 ? 's' : ''} without a title` : '',
    badChecks.length ? `${badChecks.length} incomplete check${badChecks.length > 1 ? 's' : ''}` : '',
    detail?.investigating ? 'REA is still studying the references' : '',
    detail?.subjectSearches?.length ? 'pictures of the Subjects are still being found' : '',
  ].filter(Boolean);
  // the Subjects are the server's copy: pictures arrive while the page holds an edited Brief
  const subjects = detail.brief?.brief.subjects ?? [];
  const searching = detail.subjectSearches ?? [];
  const visual = subjects.length > 0 || brief.styleOptions.length > 0 || ['image', 'video', 'cad'].includes(g.nature) || brief.tasks.some((t) => ['frontend', 'fullstack', 'mobile', 'image', 'video', 'cad'].includes(t.scenario));
  const subjectsCard = visual ? <SubjectsCard goalId={id} subjects={subjects} searching={searching} editable={settled} /> : null;

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      // a skeleton's save hands the planner's result the edited fields and keeps whatever tasks are stored by then
      await api.editBrief(id, brief, skeleton);
      setDirty(false);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const isAuto = g.budgetPreset === 'auto';
  const costAvailable = g.provider !== 'codex';
  // the estimate as earlier goals corrected it (ADR-0056): the Auto proposal is twice that
  const calibration = describeCalibration(detail.calibration ?? null, brief, costAvailable);
  const proposed = { ...proposeBudgetFromEstimate(calibratedEstimate(brief, costAvailable ? (detail.calibration ?? null) : detail.calibration ? { cost: null, time: detail.calibration.time } : null)), ...(!costAvailable ? { maxCostUsd: null } : {}) };
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
        calibration={calibration?.text ?? null}
        planning={skeleton}
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
        edit={edit}
        subjects={subjectsCard}
      />
    );
  }

  const decisions = decisionsOf(brief);
  const goalChecks = brief.checks.filter((c) => c.taskKey === null).length;
  const answered = asked.filter((q) => q.answer?.trim()).length;
  const navItems: BriefNavItem[] = [
    { id: 'brief-understanding', label: 'Understanding' },
    ...(asked.length ? [{ id: 'brief-questions', label: 'Questions', status: blockingUnanswered.length ? `${blockingUnanswered.length} blocking` : `${answered}/${asked.length}`, warn: blockingUnanswered.length > 0 }] : []),
    ...(subjectsCard ? [{ id: 'brief-subjects', label: 'Looks like', status: searching.length ? 'searching' : subjects.length ? String(subjects.length) : null }] : []),
    { id: 'brief-assumptions', label: 'Assumptions', status: brief.assumptions.length ? `${brief.assumptions.filter((a) => a.accepted).length}/${brief.assumptions.length}` : null },
    ...(decisions.length || editable ? [{ id: 'brief-decisions', label: 'Decisions', status: pending.length ? `${pending.length} to apply` : decisions.length ? String(decisions.length) : null, warn: pending.length > 0 }] : []),
    // while the planner works every Area is still empty: nothing to warn about yet
    { id: 'brief-areas', label: 'Areas', status: gaps.length && !skeleton ? `${gaps.length} empty` : String(brief.areas.length), warn: !skeleton && gaps.length > 0 },
    { id: 'brief-plan', label: 'Plan', status: skeleton ? 'planning…' : `${brief.tasks.length} task${brief.tasks.length === 1 ? '' : 's'}`, warn: !skeleton && (!graph.ok || badTasks.length > 0) },
    { id: 'brief-acceptance', label: 'Goal acceptance', status: String(goalChecks), warn: badChecks.length > 0 },
    { id: 'brief-run', label: 'How to run it' },
    { id: 'brief-completion', label: 'Completion' },
    { id: 'brief-budget', label: 'Estimate & budget', status: skeleton ? 'with the plan' : `${costAvailable ? `$${brief.costEstimateUsd} · ` : ''}${brief.timeEstimateMin}m`, warn: !skeleton && (overCost || overTime) },
  ];
  const sec = 'scroll-mt-14 lg:scroll-mt-4';

  return (
    <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6 space-y-4">
      <Header detail={detail} onSimple={() => setView(false)} beforeReclarify={dirty ? save : undefined} />
      <div className="grid lg:grid-cols-[11rem_minmax(0,1fr)] gap-x-6">
        <BriefSideNav items={navItems} />
        <div className="min-w-0 space-y-4">
          <BriefChipNav items={navItems} />
          <section id="brief-understanding" className={sec}>
            <Card title={<><SectionTitle section="understanding">Understanding</SectionTitle><HelpLink to="approving-the-brief#understanding" className="ml-1.5" /></>}>
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
                  <MarkdownPanel title="preview" source={brief.understanding} maxHeight={260} actions={<OpenFull value={{ title: 'Understanding', text: brief.understanding }} />} />
                </div>
              ) : (
                <MarkdownPanel title="understanding" source={brief.understanding} actions={<OpenFull value={{ title: 'Understanding', text: brief.understanding }} />} />
              )}
            </Card>
          </section>

          {asked.length > 0 && (
            <section id="brief-questions" className={sec}>
              <Card title={<><SectionTitle section="questions">{`Questions (${blockingUnanswered.length} blocking unanswered)`}</SectionTitle><HelpLink to="approving-the-brief#questions" className="ml-1.5" /></>}>
                <div className="space-y-3">
                  {brief.questions.map((q, i) => {
                    if (q.kind === 'note') return null;
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
                                className={cn('text-[11px] text-left rounded-xl border px-2 py-0.5', (q.answer ?? '') === opt ? 'border-emerald-500 text-emerald-300 bg-emerald-500/10' : 'border-zinc-700 text-zinc-300 hover:border-zinc-500')}
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
            </section>
          )}

          {subjectsCard && (
            <section id="brief-subjects" className={sec}>
              {subjectsCard}
            </section>
          )}

          <section id="brief-assumptions" className={sec}>
            <Card title={<><SectionTitle section="assumptions">Assumptions (accepted unless you uncheck)</SectionTitle><HelpLink to="approving-the-brief#assumptions" className="ml-1.5" /></>}>
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
          </section>

          {(decisions.length > 0 || editable) && (
            <section id="brief-decisions" className={sec}>
              <DecisionsBar brief={brief} goal={g} goalId={id} editable={editable} revisable={settled} edit={edit} beforeRevise={dirty ? save : undefined} />
            </section>
          )}
          {(editable || detail.secondOpinion) && (
            <section id="brief-second-opinion" className={sec}>
              <SecondOpinionBar goalId={id} stored={detail.secondOpinion ?? null} failed={detail.secondOpinionFailed ?? null} running={!!detail.secondOpinionRunning} editable={editable} edit={edit} beforeRun={dirty ? save : undefined} />
            </section>
          )}
          <section id="brief-areas" className={sec}>
            <AreasCard brief={brief} goalId={id} editable={editable} draftable={settled} planning={skeleton} edit={edit} />
          </section>
          <section id="brief-plan" className={sec}>
            {skeleton ? (
              <Card title={<><SectionTitle section="plan">Plan</SectionTitle><HelpLink to="approving-the-brief#while-the-planner-works" className="ml-1.5" /></>}>
                <div className="text-xs space-y-3">
                  <ClarifyProgress goal={g} writingBrief skeleton events={detail.events} />
                  <p className="text-zinc-400">
                    The tasks, their checks and the estimate appear here by themselves. Read and edit the rest meanwhile: what you change is kept, and the plan fills in around it. <b>Save edits</b> hands your changes to the planner's result even if you leave the page.
                  </p>
                  <LiveLog attemptId={clarifyChannel(g)} className="max-h-48" />
                </div>
              </Card>
            ) : (
              <PlanSection costAvailable={costAvailable} brief={brief} goalId={id} editable={editable} edit={edit} />
            )}
          </section>
          <section id="brief-acceptance" className={sec}>
            <GoalAcceptanceCard brief={brief} editable={editable} edit={edit} />
          </section>
          {g.references.length > 0 && (
            <section id="brief-reference" className={sec}>
              <ReferenceCard goal={g} investigating={detail?.investigating} />
            </section>
          )}
          <section id="brief-run" className={sec}>
            <RunCard brief={brief} editable={editable} edit={edit} goalId={g.id} selfCheck={g.selfCheck} milestonePause={g.milestonePause ?? true} ponytail={(g.workflow.ponytail ?? 'on') === 'on'} />
          </section>
          <section id="brief-completion" className={sec}>
            <CompletionCard brief={brief} editable={editable} value={completionEdit} onChange={setCompletionEdit} />
          </section>

          <section id="brief-budget" className={sec}>
            <Card title={<SectionTitle section="budget">{isAuto && editable ? 'Estimate → proposed budget' : 'Estimate & budget'}</SectionTitle>}>
              {skeleton && <p className="text-xs text-sky-300 mb-2">The estimate arrives with the plan.</p>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                {costAvailable ? <div>
                  Estimated cost <span className="mono">${brief.costEstimateUsd}</span>
                  <span className={cn('ml-1', overCost ? 'text-amber-300' : 'text-zinc-500')}>(budget {fmtLimitUsd(g.budgets.maxCostUsd)})</span>
                </div> : <p className="text-zinc-400">Codex dollar costs are unavailable. Time and attempt limits apply.</p>}
                <div>
                  Estimated time <span className="mono">{brief.timeEstimateMin} min</span>
                  <span className={cn('ml-1', overTime ? 'text-amber-300' : 'text-zinc-500')}>(budget {fmtLimitMin(g.budgets.maxDurationMin)})</span>
                </div>
              </div>
              {calibration && !skeleton && (
                <p className="mt-2 text-xs text-zinc-400" title={detail.calibration?.samples.map((s) => `${s.title}: ${s.actualUsd != null ? `$${s.actualUsd.toFixed(2)} of $${s.estimateUsd}` : 'no cost'}, ${s.actualMin != null ? `${Math.round(s.actualMin)} of ${s.estimateMin} min` : 'no time'}`).join('\n')}>
                  {calibration.text}
                </p>
              )}
              {editable && (
                <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/50 p-3">
                  <div className="text-xs text-zinc-400 mb-2">
                    {isAuto ? (
                      <>
                        <span className="text-emerald-300">Auto budget preset:</span> no cap was set while clarifying; this proposal ({calibration ? 'the calibrated estimate ×2' : 'estimate ×2'}) becomes the goal's budget when you approve. Edit it, or keep it unlimited — the engine pauses and asks you if a limit is reached.
                      </>
                    ) : overCost || overTime ? (
                      <span className="text-amber-300">The estimate exceeds the budget you set. Raise it here or approve anyway (the engine will pause when it is reached).</span>
                    ) : (
                      'Budget applied when you approve. Blank = no limit.'
                    )}
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    {costAvailable && <label className="text-xs text-zinc-400">
                      max cost $
                      <Input type="number" min={0.5} step={0.5} className="w-28 mt-1" value={budgetDraft.maxCostUsd ?? ''} placeholder="∞" onChange={(e) => setBudgetEdit({ ...budgetDraft, maxCostUsd: e.target.value === '' ? null : Number(e.target.value) })} />
                    </label>}
                    <label className="text-xs text-zinc-400">
                      max minutes
                      <Input type="number" min={5} step={5} className="w-28 mt-1" value={budgetDraft.maxDurationMin ?? ''} placeholder="∞" onChange={(e) => setBudgetEdit({ ...budgetDraft, maxDurationMin: e.target.value === '' ? null : Number(e.target.value) })} />
                    </label>
                    {(overCost || overTime || budgetChanged) && (
                      <Button size="sm" variant="ghost" onClick={() => setBudgetEdit(proposed)}>
                        Use {calibration ? 'calibrated estimate' : 'estimate'} ×2 ({costAvailable && <>${proposed.maxCostUsd} / </>}{proposed.maxDurationMin} min)
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
          </section>

          {err && <div className="text-sm text-rose-400">{err}</div>}
          {editable ? (
            <div className="flex items-center justify-end gap-2 flex-wrap sticky bottom-0 py-3 bg-zinc-950/90 backdrop-blur">
              {skeleton && (
                <span className="text-[11px] text-sky-300 mr-auto inline-flex items-center gap-1.5">
                  <Loader2 size={12} className="animate-spin" /> The planner is splitting the goal into tasks. Read and edit meanwhile; approval opens when the plan is in.
                </span>
              )}
              {!skeleton && (gaps.length > 0 || pending.length > 0) && (
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
                Approve & run{editable && budgetChanged ? ` · budget ${costAvailable ? fmtLimitUsd(budgetDraft.maxCostUsd) + ' / ' : ''}${fmtLimitMin(budgetDraft.maxDurationMin)}` : ''}
              </Button>
            </div>
          ) : (
            <div className="text-sm text-zinc-400">
              This brief was {detail.brief?.approved ? 'approved' : 'superseded'}. <Link className="underline" to={`/goals/${id}`}>Go to run view</Link>.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Header({ detail, onSimple, beforeReclarify }: { detail: GoalDetail; onSimple?: () => void; /** saves the page's edits first, so answers and notes typed here reach the new Clarify as Decisions */ beforeReclarify?: () => Promise<void> }) {
  const g = detail.goal;
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const reclarify = async () => {
    setBusy(true);
    setErr(null);
    try {
      await beforeReclarify?.();
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
        {g.workflow.profile && <span className="text-[10px] rounded-full border border-violet-800 text-violet-300 px-1.5" title="Workflow suite: whose skills the roles follow for this goal">Powered by {g.workflow.profile}</span>}
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
      <div className="flex items-center gap-2 flex-wrap"><ProviderBadge provider={g.provider} /><span className="text-xs text-zinc-500 mono">{g.repoPath} · {g.baseBranch} → {g.branch}</span></div>
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
        <MarkdownPanel title="goal" source={g.prompt} maxHeight={220} actions={<OpenFull value={{ title: g.title, text: g.prompt }} />} />
      </div>
    </div>
  );
}
