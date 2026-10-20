import type { EngineEvent, Goal } from '@foundry/core/browser';
import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiForProvider, awaitSkillOp } from '../../api.ts';
import { Button, cn } from '../../ui.tsx';
import { LiveLog } from '../LiveLog.tsx';
import { stageDurations } from './clarify-timing.ts';

const fmt = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`);

/** the live log of the Clarify step under way: REA's investigation while it studies the references, else the Clarifier's and the planner's sessions */
export const clarifyChannel = (goal: Goal) => (goal.clarifyStage?.stage === 'investigating' ? `investigate-${goal.id}` : `clarify-${goal.id}`);

/** the Brief skeleton is out: the Brief page shows it, editable, while the planner works */
export function SkeletonNotice({ goalId }: { goalId: string }) {
  return (
    <p className="mt-2 text-xs text-sky-300">
      The Brief is taking shape: its understanding, Areas and assumptions are ready to read and edit while the planner splits the goal into tasks.{' '}
      <Link to={`/goals/${goalId}/brief`} className="underline">
        Open the Brief
      </Link>
    </p>
  );
}

/**
 * Where Clarify is, with how long the current step has run: the Clarifier reading the repository and writing its
 * answer, then the planner splitting the goal into tasks; a wait for a free session slot shows on the step it holds up.
 * Finished steps show how long they took. A long answer is written in one go, so the log can stand still for minutes;
 * the timer says it is still working.
 */
export function ClarifyProgress({ goal, writingBrief, skeleton = false, events = [] }: { goal: Goal; writingBrief: boolean; /** the Brief skeleton is out: the Clarifier's step is done, the planner's under way */ skeleton?: boolean; /** the goal's events, for how long each finished step took */ events?: Pick<EngineEvent, 'type' | 'ts' | 'payload'>[] }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  // a cad goal waits for text-to-cad: the engine says so in a note, and the install is one click here
  const [cad, setCad] = useState<{ installed: boolean; uv: boolean } | null>(null);
  /** the install operation's channel while it runs */
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    // asked while the goal waits (the engine lets it go on when the plugin turned up); once installed there is nothing to ask
    if (goal.nature !== 'cad' || cad?.installed) return;
    void api.cad(goal.provider).then(setCad).catch(() => setCad(null));
  }, [goal.nature, goal.provider, goal.updatedAt, cad?.installed]);
  const installCad = async () => {
    setError(null);
    const scoped = apiForProvider(goal.provider);
    try {
      const { op } = await scoped.installBundle('text-to-cad', `cad-${Date.now().toString(36)}`);
      setBusy(op.channel);
      const done = await awaitSkillOp(scoped, op);
      if (done.status === 'failed') setError(`Install failed: ${done.summary ?? 'see the Setup page'}`);
      setCad(await api.cad(goal.provider).catch(() => cad));
    } catch (e: any) {
      setError(`Install failed: ${e.body?.error ?? e.message}`);
    } finally {
      setBusy(null);
    }
  };
  const stage = goal.clarifyStage;
  const since = stage ? Math.max(0, Math.round((now - Date.parse(stage.at)) / 1000)) : null;
  const spent = useMemo(() => stageDurations(events, now), [events, now]);
  const queued = stage?.stage === 'queued';
  const steps = [
    ...(goal.references.length ? [{ key: 'investigating', label: `REA: studying ${goal.references.length === 1 ? 'the reference' : 'the references'} and writing the report` }] : []),
    { key: 'clarifying', label: writingBrief || skeleton ? 'Clarifier: reading the repository, then writing the Brief' : 'Clarifier: reading the repository, then asking or writing the Brief' },
    ...(writingBrief || skeleton ? [{ key: 'planning', label: 'Planner: splitting the goal into tasks' }] : []),
  ];
  // the step under way: a wait for a slot belongs to the step it holds up (the planner once the skeleton is out); none recorded yet = the first
  const activeKey = queued ? (skeleton ? 'planning' : 'clarifying') : (stage?.stage ?? (skeleton ? 'planning' : steps[0]!.key));
  const current = Math.max(0, steps.findIndex((s) => s.key === activeKey));
  return (
    <div className="space-y-1.5">
      {goal.nature === 'cad' && cad && !cad.installed && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 space-y-1.5">
          <p>
            text-to-cad is not installed for this coding agent; Clarify waits for it.{cad.uv ? '' : ' uv, which runs its CAD kernel, is missing too: install uv first (Setup page).'}
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="primary" disabled={!cad.uv || !!busy} onClick={() => void installCad()}>
              {busy ? 'Installing…' : error ? 'Retry install' : 'Install text-to-cad'}
            </Button>
            <Link to={`/setup?provider=${goal.provider ?? 'claude'}`} className="underline">Setup page</Link>
          </div>
          {busy && (
            <p className="text-[11px] text-amber-200/80" role="status">
              Installing text-to-cad: the plugin, then its CAD runtime (a few hundred MB, once). Clarify starts by itself when it is in.
            </p>
          )}
          {busy && <LiveLog attemptId={busy} className="max-h-40" />}
          {error && <p className="text-[11px] text-rose-300" role="alert">{error}</p>}
        </div>
      )}
      <ol className="space-y-1">
        {steps.map((s, i) => {
          const done = current > i;
          const active = current === i;
          const took = spent[s.key as keyof typeof spent];
          return (
            <li key={s.key} className={cn('flex items-center gap-2 flex-wrap', active ? 'text-zinc-200' : done ? 'text-zinc-400' : 'text-zinc-600')}>
              {done ? <CheckCircle2 size={13} className="text-emerald-400" /> : active ? <Loader2 size={13} className={cn('animate-spin', queued ? 'text-amber-300' : 'text-sky-300')} /> : <Circle size={13} />}
              <span>{s.label}</span>
              {done && !!took && <span className="mono text-[11px] text-zinc-500">{fmt(took)}</span>}
              {active && queued && <span className="text-[11px] text-amber-300">waiting for a free session slot (every slot is taken)</span>}
              {active && since !== null && <span className="mono text-[11px] text-zinc-500">{fmt(since)}</span>}
            </li>
          );
        })}
      </ol>
      <p className="text-[11px] text-zinc-500">An answer is written in one go, so the log below can stand still for minutes while it is.</p>
    </div>
  );
}
