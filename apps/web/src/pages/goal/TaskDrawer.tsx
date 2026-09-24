import type { Attempt, CheckResult, Task } from '@foundry/core/browser';
import { GitMerge, RotateCcw, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { type ReactNode, useEffect, useState } from 'react';
import { api, type GoalDetail } from '../../api.ts';
import { MarkdownPanel } from '../../components/Markdown.tsx';
import { OpenMenu } from '../../components/OpenMenu.tsx';
import { TaskTags } from '../../components/TaskTags.tsx';
import { Badge, Button, Card, ago, cn, fmtUsd } from '../../ui.tsx';
import { LiveLog } from '../LiveLog.tsx';
import { EscalationCard } from '../InboxPage.tsx';

export function TaskDrawer({ d, task, onClose, onRestart }: { d: GoalDetail; task: Task; onClose: () => void; onRestart?: () => void }) {
  const attempts = d.attempts.filter((a) => a.taskId === task.id);
  const usage = d.tasks.find((t) => t.id === task.id)?.usage ?? null;
  const [ai, setAi] = useState(attempts.length - 1);
  const [view, setView] = useState<'log' | 'report' | 'prompt'>('log');
  const [prompt, setPrompt] = useState<string | null>(null);
  const a: Attempt | undefined = attempts[Math.min(Math.max(ai, 0), attempts.length - 1)];
  const results: CheckResult[] = a ? d.checkResults.filter((r) => r.attemptId === a.id) : [];
  const checks = d.checks.filter((c) => c.taskId === task.id);
  const obs = a ? (d.events.find((e) => e.type === 'observation.reported' && (e.payload as any).report.attemptId === a.id)?.payload as any)?.report : null;
  const openEsc = d.escalations.filter((e) => e.state === 'open' && e.taskId === task.id);
  const concluded = (id: string) => (d.events.find((e) => e.type === 'attempt.concluded' && (e.payload as any).attemptId === id)?.payload as { state?: string; reason?: string } | undefined) ?? null;
  const lastState = [...d.events].reverse().find((e) => e.type === 'task.state_changed' && (e.payload as any).taskId === task.id)?.payload as { to?: string; reason?: string } | undefined;

  useEffect(() => {
    setPrompt(null);
    if (view === 'prompt' && a) api.prompt(a.id).then(setPrompt).catch(() => setPrompt(''));
  }, [view, a?.id]);
  useEffect(() => setAi(attempts.length - 1), [attempts.length]);

  return (
    <Card
      title={
        <span className="flex items-center gap-2 flex-wrap">
          <span className="min-w-0 break-words">{task.title}</span> <Badge state={task.state} />
          <TaskTags kind={task.kind} scenario={task.scenario} area={task.area} difficulty={task.difficulty} />
          {task.origin !== 'brief' && <span className="text-[10px] text-zinc-500">{task.origin}</span>}
          {task.commitRef && (
            <span className="text-[11px] font-normal text-zinc-500 basis-full min-w-0 truncate" title={task.commitMessage ?? undefined}>
              <span className="mono text-zinc-400">{task.commitRef.slice(0, 7)}</span> {task.commitMessage?.split('\n')[0]}
            </span>
          )}
        </span>
      }
      actions={
        <>
          {task.state === 'blocked' && d.escalations.some((e) => e.state === 'open' && e.taskId === task.id && (e.payload as { kind?: string }).kind === 'merge') && (
            <Link to={`/goals/${d.goal.id}/resolve/${task.id}`}>
              <Button size="sm" variant="primary" title="The automatic merge attempts gave up: resolve the conflict yourself">
                <GitMerge size={13} /> Resolve manually
              </Button>
            </Link>
          )}
          {onRestart && !['running', 'observing', 'merging'].includes(task.state) && (
            <Button size="sm" onClick={onRestart} title="Reset this task and everything downstream of it, then run again">
              <RotateCcw size={13} /> Restart from here
            </Button>
          )}
          {task.worktreePath && task.state !== 'done' && <OpenMenu goalId={d.goal.id} places={[{ which: `task:${task.id}`, label: 'Task worktree', path: task.worktreePath, hint: task.branch ?? undefined }]} label="Open worktree" />}
          <Button size="sm" variant="ghost" onClick={onClose}>
            <X size={14} />
          </Button>
        </>
      }
    >
      {usage && usage.attempts > 0 && (
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400 rounded-md border border-zinc-800 bg-zinc-950/50 px-3 py-2" title="everything this task has cost so far — all attempts, all their sessions">
          <span className="text-zinc-500">Task total</span>
          <span><b className="text-zinc-200">{usage.attempts}</b> attempt{usage.attempts === 1 ? '' : 's'}</span>
          <span><b className="text-zinc-200">{fmtUsd(usage.costUsd)}</b> <span className="text-zinc-500">(worker {fmtUsd(usage.byRole.worker.costUsd)} · reviewer {fmtUsd(usage.byRole.reviewer.costUsd)}{usage.byRole.merger.sessions ? ` · merger ${fmtUsd(usage.byRole.merger.costUsd)}` : ''})</span></span>
          <span><b className="text-zinc-200">{usage.turns}</b> turns</span>
          <span><b className="text-zinc-200">{usage.wallMin.toFixed(0)}</b> min wall</span>
          {usage.models.length > 0 && <span className="mono">{usage.models.join(' · ')}</span>}
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 space-y-3">
          <MarkdownPanel title="spec" source={task.spec} maxHeight={260} />
          <div>
            <div className="text-xs text-zinc-500 mb-1">Checks</div>
            {checks.length === 0 && <div className="text-xs text-zinc-600">none (goal-level only)</div>}
            {checks.map((c) => {
              const r = results.find((x) => x.checkId === c.id);
              return (
                <div key={c.id} className="text-xs flex items-center gap-2 py-0.5">
                  <Badge state={c.tier} />
                  {r ? <Badge state={r.status} /> : <span className="text-zinc-600">—</span>}
                  <span className="truncate" title={c.spec.type === 'command' ? c.spec.cmd : c.name}>
                    {c.name}
                  </span>
                </div>
              );
            })}
          </div>
          {task.relevantFiles.length > 0 && (
            <div>
              <div className="text-xs text-zinc-500 mb-1">Relevant files</div>
              <div className="mono text-[11px] text-zinc-400 space-y-0.5">
                {task.relevantFiles.map((f) => (
                  <div key={f} className="truncate">
                    {f}
                  </div>
                ))}
              </div>
            </div>
          )}
          {task.hint && <MarkdownPanel title="human hint" source={task.hint} local />}
        </div>
        <div className="lg:col-span-2 min-w-0">
          {openEsc.length > 0 && (
            <div className="mb-3 space-y-2">
              <div className="text-xs text-orange-300 font-medium">This task is waiting for you</div>
              {openEsc.map((e) => (
                <EscalationCard key={e.id} e={e} embedded />
              ))}
            </div>
          )}
          {openEsc.length === 0 && task.state === 'blocked' && lastState?.reason && <div className="mb-3 text-xs text-orange-300">blocked: {lastState.reason}</div>}
          {!openEsc.length && task.state !== 'done' && lastState?.reason && task.state !== 'blocked' && <div className="mb-2 text-[11px] text-zinc-500">last transition: {lastState.to} — {lastState.reason}</div>}
          <div className="flex items-center gap-1 mb-2 flex-wrap">
            {attempts.map((x, i) => (
              <button key={x.id} onClick={() => setAi(i)} className={cn('text-xs rounded px-2 py-1 border flex items-center gap-1', i === Math.min(Math.max(ai, 0), attempts.length - 1) ? 'border-emerald-500 text-emerald-300' : 'border-zinc-700 text-zinc-400')}>
                #{x.index} {x.kind === 'merge' ? 'merge' : ''} <Badge state={x.state} />
                {x.continuations > 0 && <span className="text-[10px] text-emerald-300/80" title={`${x.continuations} continuation(s): the same session was resumed instead of a fresh attempt`}>↻{x.continuations}</span>}
                <span className="text-zinc-500 mono">{fmtUsd(x.costUsd)}</span>
              </button>
            ))}
            {attempts.length === 0 && <span className="text-xs text-zinc-500">no attempts yet</span>}
          </div>
          {a && (
            <>
              <AttemptStats a={a} d={d} concluded={concluded(a.id)} />
              <div className="flex gap-1 mb-2 text-xs">
                {(['log', 'report', 'prompt'] as const).map((v) => (
                  <button key={v} onClick={() => setView(v)} className={cn('rounded px-2 py-0.5 border', view === v ? 'border-emerald-500 text-emerald-300' : 'border-zinc-700 text-zinc-400')}>
                    {v === 'log' ? 'Live log' : v === 'report' ? 'Observation' : 'Prompt'}
                  </button>
                ))}
              </div>
              {view === 'log' && <LiveLog attemptId={a.id} />}
              {view === 'report' && (obs ? <MarkdownPanel title="observation report" source={obs.summary} maxHeight={420} /> : <div className="text-xs text-zinc-500">no observation yet</div>)}
              {view === 'prompt' && (prompt === null ? <div className="text-xs text-zinc-500">loading…</div> : <MarkdownPanel title="prompt sent to the worker" source={prompt || '_not recorded for this attempt_'} maxHeight={420} />)}
              {results
                .filter((r) => r.status !== 'pass')
                .map((r) => (
                  <details key={r.id} className="mt-2">
                    <summary className="text-xs text-rose-300 cursor-pointer">✗ {d.checks.find((c) => c.id === r.checkId)?.name}</summary>
                    <pre className="text-xs whitespace-pre-wrap text-zinc-300 bg-zinc-950 rounded p-2 mt-1 max-h-64 overflow-auto">{r.summary}</pre>
                  </details>
                ))}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

const fmtDur = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`);

/** Labelled facts about one attempt, then every session that ran for it (worker segments, reviewer, merger). */
function AttemptStats({ a, d, concluded }: { a: Attempt; d: GoalDetail; concluded: { state?: string; reason?: string } | null }) {
  const reviewerCost = a.sessions.filter((s) => s.role === 'reviewer').reduce((n, s) => n + s.costUsd, 0);
  const workerModels = [...new Set(a.sessions.filter((s) => s.role === 'worker').map((s) => s.model).filter(Boolean))] as string[];
  const fallbacks = d.events.filter((e) => e.type === 'goal.models_changed').map((e) => e.payload as { from: string; to: string });
  const running = !a.endedAt;
  const cell = (label: string, value: ReactNode, title?: string) => (
    <div className="min-w-0" title={title}>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-xs text-zinc-200 truncate">{value}</div>
    </div>
  );
  return (
    <div className="mb-3 space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 rounded-md border border-zinc-800 bg-zinc-950/50 p-2.5">
        {cell('Result', <span className="flex items-center gap-1.5"><Badge state={running ? 'running' : a.state} />{a.resultSubtype && !running ? <span className="mono text-zinc-500">{a.resultSubtype}</span> : null}</span>)}
        {cell('Worker model', <span className="mono">{(workerModels.length ? workerModels : [a.model ?? '?']).join(' → ')}</span>, fallbacks.length ? `model fallback(s) on this goal: ${fallbacks.map((f) => `${f.from} → ${f.to}`).join(', ')}` : undefined)}
        {cell('Turns', `${a.numTurns}${a.continuations > 0 ? ` over ${a.continuations + 1} segments` : ''}`)}
        {cell('Cost', <>{fmtUsd(a.costUsd)} <span className="text-zinc-500">worker</span>{reviewerCost > 0 ? <> + {fmtUsd(reviewerCost)} <span className="text-zinc-500">reviewer</span></> : null}</>)}
        {cell('Started', ago(a.startedAt))}
        {cell('Duration', a.endedAt ? fmtDur(Date.parse(a.endedAt) - Date.parse(a.startedAt)) : 'running…')}
        {cell('Session', a.sessionId ? <span className="mono">{a.sessionId.slice(0, 8)}</span> : '—', a.sessionId ?? undefined)}
        {cell('Skills', a.skillsUsed.length ? a.skillsUsed.join(', ') : '—', 'skills invoked with the Skill tool')}
      </div>
      {!running && concluded?.reason && <div className={cn('text-xs', concluded.state === 'passed' ? 'text-emerald-300/80' : 'text-orange-300/90')}>→ {concluded.reason}</div>}
      {a.sessions.length > 0 && (
        <div className="overflow-x-auto">
          <table className="text-[11px] w-full">
            <thead className="text-zinc-500">
              <tr className="text-left">
                <th className="pr-3 font-normal">session</th>
                <th className="pr-3 font-normal">model</th>
                <th className="pr-3 font-normal text-right">turns</th>
                <th className="pr-3 font-normal text-right">cost</th>
                <th className="pr-3 font-normal text-right">time</th>
                <th className="font-normal">ended</th>
              </tr>
            </thead>
            <tbody className="text-zinc-300">
              {a.sessions.map((s, i) => (
                <tr key={i} className="border-t border-zinc-800/70">
                  <td className="pr-3 py-0.5">
                    <span className={cn(s.role === 'worker' ? 'text-sky-300' : s.role === 'reviewer' ? 'text-violet-300' : 'text-fuchsia-300')}>{s.role}</span>
                    {s.role === 'worker' && s.segment > 0 && <span className="text-zinc-500"> · continuation {s.segment}</span>}
                  </td>
                  <td className="pr-3 mono">{s.model ?? '—'}</td>
                  <td className="pr-3 text-right">{s.numTurns}</td>
                  <td className="pr-3 text-right mono">{fmtUsd(s.costUsd)}</td>
                  <td className="pr-3 text-right">{fmtDur(s.durationMs)}</td>
                  <td className="mono text-zinc-500">{s.subtype === 'success' ? 'ok' : (s.subtype ?? '—')}{s.subtype === 'error_max_turns' || s.subtype === 'error_max_budget_usd' ? ' → continued' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
