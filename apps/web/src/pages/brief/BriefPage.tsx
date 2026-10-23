import { PROVIDER_LABEL, reportsDollars } from '@foundry/core/browser';
import type { Brief } from '@foundry/core/browser';
import { calibratedEstimate, decisionsOf, describeCalibration, pendingDecisions, proposeBudgetFromEstimate, topoSort, uncoveredAreas } from '@foundry/core/browser';
import { ArrowLeft, CircleAlert, Folder, GitBranch, Loader2, RotateCcw, Settings2 } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type GoalDetail } from '../../api.ts';
import { FollowLinks } from '../goal/FollowUps.tsx';
import { OpenFull } from '../../components/FullTextDialog.tsx';
import { MarkdownPanel } from '../../components/Markdown.tsx';
import { StageRail, StatePlate, markFill, stageMarks, stageNotes, taskMark } from '../../components/progress.tsx';
import { useLive } from '../../store.ts';
import { Button, Card, CopyButton, EmptyState, Input, Loading, PAGE_TITLE, Textarea, buttonClass, cn, fmtLimitMin, fmtLimitUsd, stateLabel } from '../../ui.tsx';
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
import { ACCEPTED_TICK, AnsweredTick, ApprovalBar, ReadOnlyTick, answerChip, blockingTag, holdsOf } from './marks.tsx';
import { areaOf, areaStyle, checkProblem, taskProblem, withPlan } from './shared.ts';
import { ProviderBadge } from '../agents/rows.tsx';
import { HelpLink } from '../HelpPage.tsx';
import { SectionTitle } from './SectionTitle.tsx';
import { ConversationBubble } from '../../components/conversation/ConversationBubble.tsx';

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

  if (err && !detail)
    return (
      <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6">
        <EmptyState icon={CircleAlert} tone="bad" title="This Brief could not be opened" actions={<Link to={`/goals/${id}`} className={buttonClass('default', 'lg')}><ArrowLeft size={16} aria-hidden="true" /> Goal</Link>}>
          {err}
        </EmptyState>
      </div>
    );
  if (!detail) return <Loading size="page" label="Loading the Brief…" />;
  const g = detail.goal;
  /** the Clarifier's Brief without its tasks: read and edit it while the planner works; approval and the AI buttons wait for the plan */
  const skeleton = g.state === 'clarifying' && !!detail.brief?.skeleton;
  const simple = (expert ?? g.mode !== 'simple') === false;

  if ((g.state === 'clarifying' && !skeleton) || !brief) {
    return (
      <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6 space-y-6">
        <ConversationBubble goalId={id} />
        <Header detail={detail} simple={simple} />
        {g.interview ? (
          <InterviewPanel goal={g} events={detail.events} />
        ) : (
          <Card title={<span className="inline-flex items-center gap-2"><Loader2 size={14} className="shrink-0 animate-spin text-work-ink" aria-hidden="true" />Clarifying…</span>}>
            <p className="text-sm text-ink-soft mb-3">The Clarifier is exploring the repository, listing the Areas the goal covers and drafting the Brief. This page shows the Brief as soon as its skeleton is written, and updates by itself.</p>
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
  /** what holds the approval back, each with how it stands: work under way, your answer awaited, a problem to fix */
  const holds = holdsOf([
    skeleton && { text: 'the planner is still splitting the goal into tasks', detail: 'read and edit meanwhile; approval opens when the plan is in', tone: 'work' },
    blockingUnanswered.length > 0 && { text: `${blockingUnanswered.length} blocking question${blockingUnanswered.length > 1 ? 's' : ''} unanswered`, tone: 'you' },
    !graph.ok && { text: 'task graph has a cycle', tone: 'bad' },
    brief.tasks.length === 0 && !skeleton && { text: 'no tasks', tone: 'bad' },
    badTasks.length > 0 && { text: `${badTasks.length} task${badTasks.length > 1 ? 's' : ''} without a title`, tone: 'bad' },
    badChecks.length > 0 && { text: `${badChecks.length} incomplete check${badChecks.length > 1 ? 's' : ''}`, tone: 'bad' },
    !!detail?.investigating && { text: 'REA is still studying the references', tone: 'work' },
    !!detail?.subjectSearches?.length && { text: 'pictures of the Subjects are still being found', tone: 'work' },
  ]);
  const blockers = holds.map((h) => h.text);
  /** what does not hold the approval back but asks a look first, once the plan is in: Areas it leaves out, Decisions it was planned before */
  const notes = skeleton
    ? []
    : holdsOf([
        gaps.length > 0 && { text: `${gaps.map((a) => a.name).join(', ')} ${gaps.length > 1 ? 'have' : 'has'} no tasks`, detail: `${gaps.length > 1 ? 'they' : 'it'} will simply not be built`, tone: 'bad' },
        pending.length > 0 && { text: `${pending.length} decision${pending.length > 1 ? 's' : ''} not applied to the plan`, detail: 'Revise, or approve anyway', tone: 'you' },
      ]);
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
  const costAvailable = reportsDollars(g.provider);
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

  if (simple) {
    return (
      <SimpleBrief
        head={<Header detail={detail} simple onView={() => setView(true)} />}
        brief={brief}
        goal={g}
        editable={editable}
        calibration={calibration?.text ?? null}
        planning={skeleton}
        update={update}
        budgetDraft={budgetDraft}
        setBudgetEdit={setBudgetEdit}
        proposed={proposed}
        blockers={holds}
        pendingDecisions={pending.length}
        busy={busy}
        dirty={dirty}
        err={err}
        onApprove={approve}
        onSave={save}
        onCancel={() => api.cancelGoal(id).then(() => nav('/'))}
        edit={edit}
        subjects={subjectsCard}
      />
    );
  }

  const decisions = decisionsOf(brief);
  const goalChecks = brief.checks.filter((c) => c.taskKey === null).length;
  const answered = asked.filter((q) => q.answer?.trim()).length;
  // a section is flagged only while the Brief can still change: an approved one waits for nothing
  const navItems: BriefNavItem[] = [
    { id: 'brief-understanding', label: 'Understanding' },
    ...(asked.length ? [{ id: 'brief-questions', label: 'Questions', status: blockingUnanswered.length ? `${blockingUnanswered.length} blocking` : `${answered}/${asked.length}`, warn: editable && blockingUnanswered.length > 0, ...(answered === asked.length ? { tone: 'ok' as const } : {}) }] : []),
    ...(subjectsCard ? [{ id: 'brief-subjects', label: 'Looks like', status: searching.length ? 'searching' : subjects.length ? String(subjects.length) : null, ...(searching.length ? { tone: 'work' as const } : {}) }] : []),
    { id: 'brief-assumptions', label: 'Assumptions', status: brief.assumptions.length ? `${brief.assumptions.filter((a) => a.accepted).length}/${brief.assumptions.length}` : null },
    ...(decisions.length || editable ? [{ id: 'brief-decisions', label: 'Decisions', status: pending.length ? `${pending.length} to apply` : decisions.length ? String(decisions.length) : null, warn: editable && pending.length > 0 }] : []),
    // while the planner works every Area is still empty: nothing to warn about yet
    { id: 'brief-areas', label: 'Areas', status: gaps.length && !skeleton ? `${gaps.length} empty` : String(brief.areas.length), warn: editable && !skeleton && gaps.length > 0 },
    { id: 'brief-plan', label: 'Plan', status: skeleton ? 'planning…' : `${brief.tasks.length} task${brief.tasks.length === 1 ? '' : 's'}`, warn: editable && !skeleton && (!graph.ok || badTasks.length > 0), ...(skeleton ? { tone: 'work' as const } : {}) },
    { id: 'brief-acceptance', label: 'Goal acceptance', status: String(goalChecks), warn: editable && badChecks.length > 0 },
    { id: 'brief-run', label: 'How to run it' },
    { id: 'brief-completion', label: 'Completion' },
    { id: 'brief-budget', label: 'Estimate & budget', status: skeleton ? 'with the plan' : `${costAvailable ? `${brief.costEstimateUsd} · ` : ''}${brief.timeEstimateMin}m`, warn: editable && !skeleton && (overCost || overTime), ...(skeleton ? { tone: 'work' as const } : {}) },
  ];
  const sec = 'scroll-mt-14 lg:scroll-mt-4';

  return (
    <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6 space-y-6">
      <ConversationBubble goalId={id} />
      <Header detail={detail} onView={() => setView(false)} beforeReclarify={dirty ? save : undefined} />
      <div className="grid lg:grid-cols-[12rem_minmax(0,1fr)] gap-x-8">
        <BriefSideNav items={navItems} goalId={id} />
        <div className="min-w-0 space-y-4">
          <BriefChipNav items={navItems} goalId={id} />
          {/* each card's "?" stays beside its title: a title that wraps never leaves it alone on a line */}
          <section id="brief-understanding" className={sec}>
            <Card title={<span className="flex items-start gap-1.5"><SectionTitle section="understanding">Understanding</SectionTitle><HelpLink to="approving-the-brief#understanding" className="mt-0.5 shrink-0" /></span>}>
              <div className="mb-4">
                <label className="block mb-1 text-xs font-semibold text-ink-soft">
                  pull request title <span className="font-normal text-ink-faint">· Conventional Commits header for the whole goal (one-PR delivery); per-task PRs use each task's header</span>
                </label>
                {editable ? (
                  <Input className="mono" value={brief.title ?? ''} onChange={(e) => update({ title: e.target.value })} placeholder="feat(scope): what this goal adds" />
                ) : (
                  <div className="mono text-sm text-ink">{brief.title || <span className="text-ink-faint">derived from the goal title</span>}</div>
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
              <Card title={<span className="flex items-start gap-1.5"><SectionTitle section="questions">{`Questions (${blockingUnanswered.length} blocking unanswered)`}</SectionTitle><HelpLink to="approving-the-brief#questions" className="mt-0.5 shrink-0" /></span>}>
                <div className="space-y-5">
                  {brief.questions.map((q, i) => {
                    if (q.kind === 'note') return null;
                    const area = areaOf(brief, q.areaKey);
                    if (q.kind === 'style' && brief.styleOptions.length) return <StyleCards key={q.id} goalId={id} brief={brief} question={q} editable={editable} update={update} />;
                    return (
                      <div key={q.id}>
                        {/* a blocking question waits for you, in yellow, until it has an answer; an answered one is ticked green */}
                        <div className="text-sm font-semibold text-ink mb-2 flex items-start gap-2 flex-wrap">
                          <AnsweredTick answer={q.answer} />
                          {q.blocking && <span className={blockingTag(!!q.answer?.trim())}>blocking</span>}
                          {area && <span className={areaStyle(brief, q.areaKey).chip}>{area.name}</span>}
                          <span className="min-w-0 flex-1 basis-64">{q.text}</span>
                        </div>
                        {q.options.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mb-2">
                            {/* the answer picked is green, as an answer given anywhere on the Brief */}
                            {q.options.map((opt, oi) => (
                              <button
                                key={opt}
                                type="button"
                                disabled={!editable}
                                title={oi === 0 ? 'Recommended by the Clarifier' : undefined}
                                className={cn(answerChip((q.answer ?? '') === opt), 'text-left')}
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
            <Card title={<span className="flex items-start gap-1.5"><SectionTitle section="assumptions">Assumptions (accepted unless you uncheck)</SectionTitle><HelpLink to="approving-the-brief#assumptions" className="mt-0.5 shrink-0" /></span>}>
              {brief.assumptions.length === 0 && <div className="text-sm text-ink-faint">None.</div>}
              <div className="space-y-1.5">
                {brief.assumptions.map((a, i) => (
                  <label key={a.id} className="flex items-start gap-2 text-sm text-ink">
                    <input type="checkbox" className={cn('mt-1', !editable && 'sr-only')} style={ACCEPTED_TICK} disabled={!editable} checked={a.accepted} onChange={(e) => update({ assumptions: brief.assumptions.map((x, j) => (j === i ? { ...x, accepted: e.target.checked, applied: false } : x)) })} />
                    {!editable && <ReadOnlyTick on={a.accepted} />}
                    <span className={cn(!a.accepted && 'line-through text-ink-faint')}>{a.text}</span>
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
              <Card title={<span className="flex items-start gap-1.5"><SectionTitle section="plan">Plan</SectionTitle><HelpLink to="approving-the-brief#while-the-planner-works" className="mt-0.5 shrink-0" /></span>}>
                <div className="text-xs space-y-3">
                  <ClarifyProgress goal={g} writingBrief skeleton events={detail.events} />
                  <p className="text-ink-soft">
                    The tasks, their checks and the estimate appear here by themselves. Read and edit the rest meanwhile: what you change is kept, and the plan fills in around it. <b className="text-ink">Save edits</b> hands your changes to the planner's result even if you leave the page.
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
              {skeleton && <p className="text-xs text-work-ink mb-3">The estimate arrives with the plan.</p>}
              {/* over its budget is yours to settle while the Brief waits (yellow); once approved it is only a figure */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {costAvailable ? (
                  <Figure label="Estimated cost" value={`$${brief.costEstimateUsd}`} dim={skeleton} note={<span className={overCost && editable ? 'font-semibold text-you-ink' : 'text-ink-faint'}>(budget {fmtLimitUsd(g.budgets.maxCostUsd)})</span>} />
                ) : (
                  <p className="text-sm text-ink-soft">{PROVIDER_LABEL[g.provider ?? 'claude']} dollar costs are unavailable. Time and attempt limits apply.</p>
                )}
                <Figure label="Estimated time" value={`${brief.timeEstimateMin} min`} dim={skeleton} note={<span className={overTime && editable ? 'font-semibold text-you-ink' : 'text-ink-faint'}>(budget {fmtLimitMin(g.budgets.maxDurationMin)})</span>} />
              </div>
              {calibration && !skeleton && (
                <p className="mt-3 text-xs text-ink-soft" title={detail.calibration?.samples.map((s) => `${s.title}: ${s.actualUsd != null ? `$${s.actualUsd.toFixed(2)} of $${s.estimateUsd}` : 'no cost'}, ${s.actualMin != null ? `${Math.round(s.actualMin)} of ${s.estimateMin} min` : 'no time'}`).join('\n')}>
                  {calibration.text}
                </p>
              )}
              {editable && (
                <div className="mt-4 rounded-md border border-line bg-sunken p-3">
                  <div className="text-xs text-ink-soft mb-2.5">
                    {isAuto ? (
                      <>
                        <span className="font-semibold text-ink">Auto budget preset:</span> no cap was set while clarifying; this proposal ({calibration ? 'the calibrated estimate ×2' : 'estimate ×2'}) becomes the goal's budget when you approve. Edit it, or keep it unlimited — the engine pauses and asks you if a limit is reached.
                      </>
                    ) : overCost || overTime ? (
                      <span className="font-semibold text-you-ink">The estimate exceeds the budget you set. Raise it here or approve anyway (the engine will pause when it is reached).</span>
                    ) : (
                      'Budget applied when you approve. Blank = no limit.'
                    )}
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    {/* the label sets the field's width: the field itself fills it */}
                    {costAvailable && <label className="block w-28 text-xs font-semibold text-ink-soft">
                      max cost $
                      <Input type="number" min={0.5} step={0.5} className="mt-1 mono" value={budgetDraft.maxCostUsd ?? ''} placeholder="∞" onChange={(e) => setBudgetEdit({ ...budgetDraft, maxCostUsd: e.target.value === '' ? null : Number(e.target.value) })} />
                    </label>}
                    <label className="block w-28 text-xs font-semibold text-ink-soft">
                      max minutes
                      <Input type="number" min={5} step={5} className="mt-1 mono" value={budgetDraft.maxDurationMin ?? ''} placeholder="∞" onChange={(e) => setBudgetEdit({ ...budgetDraft, maxDurationMin: e.target.value === '' ? null : Number(e.target.value) })} />
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
                    {budgetChanged && (
                      // pending until the Brief is approved: hollow, as a stage not started
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
                        <i className={cn('h-2 w-2 shrink-0 rounded-full', markFill.next)} aria-hidden="true" />
                        will be applied on approve
                      </span>
                    )}
                  </div>
                </div>
              )}
            </Card>
          </section>

          {err && <div className="rounded-md border border-bad/50 bg-panel px-3 py-2 text-sm text-bad-ink">{err}</div>}
          {editable ? (
            // the actions follow you down the page; what holds them back beside them (above them on a phone)
            <ApprovalBar holds={holds} notes={notes}>
              <Button variant="danger" onClick={() => api.cancelGoal(id).then(() => nav('/'))}>
                Cancel goal
              </Button>
              <Button disabled={!dirty || busy} onClick={save}>
                Save edits
              </Button>
              <Button variant="primary" disabled={busy || blockers.length > 0} onClick={approve} title={blockers.join('; ')}>
                Approve & run{editable && budgetChanged ? ` · budget ${costAvailable ? fmtLimitUsd(budgetDraft.maxCostUsd) + ' / ' : ''}${fmtLimitMin(budgetDraft.maxDurationMin)}` : ''}
              </Button>
            </ApprovalBar>
          ) : (
            // approved is done, in green; a Brief superseded by a newer one only says so
            <div className="text-sm text-ink-soft">
              This brief was {detail.brief?.approved ? <span className="font-semibold text-ok-ink">approved{detail.goal.approvedBy ? ` by ${detail.goal.approvedBy}` : ''}</span> : 'superseded'}. <Link className="font-semibold text-ink underline underline-offset-[3px]" to={`/goals/${id}`}>Go to run view</Link>.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** a figure of the estimate: its label in small capitals, the figure large in mono, the budget beside it */
function Figure({ label, value, note, dim }: { label: string; value: string; note: ReactNode; /** not known yet (the plan is still coming) */ dim?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-faint">{label}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <b className={cn('mono text-2xl font-bold', dim ? 'text-ink-faint' : 'text-ink')}>{value}</b>
        <span className="text-xs">{note}</span>
      </div>
    </div>
  );
}

/**
 * The Brief's head, read as the goal page's: the way back, the goal's state as a plate, its title in large type, its facts
 * as small plates, how the Brief was made, the view switch and Re-run Clarify on the right; then the five stages, and the
 * goal as it was asked.
 */
function Header({ detail, simple = false, onView, beforeReclarify }: { detail: GoalDetail; /** the Brief shows in its Simple view: the switch leads to Expert, and the stages lead nowhere (the goal page shows no tabs then) */ simple?: boolean; /** switches between the views; none while there is no Brief to show */ onView?: () => void; /** saves the page's edits first, so answers and notes typed here reach the new Clarify as Decisions */ beforeReclarify?: () => Promise<void> }) {
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
  const awaiting = g.state === 'awaiting_brief_approval';
  // the Simple view of the Brief leaves Re-run Clarify out, as it always has
  const canReclarify = awaiting && !(simple && onView);
  const repoName = g.repoPath.replace(/\/+$/, '').split('/').pop() || g.repoPath;
  const marks = stageMarks(g, detail.tasks.length > 0);
  // in Expert, each stage opens where its work shows on the goal page; the Brief's is this page
  const links = simple
    ? undefined
    : [
        { to: `/goals/${g.id}#activity`, title: 'open the Activity tab (Clarify session log)' },
        null,
        { to: `/goals/${g.id}#tasks`, title: 'open the Tasks tab' },
        { to: `/goals/${g.id}#activity`, title: 'open the Activity tab (review sessions)' },
        { to: `/goals/${g.id}#delivery`, title: 'open the Delivery tab' },
      ];
  /** a fact about the goal, as a small plate in the row under its title (as on the goal page) */
  const fact = 'inline-flex items-center gap-1.5 min-w-0 max-w-full rounded-md bg-panel px-2.5 py-1 text-[13px] font-semibold text-ink-soft ring-1 ring-inset ring-line';
  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2.5 text-sm text-ink-faint min-w-0">
        <Link to="/" className="inline-flex shrink-0 items-center gap-1.5 font-bold text-ink hover:underline underline-offset-[3px]">
          <ArrowLeft size={14} aria-hidden="true" /> Goals
        </Link>
        <span aria-hidden="true">/</span>
        <span className="mono truncate" title={g.repoPath}>{repoName}</span>
        <span aria-hidden="true">/</span>
        <Link to={`/goals/${g.id}`} className="shrink-0 font-bold text-ink hover:underline underline-offset-[3px]" title="Back to the goal's run view">
          Goal
        </Link>
      </nav>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:gap-8 md:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3">
            <StatePlate state={g.state} label={stateLabel(g.state)} />
            <HelpLink to="approving-the-brief" label="How to read and approve the Brief (new tab)" />
          </div>
          <h1 className={cn(PAGE_TITLE, 'line-clamp-3')} title={g.title}>
            {g.title}
          </h1>
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="About this goal">
            <li className={fact}>
              <Folder size={13} className="shrink-0" aria-hidden="true" />
              <span className="mono font-medium truncate max-w-[14rem]" title={g.repoPath}>{repoName}</span>
              <CopyButton text={g.repoPath} />
            </li>
            <li className={fact} title={`${g.baseBranch} → ${g.branch}`}>
              <GitBranch size={13} className="shrink-0" aria-hidden="true" />
              <span className="mono font-medium truncate">{g.baseBranch} → {g.branch}</span>
            </li>
            <li className="inline-flex items-center">
              <ProviderBadge provider={g.provider} size="md" />
            </li>
            {g.workflow.profile && (
              <li className={fact} title="Workflow suite: whose skills the roles follow for this goal">
                <span className="font-medium text-ink-faint">Powered by</span> {g.workflow.profile}
              </li>
            )}
            {g.workflow.pace === 'fast' && (
              <li className={fact}>
                <span className="font-medium text-ink-faint">pace</span> fast
              </li>
            )}
            <li className={fact}>
              <span className="font-medium text-ink-faint">delivery</span> {g.delivery.policy.mode}
            </li>
            {(g.companions?.length ?? 0) > 0 && (
              <li className={fact} title={`Also changes: ${g.companions!.map((c) => c.repoPath).join(', ')}`}>
                +{g.companions!.length} folder{g.companions!.length === 1 ? '' : 's'}
              </li>
            )}
          </ul>
          {awaiting && (
            <p className="mt-2.5 text-xs text-ink-faint">
              {sync ? (
                sync.startedFrom === 'remote' ? (
                  <>
                    Explored <span className="mono text-ink-soft">{sync.remote}/{sync.base}</span> (your local {sync.base} was {sync.behind} behind).
                  </>
                ) : sync.startedFrom === 'previous' ? (
                  <>Explored the previous goal's branch — {sync.detail}.</>
                ) : (
                  <>Explored local {sync.base} — {sync.detail}.</>
                )
              ) : (
                <span className="font-semibold text-ink-soft">This Brief was produced from your local checkout without fetching the remote; if upstream moved, re-run Clarify.</span>
              )}
            </p>
          )}
          <FollowLinks d={detail} />
          {err && <div className="text-xs text-bad-ink mt-1.5">{err}</div>}
        </div>
        {(onView || canReclarify) && (
          <div className="flex items-center gap-2 flex-wrap md:justify-end">
            {onView &&
              (simple ? (
                <Button size="sm" onClick={onView} title="Show every control: Areas, task graph, acceptance checks, Draft and Revise">
                  <Settings2 size={13} /> Expert view
                </Button>
              ) : (
                <Button size="sm" onClick={onView} title="Back to the plain-language view">
                  Simple view
                </Button>
              ))}
            {canReclarify && (
              <Button size="sm" disabled={busy} onClick={reclarify} title="Throw this Brief away, fetch the base branch again and let the Clarifier explore the fresh tip (attachments, budget and delivery policy are kept)">
                <RotateCcw size={13} /> {busy ? 'Starting…' : 'Re-run Clarify'}
              </Button>
            )}
          </div>
        )}
      </div>
      <StageRail marks={marks} notes={stageNotes(g, detail.tasks, marks, g.state === 'clarifying' && !!detail.brief?.skeleton)} tasks={detail.tasks.map((t) => taskMark(t.state))} links={links} />
      <MarkdownPanel title="goal" source={g.prompt} maxHeight={220} actions={<OpenFull value={{ title: g.title, text: g.prompt }} />} />
    </div>
  );
}
