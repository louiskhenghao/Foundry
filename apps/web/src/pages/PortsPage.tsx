import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ExternalLink, RefreshCw, Search } from 'lucide-react';
import { api, type PortRow, type PortsView } from '../api.ts';
import { Badge, Button, Card, ConfirmDialog, Empty, Input, Tabs, ago, cn } from '../ui.tsx';
import { HelpLink } from './HelpPage.tsx';

type Category = PortRow['category'];
const CATEGORIES: { id: Category; label: string; heading: string; badge: string; dot: string }[] = [
  { id: 'foundry', label: 'foundry', heading: 'Foundry', badge: 'foundry', dot: 'bg-emerald-400' },
  { id: 'tailscale', label: 'tailscale', heading: 'Tailscale serve', badge: 'tailscale', dot: 'bg-sky-400' },
  { id: 'docker', label: 'docker', heading: 'Docker', badge: 'docker', dot: 'bg-cyan-400' },
  { id: 'process', label: 'processes', heading: 'Other processes', badge: 'process', dot: 'bg-zinc-400' },
  { id: 'unknown', label: 'unknown', heading: 'Unknown holders', badge: 'holder-unknown', dot: 'bg-amber-400' },
];
const BADGE_LABEL: Record<Category, string> = { foundry: 'Foundry', tailscale: 'Tailscale', docker: 'Docker', process: 'Process', unknown: 'Unknown' };

/** the ports, read now and every five seconds while the page is in front */
export function usePorts(): { view: PortsView | null; error: string | null; loading: boolean; refresh: () => Promise<void> } {
  const [view, setView] = useState<PortsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const refresh = async () => {
    setLoading(true);
    try {
      setView(await api.ports());
      setError(null);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
    const t = setInterval(() => document.visibilityState === 'visible' && void refresh(), 5_000);
    return () => clearInterval(t);
  }, []);
  return { view, error, loading, refresh };
}

/** Stop & release through the confirmation dialog: `ask(row)` opens it, `dialog` renders it */
export function usePortRelease(onDone: () => void): { ask: (row: PortRow) => void; dialog: ReactNode } {
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

/** One port: number · what holds it · where it listens · actions. Indented under its group, zebra striped. */
export function PortLine({ row, onRelease, odd, highlight, standalone, plain }: { row: PortRow; onRelease: (row: PortRow) => void; odd?: boolean; highlight?: boolean; standalone?: boolean; plain?: boolean }) {
  const where = [plain ? null : row.addresses.length ? row.addresses.join(', ') : null, row.pid ? `pid ${row.pid}` : null].filter(Boolean).join(' · ');
  return (
    <div className={cn('pr-3 sm:pr-4 py-2 grid grid-cols-[4rem_minmax(0,1fr)] md:grid-cols-[4rem_minmax(0,1fr)_11rem_11rem] gap-x-3 gap-y-1 items-start text-xs', standalone ? 'pl-3' : 'pl-3 sm:pl-6 ml-2 sm:ml-4 border-l-2 border-zinc-800/60', odd && 'bg-zinc-900/50', highlight && 'bg-amber-500/10')}>
      <span className="mono text-sm text-zinc-100 tabular-nums text-right">{row.port}</span>
      <div className="min-w-0">
        {/* plain: the card already names the program and its folder, so the row says where it listens */}
        <div className="text-zinc-100 truncate" title={row.process ?? undefined}>{plain ? `listening on ${row.addresses.join(', ') || '—'}` : row.label}</div>
        <div className="text-[10px] text-zinc-500 mt-0.5 flex flex-wrap gap-x-2">
          {row.detail && !plain && <span className="min-w-0 break-words">{row.detail}</span>}
          {!row.release.allowed && row.release.reason && <span className="text-zinc-600">can't stop here: {row.release.reason}</span>}
        </div>
      </div>
      <div className="col-start-2 md:col-start-3 mono text-[11px] text-zinc-500 truncate" title={where}>
        {where || <span className="text-zinc-700">—</span>}
      </div>
      <div className="col-start-2 md:col-start-4 flex items-center gap-1 justify-start md:justify-end flex-wrap">
        {row.url && (
          <a href={row.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800" title={row.url}>
            <ExternalLink size={12} /> open
          </a>
        )}
        {row.release.allowed && (
          <Button size="sm" variant="ghost" className="text-rose-300" onClick={() => onRelease(row)} title={`Stop what holds port ${row.port} and release it`}>
            stop & release
          </Button>
        )}
      </div>
    </div>
  );
}

/** what one card gathers: one holder (a program, a compose project, a goal…) and its ports */
interface Group {
  key: string;
  category: Category;
  title: string;
  meta: string[];
  goalId: string | null;
  rows: PortRow[];
}

const shortPath = (p: string) => p.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~');

function groupsOf(rows: PortRow[]): Group[] {
  const groups = new Map<string, Group>();
  const put = (key: string, g: Omit<Group, 'key' | 'rows'>, row: PortRow) => {
    const found = groups.get(key);
    if (found) found.rows.push(row);
    else groups.set(key, { key, ...g, rows: [row] });
  };
  for (const r of rows) {
    if (r.category === 'tailscale') put('tailscale', { category: r.category, title: 'tailscale serve', meta: ['ports forwarded to your tailnet'], goalId: null }, r);
    else if (r.category === 'unknown') put('unknown', { category: r.category, title: 'Not visible to this user', meta: ['the system or another user · sudo lsof names them'], goalId: null }, r);
    else if (r.goalId) put(`goal:${r.goalId}`, { category: r.category, title: r.detail?.split(' · ')[0] ?? 'Goal', meta: ['ports of this goal'], goalId: r.goalId }, r);
    else if (r.kind === 'server' || r.kind === 'editor') put('foundry', { category: 'foundry', title: 'Foundry', meta: ['this server and VS Code (web)'], goalId: null }, r);
    else if (r.kind === 'service') put('services', { category: 'foundry', title: 'Docker services Foundry runs', meta: ['for previews · containers and data are kept when stopped'], goalId: null }, r);
    else if (r.category === 'docker') {
      const project = r.detail?.replace(/^compose project /, '') ?? null;
      put(`docker:${project ?? r.container}`, { category: 'docker', title: project ? `compose project ${project}` : (r.container ?? 'container'), meta: [project ? 'containers of one compose project' : 'a container'], goalId: null }, r);
    } else put(`pid:${r.pid}`, { category: 'process', title: r.label, meta: [r.pid ? `pid ${r.pid}` : '', r.cwd && r.cwd !== '/' ? shortPath(r.cwd) : ''].filter(Boolean), goalId: null }, r);
  }
  return [...groups.values()];
}

function GroupCard({ g, onRelease, wanted }: { g: Group; onRelease: (r: PortRow) => void; wanted: number | null }) {
  const releasable = g.rows.filter((r) => r.release.allowed).length;
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/60">
      <header className="px-3 sm:px-4 py-2.5 space-y-1">
        <div className="flex items-center gap-2 min-w-0">
          <Badge state={CATEGORIES.find((c) => c.id === g.category)!.badge} className="shrink-0">
            {BADGE_LABEL[g.category]}
          </Badge>
          <span className="text-sm font-semibold text-zinc-100 truncate">{g.title}</span>
          {g.goalId && (
            <Link to={`/goals/${g.goalId}`} className="shrink-0 text-[11px] text-zinc-500 hover:text-emerald-300">
              Open goal →
            </Link>
          )}
          <span className="ml-auto shrink-0 text-[11px] text-zinc-500 whitespace-nowrap">
            {g.rows.length} port{g.rows.length === 1 ? '' : 's'}
            {releasable > 0 && releasable < g.rows.length ? ` · ${releasable} can be released` : ''}
          </span>
        </div>
        {g.meta.length > 0 && <div className="text-[11px] text-zinc-500 truncate pl-0.5" title={g.meta.join(' · ')}>{g.meta.join(' · ')}</div>}
      </header>
      <div className="border-t border-zinc-800 pb-1">
        {g.rows.map((r, i) => (
          <PortLine key={r.id} row={r} onRelease={onRelease} odd={i % 2 === 1} highlight={r.port === wanted} plain={g.key.startsWith('pid:')} />
        ))}
      </div>
    </section>
  );
}

/** the side panel: what the computer's ports add up to, and why a port may be in use with nothing to see */
function SidePanel({ view, scoped }: { view: PortsView; scoped: PortRow[] }) {
  const [tab, setTab] = useState<'overview' | 'help'>('overview');
  const serves = view.rows.filter((r) => r.category === 'tailscale');
  const range = view.previewRange;
  const inRange = view.rows.filter((r) => r.port >= range.from && r.port <= range.to).length;
  return (
    <Card>
      <Tabs tabs={[{ id: 'overview' as const, label: 'Overview' }, { id: 'help' as const, label: 'Why a port is busy' }]} value={tab} onChange={setTab} />
      <div className="pt-3 text-xs">
        {tab === 'overview' && (
          <div className="space-y-3">
            <ul className="space-y-1.5">
              {CATEGORIES.map((c) => {
                const n = scoped.filter((r) => r.category === c.id).length;
                const total = view.rows.filter((r) => r.category === c.id).length;
                return (
                  <li key={c.id} className="flex items-center gap-2">
                    <span className={cn('h-2 w-2 rounded-full shrink-0', c.dot)} />
                    <span className="text-zinc-300">{c.heading}</span>
                    <span className="ml-auto mono text-zinc-400 tabular-nums">{n}</span>
                    {total !== n && <span className="mono text-[10px] text-zinc-600 tabular-nums w-10 text-right">of {total}</span>}
                  </li>
                );
              })}
            </ul>
            <dl className="border-t border-zinc-800 pt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[11px]">
              <dt className="text-zinc-500">Foundry</dt>
              <dd className="mono text-zinc-300 text-right">{view.foundryPort}</dd>
              <dt className="text-zinc-500">Preview ports</dt>
              <dd className="mono text-zinc-300 text-right">
                {range.from}–{range.to} <span className="text-zinc-600">({inRange} in use)</span>
              </dd>
              <dt className="text-zinc-500">Tailscale serves</dt>
              <dd className="mono text-zinc-300 text-right">
                {serves.length} <span className="text-zinc-600">({serves.filter((r) => r.kind === 'serve-foundry').length} by Foundry)</span>
              </dd>
            </dl>
            <p className="text-[11px] text-zinc-500 border-t border-zinc-800 pt-3">
              In a terminal: <span className="mono text-zinc-400">foundry ports</span> (<span className="mono">--all</span>, <span className="mono">--json</span>).
            </p>
          </div>
        )}
        {tab === 'help' && (
          <ul className="space-y-2.5 text-[11px] text-zinc-400 list-none">
            <li>
              <b className="text-zinc-200">tailscale serve</b> holds its port on the tailnet address: <span className="mono">lsof -i</span> without sudo shows nothing, yet a dev server cannot listen there. Foundry adds one for each preview's tailnet link.
            </li>
            <li>
              <b className="text-zinc-200">A dev server left running</b> — a terminal you forgot, or one a task started — keeps its port until it stops.
            </li>
            <li>
              <b className="text-zinc-200">Docker</b> holds every port a running container publishes, through Docker's own process.
            </li>
            <li>
              <b className="text-zinc-200">macOS AirPlay Receiver</b> takes ports 5000 and 7000 (System Settings → General → AirDrop & Handoff).
            </li>
            <li>
              <b className="text-zinc-200">Unknown holder</b>: a system process or another user's; <span className="mono">sudo lsof -nP -iTCP:&lt;port&gt; -sTCP:LISTEN</span> names it.
            </li>
          </ul>
        )}
      </div>
    </Card>
  );
}

/** Ports: every port in use on Foundry's computer, who holds it, and stopping the ones that can be */
export function PortsPage() {
  const { view, error, loading, refresh } = usePorts();
  const { ask, dialog } = usePortRelease(() => void refresh());
  const [params] = useSearchParams();
  const wanted = Number(params.get('port')) || null;
  const [scope, setScope] = useState<Category | 'all'>('all');
  const [devOnly, setDevOnly] = useState(true);
  const [q, setQ] = useState(wanted ? String(wanted) : '');
  const [showSide, setShowSide] = useState(false);
  const all = view?.rows ?? [];
  const scoped = all.filter((r) => !devOnly || r.relevant || r.port === wanted);
  const matching = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return scoped.filter((r) => (scope === 'all' || r.category === scope) && (!needle || String(r.port).includes(needle) || `${r.label} ${r.detail ?? ''} ${r.process ?? ''} ${r.container ?? ''} ${r.cwd ?? ''}`.toLowerCase().includes(needle)));
  }, [scoped, scope, q]);
  const groups = groupsOf(matching);
  const releasable = all.filter((r) => r.release.allowed).length;
  const count = (c: Category | 'all') => scoped.filter((r) => c === 'all' || r.category === c).length;

  return (
    <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          Ports <HelpLink to="ports" label="Ports (new tab)" />
        </h1>
        {view && (
          <span className="text-xs text-zinc-500">
            {all.length} in use · {all.filter((r) => r.relevant).length} for development · <span className={cn(releasable ? 'text-zinc-300' : 'text-zinc-500')}>{releasable} can be released</span>
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {view && <span className="text-[11px] text-zinc-500">scanned {ago(view.scannedAt)} · every 5 s</span>}
          <Button size="sm" disabled={loading} onClick={() => void refresh()}>
            <RefreshCw size={13} className={cn(loading && 'animate-spin')} /> Refresh
          </Button>
        </div>
      </div>
      <p className="text-xs text-zinc-500 -mt-2">Ports in use on the computer Foundry runs on, grouped by what holds them. Stop and release what Foundry, tailscale serve, Docker or your own programs hold; every stop asks first and says what it does.</p>

      <div className="flex items-center gap-2 flex-wrap">
        {(['all', ...CATEGORIES.map((c) => c.id)] as const).map((c) => (
          <button key={c} onClick={() => setScope(c)} className={cn('rounded-md border px-2 py-1 text-xs', scope === c ? 'border-emerald-500 text-emerald-300' : 'border-zinc-800 text-zinc-400')}>
            {c === 'all' ? 'all' : CATEGORIES.find((x) => x.id === c)!.label} <span className="text-zinc-600">{count(c)}</span>
          </button>
        ))}
        <label className="flex items-center gap-1 text-xs text-zinc-400" title="Foundry's, Tailscale's and Docker's ports, the usual dev ports, the preview range and programs in your projects">
          <input type="checkbox" checked={devOnly} onChange={(e) => setDevOnly(e.target.checked)} /> development only
        </label>
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search size={13} className="absolute left-2 top-2 text-zinc-500" />
          <Input className="pl-7 py-1 text-xs" placeholder="search port, program, folder" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className="lg:hidden text-xs underline text-zinc-400" onClick={() => setShowSide(!showSide)}>
          {showSide ? 'hide overview' : 'overview & help'}
        </button>
      </div>

      {view?.inContainer && <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">Foundry runs in its Docker image: only ports inside its container show here, not the host's.</div>}
      {error && view && <div className="rounded-md border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-xs text-rose-200">The last scan failed: {error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">
          {!view && <Empty>{error ? 'Ports unavailable; retrying…' : 'Scanning…'}</Empty>}
          {view && !matching.length && <Empty>{all.length ? 'Nothing matches. Clear the search, pick all, or untick development only.' : 'No port is in use.'}</Empty>}
          {CATEGORIES.filter((c) => groups.some((g) => g.category === c.id)).map((c) => {
            const list = groups.filter((g) => g.category === c.id);
            return (
              <div key={c.id} className="space-y-2">
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-[10px] uppercase tracking-wide text-zinc-500">{c.heading}</span>
                  <span className="text-[10px] text-zinc-600">{list.reduce((n, g) => n + g.rows.length, 0)}</span>
                  <span className="flex-1 h-px bg-zinc-800/70" />
                </div>
                {list.map((g) => (
                  <GroupCard key={g.key} g={g} onRelease={ask} wanted={wanted} />
                ))}
              </div>
            );
          })}
        </div>
        <div className={cn(showSide ? 'block' : 'hidden lg:block')}>{view && <SidePanel view={view} scoped={scoped} />}</div>
      </div>
      {dialog}
    </div>
  );
}
