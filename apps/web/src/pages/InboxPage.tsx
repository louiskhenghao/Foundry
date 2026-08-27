import type { EscalationAction } from '@ai-engine/core/browser';
import { ACTIONS_BY_TRIGGER } from '@ai-engine/core/browser';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { api, type EscalationRow } from '../api.ts';
import { MarkdownPanel } from '../components/Markdown.tsx';
import { useLive } from '../store.ts';
import { UsagePausedBanner } from '../components/UsageBanner.tsx';
import { Badge, Button, Empty, Input, ago } from '../ui.tsx';

const TRIGGER_LABEL: Record<string, string> = {
  brief_question: 'Brief question',
  retries_exhausted: 'Retries exhausted',
  boundary_action: 'Wants to leave the workspace',
  budget_exceeded: 'Budget exceeded',
  permission_denial: 'Tool denied',
};
/** one plain sentence per trigger, for people who do not want to read the details */
const PLAIN: Record<string, string> = {
  brief_question: 'The plan has a question only you can answer.',
  retries_exhausted: 'It tried several times and could not finish this part on its own.',
  boundary_action: 'It wants to do something outside the workspace (push, deploy…) and needs your OK.',
  budget_exceeded: 'It reached the money or time limit you set.',
  permission_denial: 'Claude refused one of the tools it needed.',
};
const ACTION_LABEL: Record<EscalationAction, string> = {
  retry_with_hint: 'Retry with hint',
  skip_task: 'Skip task (dependents continue)',
  abort_goal: 'Abort goal',
  approve: 'Approve & run once',
  deny: 'Deny',
  raise_budget: 'Raise budget',
  resolve_manually: 'Resolve manually',
};

export function InboxPage() {
  const version = useLive((s) => s.globalVersion);
  const [list, setList] = useState<EscalationRow[] | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => api.escalations(!all).then(setList).catch(() => {}), 150);
    return () => clearTimeout(t);
  }, [version, all]);
  return (
    <div className="max-w-4xl mx-auto p-3 sm:p-4 md:p-6 space-y-3">
      <UsagePausedBanner />
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Inbox</h1>
        <label className="text-xs text-zinc-400 flex items-center gap-1">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> show answered
        </label>
      </div>
      {!list ? <Empty>Loading…</Empty> : list.length === 0 ? <Empty>Nothing needs you. The engine only asks for: blocking brief questions, exhausted retries, leaving the workspace, exceeded budgets, or denied tools.</Empty> : list.map((e) => <EscalationCard key={e.id} e={e} />)}
    </div>
  );
}

/** `embedded` = shown inside the task view: no goal/task links, tighter frame. */
export function EscalationCard({ e, embedded }: { e: EscalationRow; embedded?: boolean }) {
  const [hint, setHint] = useState('');
  const [attempts, setAttempts] = useState(1);
  const [cost, setCost] = useState('');
  const [minutes, setMinutes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState<null | 'suggest' | 'apply'>(null);
  const [suggestion, setSuggestion] = useState(e.suggestion ?? null);
  const actions = ACTIONS_BY_TRIGGER[e.trigger];
  const canSuggest = e.taskId && (e.trigger === 'retries_exhausted' || e.trigger === 'permission_denial');
  const suggest = async (apply: boolean) => {
    setSuggesting(apply ? 'apply' : 'suggest');
    setErr(null);
    try {
      const r = await api.suggest(e.id, apply);
      setSuggestion(r.suggestion);
      if (r.suggestion.action === 'retry_with_hint') setHint(r.suggestion.hint);
    } catch (x: any) {
      setErr(x.message);
    } finally {
      setSuggesting(null);
    }
  };
  const answer = async (action: EscalationAction) => {
    setBusy(true);
    setErr(null);
    try {
      await api.answer(e.id, {
        action,
        hint: hint || undefined,
        extraAttempts: action === 'retry_with_hint' ? attempts : undefined,
        newMaxCostUsd: action === 'raise_budget' && cost ? Number(cost) : undefined,
        newMaxDurationMin: action === 'raise_budget' && minutes ? Number(minutes) : undefined,
      });
    } catch (x: any) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={embedded ? 'rounded-lg border border-orange-500/40 bg-orange-500/5 p-3' : 'rounded-lg border border-orange-500/40 bg-orange-500/5 p-4'}>
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <Badge state={e.state} />
        <span className="text-sm font-medium">{TRIGGER_LABEL[e.trigger] ?? e.trigger}</span>
        {(e.payload as { kind?: string }).kind === 'merge' && <span className="text-[10px] uppercase rounded border border-orange-500/50 text-orange-300 px-1">merge conflict</span>}
        <span className="text-xs text-zinc-500">{ago(e.createdAt)}</span>
        {!embedded && (
          <span className="ml-auto flex items-center gap-3 text-xs">
            {e.taskId && (
              <Link to={`/goals/${e.goalId}?task=${e.taskId}#tasks`} className="underline text-zinc-300">
                open task →
              </Link>
            )}
            <Link to={`/goals/${e.goalId}`} className="underline text-zinc-400">
              open goal
            </Link>
          </span>
        )}
      </div>
      <div className="text-xs text-zinc-300 mb-1">{(e.payload as { kind?: string }).kind === 'merge' ? 'Two pieces of work changed the same files and the automatic merge could not combine them.' : (e.payload as { kind?: string }).kind === 'engine' ? 'The engine itself hit an error (not the model).' : PLAIN[e.trigger] ?? ''}</div>
      {!embedded && (
        <div className="text-xs text-zinc-400 mb-2 min-w-0 truncate">
          <span className="text-zinc-500">goal</span> {e.goalTitle ?? e.goalId}
          {e.taskId && (
            <>
              <span className="text-zinc-600"> › </span>
              <span className="text-zinc-500">task</span> <span className="text-zinc-200">{e.taskTitle ?? e.taskId}</span>
            </>
          )}
        </div>
      )}
      <MarkdownPanel title="details" source={e.message} maxHeight={260} />
      {suggestion && (
        <div className="mt-2 rounded-md border border-sky-500/30 bg-sky-500/5 p-2.5 text-xs space-y-1">
          <div className="flex items-center gap-2">
            <Sparkles size={12} className="text-sky-300" />
            <span className="text-sky-200 font-medium">AI diagnosis</span>
            <span className="text-zinc-500">{suggestion.confidence} confidence · ${suggestion.costUsd.toFixed(2)}</span>
            <span className="ml-auto text-zinc-400">
              suggests: <b className="text-zinc-200">{ACTION_LABEL[suggestion.action as EscalationAction] ?? suggestion.action}</b>
            </span>
          </div>
          <div className="text-zinc-300 whitespace-pre-wrap">{suggestion.diagnosis}</div>
          {suggestion.action === 'retry_with_hint' && suggestion.hint && <div className="text-zinc-400">Hint filled in below — press <b>Retry with hint</b> to use it.</div>}
          {suggestion.action === 'resolve_manually' && <div className="text-zinc-400">Open <b>Resolve manually</b> and settle the conflict yourself.</div>}
          {suggestion.action === 'skip_task' && <div className="text-zinc-400">The AI thinks this part is not worth pursuing here — your call: <b>Skip task</b>.</div>}
        </div>
      )}
      {e.state === 'open' ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {canSuggest && (
            <>
              <Button size="sm" disabled={busy || !!suggesting} onClick={() => suggest(false)} title="The AI reads the task, the failing checks and the last session, explains the cause and writes a hint for you (≤ $1)">
                <Sparkles size={12} /> {suggesting === 'suggest' ? 'Analysing…' : 'Suggest a hint'}
              </Button>
              <Button size="sm" variant="primary" disabled={busy || !!suggesting} onClick={() => suggest(true)} title="Same analysis; when the answer is 'retry with this hint' it is applied immediately (one extra attempt). Skipping, budget and manual merges are never applied for you.">
                <Sparkles size={12} /> {suggesting === 'apply' ? 'Analysing…' : 'Let AI handle it'}
              </Button>
            </>
          )}
          {actions.includes('retry_with_hint') && (
            <>
              <Input className="flex-1 min-w-[240px]" placeholder="hint for the next attempt (optional)" value={hint} onChange={(x) => setHint(x.target.value)} />
              <Input type="number" className="w-20" value={attempts} onChange={(x) => setAttempts(Number(x.target.value))} title="extra attempts" />
            </>
          )}
          {actions.includes('raise_budget') && (
            <>
              <Input type="number" min={0.5} step={0.5} className="w-32" placeholder="new max $ (blank = ×2)" value={cost} onChange={(x) => setCost(x.target.value)} />
              <Input type="number" min={5} step={5} className="w-36" placeholder="new max min (blank = ×2)" value={minutes} onChange={(x) => setMinutes(x.target.value)} />
            </>
          )}
          {e.taskId && (e.payload as { kind?: string }).kind === 'merge' && (
            <Link to={`/goals/${e.goalId}/resolve/${e.taskId}`}>
              <Button size="sm" variant="primary" title="See the conflicted files with both sides and resolve them yourself (in the browser or your editor)">
                Resolve manually →
              </Button>
            </Link>
          )}
          {actions.filter((a) => a !== 'resolve_manually').map((a) => (
            <Button key={a} size="sm" disabled={busy} variant={a === 'abort_goal' || a === 'deny' ? 'danger' : a === 'retry_with_hint' || a === 'approve' || a === 'raise_budget' ? 'primary' : 'default'} onClick={() => answer(a)} title={a === 'skip_task' && !e.taskId ? 'Finish the goal with what is there; the failing checks are waived (no more review runs)' : undefined}>
              {a === 'skip_task' && !e.taskId ? 'Accept as-is (finish goal)' : ACTION_LABEL[a]}
            </Button>
          ))}
          {err && <span className="text-xs text-rose-400">{err}</span>}
        </div>
      ) : (
        <div className="mt-2 text-xs text-zinc-400">
          answered: {e.answer?.action}
          {e.answer?.hint ? ` — "${e.answer.hint}"` : ''}
        </div>
      )}
    </div>
  );
}
