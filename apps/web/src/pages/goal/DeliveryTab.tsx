import type { DeliveryPlanStep } from '@foundry/core/browser';
import { CheckCircle2, CircleDashed, ExternalLink, Loader2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type GoalDetail, type RepoInfo } from '../../api.ts';
import { DeliveryPolicyForm, type PolicyDraft } from '../../components/DeliveryPolicyForm.tsx';
import { MergeStatus } from '../../components/MergeStatus.tsx';
import { Badge, Button, Card, cn } from '../../ui.tsx';

const STEP_LABEL: Record<string, string> = { preflight: 'Preflight', 'ensure-remote': 'Remote', 'sync-base': 'Sync with base', 'build-stack': 'Build stack', push: 'Push', 'open-pr': 'Open PR', 'wait-checks': 'CI checks', 'fix-ci': 'Fix CI', merge: 'Merge', cleanup: 'Cleanup' };
const STEPS = ['preflight', 'ensure-remote', 'sync-base', 'build-stack', 'push', 'open-pr', 'wait-checks', 'fix-ci', 'merge', 'cleanup'];
const PR_STATE: Record<string, string> = { pending: 'pending', open: 'open', merged: 'done', closed: 'cancelled', failed: 'failed' };

export function DeliveryTab({ d }: { d: GoalDetail }) {
  const g = d.goal;
  const del = g.delivery;
  const finished = g.state === 'done' || g.state === 'over_delivered';
  const [draft, setDraft] = useState<PolicyDraft>({ ...del.policy });
  const [repo, setRepo] = useState<RepoInfo | null>(null);
  const [plan, setPlan] = useState<DeliveryPlanStep[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.validateRepo(g.repoPath).then(setRepo).catch(() => {});
  }, [g.repoPath]);
  useEffect(() => {
    if (draft.mode === 'local') return setPlan(null);
    const q: Record<string, string> = { mode: draft.mode };
    if (draft.remote) q.remote = draft.remote;
    if (draft.remoteUrl) q.remoteUrl = draft.remoteUrl;
    if (draft.createRepo) Object.assign(q, { owner: draft.createRepo.owner, name: draft.createRepo.name, visibility: draft.createRepo.visibility });
    if (draft.mergeMethod) q.mergeMethod = draft.mergeMethod;
    if (draft.unit) q.unit = draft.unit;
    const t = setTimeout(() => api.deliveryPlan(g.id, q).then((p) => setPlan(p.steps)).catch((e) => setErr(e.message)), 300);
    return () => clearTimeout(t);
  }, [JSON.stringify(draft), g.id]);

  const steps = d.events.filter((e) => e.type === 'delivery.step').map((e) => e.payload as any);
  const latestByStep = new Map<string, any>();
  for (const s of steps) latestByStep.set(s.step, s);
  const commands = d.events.filter((e) => e.type === 'delivery.command').map((e) => e.payload as any);
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.deliver(g.id, draft);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {(del.status !== 'idle' || del.policy.mode !== 'local') && (
        <Card
          title={
            <span className="flex items-center gap-2">
              Delivery <Badge state={del.status === 'delivered' ? 'done' : del.status === 'failed' ? 'failed' : del.status === 'running' ? 'running' : 'pending'}>{del.status}</Badge>
              <span className="text-xs text-zinc-500 font-normal">
                {del.policy.mode}
                {del.policy.mode !== 'local' && del.policy.unit === 'task' ? ' · one PR per task' : ''}
              </span>
            </span>
          }
          actions={del.status === 'running' ? <Button size="sm" variant="danger" onClick={() => api.cancelDelivery(g.id)}>Cancel</Button> : null}
        >
          {del.status === 'idle' && del.policy.mode !== 'local' && <div className="text-sm text-zinc-400">Will deliver automatically when the goal is done ({finished ? 'starting…' : `currently ${g.state}`}).</div>}
          <ol className="mt-2 space-y-1.5">
            {STEPS.map((s) => {
              const st = latestByStep.get(s);
              if (!st && !(del.step === s)) return null;
              const Icon = st?.status === 'ok' ? CheckCircle2 : st?.status === 'skipped' ? CircleDashed : st?.status === 'failed' ? XCircle : Loader2;
              const color = st?.status === 'ok' ? 'text-emerald-400' : st?.status === 'skipped' ? 'text-zinc-500' : st?.status === 'failed' ? 'text-rose-400' : 'text-blue-400';
              return (
                <li key={s} className="flex items-start gap-2 text-sm">
                  <Icon size={15} className={cn('mt-0.5 shrink-0', color, st?.status === 'started' && 'animate-spin')} />
                  <span className="w-28 text-zinc-200">{STEP_LABEL[s]}</span>
                  <span className="text-xs text-zinc-400 break-words">{st?.detail || (st?.status === 'started' ? 'in progress…' : '')}</span>
                </li>
              );
            })}
          </ol>
          {del.prs.length > 0 && (
            <div className="mt-3 rounded-md border border-zinc-800 divide-y divide-zinc-800/60">
              {del.prs.map((p) => (
                <div key={p.branch} className="flex items-center gap-2 px-2.5 py-1.5 text-xs min-w-0">
                  <span className="mono text-zinc-600 w-5 shrink-0">{p.index}</span>
                  <span className="text-zinc-100 truncate min-w-0 flex-1" title={`${p.branch} → ${p.base}`}>
                    {p.title || p.branch}
                  </span>
                  {p.checks && <Badge state={p.checks === 'passing' ? 'pass' : p.checks === 'failing' ? 'fail' : 'pending'}>{p.checks}</Badge>}
                  <Badge state={PR_STATE[p.state] ?? p.state}>{p.state}</Badge>
                  {p.url ? (
                    <a className="underline text-sky-300 flex items-center gap-1 shrink-0" href={p.url} target="_blank" rel="noreferrer">
                      <ExternalLink size={12} /> #{p.number}
                    </a>
                  ) : (
                    <span className="mono text-zinc-600 shrink-0 hidden sm:inline">{p.branch.slice(-24)}</span>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-4 mt-3 text-xs">
            {del.pr && del.prs.length === 0 && (
              <a className="underline text-sky-300 flex items-center gap-1" href={del.pr.url} target="_blank" rel="noreferrer">
                <ExternalLink size={12} /> PR #{del.pr.number}
              </a>
            )}
            {del.checks && del.prs.length <= 1 && <span className="text-zinc-400">checks: <Badge state={del.checks === 'passing' ? 'pass' : del.checks === 'failing' ? 'fail' : 'pending'}>{del.checks}</Badge></span>}
            {del.outcome && <span className="text-emerald-300">outcome: {del.outcome.replace('_', ' ')}</span>}
            {del.mergedRef && <span className="mono text-zinc-500">merged {del.mergedRef.slice(0, 7)}</span>}
            {del.fixCycles > 0 && <span className="text-zinc-400">fix-CI cycles: {del.fixCycles}</span>}
          </div>
          <MergeStatus goal={g} className="mt-3" />
          {del.error && <div className="mt-2 text-xs text-rose-300 whitespace-pre-wrap">{del.error}</div>}
          {commands.length > 0 && (
            <details className="mt-3">
              <summary className="text-xs text-zinc-500 cursor-pointer">{commands.length} remote command(s) — full audit</summary>
              <div className="mono text-[11px] mt-1 space-y-1 max-h-72 overflow-auto">
                {commands.map((c, i) => (
                  <div key={i} className="border-l-2 border-zinc-800 pl-2">
                    <span className={c.exitCode === 0 ? 'text-emerald-400' : 'text-rose-400'}>{c.exitCode}</span> <span className="text-zinc-300">{c.command}</span> <span className="text-zinc-600">({c.durationMs}ms · {c.step})</span>
                    {c.outputTail && <pre className="text-zinc-500 whitespace-pre-wrap">{c.outputTail}</pre>}
                  </div>
                ))}
              </div>
            </details>
          )}
        </Card>
      )}

      <Card title={del.status === 'idle' && del.policy.mode === 'local' ? 'Deliver this goal' : 'Change delivery'}>
        <p className="text-xs text-zinc-400 mb-3">
          The work lives on local branch <span className="mono text-zinc-200">{g.branch}</span>. Pick what the engine may do with it. Below is the exact plan — nothing else will run.
        </p>
        <DeliveryPolicyForm value={draft} onChange={setDraft} repo={repo} taskCount={d.tasks.filter((t) => t.origin === 'brief' || t.origin === 'goal-review-fix').length} />
        {plan && (
          <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="text-[11px] uppercase text-zinc-500 mb-2">plan</div>
            <ol className="space-y-1 text-xs">
              {plan.map((s, i) => (
                <li key={i} className="flex gap-2">
                  <span className="w-24 text-zinc-300">{STEP_LABEL[s.step]}</span>
                  <span className="flex-1">
                    {s.command && <div className="mono text-zinc-200 break-all">{s.command}</div>}
                    <div className="text-zinc-500">{s.note}</div>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
        {err && <div className="text-xs text-rose-400 mt-2">{err}</div>}
        <div className="flex justify-end mt-3 gap-2">
          <Button variant="primary" disabled={busy || draft.mode === 'local' || del.status === 'running'} onClick={run}>
            {!finished ? 'Save policy (runs when done)' : draft.mode === 'local' ? 'Local only — nothing to run' : draft.mode === 'push' ? 'Push now' : draft.mode === 'pr' ? (draft.unit === 'task' ? 'Open PRs now' : 'Open PR now') : draft.unit === 'task' ? 'Open PRs and merge when green' : 'Open PR and merge when green'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
