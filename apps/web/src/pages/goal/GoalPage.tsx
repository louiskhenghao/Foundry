import { taskUsage } from '@foundry/core/browser';
import { Ban, CornerDownRight, Folder, GitBranch, Link2, RotateCcw, Trash2 } from 'lucide-react';
import { RestartDialog } from '../../components/RestartDialog.tsx';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { FollowLinks, MarkFollowUpDialog } from './FollowUps.tsx';
import { InterviewPanel } from './InterviewPanel.tsx';
import { MilestoneCard } from './MilestoneCard.tsx';
import { api, type GoalDetail } from '../../api.ts';
import { useLive } from '../../store.ts';
import { Badge, Button, Card, ConfirmDialog, CopyButton, Empty, Meter, Tabs, fmtLimitMin, fmtLimitUsd, fmtUsd } from '../../ui.tsx';
import { OpenMenu } from '../../components/OpenMenu.tsx';
import { MoreMenu, type MoreItem } from '../../components/MoreMenu.tsx';
import { LiveLog } from '../LiveLog.tsx';
import { ActivityTab } from './ActivityTab.tsx';
import { DagCanvas, type DagTask } from './DagCanvas.tsx';
import { DeliveryTab } from './DeliveryTab.tsx';
import { DiffTab } from './DiffTab.tsx';
import { OverviewTab } from './OverviewTab.tsx';
import { TaskDrawer } from './TaskDrawer.tsx';
import { SimpleOverview } from './SimpleOverview.tsx';
import { UsagePausedBanner } from '../../components/UsageBanner.tsx';

type Tab = 'overview' | 'tasks' | 'activity' | 'diff' | 'delivery';
const TABS: Tab[] = ['overview', 'tasks', 'activity', 'diff', 'delivery'];

export function GoalPage() {
  const { id = '' } = useParams();
  const loc = useLocation();
  const nav = useNavigate();
  const version = useLive((s) => s.goalVersion[id] ?? 0);
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
  const tab = (TABS.find((t) => `#${t}` === loc.hash) ?? 'overview') as Tab;
  const setTab = (t: Tab) => nav({ hash: t }, { replace: true });

  useEffect(() => {
    const t = setTimeout(() => api.goal(id).then(setD).catch((e) => setErr(e.message)), 200);
    return () => clearTimeout(t);
  }, [id, version]);
  // /goals/:id?task=<taskId>#tasks (Inbox links) opens that task's view directly
  useEffect(() => {
    const t = new URLSearchParams(loc.search).get('task');
    if (t) setSel(t);
  }, [loc.search]);

  const dagTasks: DagTask[] = useMemo(
    () =>
      (d?.tasks ?? []).map((t) => {
        const attempts = d!.attempts.filter((a) => a.taskId === t.id);
        return { ...t, attempts: attempts.length, maxAttempts: t.retryBudget + t.extraAttempts, totalCost: attempts.length ? taskUsage(attempts).costUsd : null };
      }),
    [d],
  );

  if (err) return <Empty>{err}</Empty>;
  if (!d) return <Empty>Loading…</Empty>;
  const g = d.goal;
  const terminal = ['done', 'over_delivered', 'failed', 'cancelled'].includes(g.state);
  const open = d.escalations.filter((e) => e.state === 'open').length;
  const running = d.tasks.filter((t) => t.state === 'running').length;
  const selTask = d.tasks.find((t) => t.id === sel) ?? null;
  const finished = g.state === 'done' || g.state === 'over_delivered';
  const awaiting = g.state === 'awaiting_brief_approval';
  const repoName = g.repoPath.replace(/\/+$/, '').split('/').pop() || g.repoPath;
  const more: MoreItem[] = [
    ...(terminal || g.state === 'blocked' ? [{ label: 'Restart…', icon: <RotateCcw size={13} />, onClick: () => setRestart(true), title: 'Restart from a task of your choice (or from the beginning)' }] : []),
    ...(awaiting ? [{ label: 'Re-run Clarify', icon: <RotateCcw size={13} />, onClick: () => api.reclarify(id, 'fetch the latest base branch and explore again').catch((e) => setErr(e.message)), title: 'Fetch the base branch again and rebuild the Brief from the fresh tip' }] : []),
    ...(!terminal && awaiting ? [{ label: 'Cancel goal', icon: <Ban size={13} />, onClick: () => api.cancelGoal(id) }] : []),
    ...(!g.follows ? [{ label: 'Mark as follow-up of…', icon: <Link2 size={13} />, onClick: () => setMarkFollow(true), title: 'Record that this goal continues an earlier goal of the same repository' }] : []),
    { label: 'Delete goal…', icon: <Trash2 size={13} />, onClick: () => setDel(true), danger: true },
  ];

  return (
    <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6 space-y-4">
      <UsagePausedBanner />
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_21rem] md:gap-6 md:items-start">
        <div className="min-w-0">
          <div className="flex items-start gap-2 flex-wrap">
            <h1 className="text-lg font-semibold leading-snug line-clamp-2 min-w-0" title={g.title}>
              {g.title}
            </h1>
            <Badge state={g.state} className="mt-1" />
            {g.workflow.pace === 'fast' && <span className="text-[10px] rounded-full border border-amber-800 text-amber-300 px-1.5 mt-1.5">fast</span>}
          </div>
          <div className="text-xs text-zinc-500 flex items-center gap-1.5 mt-1.5 min-w-0 flex-wrap">
            <Folder size={12} className="shrink-0" />
            <span className="mono text-zinc-400 truncate max-w-[14rem]" title={g.repoPath}>
              {repoName}
            </span>
            <CopyButton text={g.repoPath} />
            <span className="text-zinc-600">·</span>
            <GitBranch size={12} className="shrink-0" />
            <span className="mono truncate" title={`${g.baseBranch} → ${g.branch}`}>
              {g.baseBranch} → {g.branch}
            </span>
          </div>
          <FollowLinks d={d} />
        </div>
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-3">
            <Meter label={`cost ${fmtUsd(g.costUsd)} / ${fmtLimitUsd(g.budgets.maxCostUsd)}`} value={g.costUsd} max={g.budgets.maxCostUsd} />
            <Meter label={`time ${d.budget.elapsedMin.toFixed(0)} / ${fmtLimitMin(g.budgets.maxDurationMin)}`} value={d.budget.elapsedMin} max={g.budgets.maxDurationMin} />
          </div>
          <div className="flex items-center gap-2 flex-wrap md:justify-end">
            <OpenMenu
              goalId={id}
              places={[
                { which: 'repo', label: 'Repository', path: d.paths.repo, hint: `your checkout · ${g.baseBranch}` },
                ...(d.paths.workspace ? [{ which: 'workspace' as const, label: 'Goal workspace', path: d.paths.workspace, hint: `branch ${g.branch}` }] : []),
              ]}
            />
            {awaiting ? (
              <Link to={`/goals/${id}/brief`}>
                <Button size="sm" variant="primary">Review brief →</Button>
              </Link>
            ) : finished ? (
              <Button size="sm" variant="primary" onClick={() => setTab('delivery')}>
                {g.delivery.status === 'delivered' ? 'Delivery' : g.delivery.status === 'running' ? 'Delivering…' : 'Deliver…'}
              </Button>
            ) : !terminal ? (
              <Button variant="danger" size="sm" onClick={() => api.cancelGoal(id)}>
                <Ban size={13} /> Cancel
              </Button>
            ) : null}
            {terminal && (
              <Link to={`/goals/new?follows=${id}`}>
                <Button size="sm" variant={finished ? 'default' : 'primary'} title="Start a new goal that builds on this one">
                  <CornerDownRight size={13} /> Continue with a follow-up…
                </Button>
              </Link>
            )}
            <MoreMenu items={more} />
          </div>
        </div>
      </div>
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
            Also delete the branch <span className="mono">{g.branch}</span> from the repository {g.delivery.status === 'delivered' ? <span className="text-zinc-500">(already delivered — the remote copy stays)</span> : <span className="text-amber-300">(the goal's work is lost locally unless you pushed it)</span>}
          </span>
        </label>
      </ConfirmDialog>

      {g.state === 'awaiting_feedback' && <MilestoneCard d={d} />}

      {g.state === 'clarifying' && g.interview && <InterviewPanel goal={g} />}
      {((g.state === 'clarifying' && !g.interview) || g.state === 'goal_review') && (
        <Card title={g.state === 'clarifying' ? 'Clarifying…' : 'Goal review…'}>
          <LiveLog attemptId={g.state === 'clarifying' ? `clarify-${id}` : `goal-review-${id}-${g.fixCycles}`} />
        </Card>
      )}

      {(expert ?? g.mode !== 'simple') === false ? (
        <SimpleOverview
          d={d}
          onExpert={() => setView(true)}
          onDeliver={() => {
            setView(true);
            setTab('delivery');
          }}
        />
      ) : (
        <>
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        right={
          !awaiting && (
            <Button size="sm" variant="ghost" onClick={() => setView(false)} title="Back to the plain progress view">
              Simple view
            </Button>
          )
        }
        tabs={[
          { id: 'overview', label: 'Overview', badge: open > 0 ? <span className="rounded-full bg-orange-500 text-zinc-950 text-[10px] px-1.5 font-bold">{open}</span> : null },
          { id: 'tasks', label: `Tasks`, badge: <span className="text-[10px] text-zinc-500">{d.tasks.filter((t) => t.state === 'done').length}/{d.tasks.length}{running ? ` · ${running} running` : ''}</span> },
          { id: 'activity', label: 'Activity' },
          { id: 'diff', label: 'Diff' },
          { id: 'delivery', label: 'Delivery' },
        ]}
      />

      {tab === 'overview' && <OverviewTab d={d} />}
      {tab === 'tasks' && (
        <div className="space-y-4">
          <Card title={`Tasks (${d.tasks.length})`}>
            <DagCanvas tasks={dagTasks} selected={sel} onSelect={setSel} />
          </Card>
          {selTask && (
            <FullScreen onClose={() => setSel(null)}>
              <TaskDrawer d={d} task={selTask} onClose={() => setSel(null)} onRestart={() => setRestart(selTask.id)} />
            </FullScreen>
          )}
        </div>
      )}
      {tab === 'activity' && <ActivityTab d={d} />}
      {tab === 'diff' && <DiffTab goalId={id} baseBranch={g.baseBranch} branch={g.branch} />}
      {tab === 'delivery' && <DeliveryTab d={d} />}
        </>
      )}
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
    <div className="fixed inset-0 z-50 bg-zinc-950/95 backdrop-blur-sm overflow-auto">
      <div className="max-w-6xl mx-auto p-3 sm:p-6 min-h-full">{children}</div>
    </div>
  );
}
