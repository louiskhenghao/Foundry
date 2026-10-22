import type { TaskState } from '@foundry/core/browser';
import { markFill, taskMark, type Mark } from '../../components/progress.tsx';
import { cn, fmtUsd, stateLabel } from '../../ui.tsx';
import { delegatedProgress, type DagTask } from './DagCanvas.tsx';

/** the three steps every task goes through, and how far it is along them */
export function flowOf(state: TaskState): [Mark, Mark, Mark] {
  switch (state) {
    case 'running':
      return ['run', 'next', 'next'];
    case 'observing':
      return ['done', 'run', 'next'];
    case 'merging':
      return ['done', 'done', 'run'];
    case 'done':
      return ['done', 'done', 'done'];
    case 'blocked':
      return ['you', 'next', 'next'];
    case 'failed':
      return ['bad', 'off', 'off'];
    case 'skipped':
      return ['off', 'off', 'off'];
    default:
      return ['next', 'next', 'next'];
  }
}

/** a step chip's leaning plate (behind the label, so a hatch never dims the word) and its label's colour */
const STEP: Record<Mark, { plate: string; text: string }> = {
  done: { plate: 'bg-ok/15 ring-1 ring-inset ring-ok/45', text: 'text-ok-ink' },
  run: { plate: 'hatch text-work/30 ring-[1.5px] ring-inset ring-work', text: 'text-work-ink' },
  you: { plate: 'bg-you', text: 'text-on-you' },
  bad: { plate: 'bg-bad/15 ring-1 ring-inset ring-bad', text: 'text-bad-ink' },
  next: { plate: 'ring-1 ring-inset ring-line-strong', text: 'text-ink-faint' },
  off: { plate: 'ring-1 ring-inset ring-line opacity-60', text: 'text-ink-faint/70' },
};

/**
 * The Tasks tab as a list, the other way to see what the graph shows: one row per task in the order they were planned,
 * its square (green done, a blue hatch under way, yellow waiting for you, red failed, hollow not started), what it is and what it
 * waits for, how far it is through work, review and merge, and its time and cost. A row opens the task, as a card in the
 * graph does.
 */
export function TaskList({ tasks, selected, onSelect }: { tasks: DagTask[]; selected: string | null; onSelect: (id: string | null) => void }) {
  if (!tasks.length) return <div className="text-sm text-ink-faint py-8 text-center">No tasks yet.</div>;
  const order = [...tasks].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const num = new Map(order.map((t, i) => [t.id, i + 1]));
  return (
    <ol className="-my-1.5" aria-label="Tasks">
      {order.map((t) => {
        const steps = flowOf(t.state);
        const labels = ['Work', t.attempts > 1 ? `Review ↺${t.attempts - 1}` : 'Review', t.state === 'done' ? 'Merged' : 'Merge'];
        const waiting = t.state === 'pending' || t.state === 'ready';
        const after = t.dependsOn.map((d) => `T${num.get(d) ?? '?'}`);
        const facts = [
          stateLabel(t.state),
          t.attempts > 0 && `attempt ${t.attempts} of ${t.maxAttempts}`,
          t.model,
          waiting && after.length > 0 && `after ${after.join(', ')}`,
          t.kind === 'goal' && (t.delegated?.exists ? `its own goal · ${delegatedProgress(t.delegated.taskCounts)}` : 'done by a goal of its own'),
          t.area,
          t.origin !== 'brief' && t.origin,
        ].filter(Boolean);
        return (
          <li key={t.id} className="border-t border-line first:border-t-0">
            <button
              type="button"
              onClick={() => onSelect(selected === t.id ? null : t.id)}
              aria-pressed={selected === t.id}
              className={cn('grid w-full grid-cols-[0.875rem_2rem_minmax(0,1fr)] md:grid-cols-[0.875rem_2rem_minmax(0,1fr)_auto_5.5rem] items-center gap-x-3 gap-y-2 rounded-md px-2 py-3.5 text-left transition-colors hover:bg-sunken focus-visible:outline-2 focus-visible:outline-accent', selected === t.id && 'bg-sunken')}
            >
              <i className={cn('block h-3.5 w-3.5 rounded-[3.5px]', markFill[taskMark(t.state)])} aria-hidden="true" />
              <span className="mono text-[13px] font-bold text-ink-faint">T{num.get(t.id)}</span>
              <span className="min-w-0 flex flex-col gap-0.5">
                <b className={cn('text-[15px] leading-snug', waiting ? 'font-semibold text-ink-soft' : 'font-bold text-ink')}>{t.title}</b>
                <span className="text-[13px] text-ink-faint first-letter:uppercase">{facts.join(' · ')}</span>
              </span>
              <span className="col-start-3 md:col-start-auto inline-flex gap-1.5 px-1" aria-label={`work ${steps[0]}, review ${steps[1]}, merge ${steps[2]}`}>
                {labels.map((l, i) => (
                  <span key={l} className={cn('relative isolate whitespace-nowrap px-2.5 py-0.5 text-[11.5px] font-bold', STEP[steps[i]!].text)}>
                    <i className={cn('absolute inset-0 -z-10 rounded-[3px] slant', STEP[steps[i]!].plate)} aria-hidden="true" />
                    {l}
                  </span>
                ))}
              </span>
              <span className="col-start-3 md:col-start-auto flex md:flex-col gap-3 md:gap-0 md:items-end mono text-[13px] text-ink-faint">
                {t.minutes != null && t.minutes > 0 ? <span>{t.minutes < 1 ? '<1' : Math.round(t.minutes)} min</span> : <span>—</span>}
                {t.totalCost != null && t.totalCost > 0 && <span className="font-semibold text-ink">{fmtUsd(t.totalCost)}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
