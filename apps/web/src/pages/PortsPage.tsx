import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ExternalLink, Search, Square } from 'lucide-react';
import { api, type PortRow, type PortsView } from '../api.ts';
import { Button, ButtonGroup, ConfirmDialog, Empty, Page, cn } from '../ui.tsx';
import { HelpLink } from './HelpPage.tsx';

const GROUPS: { category: PortRow['category']; label: string; accent: string; hint: string }[] = [
  { category: 'foundry', label: 'Foundry', accent: 'bg-violet-400', hint: 'Its server, previews, VS Code (web), what tasks started, the Docker services it runs.' },
  { category: 'tailscale', label: 'Tailscale serve', accent: 'bg-sky-400', hint: 'Ports forwarded to your tailnet. lsof without sudo does not show them.' },
  { category: 'docker', label: 'Docker', accent: 'bg-cyan-400', hint: 'Containers publishing a port.' },
  { category: 'process', label: 'Other processes', accent: 'bg-zinc-400', hint: 'Other programs. Only your own can be stopped.' },
  { category: 'unknown', label: 'Unknown holder', accent: 'bg-amber-400', hint: 'Held by the system or another user: sudo lsof names it.' },
];

/** the ports, read now and every five seconds while the page is in front */
export function usePorts(): { view: PortsView | null; error: string | null; refresh: () => Promise<void> } {
  const [view, setView] = useState<PortsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = async () => {
    try {
      setView(await api.ports());
      setError(null);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  };
  useEffect(() => {
    void refresh();
    const t = setInterval(() => document.visibilityState === 'visible' && void refresh(), 5_000);
    return () => clearInterval(t);
  }, []);
  return { view, error, refresh };
}

/** Stop & release through the confirmation dialog: `ask(row)` opens it, `dialog` renders it */
export function usePortRelease(onDone: () => void): { ask: (row: PortRow) => void; dialog: React.ReactNode } {
  const [row, setRow] = useState<PortRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const close = () => {
    setRow(null);
    setErr(null);
  };
  const go = async () => {
    if (!row) return;
    setBusy(true);
    setErr(null);
    try {
      await api.releasePort(row.id);
      close();
      onDone();
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };
  const dialog = (
    <ConfirmDialog open={!!row} danger busy={busy} title={`Stop and release port ${row?.port ?? ''}?`} confirmLabel="Stop & release" onConfirm={go} onClose={close}>
      <p>
        <b>{row?.label}</b>
        {row?.detail ? <span className="text-zinc-400"> · {row.detail}</span> : null}
      </p>
      {row?.release.confirm && <p>{row.release.confirm}</p>}
      {err && <p className="text-rose-400">{err}</p>}
    </ConfirmDialog>
  );
  return { ask: (r) => setRow(r), dialog };
}

/** one grid for every port row, so the columns line up; phones stack it */
const ROW = 'grid grid-cols-[3.5rem_minmax(0,1fr)_2rem] sm:grid-cols-[3.5rem_minmax(0,1fr)_14rem_2rem] gap-x-3 gap-y-1 items-start px-1 py-2.5';

/** one port: the number, who holds it in words, where it listens, and ■ when it can be stopped */
export function PortLine({ row, onRelease, highlight }: { row: PortRow; onRelease: (row: PortRow) => void; highlight?: boolean }) {
  const where = [row.addresses.length ? row.addresses.join(', ') : null, row.pid ? `pid ${row.pid}` : null, row.container].filter(Boolean).join(' · ');
  return (
    <li className={cn(ROW, highlight && 'rounded bg-amber-500/10')}>
      <span className="mono text-sm text-zinc-100 tabular-nums text-right pt-px">{row.port}</span>
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm text-zinc-100 truncate" title={row.process ?? undefined}>{row.label}</span>
          {row.goalId && (
            <Link to={`/goals/${row.goalId}${row.taskId ? `?task=${row.taskId}#tasks` : ''}`} className="shrink-0 text-[11px] text-zinc-500 hover:text-emerald-300" aria-label="Open goal">
              Open goal →
            </Link>
          )}
        </div>
        {(row.detail || row.url) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-500 min-w-0">
            {row.detail && <span className="break-words min-w-0">{row.detail}</span>}
            {row.url && (
              <a href={row.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 mono text-sky-300 hover:underline">
                {row.url.replace(/^https?:\/\//, '')} <ExternalLink size={10} aria-hidden="true" />
              </a>
            )}
          </div>
        )}
        {!row.release.allowed && row.release.reason && <div className="mt-1 text-[11px] text-zinc-600">Cannot be stopped here: {row.release.reason}</div>}
      </div>
      <span className="col-start-2 sm:col-start-auto mono text-[11px] text-zinc-500 truncate pt-0.5" title={where}>
        {where}
      </span>
      <div className="row-start-1 col-start-3 sm:row-start-auto sm:col-start-auto flex justify-end">
        {row.release.allowed && (
          <Button size="sm" variant="ghost" title={`Stop and release port ${row.port}`} aria-label={`Stop and release port ${row.port}`} onClick={() => onRelease(row)}>
            <Square size={12} className="text-rose-400" />
          </Button>
        )}
      </div>
    </li>
  );
}

function GroupHeading({ accent, label, hint }: { accent: string; label: string; hint: string }) {
  return (
    <div className="flex items-baseline gap-2 flex-wrap mb-2">
      <span className={cn('h-2 w-2 rounded-full self-center shrink-0', accent)} />
      <h2 className="text-sm font-medium text-zinc-200">{label}</h2>
      <span className="text-[11px] text-zinc-600">{hint}</span>
    </div>
  );
}

/** Ports: every port in use on Foundry's computer, who holds it, and stopping the ones that can be */
export function PortsPage() {
  const { view, error, refresh } = usePorts();
  const { ask, dialog } = usePortRelease(() => void refresh());
  const [params] = useSearchParams();
  const wanted = Number(params.get('port')) || null;
  const [scope, setScope] = useState<'dev' | 'all'>('dev');
  const [query, setQuery] = useState(wanted ? String(wanted) : '');
  const all = view?.rows ?? [];
  const inScope = all.filter((r) => scope === 'all' || r.relevant || r.port === wanted);
  const matching = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return inScope.filter((r) => !needle || String(r.port).includes(needle) || `${r.label} ${r.detail ?? ''} ${r.process ?? ''} ${r.container ?? ''} ${r.cwd ?? ''}`.toLowerCase().includes(needle));
  }, [inScope, query]);
  const dev = all.filter((r) => r.relevant).length;
  return (
    <Page width="lg">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
        <h1 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
          Ports <HelpLink to="ports" label="Ports (new tab)" />
        </h1>
        {view && <span className="text-xs text-zinc-500">{all.length} in use · {dev} for development</span>}
      </div>
      <p className="text-xs text-zinc-500 mb-4 max-w-2xl">Ports in use on the computer Foundry runs on, and who holds them. Stop and release what Foundry, tailscale serve, Docker or your own programs hold.</p>
      <div className="flex items-end justify-between gap-3 flex-wrap mb-5">
        <ButtonGroup
          label="Which ports"
          value={scope}
          onChange={setScope}
          options={[
            { id: 'dev', label: `For development${view ? ` ${dev}` : ''}`, title: "Foundry's, Tailscale's and Docker's ports, the usual dev ports, the preview range and programs in your projects" },
            { id: 'all', label: `All ports${view ? ` ${all.length}` : ''}`, title: 'System and background programs too' },
          ]}
        />
        <label className="relative flex-1 min-w-48 max-w-xs">
          <span className="sr-only">Search ports</span>
          <Search size={14} className="absolute left-3 top-3 text-zinc-500" aria-hidden="true" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search ports, programs, containers, folders…" className="w-full rounded-lg border border-zinc-800 bg-zinc-950/50 py-2.5 pl-9 pr-3 text-xs text-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/50" />
        </label>
      </div>
      {view?.inContainer && <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">Foundry runs in its Docker image: only ports inside its container show here, not the host's.</div>}
      {view && <div className="mb-3 text-xs text-zinc-500" aria-live="polite">Showing {matching.length} of {all.length} ports · refreshes automatically</div>}
      {!view && <Empty>{error ? 'Ports unavailable; retrying…' : 'Loading…'}</Empty>}
      {view && matching.length === 0 && <Empty>{all.length === 0 ? 'No port is in use.' : 'No port matches. Try All ports or clear the search.'}</Empty>}
      {GROUPS.map((g) => {
        const list = matching.filter((r) => r.category === g.category);
        if (!list.length) return null;
        return (
          <section key={g.category} className="mb-6">
            <GroupHeading accent={g.accent} label={g.label} hint={`${list.length} · ${g.hint}`} />
            <div className="rounded-lg border border-zinc-800 px-3 surface-card">
              <ul className="divide-y divide-zinc-800/70">
                {list.map((r) => (
                  <PortLine key={r.id} row={r} onRelease={ask} highlight={r.port === wanted} />
                ))}
              </ul>
            </div>
          </section>
        );
      })}
      {dialog}
    </Page>
  );
}
