/**
 * Bring your goals over (ADR-0107): an earlier Foundry found on this computer (a checkout, a Docker container) moved
 * here with one click. On the Goals page while this install has no goals of its own; in Settings → Engine (install)
 * always. The move's steps stream in while it runs, and the page follows Foundry to where it starts again.
 */
import { ArrowRightLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type EarlierInstall, type MoveStatus } from '../api.ts';
import { LiveLog } from '../pages/LiveLog.tsx';
import { Button, ago, cn } from '../ui.tsx';

const named = (i: { kind: 'source' | 'docker'; where: string }) => (i.kind === 'docker' ? `the Docker container ${i.where}` : i.where);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

function Facts({ i }: { i: EarlierInstall }) {
  return (
    <span className="text-ink-soft">
      {plural(i.goals, 'goal')}
      {i.last ? `, last active ${ago(i.last)}` : ''}
      {i.version ? ` · Foundry ${i.version}` : ''}
      {i.running ? ' · running now' : ''}
    </span>
  );
}

export function MoveCard({ variant }: { variant: 'offer' | 'settings' }) {
  const [status, setStatus] = useState<MoveStatus | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [replace, setReplace] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = (fresh = false) =>
    api
      .moveStatus(fresh)
      .then(setStatus)
      .catch(() => {});
  useEffect(() => {
    void load(variant === 'settings');
  }, []);

  const job = status?.job ?? null;
  // a server that stops answering mid-move has started again on the moved data: follow it
  const [lost, setLost] = useState(false);
  // a move under way: its steps every second
  useEffect(() => {
    if (!job || job.state !== 'running') return;
    let misses = 0;
    const t = setInterval(() => {
      api
        .moveStatus()
        .then((s) => ((misses = 0), setStatus(s)))
        .catch(() => {
          if (++misses >= 2) setLost(true);
        });
    }, 1000);
    return () => clearInterval(t);
  }, [job?.state]);
  // the move is in place: Foundry starts again, perhaps on the old one's port, and the page goes there
  useEffect(() => {
    if (!job || !(job.state === 'restarting' || lost) || !job.nextUrl) return;
    let alive = true;
    const next = job.nextUrl;
    const same = new URL(next).origin === window.location.origin;
    const tick = async () => {
      if (!alive) return;
      // this origin first: the moved goals here, or a move that did not take (back on this address, the old one running)
      try {
        const s = await api.moveStatus();
        if (s.last && s.last.finishedAt > job.startedAt) return void (window.location.href = '/');
        if (s.failed && s.failed.at >= job.startedAt) {
          setLost(false);
          return void setStatus(s);
        }
      } catch {}
      if (!same) {
        try {
          // another port is another origin: a no-cors request only says that something answers there
          await fetch(`${next}/api/health`, { mode: 'no-cors', cache: 'no-store' });
          return void (window.location.href = `${next}/`);
        } catch {}
      }
      setTimeout(() => void tick(), 1000);
    };
    const t = setTimeout(() => void tick(), 1500);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [job?.state, job?.nextUrl, lost]);

  if (!status) return null;
  const start = async (id: string) => {
    setBusy(true);
    setErr(null);
    try {
      await api.moveStart(id, { replace: status.here.goals > 0 });
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return <MoveView variant={variant} status={status} chosen={chosen} onChoose={setChosen} replace={replace} onReplace={setReplace} busy={busy} err={err} onMove={(id) => void start(id)} onMoveNow={() => void api.moveNow()} />;
}

export interface MoveViewProps {
  variant: 'offer' | 'settings';
  status: MoveStatus;
  chosen: string | null;
  onChoose: (id: string) => void;
  replace: boolean;
  onReplace: (v: boolean) => void;
  busy: boolean;
  err: string | null;
  onMove: (id: string) => void;
  onMoveNow: () => void;
}

/** what the card shows for a status: the offer, the move under way, or that there is nothing to move */
export function MoveView({ variant, status, chosen, onChoose, replace, onReplace, busy, err, onMove, onMoveNow }: MoveViewProps) {
  const job = status.job;
  if (status.kind === 'checkout') return null;
  if (variant === 'offer' && !status.offer && !job) return null;
  const candidates = status.installs.filter((i) => i.goals > 0);
  const pick = candidates.find((i) => i.id === chosen) ?? candidates[0] ?? null;
  const mine = status.here.goals;

  return (
    <section
      aria-labelledby="move-title"
      className={cn('rounded-lg bg-panel p-4 text-sm text-ink inset-ring inset-ring-line', variant === 'offer' && 'mb-8 shadow-[inset_4px_0_0_var(--color-you)]')}
    >
      <div className="flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-you text-on-you" aria-hidden="true">
          <ArrowRightLeft size={16} strokeWidth={2.5} />
        </span>
        <div className="min-w-0 flex-1 space-y-3">
          <h2 id="move-title" className="text-base font-bold">
            {variant === 'offer' ? 'Bring your goals over' : 'Move from another Foundry'}
          </h2>

          {!job && status.failed && (
            <p>
              <b className="font-bold">The last move did not take:</b> {status.failed.error}. This Foundry is back on its own folder, and the old one runs again as it was.
            </p>
          )}
          {job ? (
            <div className="space-y-3">
              <p>
                {job.state === 'running' && <>Moving the goals of <span className="mono">{job.where}</span> here.</>}
                {job.state === 'restarting' && <>The goals are here. Foundry is starting again on them{job.nextUrl && new URL(job.nextUrl).origin !== window.location.origin ? <>, at <span className="mono">{job.nextUrl}</span></> : null}: this page follows it.</>}
                {job.state === 'failed' && (
                  <>
                    <b className="font-bold">The move stopped:</b> {job.error} Nothing here changed, and the old Foundry is as it was.
                  </>
                )}
              </p>
              <LiveLog attemptId="move" className="max-h-56" />
              <div className="flex flex-wrap items-center gap-2">
                {job.state === 'running' && (
                  <Button size="sm" variant="ghost" onClick={onMoveNow} title="Stop waiting for the goals at work there: the steps they are in start again here">
                    Move now
                  </Button>
                )}
                {job.state === 'failed' && (
                  <Button size="sm" variant="primary" disabled={busy} onClick={() => onMove(job.id)}>
                    Try again
                  </Button>
                )}
              </div>
            </div>
          ) : pick ? (
            <div className="space-y-3">
              {candidates.length > 1 ? (
                <fieldset className="space-y-1.5">
                  <legend className="mb-1">Foundry found more than one earlier install with goals. Which one moves here?</legend>
                  {candidates.map((i) => (
                    <label key={i.id} className="flex items-start gap-2">
                      <input type="radio" name="move-from" className="mt-1" checked={i.id === pick.id} onChange={() => onChoose(i.id)} />
                      <span>
                        <span className="mono">{named(i)}</span> <Facts i={i} />
                      </span>
                    </label>
                  ))}
                </fieldset>
              ) : (
                <p>
                  Foundry found your earlier Foundry in <span className="mono">{named(pick)}</span>: <Facts i={pick} />.
                </p>
              )}
              <p className="text-ink-soft">
                Moving copies everything here: goals, history, settings, attachments and worktrees. Then it stops that Foundry and keeps it as it is, as the backup.
                {pick.port ? ' This one takes over its address, so your bookmarks keep working.' : ''}
                {pick.running ? ' Goals at work there are paused first, and go on here.' : ''}
              </p>
              {mine > 0 && (
                <label className="flex items-start gap-2 rounded-md bg-sunken p-2.5 text-ink inset-ring inset-ring-line">
                  <input type="checkbox" className="mt-1" checked={replace} onChange={(e) => onReplace(e.target.checked)} />
                  <span>
                    I understand: this Foundry’s own {plural(mine, 'goal')} are set aside as a backup, not merged with the ones that move here.
                  </span>
                </label>
              )}
              {err && <p className="text-bad-ink">{err}</p>}
              <Button variant="primary" disabled={busy || (mine > 0 && !replace)} onClick={() => onMove(pick.id)}>
                Move {plural(pick.goals, 'goal')} here
              </Button>
            </div>
          ) : (
            <p className="text-ink-soft">No earlier Foundry with goals on this computer.</p>
          )}

          {status.notes.map((n) => (
            <p key={n} className="text-xs text-ink-faint">
              {n}
            </p>
          ))}
          {variant === 'settings' && status.last && !job && (
            <p className="text-xs text-ink-faint">
              The goals here came from <span className="mono">{named(status.last.from)}</span> on {status.last.finishedAt.slice(0, 10)}: {plural(status.last.goals, 'goal')}
              {status.last.unrepaired.length ? `; ${plural(status.last.unrepaired.length, 'worktree')} whose repository is not on this computer were left as they were` : ''}.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
