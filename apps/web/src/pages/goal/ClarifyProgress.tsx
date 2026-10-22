import type { EngineEvent, Goal } from '@foundry/core/browser';
import { Download } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiForProvider, awaitSkillOp } from '../../api.ts';
import { markFill } from '../../components/progress.tsx';
import { Button, cn } from '../../ui.tsx';
import { LiveLog } from '../LiveLog.tsx';
import { stageDurations } from './clarify-timing.ts';

const fmt = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`);

/** the live log of the Clarify step under way: REA's investigation while it studies the references, else the Clarifier's and the planner's sessions */
export const clarifyChannel = (goal: Goal) => (goal.clarifyStage?.stage === 'investigating' ? `investigate-${goal.id}` : `clarify-${goal.id}`);

/** the Brief skeleton is out: the Brief page shows it, editable, while the planner works (a note: the information colour) */
export function SkeletonNotice({ goalId }: { goalId: string }) {
  return (
    <p className="mt-3 rounded-md bg-work/[0.07] px-3 py-2 text-[13px] leading-snug text-ink ring-1 ring-inset ring-work/30">
      The Brief is taking shape: its understanding, Areas and assumptions are ready to read and edit while the planner splits the goal into tasks.{' '}
      <Link to={`/goals/${goalId}/brief`} className="font-bold text-work-ink underline underline-offset-2">
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
    <div className="space-y-2">
      {/* Clarify waits for you to install the plugin: a plate with the yellow tint */}
      {goal.nature === 'cad' && cad && !cad.installed && (
        <div className="rounded-lg bg-you/10 px-3.5 py-3 text-[13px] text-ink ring-1 ring-inset ring-you/50 space-y-2">
          <p className="flex items-start gap-2.5">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-you text-on-you" aria-hidden="true">
              <Download size={13} strokeWidth={2.5} />
            </span>
            <span className="pt-0.5">
              text-to-cad is not installed for this coding agent; Clarify waits for it.{cad.uv ? '' : ' uv, which runs its CAD kernel, is missing too: install uv first (Setup page).'}
            </span>
          </p>
          <div className="flex items-center gap-3 sm:pl-[2.125rem]">
            <Button size="sm" variant="primary" disabled={!cad.uv || !!busy} onClick={() => void installCad()}>
              {busy ? 'Installing…' : error ? 'Retry install' : 'Install text-to-cad'}
            </Button>
            <Link to={`/setup?provider=${goal.provider ?? 'claude'}`} className="font-semibold underline underline-offset-2">Setup page</Link>
          </div>
          {busy && (
            <p className="text-xs text-ink-soft" role="status">
              Installing text-to-cad: the plugin, then its CAD runtime (a few hundred MB, once). Clarify starts by itself when it is in.
            </p>
          )}
          {busy && <LiveLog attemptId={busy} className="max-h-40" />}
          {error && <p className="text-xs text-bad-ink" role="alert">{error}</p>}
        </div>
      )}
      <ol className="space-y-1.5">
        {steps.map((s, i) => {
          const done = current > i;
          const active = current === i;
          const took = spent[s.key as keyof typeof spent];
          // a step's square: done solid, under way hatched; one waiting for a slot, or still to come, hollow
          const mark = done ? 'done' : active && !queued ? 'run' : 'next';
          return (
            <li key={s.key} className={cn('flex items-center gap-x-2.5 gap-y-1 flex-wrap text-[13px]', active ? 'font-semibold text-ink' : done ? 'text-ink-soft' : 'text-ink-faint')}>
              <i className={cn('block h-3 w-3 shrink-0 rounded-[3px]', markFill[mark])} aria-hidden="true" />
              <span>{s.label}</span>
              {done && !!took && <span className="mono text-xs font-normal text-ink-faint">{fmt(took)}</span>}
              {/* a wait for a session slot is not a wait for you: a quiet chip */}
              {active && queued && <span className="rounded-sm px-1.5 py-0.5 text-[11px] font-semibold text-ink-soft ring-1 ring-inset ring-line-strong">waiting for a free session slot (every slot is taken)</span>}
              {active && since !== null && <span className="mono text-xs font-normal text-ink-faint">{fmt(since)}</span>}
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-ink-faint">An answer is written in one go, so the log below can stand still for minutes while it is.</p>
    </div>
  );
}
