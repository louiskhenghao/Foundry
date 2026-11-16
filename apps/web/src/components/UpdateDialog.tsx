import { ArrowUpCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, type SwitchView, type UpdateStatusView } from '../api.ts';
import { LiveLog } from '../pages/LiveLog.tsx';
import { Button, CopyButton, Modal, cn } from '../ui.tsx';

/**
 * Header pill: a release newer than this instance exists. Hidden while up to date.
 * The server checks daily; this only reads its cached report.
 */
export function UpdatePill() {
  const [status, setStatus] = useState<UpdateStatusView | null>(null);
  const [open, setOpen] = useState(false);
  // the menu bar app's "Update to …" opens the page with ?update (ADR-0102): the dialog opens once the report has the version
  const asked = useRef(new URLSearchParams(window.location.search).has('update'));
  useEffect(() => {
    if (!asked.current || !status?.updateAvailable) return;
    asked.current = false;
    setOpen(true);
    const url = new URL(window.location.href);
    url.searchParams.delete('update');
    window.history.replaceState(window.history.state, '', url.toString());
  }, [status?.updateAvailable]);
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
      {/* news, not a request: the work (information) colour, in the top bar's own palette. A phone's bar has no room for
          it; there the ⚙ button's dot says a newer version is out, and its menu leads to About & updates */}
      <button onClick={() => setOpen(true)} className="hidden sm:flex h-8 sm:h-7 items-center gap-1.5 rounded-md border border-work/50 text-work-ink px-2 text-[11px] font-bold mono hover:bg-band-hover" title={`Foundry ${status.latest} is available — you run ${status.current}`}>
        <ArrowUpCircle size={12} />
        <span className="whitespace-nowrap">{status.latest}</span>
      </button>
      <UpdateDialog open={open} onClose={() => setOpen(false)} status={status} />
    </>
  );
}

/** what a one-click update does, by how this Foundry is installed */
const HOW: Record<string, string> = {
  docker: 'The watchtower sidecar pulls the new image and restarts this container; the page reconnects by itself.',
  local: 'Runs git pull, installs and rebuilds, then restarts the server; any failure rolls back and changes nothing.',
  app: 'Downloads the release and checks it, then the menu bar app swaps the application and starts it again.',
  binary: 'Downloads the release and checks it, switches the install folder to it, then restarts.',
};
/** why this install cannot update itself, above the commands that do it by hand */
const GUIDED: Record<string, string> = {
  docker: 'This container has no watchtower sidecar, so it cannot replace itself — run these on the host (the newest docker-compose.yml adds the sidecar for one-click updates):',
  local: 'This install cannot update itself — run these in the Foundry directory, then restart:',
  app: 'This Foundry was started without its menu bar app, which is what swaps the application — download the release and replace Foundry.app by hand:',
  binary: 'This install is not in a release folder Foundry can switch — download the release and replace the install by hand:',
};

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
  const start = async (acknowledge = false) => {
    setErr(null);
    try {
      await api.updateApply(force, acknowledge);
      setPhase('running');
    } catch (e: any) {
      setErr(e.message);
    }
  };
  // portalled to <body>: opened from the header's update pill, whose backdrop blur would pin a fixed overlay to the 48px header
  return createPortal(
    <Modal open={open} title={cap.switch ? `Switch to Foundry ${cap.switch.to}` : `Update to ${status.latest ?? '…'}`} onClose={phase === 'running' ? () => {} : onClose} wide>
      <div className="space-y-3 text-sm">
        <p className="text-xs text-ink-soft">
          {/* the newer version is news, in the information blue the top bar's pill shows it in */}
          You run <span className="mono font-bold text-ink">{status.current}</span> ({cap.mode} install) — <span className="mono font-bold text-work-ink">{status.latest}</span> is available.
        </p>
        {status.changelog.length > 0 && (
          <div className="max-h-56 overflow-auto rounded-md border border-line bg-sunken p-3 space-y-3">
            {status.changelog.map((c) => (
              <div key={c.version}>
                <div className="text-xs font-bold text-ink mono">{c.version}</div>
                <div className="text-xs text-ink-soft whitespace-pre-wrap mt-1">{c.notes || '(no notes)'}</div>
              </div>
            ))}
          </div>
        )}
        {cap.switch && phase === 'idle' ? (
          <SwitchNotice sw={cap.switch} steps={cap.guided} canSwitch={cap.canSelfUpdate} force={force} onForce={setForce} err={err} onSwitch={() => start(true)} onClose={onClose} />
        ) : cap.canSelfUpdate ? (
          phase === 'idle' ? (
            <div className="space-y-2">
              <p className="text-xs text-ink-faint">
                {HOW[cap.mode] ?? HOW.local}{' '}
                New sessions stop first and active agents finish before the restart.
              </p>
              <label className="flex items-center gap-2 text-xs text-ink-soft cursor-pointer">
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                Update immediately without waiting — interrupts running agents
              </label>
              {err && <div className="text-xs text-bad-ink">✘ {err}</div>}
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={onClose}>
                  Not now
                </Button>
                <Button size="sm" variant="primary" onClick={() => start()}>
                  <ArrowUpCircle size={14} /> Update
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <LiveLog attemptId="self-update" className="max-h-56" />
              {/* the update at work in blue, a failed one in red */}
              <p className={cn('text-xs font-semibold', phase === 'failed' ? 'text-bad-ink' : 'text-work-ink')}>
                {phase === 'failed'
                  ? cap.switch
                    ? `The switch did not go through — this Foundry carries on as it was. See the log above and ${cap.switch.log}.`
                    : 'The update did not go through — it was rolled back and the old version is running. See the log above.'
                  : cap.switch
                    ? `Switching… this Foundry stops, its data is copied, and Foundry ${cap.switch.to} starts on port ${cap.switch.port}; this page reloads by itself. A large data folder takes a while.`
                    : 'Updating… the server restarts at the end and this page reloads by itself.'}
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
            <p className="text-xs text-ink-faint">
              {GUIDED[cap.mode] ?? GUIDED.local}
            </p>
            <div className="rounded-md border border-line bg-sunken p-3 space-y-1">
              {cap.guided.map((cmd) => (
                <div key={cmd} className="flex items-center gap-2 text-[12px] mono text-ink [overflow-wrap:anywhere]">
                  <span className="text-ink-faint">$</span> {cmd} <CopyButton text={cmd} />
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
    </Modal>,
    document.body,
  );
}

const list = 'list-disc space-y-1 pl-5 text-xs text-ink-soft';
const mono = 'mono text-ink [overflow-wrap:anywhere]';

/**
 * Before a checkout or a container meets 3.0 (ADR-0103): what the switch to the app or the binary does, what can go
 * wrong, and the way back. A checkout switches on a ticked box; a container gets the steps to run on its host.
 */
export function SwitchNotice({ sw, steps, canSwitch, force, onForce, err, onSwitch, onClose }: {
  sw: SwitchView;
  steps: string[];
  canSwitch: boolean;
  force: boolean;
  onForce: (v: boolean) => void;
  err: string | null;
  onSwitch: () => void;
  onClose: () => void;
}) {
  const [sure, setSure] = useState(false);
  const what = sw.install === 'app' ? 'the Foundry app' : 'the foundry binary';
  return (
    <div className="space-y-3">
      {/* a decision only the person makes: in the colour of what waits for them */}
      <div className="rounded-md border border-you/60 p-3 space-y-1">
        <p className="text-sm font-bold text-ink">Foundry {sw.to} ships only as {what}.</p>
        <p className="text-xs text-ink-soft">
          This {sw.from === 'docker' ? 'Docker' : 'source'} install gets no updates from {sw.to} on. Switching keeps every goal, setting, transcript and attachment.
        </p>
      </div>
      <div className="space-y-1">
        <p className="text-xs font-bold text-ink">What switching does</p>
        <ul className={list}>
          <li>Installs Foundry {sw.to} {sw.install === 'app' ? 'as Foundry.app in Applications, run from the menu bar' : 'in ~/.local/share/foundry, run as a service'}.</li>
          <li>
            Stops this Foundry, then copies its data folder <span className={mono}>{sw.dataDir}</span> to <span className={mono}>{sw.target}</span>. The original stays as it is: it is the backup.
          </li>
          <li>Starts the new Foundry on port {sw.port}, the address this page has. The page reconnects by itself.</li>
          <li>Your repositories, their branches and the goals' progress folders are not touched.</li>
        </ul>
      </div>
      <div className="space-y-1">
        <p className="text-xs font-bold text-ink">The risks</p>
        <ul className={list}>
          {sw.install === 'app' && <li>The app is not notarized by Apple. Installed this way it opens without a warning; after an update macOS may ask again for folders it guards, such as Documents or Desktop.</li>}
          <li>The copy needs as much free disk as the data folder takes, and time to match: long transcripts and old worktrees make it slower.</li>
          <li>Running goals are paused first, as with every update, and carry on in the new Foundry.</li>
          <li>
            If the switch stops before this Foundry is stopped, nothing changes here. If it stops after, its log says why: <span className={mono}>{sw.log}</span>.
          </li>
        </ul>
      </div>
      <div className="space-y-1">
        <p className="text-xs font-bold text-ink">The way back</p>
        <ul className={list}>
          <li>
            {sw.from === 'docker'
              ? 'The Docker volumes stay as they are. To go back, stop the new Foundry and start the container again.'
              : 'This checkout and its data stay as they were. To go back, quit the new Foundry and start this one again.'}
          </li>
        </ul>
      </div>
      {sw.from === 'docker' || !canSwitch ? (
        <div className="space-y-2">
          <p className="text-xs text-ink-faint">
            {sw.from === 'docker'
              ? 'Nothing in a container can install on its host. On the host, run these in order (Linux; on a Mac, --mode app and ~/Library/Application Support/Foundry/data):'
              : 'This Foundry cannot switch by itself here. In a terminal:'}
          </p>
          <div className="rounded-md border border-line bg-sunken p-3 space-y-1">
            {steps.map((cmd) => (
              <div key={cmd} className="flex items-center gap-2 text-[12px] mono text-ink [overflow-wrap:anywhere]">
                <span className="text-ink-faint">$</span> {cmd} <CopyButton text={cmd} />
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <Button size="sm" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-ink cursor-pointer">
            <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />I understand: switch this install to Foundry {sw.to}
          </label>
          <label className="flex items-center gap-2 text-xs text-ink-soft cursor-pointer">
            <input type="checkbox" checked={force} onChange={(e) => onForce(e.target.checked)} />
            Switch now without waiting — interrupts running agents
          </label>
          {err && <div className="text-xs text-bad-ink">✘ {err}</div>}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>
              Not now
            </Button>
            <Button size="sm" variant="primary" disabled={!sure} onClick={onSwitch}>
              <ArrowUpCircle size={14} /> Switch to {sw.to}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
