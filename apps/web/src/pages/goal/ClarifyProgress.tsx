import type { Goal } from '@foundry/core/browser';
import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiForProvider, awaitSkillOp } from '../../api.ts';
import { Button, cn } from '../../ui.tsx';
import { LiveLog } from '../LiveLog.tsx';

const fmt = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`);

/**
 * Where Clarify is, with how long the current step has run: the Clarifier reading the repository and writing its
 * answer, then the planner splitting the goal into tasks. A long answer is written in one go, so the log can stand still
 * for minutes; the timer says it is still working.
 */
export function ClarifyProgress({ goal, writingBrief }: { goal: Goal; writingBrief: boolean }) {
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
  const steps = [
    ...(goal.references.length ? [{ key: 'investigating', label: `REA: studying ${goal.references.length === 1 ? 'the reference' : 'the references'} and writing the report` }] : []),
    { key: 'clarifying', label: writingBrief ? 'Clarifier: reading the repository, then writing the Brief' : 'Clarifier: reading the repository, then asking or writing the Brief' },
    ...(writingBrief ? [{ key: 'planning', label: 'Planner: splitting the goal into tasks' }] : []),
  ];
  // no step recorded yet (the session is being prepared): the first one
  const current = Math.max(0, steps.findIndex((s) => s.key === stage?.stage));
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
          return (
            <li key={s.key} className={cn('flex items-center gap-2', active ? 'text-zinc-200' : done ? 'text-zinc-400' : 'text-zinc-600')}>
              {done ? <CheckCircle2 size={13} className="text-emerald-400" /> : active ? <Loader2 size={13} className="animate-spin text-sky-300" /> : <Circle size={13} />}
              <span>{s.label}</span>
              {active && since !== null && <span className="mono text-[11px] text-zinc-500">{fmt(since)}</span>}
            </li>
          );
        })}
      </ol>
      <p className="text-[11px] text-zinc-500">An answer is written in one go, so the log below can stand still for minutes while it is.</p>
    </div>
  );
}
