import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ExternalLink, Network, RefreshCw, Square } from 'lucide-react';
import { api, type PortRow, type PortsView } from '../api.ts';
import { Button, Card, Input, Page, ago, cn } from '../ui.tsx';
import { HelpLink } from './HelpPage.tsx';

const GROUPS: { category: PortRow['category']; title: string }[] = [
  { category: 'foundry', title: 'Foundry' },
  { category: 'tailscale', title: 'Tailscale serve' },
  { category: 'docker', title: 'Docker' },
  { category: 'process', title: 'Other processes' },
  { category: 'unknown', title: 'Unknown holder' },
];

/** the page's ports, read now and every five seconds while the page is in front */
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

/** Stop and release one port's holder: Foundry's own go at once, everything else asks first */
export function ReleaseButton({ row, onDone }: { row: PortRow; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!row.release.allowed) return <span className="text-[11px] text-zinc-600" title={row.release.reason ?? undefined}>{row.release.reason}</span>;
  const go = async () => {
    if (row.release.confirm && !confirm(row.release.confirm)) return;
    setBusy(true);
    setErr(null);
    try {
      await api.releasePort(row.id);
      onDone();
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="flex items-center gap-2">
      {err && <span className="text-[11px] text-rose-400 max-w-56 truncate" title={err}>{err}</span>}
      <Button size="sm" variant="danger" disabled={busy} onClick={go} title={`Stop what holds port ${row.port} and release it`}>
        <Square size={12} /> {busy ? 'Stopping…' : 'Stop & release'}
      </Button>
    </span>
  );
}

/** one port: the number, who holds it in words, where it listens, and what can be done */
export function PortLine({ row, onDone, highlight }: { row: PortRow; onDone: () => void; highlight?: boolean }) {
  return (
    <li className={cn('flex flex-wrap sm:flex-nowrap items-start gap-3 px-3 py-2', highlight && 'bg-amber-500/10')}>
      <span className="mono text-sm text-zinc-100 w-14 shrink-0 text-right">{row.port}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-zinc-200 truncate">
          {row.label}
          {row.goalId && (
            <Link to={`/goals/${row.goalId}${row.taskId ? `?task=${row.taskId}#tasks` : ''}`} className="ml-2 text-[11px] text-sky-300 hover:underline">
              open goal →
            </Link>
          )}
        </span>
        {row.detail && <span className="block text-[11px] text-zinc-500 break-words">{row.detail}</span>}
        <span className="block text-[11px] text-zinc-600 mono truncate">
          {[row.addresses.length ? `on ${row.addresses.join(', ')}` : null, row.pid ? `pid ${row.pid}` : null, row.container ? `container ${row.container}` : null].filter(Boolean).join(' · ')}
          {row.url && (
            <a href={row.url} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-0.5 text-sky-300 hover:underline">
              {row.url.replace(/^https?:\/\//, '')} <ExternalLink size={10} />
            </a>
          )}
        </span>
      </span>
      <span className="shrink-0 ml-auto">
        <ReleaseButton row={row} onDone={onDone} />
      </span>
    </li>
  );
}

/** Ports: every port in use on Foundry's computer, who holds it, and stopping the ones that can be */
export function PortsPage() {
  const { view, error, refresh } = usePorts();
  const [params] = useSearchParams();
  const wanted = Number(params.get('port')) || null;
  const [all, setAll] = useState(false);
  const [q, setQ] = useState(wanted ? String(wanted) : '');
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (view?.rows ?? []).filter((r) => (all || r.relevant || r.port === wanted) && (!needle || String(r.port).includes(needle) || `${r.label} ${r.detail ?? ''} ${r.process ?? ''} ${r.container ?? ''}`.toLowerCase().includes(needle)));
  }, [view, all, q, wanted]);
  const hidden = (view?.rows.length ?? 0) - (view?.rows ?? []).filter((r) => r.relevant || r.port === wanted).length;
  return (
    <Page width="lg">
      <div>
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Network size={18} /> Ports <HelpLink to="ports" label="Ports (new tab)" />
        </h1>
        <p className="text-sm text-zinc-400 mt-1">Ports in use on the computer Foundry runs on, and who holds them. Stop and release what Foundry, tailscale serve, Docker or your own processes hold.</p>
      </div>
      {view?.inContainer && <div className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">Foundry runs in its Docker image: only ports inside its container show here, not the host's.</div>}
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-64">
          <Input className="text-xs" placeholder="Filter by port or name" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer">
          <input type="checkbox" className="accent-emerald-500" checked={all} onChange={(e) => setAll(e.target.checked)} />
          Show all{hidden > 0 && !all ? ` (${hidden} system and background)` : ''}
        </label>
        <span className="ml-auto flex items-center gap-2 text-[11px] text-zinc-500">
          {view && <span>scanned {ago(view.scannedAt)}</span>}
          <Button size="sm" variant="ghost" onClick={() => void refresh()} title="Scan again now">
            <RefreshCw size={12} /> Refresh
          </Button>
        </span>
      </div>
      {error && <div className="text-xs text-rose-400">{error}</div>}
      {!view && !error && <div className="text-xs text-zinc-500">Scanning…</div>}
      {view && !rows.length && <div className="text-xs text-zinc-500">No port matches.</div>}
      {GROUPS.map((g) => {
        const list = rows.filter((r) => r.category === g.category);
        if (!list.length) return null;
        return (
          <Card key={g.category} title={`${g.title} (${list.length})`} bodyClassName="p-0">
            <ul className="divide-y divide-zinc-800/70">
              {list.map((r) => (
                <PortLine key={r.id} row={r} onDone={() => void refresh()} highlight={r.port === wanted} />
              ))}
            </ul>
          </Card>
        );
      })}
    </Page>
  );
}
