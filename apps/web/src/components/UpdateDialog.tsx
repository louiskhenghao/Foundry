import { ArrowUpCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, type UpdateStatusView } from '../api.ts';
import { LiveLog } from '../pages/LiveLog.tsx';
import { Button, CopyButton, Modal, cn } from '../ui.tsx';

/**
 * Header pill: a release newer than this instance exists. Hidden while up to date.
 * The server checks daily; this only reads its cached report.
 */
export function UpdatePill() {
  const [status, setStatus] = useState<UpdateStatusView | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const load = () => api.updateStatus().then(setStatus).catch(() => {});
    const t = setTimeout(load, 1000);
    const i = setInterval(load, 5 * 60_000);
    return () => {
      clearTimeout(t);
      clearInterval(i);
    };
  }, []);
  if (!status?.updateAvailable) return null;
  return (
    <>
      <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 rounded-md border border-sky-500/40 text-sky-300 px-2 py-1 text-[11px] mono" title={`Foundry ${status.latest} is available — you run ${status.current}`}>
        <ArrowUpCircle size={12} />
        <span className="whitespace-nowrap">{status.latest}</span>
      </button>
      <UpdateDialog open={open} onClose={() => setOpen(false)} status={status} />
    </>
  );
}

/**
 * The one-click update: changelog, then self-update with live progress — or the guided
 * commands when this install cannot replace itself (ADR-0010's degradation, never an error).
 */
export function UpdateDialog({ open, onClose, status }: { open: boolean; onClose: () => void; status: UpdateStatusView | null }) {
  const [phase, setPhase] = useState<'idle' | 'running' | 'failed'>('idle');
  const [force, setForce] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  // while the update runs the server goes away; when it answers again with the new version, reload into it
  useEffect(() => {
    if (phase !== 'running' || !status?.latest) return;
    poll.current = setInterval(() => {
      api
        .health()
        .then((h) => {
          if (h.version === status.latest) location.reload();
          else if (!h.updating) setPhase('failed'); // server is back on the old version: rolled back
        })
        .catch(() => {}); // down mid-restart — keep waiting
    }, 2000);
    return () => {
      if (poll.current) clearInterval(poll.current);
    };
  }, [phase, status?.latest]);
  if (!status) return null;
  const cap = status.capability;
  const start = async () => {
    setErr(null);
    try {
      await api.updateApply(force);
      setPhase('running');
    } catch (e: any) {
      setErr(e.message);
    }
  };
  return (
    <Modal open={open} title={`Update to ${status.latest ?? '…'}`} onClose={phase === 'running' ? () => {} : onClose} wide>
      <div className="space-y-3 text-sm">
        <p className="text-xs text-zinc-400">
          You run <span className="mono text-zinc-200">{status.current}</span> ({cap.mode} install) — <span className="mono text-zinc-200">{status.latest}</span> is available.
        </p>
        {status.changelog.length > 0 && (
          <div className="max-h-56 overflow-auto rounded-md border border-zinc-800 bg-zinc-900/40 p-3 space-y-3">
            {status.changelog.map((c) => (
              <div key={c.version}>
                <div className="text-xs font-semibold text-zinc-200 mono">{c.version}</div>
                <div className="text-[11px] text-zinc-400 whitespace-pre-wrap mt-1">{c.notes || '(no notes)'}</div>
              </div>
            ))}
          </div>
        )}
        {cap.canSelfUpdate ? (
          phase === 'idle' ? (
            <div className="space-y-2">
              <p className="text-[11px] text-zinc-500">
                {cap.mode === 'docker'
                  ? 'The watchtower sidecar pulls the new image and restarts this container; the page reconnects by itself.'
                  : 'Runs git pull, installs and rebuilds, then restarts the server; any failure rolls back and changes nothing.'}{' '}
                New sessions stop first and active agents finish before the restart.
              </p>
              <label className="flex items-center gap-2 text-[11px] text-zinc-400 cursor-pointer">
                <input type="checkbox" className="accent-amber-500" checked={force} onChange={(e) => setForce(e.target.checked)} />
                Update immediately without waiting — interrupts running agents
              </label>
              {err && <div className="text-[11px] text-rose-300">✘ {err}</div>}
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={onClose}>
                  Not now
                </Button>
                <Button size="sm" variant="primary" onClick={start}>
                  <ArrowUpCircle size={14} /> Update
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <LiveLog attemptId="self-update" className="max-h-56" />
              <p className={cn('text-[11px]', phase === 'failed' ? 'text-rose-300' : 'text-zinc-500')}>
                {phase === 'failed' ? 'The update did not go through — it was rolled back and the old version is running. See the log above.' : 'Updating… the server restarts at the end and this page reloads by itself.'}
              </p>
              {phase === 'failed' && (
                <div className="flex justify-end">
                  <Button size="sm" variant="ghost" onClick={onClose}>
                    Close
                  </Button>
                </div>
              )}
            </div>
          )
        ) : (
          <div className="space-y-2">
            <p className="text-[11px] text-zinc-500">
              {cap.mode === 'docker'
                ? 'This container has no watchtower sidecar, so it cannot replace itself — run these on the host (the newest docker-compose.yml adds the sidecar for one-click updates):'
                : 'This install cannot update itself — run these in the Foundry directory, then restart:'}
            </p>
            <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-3 space-y-1">
              {cap.guided.map((cmd) => (
                <div key={cmd} className="flex items-center gap-2 text-[12px] mono text-zinc-200">
                  <span className="text-zinc-500">$</span> {cmd} <CopyButton text={cmd} />
                </div>
              ))}
            </div>
            <div className="flex justify-end">
              <Button size="sm" variant="ghost" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
