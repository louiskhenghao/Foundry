import type { DeliveryPlanStep } from '@foundry/core/browser';
import { CheckCircle2, CircleDashed, ExternalLink, Loader2, XCircle } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api, type GoalDetail, type RepoInfo } from '../../api.ts';
import { DeliveryPolicyForm, type PolicyDraft, type PolicyLock } from '../../components/DeliveryPolicyForm.tsx';
import { MergeStatus } from '../../components/MergeStatus.tsx';
import { Badge, Button, Card, ConfirmDialog, cn } from '../../ui.tsx';

const STEP_LABEL: Record<string, string> = { preflight: 'Preflight', 'ensure-remote': 'Remote', 'sync-base': 'Sync with base', 'build-stack': 'Build stack', push: 'Push', 'open-pr': 'Open PR', 'wait-checks': 'CI checks', 'fix-ci': 'Fix CI', merge: 'Merge', cleanup: 'Cleanup' };
const STEPS = ['preflight', 'ensure-remote', 'sync-base', 'build-stack', 'push', 'open-pr', 'wait-checks', 'fix-ci', 'merge', 'cleanup'];
const PR_STATE: Record<string, string> = { pending: 'pending', open: 'open', merged: 'done', closed: 'cancelled', failed: 'failed' };
const SYNC_LABEL: Record<string, string | null> = { current: null, rebased: 'rebased onto base', merged: 'base merged in', resolved: 'conflict resolved' };

function Tag({ tone = 'zinc', title, children }: { tone?: 'zinc' | 'amber' | 'sky' | 'emerald' | 'rose'; title?: string; children: ReactNode }) {
  const tones = { zinc: 'border-zinc-700 text-zinc-400', amber: 'border-amber-800 text-amber-300', sky: 'border-sky-800 text-sky-300', emerald: 'border-emerald-800 text-emerald-300', rose: 'border-rose-800 text-rose-300' };
  return (
    <span title={title} className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-px text-[10px]', tones[tone])}>
      {children}
    </span>
  );
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function DeliveryTab({ d }: { d: GoalDetail }) {
  const g = d.goal;
  const del = g.delivery;
  const finished = g.state === 'done' || g.state === 'over_delivered';
  const [draft, setDraft] = useState<PolicyDraft>({ ...del.policy });
  // the saved policy the draft started from: a policy saved elsewhere (another tab, the engine) replaces an untouched draft
  const [origin, setOrigin] = useState<PolicyDraft>({ ...del.policy });
  const dirty = !same(draft, origin);
  useEffect(() => {
    if (same(del.policy, origin)) return;
    if (!dirty) setDraft({ ...del.policy });
    setOrigin({ ...del.policy });
  }, [JSON.stringify(del.policy)]);
  const [repo, setRepo] = useState<RepoInfo | null>(null);
  const [plan, setPlan] = useState<DeliveryPlanStep[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmStartOver, setConfirmStartOver] = useState(false);
  const running = del.status === 'running';
  const openPrs = del.prs.filter((p) => p.state === 'open');
  // a delivery that already did something is carried on (Resume) or begun again (Start over), not run from scratch
  const started = del.prs.length > 0 || (del.status !== 'idle' && del.outcome !== 'by_you');
  const locked: PolicyLock | null = running
    ? { reason: 'A delivery is running: only the switches below can change now, and they apply from its next step. Mode, target, merge method and granularity stay as the run started.', prModes: false }
    : openPrs.length
      ? { reason: `${openPrs.length} pull request${openPrs.length === 1 ? ' is' : 's are'} open: target, merge method and granularity stay as they were opened. Start over closes them to deliver differently.`, prModes: true }
      : null;
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
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const run = () => act(() => api.deliver(g.id, draft));
  const save = () =>
    act(async () => {
      await api.saveDeliveryPolicy(g.id, draft);
      setOrigin({ ...draft });
    });
  // Resume uses what is on screen: unsaved changes are saved first
  const resume = () =>
    act(async () => {
      if (dirty) {
        await api.saveDeliveryPolicy(g.id, draft);
        setOrigin({ ...draft });
      }
      await api.resumeDelivery(g.id);
    });
  const startOver = () => {
    setConfirmStartOver(false);
    return act(async () => {
      await api.startOverDelivery(g.id, draft);
      setOrigin({ ...draft });
    });
  };

  // a Follow-up that started from the earlier goal's branch carries that goal's unmerged changes along
  const ridesAlong = g.follows?.via === 'created' && (g.baseSync ? g.baseSync.startedFrom === 'previous' : g.follows.startFrom === 'previous');
  return (
    <div className="space-y-4">
      {ridesAlong && (
        <div className="rounded-lg border border-sky-900 bg-sky-950/30 px-3 py-2 text-xs text-sky-200">
          This goal follows <span className="font-medium">{g.follows!.title}</span> and started from its goal branch <span className="mono">{g.follows!.branch}</span>, whose work is not on <span className="mono">{g.baseBranch}</span>. Its changes go along in this goal's delivery{del.policy.mode === 'local' ? '' : ' and pull request'}.
        </div>
      )}
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
          actions={running ? <Button size="sm" variant="danger" onClick={() => api.cancelDelivery(g.id)}>Cancel</Button> : null}
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
              {del.prs.map((p, i) => {
                const below = i > 0 ? del.prs[i - 1] : null;
                const waitsFor = p.state === 'open' && below && below.state !== 'merged' && below.number != null ? below.number : null;
                const sync = p.sync ? SYNC_LABEL[p.sync] : null;
                return (
                <div key={p.branch} className="px-2.5 py-1.5 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="mono text-zinc-600 w-5 shrink-0">{p.index}</span>
                  <span className="text-zinc-100 truncate min-w-0 flex-1" title={`${p.branch} → ${p.base}`}>
                    {p.title || p.branch}
                  </span>
                  {p.ciSkipped ? (
                    <Badge state="skipped" className="normal-case">CI skipped</Badge>
                  ) : (
                    p.checks && <Badge state={p.checks === 'passing' ? 'pass' : p.checks === 'failing' ? 'fail' : p.checks === 'none' ? 'skipped' : 'pending'}>{p.checks === 'none' ? 'no CI' : `CI ${p.checks}`}</Badge>
                  )}
                  <Badge state={PR_STATE[p.state] ?? p.state}>{p.state}</Badge>
                  {p.url ? (
                    <a className="underline text-sky-300 flex items-center gap-1 shrink-0" href={p.url} target="_blank" rel="noreferrer">
                      <ExternalLink size={12} /> #{p.number}
                    </a>
                  ) : (
                    <span className="mono text-zinc-600 shrink-0 hidden sm:inline">{p.branch.slice(-24)}</span>
                  )}
                  {p.state === 'open' && p.number != null && (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => api.recheckPr(g.id, p.number!))} title="Read this pull request on GitHub again — merged, closed, or its checks. If it passes now, the delivery carries on.">
                      Re-check
                    </Button>
                  )}
                </div>
                {(p.activity || waitsFor != null || sync || p.branchDeleted) && (
                  <div className="mt-1 ml-7 flex flex-wrap items-center gap-1.5">
                    {p.activity && (
                      <Tag tone="sky">
                        <Loader2 size={10} className="animate-spin" /> {STEP_LABEL[p.activity] ?? p.activity}
                      </Tag>
                    )}
                    {waitsFor != null && !p.activity && <Tag title="Stacked pull requests merge bottom-up">waiting for #{waitsFor}</Tag>}
                    {sync && (
                      <Tag tone={p.sync === 'resolved' ? 'amber' : 'zinc'} title={p.sync === 'rebased' ? 'Its own commits were replayed onto the base after the PR below merged' : undefined}>
                        {sync}
                      </Tag>
                    )}
                    {p.branchDeleted && <Tag title={p.branch}>branch deleted</Tag>}
                  </div>
                )}
                {p.failing.length > 0 && p.state === 'open' && (
                  <ul className="mt-1 ml-7 space-y-0.5">
                    {p.failing.map((c) => (
                      <li key={c.name} className="text-rose-300 break-words">
                        <XCircle size={11} className="inline mr-1 -mt-0.5" />
                        <span className="text-zinc-200">{c.name}</span>
                        {c.description && <span className="text-zinc-400"> — {c.description}</span>}
                        {c.url && (
                          <a className="ml-1 underline text-sky-300" href={c.url} target="_blank" rel="noreferrer">
                            details
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                </div>
                );
              })}
            </div>
          )}
          <div className="flex flex-wrap gap-4 mt-3 text-xs">
            {del.pr && del.prs.length === 0 && (
              <a className="underline text-sky-300 flex items-center gap-1" href={del.pr.url} target="_blank" rel="noreferrer">
                <ExternalLink size={12} /> PR #{del.pr.number}
              </a>
            )}
            {del.checks && del.prs.length <= 1 && <span className="text-zinc-400">checks: <Badge state={del.checks === 'passing' ? 'pass' : del.checks === 'failing' ? 'fail' : 'pending'}>{del.checks}</Badge></span>}
            {del.outcome && <span className="text-emerald-300">outcome: {del.outcome === 'by_you' ? 'delivered by you' : del.outcome.replace('_', ' ')}</span>}
            {del.mergedRef && <span className="mono text-zinc-500">merged {del.mergedRef.slice(0, 7)}</span>}
            {del.fixCycles > 0 && <span className="text-zinc-400">fix-CI cycles: {del.fixCycles}</span>}
          </div>
          <MergeStatus goal={g} className="mt-3" />
          {del.error && <div className="mt-2 text-xs text-rose-300 whitespace-pre-wrap break-words">{del.error}</div>}
          {(del.status === 'failed' || (del.status === 'delivered' && (del.outcome === 'pr_open' || del.outcome === 'automerge_armed'))) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {del.status === 'failed' && (
                <Button size="sm" variant="primary" disabled={busy} onClick={resume} title="Carry on from where the delivery stopped: open pull requests are kept, merged ones skipped, missing ones added, and fixing CI gets a fresh budget">
                  Resume delivery
                </Button>
              )}
              <Button size="sm" disabled={busy} onClick={() => act(() => api.markDelivered(g.id))} title="You finished the delivery yourself. Foundry reads the pull requests first: merged → it finishes as merged (your main is updated and the workspace tidied); otherwise it is only marked delivered by you">
                Mark as delivered
              </Button>
              {err && <span className="text-xs text-rose-400 self-center">{err}</span>}
            </div>
          )}
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

      <Card title={del.status === 'idle' && del.policy.mode === 'local' ? 'Deliver this goal' : 'Delivery settings'}>
        <p className="text-xs text-zinc-400 mb-3">
          The work lives on local branch <span className="mono text-zinc-200">{g.branch}</span>. Pick what the engine may do with it. Below is the exact plan — nothing else will run.
        </p>
        <DeliveryPolicyForm value={draft} onChange={setDraft} repo={repo} locked={locked} prefill={!started} taskCount={d.tasks.filter((t) => t.origin === 'brief' || t.origin === 'goal-review-fix').length} />
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
        <div className="flex flex-wrap items-center justify-end mt-3 gap-2">
          {finished && started && !running && draft.mode !== 'local' && (
            <Button variant="ghost" className="sm:mr-auto" disabled={busy} onClick={() => setConfirmStartOver(true)} title="Close the open pull requests, delete the stacked branches and deliver again with these settings">
              Start over…
            </Button>
          )}
          {dirty && <span className="text-[11px] text-amber-300">unsaved changes</span>}
          {(started || !finished || running) && (
            <Button disabled={busy || !dirty} onClick={save} title={running ? 'Applies to the running delivery from its next step' : 'Store these settings without starting anything'}>
              {!finished ? 'Save (runs when the goal is done)' : 'Save'}
            </Button>
          )}
          {finished && started && !running && del.status !== 'failed' && draft.mode !== 'local' && (
            <Button variant="primary" disabled={busy} onClick={resume} title="Carry on from where the delivery stands: open pull requests are kept, merged ones skipped, missing ones (such as the docs commit) added">
              {dirty ? 'Save and resume delivery' : 'Resume delivery'}
            </Button>
          )}
          {finished && !started && (
            <Button variant="primary" disabled={busy || draft.mode === 'local' || running} onClick={run}>
              {draft.mode === 'local' ? 'Local only — nothing to run' : draft.mode === 'push' ? 'Push now' : draft.mode === 'pr' ? (draft.unit === 'task' ? 'Open PRs now' : 'Open PR now') : draft.unit === 'task' ? 'Open PRs and merge when green' : 'Open PR and merge when green'}
            </Button>
          )}
        </div>
      </Card>
      <ConfirmDialog open={confirmStartOver} title="Start the delivery over?" confirmLabel="Close PRs and start over" danger busy={busy} onConfirm={startOver} onClose={() => setConfirmStartOver(false)}>
        <div className="space-y-2 text-sm text-zinc-300">
          <p>
            {openPrs.length ? `The ${openPrs.length} open pull request${openPrs.length === 1 ? '' : 's'} (${openPrs.map((p) => `#${p.number}`).join(', ')}) will be closed with a comment, ` : ''}
            the goal's stacked branches deleted here and on the remote, and the goal delivered again with the settings on screen.
          </p>
          <p className="text-xs text-zinc-500">Pull requests that already merged stay merged; their work is not delivered twice. The goal branch is kept. Resume is usually what you want — it keeps the open pull requests.</p>
        </div>
      </ConfirmDialog>
    </div>
  );
}
