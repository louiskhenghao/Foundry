import { isHistory, reportsDollars, taskUsage } from '@foundry/core/browser';
import { ArrowLeft, Ban, Brain, CircleAlert, CornerDownRight, Folder, GitBranch, GitMerge, LayoutTemplate, Link2, NotebookPen, RotateCcw, Trash2 } from 'lucide-react';
import { RestartDialog } from '../../components/RestartDialog.tsx';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { FollowLinks, MarkFollowUpDialog } from './FollowUps.tsx';
import { IssueLink, ScheduleLink } from './IssueLink.tsx';
import { DelegationLinks } from './Delegations.tsx';
import { ClarifyProgress, SkeletonNotice, clarifyChannel } from './ClarifyProgress.tsx';
import { InterviewPanel } from './InterviewPanel.tsx';
import { MilestoneCard } from './MilestoneCard.tsx';
import { ImportedCard } from './ImportedCard.tsx';
import { api, type GoalDetail } from '../../api.ts';
import { useLive } from '../../store.ts';
import { Button, ButtonGroup, Card, ConfirmDialog, CopyButton, EmptyState, Loading, PAGE_TITLE, Tabs, buttonClass, cn, stateLabel } from '../../ui.tsx';
import { StatePlate, StageRail, stageMarks, stageNotes, taskMark } from '../../components/progress.tsx';
import { OpenMenu } from '../../components/OpenMenu.tsx';
import { MoreMenu, type MoreItem } from '../../components/MoreMenu.tsx';
import { LiveLog } from '../LiveLog.tsx';
import { ActivityTab } from './ActivityTab.tsx';
import { DagCanvas, type DagTask } from './DagCanvas.tsx';
import { DeliveryTab } from './DeliveryTab.tsx';
import { DiffTab } from './DiffTab.tsx';
import { OverviewTab } from './OverviewTab.tsx';
import { TimelineTab } from './TimelineTab.tsx';
import { TaskDrawer } from './TaskDrawer.tsx';
import { TaskList } from './TaskList.tsx';
import { SimpleOverview } from './SimpleOverview.tsx';
import { UsagePausedBanner } from '../../components/UsageBanner.tsx';
import { ProviderBadge } from '../agents/rows.tsx';
import { BetaChip, ConversationBubble } from '../../components/conversation/ConversationBubble.tsx';
import { useConversations } from '../../components/conversation/store.ts';
import { ConversationTab } from './ConversationTab.tsx';

type Tab = 'overview' | 'tasks' | 'timeline' | 'activity' | 'diff' | 'delivery' | 'conversation';
const TABS: Tab[] = ['overview', 'tasks', 'timeline', 'activity', 'diff', 'delivery', 'conversation'];

/** the Tasks tab as the graph of which task waits for which, or as a list in planned order: kept in this browser for every goal */
type TaskView = 'graph' | 'list';
const TASK_VIEW_KEY = 'foundry.tasks.view';
const savedTaskView = (): TaskView => {
  try {
    return localStorage.getItem(TASK_VIEW_KEY) === 'list' ? 'list' : 'graph';
  } catch {
    return 'graph';
  }
};

export function GoalPage() {
  const { id = '' } = useParams();
  const loc = useLocation();
  const nav = useNavigate();
  const version = useLive((s) => s.goalVersion[id] ?? 0);
  // the goal's Conversations (ADR-0073): the tab shows only while the feature is on
  const talk = useConversations(id);
  const [d, setD] = useState<GoalDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [del, setDel] = useState(false);
  /** false = closed; true = open (all); string = open, preselect that task */
  const [restart, setRestart] = useState<boolean | string>(false);
  const [delBranch, setDelBranch] = useState(false);
  const [markFollow, setMarkFollow] = useState(false);
  const [expert, setExpert] = useState<boolean | null>(() => {
    const v = localStorage.getItem(`foundry.expert.${id}`);
    return v === null ? null : v === '1';
  });
  const setView = (e: boolean) => {
    setExpert(e);
    localStorage.setItem(`foundry.expert.${id}`, e ? '1' : '0');
  };
  const [deleting, setDeleting] = useState(false);
  const [taskView, setTaskView] = useState<TaskView>(savedTaskView);
  const chooseTaskView = (v: TaskView) => {
    setTaskView(v);
    try {
      localStorage.setItem(TASK_VIEW_KEY, v);
    } catch {}
  };
  const tab = (TABS.find((t) => `#${t}` === loc.hash) ?? 'overview') as Tab;
  /** the tabs and what they show, from where the row of tabs sits before it sticks to the top */
  const tabsBox = useRef<HTMLDivElement | null>(null);
  /** the row of tabs is stuck to the top of the page, a tab scrolling under it */
  const [stuck, setStuck] = useState(false);
  const unwatch = useRef<() => void>(() => {});
  // a callback ref: the tabs mount once the goal is in, and again on every switch back to Expert
  const watchTabs = useCallback((el: HTMLDivElement | null) => {
    unwatch.current();
    unwatch.current = () => {};
    tabsBox.current = el;
    const main = el?.closest('main');
    if (!el || !main) return setStuck(false);
    const check = () => setStuck(el.getBoundingClientRect().top < main.getBoundingClientRect().top);
    check();
    main.addEventListener('scroll', check, { passive: true });
    unwatch.current = () => main.removeEventListener('scroll', check);
  }, []);
  useEffect(() => () => unwatch.current(), []);
  const setTab = (t: Tab) => {
    const box = tabsBox.current;
    const main = box?.closest('main');
    if (box && main) {
      // chosen from the row stuck at the top: the tab opens at its own top, not as far down as the last one was scrolled
      const top = box.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop;
      if (main.scrollTop > top) main.scrollTop = top;
    }
    nav({ hash: t }, { replace: true });
  };

  useEffect(() => {
    const t = setTimeout(() => api.goal(id).then(setD).catch((e) => setErr(e.message)), 200);
    return () => clearTimeout(t);
  }, [id, version]);
  // a delivered goal asks for fresh facts once per visit: a PR merged or closed on GitHub, a base branch pulled by hand
  const dv = d?.goal.delivery;
  // a delivery that stopped with a PR still open counts too: the PR may have been merged by hand since
  const delivered = !!dv && ((dv.status === 'delivered' && !dv.cleanup?.done) || (dv.status === 'failed' && dv.prs.some((p) => p.state === 'open')));
  useEffect(() => {
    if (delivered) void api.refreshDelivery(id).catch(() => {});
  }, [id, delivered]);
  // /goals/:id?task=<taskId>#tasks (Inbox links) opens that task's view directly
  useEffect(() => {
    const t = new URLSearchParams(loc.search).get('task');
    if (t) setSel(t);
  }, [loc.search]);

  const dagTasks: DagTask[] = useMemo(
    () =>
      (d?.tasks ?? []).map((t) => {
        const attempts = d!.attempts.filter((a) => a.taskId === t.id);
        const model = attempts.flatMap((a) => a.sessions).filter((s) => s.role === 'worker' && s.model).at(-1)?.model ?? null;
        const u = attempts.length ? taskUsage(attempts) : null;
        return { ...t, attempts: attempts.length, maxAttempts: t.retryBudget + t.extraAttempts, totalCost: reportsDollars(d!.goal.provider) && u ? u.costUsd : null, unmeasured: u?.unmeasured ?? 0, model: model?.replace(/^claude-/, '').replace(/\[1m\]$/, '') ?? null, minutes: u ? u.wallMin : null };
      }),
    [d],
  );

  if (err)
    return (
      <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6">
        <EmptyState icon={CircleAlert} tone="bad" title="Something went wrong" actions={<Link to="/" className={buttonClass('default', 'lg')}><ArrowLeft size={16} aria-hidden="true" /> Goals</Link>}>
          {err}
        </EmptyState>
      </div>
    );
  if (!d) return <Loading size="page" label="Loading the goal…" />;
  const g = d.goal;
  // sessions that ended before Claude Code reported a cost: the meter's total leaves them out and says so
  const terminal = ['done', 'over_delivered', 'failed', 'cancelled'].includes(g.state);
  const open = d.escalations.filter((e) => e.state === 'open').length;
  const running = d.tasks.filter((t) => t.state === 'running').length;
  const selTask = d.tasks.find((t) => t.id === sel) ?? null;
  const finished = g.state === 'done' || g.state === 'over_delivered';
  const awaiting = g.state === 'awaiting_brief_approval';
  const repoName = g.repoPath.replace(/\/+$/, '').split('/').pop() || g.repoPath;
  const isExpert = expert ?? g.mode !== 'simple';
  // an Imported Goal not Reattached yet is history: it can be read, mapped, Reattached or deleted (ADR-0030)
  const history = isHistory(g);
  const more: MoreItem[] = history ? [{ label: 'Delete goal…', icon: <Trash2 size={13} />, onClick: () => setDel(true), danger: true }] : [
    ...(terminal || g.state === 'blocked' ? [{ label: 'Restart…', icon: <RotateCcw size={13} />, onClick: () => setRestart(true), title: 'Restart from a task of your choice (or from the beginning)' }] : []),
    ...(awaiting ? [{ label: 'Re-run Clarify', icon: <RotateCcw size={13} />, onClick: () => api.reclarify(id, 'fetch the latest base branch and explore again').catch((e) => setErr(e.message)), title: 'Fetch the base branch again and rebuild the Brief from the fresh tip' }] : []),
    ...(!terminal && awaiting ? [{ label: 'Cancel goal', icon: <Ban size={13} />, onClick: () => api.cancelGoal(id) }] : []),
    ...(!g.follows ? [{ label: 'Mark as follow-up of…', icon: <Link2 size={13} />, onClick: () => setMarkFollow(true), title: 'Record that this goal continues an earlier goal of the same repository' }] : []),
    ...(terminal && g.state !== 'cancelled' ? [{ label: 'Learn from this goal again', icon: <NotebookPen size={13} />, onClick: () => api.learnFrom(id).catch((e) => setErr(e.message)), title: "A short session reads how this goal went and updates this folder's Learnings" }] : []),
    { label: 'Save as template…', icon: <LayoutTemplate size={13} />, onClick: () => nav(`/templates/new?from=${id}`), title: 'A template of your own from the words and settings of this goal, to start the next one from (ADR-0079)' },
    { label: 'Delete goal…', icon: <Trash2 size={13} />, onClick: () => setDel(true), danger: true },
  ];

  // where the goal stands, said once above the stages: the plate, then the tasks and the time
  const total = d.tasks.length;
  const doneTasks = d.tasks.filter((t) => t.state === 'done').length;
  const statusLine = [total ? (running ? `${running} of ${total} task${total === 1 ? '' : 's'} running` : `${doneTasks} of ${total} task${total === 1 ? '' : 's'} done`) : null, d.budget.elapsedMin >= 1 ? `${d.budget.elapsedMin.toFixed(0)} min in` : null].filter(Boolean).join(' · ');
  const marks = stageMarks(g, total > 0);
  // in Expert, each stage opens where its work shows; the Brief has its own page in both views
  const stageLinks = [
    isExpert ? { to: `/goals/${id}#activity`, title: 'open the Activity tab (Clarify session log)' } : null,
    { to: `/goals/${id}/brief`, title: 'open the Brief page' },
    isExpert ? { to: `/goals/${id}#tasks`, title: 'open the Tasks tab' } : null,
    isExpert ? { to: `/goals/${id}#activity`, title: 'open the Activity tab (review sessions)' } : null,
    isExpert ? { to: `/goals/${id}#delivery`, title: 'open the Delivery tab' } : null,
  ];
  /** a fact about the goal, as a small plate in the row under its title */
  const fact = 'inline-flex items-center gap-1.5 min-w-0 max-w-full rounded-md bg-panel px-2.5 py-1 text-[13px] font-semibold text-ink-soft ring-1 ring-inset ring-line';

  return (
    <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6 space-y-5">
      <UsagePausedBanner />
      <nav aria-label="Breadcrumb" className="flex items-center gap-2.5 text-sm text-ink-faint min-w-0">
        <Link to="/" className="inline-flex shrink-0 items-center gap-1.5 font-bold text-ink hover:underline underline-offset-[3px]">
          <ArrowLeft size={14} aria-hidden="true" /> Goals
        </Link>
        <span aria-hidden="true">/</span>
        <span className="mono truncate" title={g.repoPath}>{repoName}</span>
      </nav>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-8 lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3">
            <StatePlate state={g.state} label={stateLabel(g.state)} />
            {statusLine && <span className="text-sm font-semibold text-ink-faint">{statusLine}</span>}
            {g.transfer && <span className="text-[11px] font-semibold rounded-sm bg-code-1/12 ring-1 ring-inset ring-code-1/45 text-code-1-ink px-1.5 py-0.5" title={`came from ${g.transfer.from.hostname}`}>imported</span>}
            {g.delivery.reverts[g.delivery.reverts.length - 1]?.status === 'merged' && <span className="text-[11px] font-semibold rounded-sm ring-1 ring-inset ring-bad/45 text-bad-ink px-1.5 py-0.5" title="Its merge was undone by a revert pull request (Delivery tab)">reverted</span>}
          </div>
          <h1 className={cn(PAGE_TITLE, 'line-clamp-3')} title={g.title}>
            {g.title}
          </h1>
          {/* what was asked, in its first lines: the Overview's Goal card holds all of it */}
          {g.prompt && g.prompt !== g.title && <p className="mt-3 max-w-[72ch] text-[17px] leading-relaxed text-ink-soft line-clamp-2 header-compact:text-sm" title={g.prompt}>{g.prompt}</p>}
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
                <span className="font-medium text-ink-faint">workflow</span> {g.workflow.profile}
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
            {g.template && (
              <li className={fact} title={`Made from the template "${g.template.name}"`}>
                <span className="font-medium text-ink-faint">template</span>{' '}
                <Link to={`/templates/${encodeURIComponent(g.template.id)}`} className="hover:underline">
                  {g.template.name}
                </Link>
              </li>
            )}
            {(g.companions?.length ?? 0) > 0 && (
              <li className={fact} title={`Also changes: ${g.companions!.map((c) => c.repoPath).join(', ')}`}>
                +{g.companions!.length} folder{g.companions!.length === 1 ? '' : 's'}
              </li>
            )}
          </ul>
          {(g.by || g.approvedBy) && (
            <p className="text-xs text-ink-faint mt-2.5" title="Who asked for the goal and who approved its Brief (Settings → Access)">
              {[g.by ? `Asked by ${g.by}` : '', g.approvedBy ? `Brief approved by ${g.approvedBy}` : ''].filter(Boolean).join(' · ')}
            </p>
          )}
          <IssueLink issue={g.issue} />
          <ScheduleLink schedule={g.schedule} />
          <FollowLinks d={d} />
          <DelegationLinks d={d} />
          {(d.learningsCount ?? 0) > 0 && (
            <div className="text-xs text-ink-faint mt-1.5">
              <Link to={`/learnings?repo=${encodeURIComponent(g.repoPath)}`} className="inline-flex items-center gap-1 hover:text-ink" title="What earlier goals in this folder learned; every new goal here is given it">
                <NotebookPen size={12} /> Learnings for this folder: {d.learningsCount}
              </Link>
            </div>
          )}
          {d.memory?.enabled && (
            <div className="text-xs text-ink-faint mt-1.5" title={d.memory.bank ? `This folder's goals share the bank ${d.memory.bank} with your own sessions here (Memory, Extensions → MCP servers)` : 'Memory is set up; this goal has not asked it yet'}>
              <span className="inline-flex items-center gap-1">
                <Brain size={12} /> Memory:{' '}
                {d.memory.recalls.length === 0 ? 'not asked yet' : d.memory.recalls.every((r) => !r.text && r.error) ? 'the server did not answer' : `${d.memory.recalls.filter((r) => r.text).length}/${d.memory.recalls.length} recalled · wrote back ${d.memory.written}`}
              </span>
            </div>
          )}
        </div>
        {/* the goal's actions, large: what it spent and how long it worked are the Overview's Budget & time. Under the
            title below 1024 px; beside it, a row wide enough for every state's actions but a finished goal's, which wrap
            as two groups */}
        <div className="lg:max-w-[30rem]">
          <div className="flex items-center gap-2.5 flex-wrap lg:justify-end">
            {/* in the header, not in the tabs row or the simple view's status line: switching views must not move it */}
            <ButtonGroup
              size="lg"
              label="View"
              value={isExpert ? 'expert' : 'simple'}
              onChange={(v) => setView(v === 'expert')}
              options={[
                { id: 'simple', label: 'Simple', title: 'The plain progress view' },
                { id: 'expert', label: 'Expert', title: 'Tasks, logs, acceptance checks, diff, delivery controls' },
              ]}
            />
            <OpenMenu
              goalId={id}
              places={[
                { which: 'repo', label: 'Repository', path: d.paths.repo, hint: `your checkout · ${g.baseBranch}` },
                ...(d.paths.workspace ? [{ which: 'workspace' as const, label: 'Goal workspace', path: d.paths.workspace, hint: `branch ${g.branch}` }] : []),
              ]}
              working={['running', 'goal_review'].includes(g.state)}
              size="lg"
            />
            {history ? null : awaiting ? (
              <Link to={`/goals/${id}/brief`}>
                <Button size="lg" variant="primary">Review brief →</Button>
              </Link>
            ) : finished ? (
              <Button size="lg" variant="primary" onClick={() => setTab('delivery')}>
                <GitMerge size={15} aria-hidden="true" />
                {g.delivery.status === 'delivered' ? 'Delivery' : g.delivery.status === 'running' ? 'Delivering…' : 'Deliver…'}
              </Button>
            ) : !terminal ? (
              <Button variant="danger" size="lg" onClick={() => api.cancelGoal(id)}>
                <Ban size={15} /> Cancel
              </Button>
            ) : null}
            {terminal && (!history || g.transfer?.repoMapped) && (
              <Link to={`/goals/new?follows=${id}`}>
                <Button size="lg" variant={finished ? 'default' : 'primary'} title="Start a new goal that builds on this one">
                  <CornerDownRight size={15} /> Continue with a follow-up…
                </Button>
              </Link>
            )}
            <MoreMenu items={more} size="lg" />
          </div>
        </div>
      </div>
      <StageRail marks={marks} notes={stageNotes(g, d.tasks, marks)} tasks={d.tasks.map((t) => taskMark(t.state))} links={stageLinks} />
      {history && <ImportedCard goal={g} onChanged={() => api.goal(id).then(setD).catch((e) => setErr(e.message))} />}
      <MarkFollowUpDialog d={d} open={markFollow} onClose={() => setMarkFollow(false)} />
      {restart !== false && <RestartDialog goalId={id} tasks={d.tasks} initial={typeof restart === 'string' ? restart : null} open onClose={() => setRestart(false)} onDone={() => { setRestart(false); setTab('tasks'); }} />}
      <ConfirmDialog
        open={del}
        title={`Delete goal "${g.title}"?`}
        confirmLabel="Delete goal"
        danger
        busy={deleting}
        onClose={() => setDel(false)}
        onConfirm={async () => {
          setDeleting(true);
          try {
            await api.deleteGoal(id, delBranch);
            nav('/');
          } catch (e: any) {
            setErr(e.message);
            setDeleting(false);
          }
        }}
      >
        <p>Running sessions are stopped. The progress folder, the task folders and the goal's stacked delivery branches are deleted for good; attachments go to the trash. The goal disappears from the list, and its event history is kept.</p>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5" checked={delBranch} onChange={(e) => setDelBranch(e.target.checked)} />
          <span>
            Also delete the branch <span className="mono">{g.branch}</span> from the repository {g.delivery.status === 'delivered' ? <span className="text-ink-faint">(already delivered — the remote copy stays)</span> : <span className="text-bad-ink">(the goal's work is lost locally unless you pushed it)</span>}
          </span>
        </label>
      </ConfirmDialog>

      {g.state === 'awaiting_feedback' && <MilestoneCard d={d} />}

      {g.state === 'clarifying' && g.interview && <InterviewPanel goal={g} skeleton={!!d.brief?.skeleton} events={d.events} />}
      {((g.state === 'clarifying' && !g.interview) || g.state === 'goal_review') && (
        <Card title={g.state === 'clarifying' ? (d.brief?.skeleton ? 'Planning…' : 'Clarifying…') : 'Goal review…'}>
          {g.state === 'clarifying' && (
            <div className="mb-3 text-xs">
              <ClarifyProgress goal={g} writingBrief skeleton={!!d.brief?.skeleton} events={d.events} />
              {d.brief?.skeleton && <SkeletonNotice goalId={id} />}
            </div>
          )}
          <LiveLog attemptId={g.state === 'clarifying' ? clarifyChannel(g) : `goal-review-${id}-${g.fixCycles}`} />
        </Card>
      )}

      {!isExpert ? (
        <SimpleOverview
          d={d}
          onDeliver={() => {
            setView(true);
            setTab('delivery');
          }}
        />
      ) : (
        <div ref={watchTabs} className="space-y-5">
      {/* the row of tabs stays at the top of the page while a tab scrolls under it. Only then on the page's colour,
          see-through and blurred, so what passes under it is frosted: at rest a plain panel showed as a band over the
          theme's grain */}
      <div className={cn('sticky top-0 z-20 -mx-3 sm:-mx-4 md:-mx-6 px-3 sm:px-4 md:px-6 transition-colors', stuck && 'bg-page/85 backdrop-blur-md')}>
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Overview', badge: open > 0 ? <span className="mono rounded-[5px] bg-you text-on-you text-[10.5px] px-1.5 font-bold">{open}</span> : null },
          { id: 'tasks', label: `Tasks`, badge: <span className="text-[10px] text-ink-faint">{d.tasks.filter((t) => t.state === 'done').length}/{d.tasks.length}{running ? ` · ${running} running` : ''}</span> },
          { id: 'timeline', label: 'Timeline' },
          { id: 'activity', label: 'Activity' },
          { id: 'diff', label: 'Diff' },
          { id: 'delivery', label: 'Delivery' },
          ...(talk?.enabled ? [{ id: 'conversation' as Tab, label: 'Conversation', badge: <BetaChip /> }] : []),
        ]}
      />
      </div>

      {/* every tab at least as tall as the room under the stuck row: switching to a short one never moves the row or the page */}
      <div className="min-h-[calc(100dvh-8rem)] xl:nav-side:min-h-[calc(100dvh-4.5rem)]">
      {tab === 'overview' && <OverviewTab d={d} />}
      {tab === 'tasks' && (
        <div className="space-y-4">
          <Card
            title={`Tasks (${d.tasks.length})`}
            actions={
              <ButtonGroup
                label="Show the tasks as"
                value={taskView}
                onChange={chooseTaskView}
                options={[
                  { id: 'graph', label: 'Graph', title: 'Which task waits for which: the plan as a graph' },
                  { id: 'list', label: 'List', title: 'One row per task, in the order they were planned' },
                ]}
              />
            }
          >
            {taskView === 'graph' ? <DagCanvas tasks={dagTasks} selected={sel} onSelect={setSel} areas={d.brief?.brief.areas} /> : <TaskList tasks={dagTasks} selected={sel} onSelect={setSel} areas={d.brief?.brief.areas} />}
          </Card>
        </div>
      )}
      {/* a task opens over whichever tab asked for it: the graph's, or a step on the timeline */}
      {selTask && (tab === 'tasks' || tab === 'timeline') && (
        <FullScreen onClose={() => setSel(null)}>
          <TaskDrawer d={d} task={selTask} onClose={() => setSel(null)} onRestart={() => setRestart(selTask.id)} />
        </FullScreen>
      )}
      {tab === 'timeline' && <TimelineTab goalId={id} onOpenTask={setSel} />}
      {tab === 'activity' && <ActivityTab d={d} />}
      {tab === 'diff' && <DiffTab goalId={id} baseBranch={g.baseBranch} branch={g.branch} workspace={d.paths.workspace} />}
      {tab === 'delivery' && <DeliveryTab d={d} />}
      {tab === 'conversation' && <ConversationTab goalId={id} />}
      </div>
        </div>
      )}
      <ConversationBubble goalId={id} />
    </div>
  );
}

/** Full-screen overlay for the task drawer: no more scrolling past the graph; Escape or the × closes it. */
function FullScreen({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    // translucent and blurred: the goal page stays in view behind the panel; a click beside the panel closes it.
    // The panel is always the full viewport height, so switching tasks never resizes it; its content scrolls inside.
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[3px] p-3 sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="max-w-6xl mx-auto h-full rounded-lg bg-panel shadow-2xl">{children}</div>
    </div>
  );
}
