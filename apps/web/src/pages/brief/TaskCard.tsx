import type { Brief, BriefTask } from '@ai-engine/core/browser';
import { TASK_SCENARIOS } from '@ai-engine/core/browser';
import { ListChecks, Maximize2, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api, type DraftProposal } from '../../api.ts';
import { MarkdownPanel } from '../../components/Markdown.tsx';
import { TaskTags } from '../../components/TaskTags.tsx';
import { Button, Input, Menu, MenuItem, Modal, Select, Textarea, cn } from '../../ui.tsx';
import { LiveLog } from '../LiveLog.tsx';
import { CheckRow } from './CheckRow.tsx';
import { DraftPanel } from './DraftPanel.tsx';
import { TASK_KINDS, areaOf, areaStyle, newCheck, taskProblem } from './shared.ts';

/** One compact row per task; everything else (title, attributes, deps, spec, checks) is edited in a modal. */
export function TaskCard({ task, brief, goalId, editable, open, onOpen, onClose, edit }: { task: BriefTask; brief: Brief; goalId: string; editable: boolean; open: boolean; onOpen: () => void; onClose: () => void; edit: (fn: (b: Brief) => Brief) => void }) {
  const checks = brief.checks.filter((c) => c.taskKey === task.key);
  const area = areaOf(brief, task.areaKey);
  const style = areaStyle(brief, task.areaKey);
  const problem = taskProblem(task);

  const remove = () => {
    edit((b) => ({ ...b, tasks: b.tasks.filter((t) => t.key !== task.key).map((t) => ({ ...t, dependsOnKeys: t.dependsOnKeys.filter((k) => k !== task.key) })), checks: b.checks.filter((c) => c.taskKey !== task.key) }));
    if (open) onClose();
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen()}
        className={cn('rounded-md border bg-zinc-950/50 transition-colors cursor-pointer hover:border-zinc-500', problem && editable ? 'border-rose-500/40' : 'border-zinc-800')}
      >
        <div className="flex items-center gap-2 flex-wrap p-2.5">
          <span className="mono text-xs text-zinc-500 w-7">{task.key}</span>
          <span className="text-sm flex-1 min-w-0 truncate">{task.title || <span className="text-zinc-500">(untitled)</span>}</span>
          {problem && editable && <span className="text-xs text-rose-300 whitespace-nowrap">{problem}</span>}
          <TaskTags kind={task.kind} scenario={task.scenario} />
          {brief.areas.length > 0 && <span className={cn('text-[10px] rounded-full border px-2 py-0.5 whitespace-nowrap', style.chip)}>{area?.name ?? 'unassigned'}</span>}
          {checks.length > 0 && (
            <span className="text-[10px] text-zinc-500 flex items-center gap-1 whitespace-nowrap" title="acceptance checks on this task">
              <ListChecks size={11} /> {checks.length}
            </span>
          )}
          {editable && (
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                remove();
              }}
              title="Remove task (and its checks)"
            >
              <Trash2 size={13} />
            </Button>
          )}
          <Maximize2 size={12} className="text-zinc-600" />
        </div>
      </div>
      {open && <TaskModal task={task} brief={brief} goalId={goalId} editable={editable} onClose={onClose} onRemove={remove} edit={edit} />}
    </>
  );
}

function TaskModal({ task, brief, goalId, editable, onClose, onRemove, edit }: { task: BriefTask; brief: Brief; goalId: string; editable: boolean; onClose: () => void; onRemove: () => void; edit: (fn: (b: Brief) => Brief) => void }) {
  const [proposal, setProposal] = useState<DraftProposal | null>(null);
  const [notes, setNotes] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const checks = brief.checks.filter((c) => c.taskKey === task.key);
  const area = areaOf(brief, task.areaKey);
  const after = task.dependsOnKeys.map((k) => brief.tasks.find((t) => t.key === k)).filter(Boolean) as BriefTask[];
  const problem = taskProblem(task);
  const hasSpec = task.spec.trim().length > 0;

  const change = (patch: Partial<BriefTask>) => edit((b) => ({ ...b, tasks: b.tasks.map((t) => (t.key === task.key ? { ...t, ...patch } : t)) }));
  const draft = async (mode: 'task' | 'acceptance') => {
    setDrafting(true);
    setErr(null);
    try {
      const { proposal } = await api.draftBrief(goalId, { mode, brief, taskKey: task.key, notes });
      setProposal(proposal);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setDrafting(false);
    }
  };

  return (
    <Modal open wide title={`${task.key} · ${task.title || 'untitled task'}`} onClose={onClose}>
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          {editable ? <Input className="flex-1 min-w-48" placeholder="imperative title, e.g. add teacher dashboard" value={task.title} onChange={(e) => change({ title: e.target.value })} /> : <span className="text-sm flex-1">{task.title}</span>}
          {problem && editable && <span className="text-xs text-rose-300 whitespace-nowrap">{problem}</span>}
          {editable && (
            <Button size="sm" variant="ghost" onClick={onRemove} title="Remove task (and its checks)">
              <Trash2 size={13} />
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Menu
            width="w-72"
            align="left"
            trigger={({ toggle }) => (
              <button disabled={!editable || brief.tasks.length <= 1} onClick={toggle} className="rounded border border-zinc-700 px-2 py-0.5 text-zinc-300 hover:border-zinc-500 disabled:opacity-60 disabled:cursor-default text-left">
                {after.length ? (
                  <>
                    <span className="text-zinc-500">runs after</span> {after.map((t) => t.title || t.key).join(', ')}
                  </>
                ) : (
                  <span className="text-zinc-500">runs first (no dependencies)</span>
                )}
              </button>
            )}
          >
            <div className="px-1 py-1 text-[11px] text-zinc-500">This task starts only after the ticked tasks are done.</div>
            {brief.tasks
              .filter((t) => t.key !== task.key)
              .map((t) => {
                const on = task.dependsOnKeys.includes(t.key);
                return (
                  <MenuItem key={t.key} onClick={() => change({ dependsOnKeys: on ? task.dependsOnKeys.filter((k) => k !== t.key) : [...task.dependsOnKeys, t.key] })}>
                    <span className="flex items-center gap-2">
                      <input type="checkbox" readOnly checked={on} />
                      <span className="mono text-zinc-500">{t.key}</span>
                      <span className="truncate">{t.title || '(untitled)'}</span>
                    </span>
                  </MenuItem>
                );
              })}
          </Menu>
          <label className="text-zinc-400 flex items-center gap-1 whitespace-nowrap" title="May run at the same time as other ready tasks (in its own worktree)">
            <input type="checkbox" disabled={!editable} checked={task.parallelizable} onChange={(e) => change({ parallelizable: e.target.checked })} /> parallel
          </label>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
          <label className="block">
            <span className="text-zinc-500">Area</span>
            <Select disabled={!editable} className="text-xs py-1 mt-0.5" value={task.areaKey ?? ''} onChange={(e) => change({ areaKey: e.target.value || null })}>
              <option value="">unassigned</option>
              {brief.areas.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="text-zinc-500">Kind</span>
            <Select disabled={!editable} className="text-xs py-1 mt-0.5" value={task.kind} onChange={(e) => change({ kind: e.target.value as BriefTask['kind'] })} title="feature / bug (reproduce first) / refactor / research / chore — selects the worker's workflow skills">
              {TASK_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="text-zinc-500">Scenario</span>
            <Select disabled={!editable} className="text-xs py-1 mt-0.5" value={task.scenario} onChange={(e) => change({ scenario: e.target.value as BriefTask['scenario'] })} title="Where the work happens — UI tasks get the design skills">
              {TASK_SCENARIOS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="text-zinc-500">TDD</span>
            <Select disabled={!editable} className="text-xs py-1 mt-0.5" value={task.tdd} onChange={(e) => change({ tdd: e.target.value as BriefTask['tdd'] })} title="inherit the goal's discipline, or switch TDD off for this task (docs / infra tasks are off automatically)">
              <option value="inherit">inherit</option>
              <option value="off">off</option>
            </Select>
          </label>
          <label className="block">
            <span className="text-zinc-500">Commit scope</span>
            <Input disabled={!editable} className="mono text-xs py-1 mt-0.5" placeholder={area?.slug ?? 'optional'} value={task.scope ?? ''} onChange={(e) => change({ scope: e.target.value || null })} title="Conventional Commits scope: feat(<scope>): … — blank = the Area's slug" />
          </label>
        </div>

        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] uppercase tracking-wide text-zinc-400">Spec</span>
            {editable && (
              <span className="ml-auto flex items-center gap-1.5">
                <Input className="text-xs py-1 w-56" placeholder="notes for the AI (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
                <Button size="sm" disabled={drafting || !task.title.trim()} onClick={() => draft(hasSpec ? 'acceptance' : 'task')} title={hasSpec ? 'Propose acceptance checks for this task (your spec is kept)' : 'Draft the spec, attributes and acceptance checks from the title, the Brief and the repository'}>
                  <Sparkles size={12} /> {drafting ? 'Drafting…' : hasSpec ? 'Suggest acceptance' : 'Draft with AI'}
                </Button>
              </span>
            )}
          </div>
          {err && <div className="text-xs text-rose-300 mb-1">{err}</div>}
          {drafting && <LiveLog attemptId={`draft-${goalId}`} className="max-h-40 mb-2" />}
          {proposal && <div className="mb-2"><DraftPanel proposal={proposal} onApply={edit} onClose={() => setProposal(null)} /></div>}
          {editable ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <Textarea rows={8} className="mono text-xs" placeholder="what to change, where, and how to know it is done — or press Draft with AI" value={task.spec} onChange={(e) => change({ spec: e.target.value })} />
              <MarkdownPanel title="preview" source={task.spec} maxHeight={220} />
            </div>
          ) : (
            <MarkdownPanel title="spec" source={task.spec} maxHeight={300} />
          )}
        </div>

        <Input className="mono text-xs" disabled={!editable} placeholder="start files, comma-separated (repo-relative)" value={task.relevantFiles.join(', ')} onChange={(e) => change({ relevantFiles: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />

        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] uppercase tracking-wide text-zinc-400 whitespace-nowrap">Acceptance for this task</span>
            <span className="text-[11px] text-zinc-500">run after every attempt; the task is done when its must checks pass</span>
            {editable && (
              <Menu
                className="ml-auto"
                trigger={({ toggle }) => (
                  <Button size="sm" variant="ghost" onClick={toggle}>
                    <Plus size={12} /> Add check
                  </Button>
                )}
              >
                {(close) => (
                  <>
                    <MenuItem onClick={() => { edit((b) => ({ ...b, checks: [...b.checks, newCheck(b, 'command', task.key)] })); close(); }}>Command — a shell command must exit 0</MenuItem>
                    <MenuItem onClick={() => { edit((b) => ({ ...b, checks: [...b.checks, newCheck(b, 'reviewer', task.key)] })); close(); }}>Reviewer — Claude judges the diff against a rubric</MenuItem>
                  </>
                )}
              </Menu>
            )}
          </div>
          {checks.length === 0 && <div className="text-xs text-zinc-500">No task-level checks — only the goal-level ones will judge this task's work.</div>}
          <div className="space-y-1.5">
            {checks.map((c) => (
              <CheckRow key={c.key} check={c} brief={brief} editable={editable} context="task" onChange={(nc) => edit((b) => ({ ...b, checks: b.checks.map((x) => (x.key === c.key ? nc : x)) }))} onRemove={() => edit((b) => ({ ...b, checks: b.checks.filter((x) => x.key !== c.key) }))} />
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
