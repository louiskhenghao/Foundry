import type { Escalation, EscalationAction } from '@ai-engine/core/browser';
import { ACTIONS_BY_TRIGGER } from '@ai-engine/core/browser';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.ts';
import { MarkdownPanel } from '../components/Markdown.tsx';
import { useLive } from '../store.ts';
import { Badge, Button, Empty, Input, ago } from '../ui.tsx';

const TRIGGER_LABEL: Record<string, string> = {
  brief_question: 'Brief question',
  retries_exhausted: 'Retries exhausted',
  boundary_action: 'Wants to leave the workspace',
  budget_exceeded: 'Budget exceeded',
  permission_denial: 'Tool denied',
};
const ACTION_LABEL: Record<EscalationAction, string> = {
  retry_with_hint: 'Retry with hint',
  skip_task: 'Skip task (dependents continue)',
  abort_goal: 'Abort goal',
  approve: 'Approve & run once',
  deny: 'Deny',
  raise_budget: 'Raise budget',
};

export function InboxPage() {
  const version = useLive((s) => s.globalVersion);
  const [list, setList] = useState<Escalation[] | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => api.escalations(!all).then(setList).catch(() => {}), 150);
    return () => clearTimeout(t);
  }, [version, all]);
  return (
    <div className="max-w-4xl mx-auto p-3 sm:p-4 md:p-6 space-y-3">
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

export function EscalationCard({ e }: { e: Escalation }) {
  const [hint, setHint] = useState('');
  const [attempts, setAttempts] = useState(1);
  const [cost, setCost] = useState('');
  const [minutes, setMinutes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const actions = ACTIONS_BY_TRIGGER[e.trigger];
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
    <div className="rounded-lg border border-orange-500/40 bg-orange-500/5 p-4">
      <div className="flex items-center gap-2 mb-2">
        <Badge state={e.state} />
        <span className="text-sm font-medium">{TRIGGER_LABEL[e.trigger] ?? e.trigger}</span>
        <span className="text-xs text-zinc-500">{ago(e.createdAt)}</span>
        <Link to={`/goals/${e.goalId}`} className="ml-auto text-xs underline text-zinc-400">
          open goal
        </Link>
      </div>
      <MarkdownPanel title="details" source={e.message} maxHeight={260} />
      {e.state === 'open' ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
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
          {actions.map((a) => (
            <Button key={a} size="sm" disabled={busy} variant={a === 'abort_goal' || a === 'deny' ? 'danger' : a === 'retry_with_hint' || a === 'approve' || a === 'raise_budget' ? 'primary' : 'default'} onClick={() => answer(a)}>
              {ACTION_LABEL[a]}
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
