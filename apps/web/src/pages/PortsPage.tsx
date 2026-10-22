import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, CircleHelp, Container, Cpu, ExternalLink, Hammer, Lock, Plug, RefreshCw, Search, SearchX, Square, Waypoints, type LucideIcon } from 'lucide-react';
import { api, type PortRow, type PortsView } from '../api.ts';
import { BOARD_ROW, Board, Button, Card, ConfirmDialog, EmptyState, Input, Loading, PageHeader, Tabs, ago, buttonClass, chipClass, cn, code, useAffix } from '../ui.tsx';
import { categoryPlate, categorySquare, notice, statePlate } from './agents/marks.ts';
import { FIGURE_LABEL } from './agents/rows.tsx';
import { HelpLink } from './HelpPage.tsx';

type Category = PortRow['category'];
/**
 * each group of holders: its filter chip, its board's heading and icon, and a category colour (code(i)) on its icon, its
 * rows' plates and its squares in the filters and the overview, as before themes: Foundry green, Tailscale blue, Docker
 * teal. Other processes keep plain grey; an unknown holder is no signal and nothing is known of it: hollow.
 */
const CATEGORIES: { id: Category; label: string; heading: string; icon: LucideIcon; code: number | null }[] = [
  { id: 'foundry', label: 'foundry', heading: 'Foundry', icon: Hammer, code: 1 },
  { id: 'tailscale', label: 'tailscale', heading: 'Tailscale serve', icon: Waypoints, code: 0 },
  { id: 'docker', label: 'docker', heading: 'Docker', icon: Container, code: 5 },
  { id: 'process', label: 'processes', heading: 'Other processes', icon: Cpu, code: null },
  { id: 'unknown', label: 'unknown', heading: 'Unknown holders', icon: CircleHelp, code: null },
];
const BADGE_LABEL: Record<Category, string> = { foundry: 'Foundry', tailscale: 'Tailscale', docker: 'Docker', process: 'Process', unknown: 'Unknown' };
const codeOf = (c: Category) => CATEGORIES.find((x) => x.id === c)!.code;
/** a holder's square before its name in the filters and the overview */
const holderSquare = (c: Category) => (c === 'unknown' ? 'inline-block h-2 w-2 shrink-0 rounded-[2px] inset-ring-[1.5px] inset-ring-ink-faint' : categorySquare(codeOf(c)));
/** a holder's plate on its rows: in its colour, or hollow where it has none */
const holderPlate = (c: Category) => {
  const i = codeOf(c);
  return i == null ? statePlate('none') : categoryPlate(i);
};

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
        <b className="text-ink">{row?.label}</b>
        {row?.detail ? <span className="text-ink-soft"> · {row.detail}</span> : null}
      </p>
      {row?.release.confirm && <p>{row.release.confirm}</p>}
      {err && <p className="text-bad-ink">{err}</p>}
    </ConfirmDialog>
  );
  return { ask: (r) => setRow(r), dialog };
}

/**
 * One port, as a row of its holder's board (or `standalone`, in a list of its own): its number large, what holds it,
 * where it listens, and what can be done. `highlight` marks the port asked for (`?port=`) with the row's ink bar.
 * `odd` is no longer drawn: rows are divided by lines, as on every board.
 */
export function PortLine({ row, onRelease, highlight, standalone, plain }: { row: PortRow; onRelease: (row: PortRow) => void; odd?: boolean; highlight?: boolean; standalone?: boolean; plain?: boolean }) {
  const where = [plain ? null : row.addresses.length ? row.addresses.join(', ') : null, row.pid ? `pid ${row.pid}` : null].filter(Boolean).join(' · ');
  return (
    <li className={cn('py-2.5 grid grid-cols-[3.5rem_minmax(0,1fr)] md:grid-cols-[3.5rem_minmax(0,1fr)_10rem_13rem] gap-x-3 gap-y-1 items-center text-xs', standalone ? 'pl-1 pr-1 sm:pr-2' : cn(BOARD_ROW, 'pl-6 sm:pl-10 pr-4 md:pr-5'), highlight && 'bg-sunken shadow-[inset_4px_0_0_var(--color-ink)]')}>
      <span className="mono text-[15px] font-bold text-ink tabular-nums text-right">{row.port}</span>
      <div className="min-w-0">
        {/* plain: the card already names the program and its folder, so the row says where it listens */}
        <div className="text-[13px] font-semibold text-ink truncate" title={row.process ?? undefined}>{plain ? `listening on ${row.addresses.join(', ') || '—'}` : row.label}</div>
        {row.detail && !plain && <div className="mt-0.5 min-w-0 break-words text-xs text-ink-faint">{row.detail}</div>}
      </div>
      <div className="col-start-2 md:col-start-3 mono text-[11px] text-ink-faint truncate" title={where}>
        {where || <span className="text-line-strong">—</span>}
      </div>
      <div className="col-start-2 md:col-start-4 flex items-center gap-1.5 justify-start md:justify-end flex-wrap md:flex-nowrap whitespace-nowrap">
        {row.url && (
          <a href={row.url} target="_blank" rel="noreferrer" className={buttonClass('info', 'sm')} title={row.url}>
            <ExternalLink size={12} /> Open
          </a>
        )}
        {row.release.allowed ? (
          <Button size="sm" variant="danger" onClick={() => onRelease(row)} title={`Stop what holds port ${row.port} and release it`}>
            <Square size={11} /> Stop & release
          </Button>
        ) : (
          // where the button would be: why this one cannot be stopped here, kept to one short line
          <span className="inline-flex items-center gap-1 max-w-full rounded-md border border-line px-2 py-1 text-[11px] font-semibold text-ink-faint" title={`Cannot be stopped here: ${row.release.reason ?? 'not allowed'}`}>
            <Lock size={11} className="shrink-0" aria-hidden="true" />
            <span className="truncate">{row.release.reason ?? 'protected'}</span>
          </span>
        )}
      </div>
    </li>
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

const FOLDED_KEY = 'foundry.ports.folded';
function readFolded(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '{}');
  } catch {
    return {};
  }
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

/** one holder as a row of its board: fold, plate, name and its ports' count; open, its ports are listed under it, indented */
function GroupCard({ g, onRelease, wanted, open, onToggle }: { g: Group; onRelease: (r: PortRow) => void; wanted: number | null; open: boolean; onToggle: () => void }) {
  const releasable = g.rows.filter((r) => r.release.allowed).length;
  return (
    <li>
      <div className={cn(BOARD_ROW, 'px-4 md:px-5 py-3.5')}>
        <div className="flex items-center gap-2.5 min-w-0">
          {/* the fold button covers the row, as a goal's title link covers its row */}
          <button type="button" className="flex items-center gap-2.5 min-w-0 flex-1 text-left rounded after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-accent" onClick={onToggle} aria-expanded={open} title={open ? 'collapse' : 'expand'}>
            {open ? <ChevronDown size={14} className="text-ink-faint shrink-0" /> : <ChevronRight size={14} className="text-ink-faint shrink-0" />}
            <span className={cn(holderPlate(g.category), 'shrink-0')}>{BADGE_LABEL[g.category]}</span>
            <span className="min-w-0 text-[15px] font-bold leading-snug text-ink break-words line-clamp-2 sm:line-clamp-1 group-hover:underline decoration-2 underline-offset-[3px]">{g.title}</span>
          </button>
          {g.goalId && (
            // the padding gives a phone's thumb a 32px target; the negative margin keeps the row where it was
            <Link to={`/goals/${g.goalId}`} className="relative z-10 shrink-0 py-2 -my-2 px-1.5 -mx-1.5 text-xs font-semibold text-ink-soft hover:text-ink hover:underline underline-offset-2">
              Open goal →
            </Link>
          )}
          <span className="ml-auto shrink-0 text-xs text-ink-faint whitespace-nowrap">
            <span className="mono">{g.rows.length}</span> port{g.rows.length === 1 ? '' : 's'}
            {releasable > 0 && releasable < g.rows.length ? <> · <span className="mono">{releasable}</span> can be released</> : ''}
          </span>
        </div>
        {g.meta.length > 0 && <div className={cn('mt-1 text-xs text-ink-faint truncate pl-6', g.key.startsWith('pid:') && 'mono')} title={g.meta.join(' · ')}>{g.meta.join(' · ')}</div>}
      </div>
      {open && (
        <ul className="border-t border-line divide-y divide-line bg-sunken/60">
          {g.rows.map((r) => (
            <PortLine key={r.id} row={r} onRelease={onRelease} highlight={r.port === wanted} plain={g.key.startsWith('pid:')} />
          ))}
        </ul>
      )}
    </li>
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
      <div className="pt-4 text-xs">
        {tab === 'overview' && (
          <div className="space-y-4">
            {/* each group's ports as a figure: its name in tiny capitals over the count, and the total when a filter hides some */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              {CATEGORIES.map((c) => {
                const n = scoped.filter((r) => r.category === c.id).length;
                const total = view.rows.filter((r) => r.category === c.id).length;
                return (
                  <div key={c.id} className="min-w-0">
                    <dt className={cn(FIGURE_LABEL, 'flex items-center gap-1.5 leading-tight')}>
                      <i className={holderSquare(c.id)} aria-hidden="true" />
                      {c.heading}
                    </dt>
                    <dd className="mt-1 flex items-baseline gap-1.5 leading-none">
                      <span className="text-2xl font-bold mono text-ink tabular-nums">{n}</span>
                      {total !== n && <span className="mono text-xs text-ink-faint tabular-nums">of {total}</span>}
                    </dd>
                  </div>
                );
              })}
            </dl>
            <dl className="border-t border-line pt-3 grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2">
              <dt className={FIGURE_LABEL}>Foundry</dt>
              <dd className="mono text-sm font-bold text-ink text-right">{view.foundryPort}</dd>
              <dt className={FIGURE_LABEL}>Preview ports</dt>
              <dd className="mono text-sm font-bold text-ink text-right">
                {range.from}–{range.to} <span className="text-xs font-normal text-ink-faint">({inRange} in use)</span>
              </dd>
              <dt className={FIGURE_LABEL}>Tailscale serves</dt>
              <dd className="mono text-sm font-bold text-ink text-right">
                {serves.length} <span className="text-xs font-normal text-ink-faint">({serves.filter((r) => r.kind === 'serve-foundry').length} by Foundry)</span>
              </dd>
            </dl>
            <p className="text-xs text-ink-faint border-t border-line pt-3">
              In a terminal: <span className="mono text-ink-soft">foundry ports</span> (<span className="mono">--all</span>, <span className="mono">--json</span>).
            </p>
          </div>
        )}
        {tab === 'help' && (
          <ul className="space-y-3 text-[13px] leading-relaxed text-ink-soft list-none">
            <li>
              <b className="text-ink">tailscale serve</b> holds its port on the tailnet address: <span className="mono">lsof -i</span> without sudo shows nothing, yet a dev server cannot listen there. Foundry adds one for each preview's tailnet link.
            </li>
            <li>
              <b className="text-ink">A dev server left running</b> — a terminal you forgot, or one a task started — keeps its port until it stops.
            </li>
            <li>
              <b className="text-ink">Docker</b> holds every port a running container publishes, through Docker's own process.
            </li>
            <li>
              <b className="text-ink">macOS AirPlay Receiver</b> takes ports 5000 and 7000 (System Settings → General → AirDrop & Handoff).
            </li>
            <li>
              <b className="text-ink">Unknown holder</b>: a system process or another user's; <span className="mono">sudo lsof -nP -iTCP:&lt;port&gt; -sTCP:LISTEN</span> names it.
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
  const affix = useAffix<HTMLDivElement>();
  const all = view?.rows ?? [];
  const scoped = all.filter((r) => !devOnly || r.relevant || r.port === wanted);
  const matching = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return scoped.filter((r) => (scope === 'all' || r.category === scope) && (!needle || String(r.port).includes(needle) || `${r.label} ${r.detail ?? ''} ${r.process ?? ''} ${r.container ?? ''} ${r.cwd ?? ''}`.toLowerCase().includes(needle)));
  }, [scoped, scope, q]);
  const groups = groupsOf(matching);
  // cards start open; one the person folds stays folded (this browser), and a search or a wanted port opens them all
  const [folded, setFolded] = useState<Record<string, boolean>>(readFolded);
  const isOpen = (g: Group) => !!q.trim() || !folded[g.key];
  const toggle = (g: Group) =>
    setFolded((f) => {
      const next = { ...f, [g.key]: isOpen(g) };
      try {
        localStorage.setItem(FOLDED_KEY, JSON.stringify(next));
      } catch {
        /* private mode */
      }
      return next;
    });
  const setAll = (fold: boolean) =>
    setFolded(() => {
      const next = fold ? Object.fromEntries(groups.map((g) => [g.key, true])) : {};
      try {
        localStorage.setItem(FOLDED_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  const releasable = all.filter((r) => r.release.allowed).length;
  const count = (c: Category | 'all') => scoped.filter((r) => c === 'all' || r.category === c).length;

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 pt-6 md:pt-9 pb-16 space-y-4">
      <PageHeader
        title="Ports"
        help={<HelpLink to="ports" label="Ports (new tab)" />}
        summary={
          <>
            {view && (
              <span className="block">
                <span className="mono">{all.length}</span> in use · <span className="mono">{all.filter((r) => r.relevant).length}</span> for development · <span className={cn(releasable > 0 && 'font-semibold text-ink-soft')}><span className="mono">{releasable}</span> can be released</span>
              </span>
            )}
            <span className="block mt-1">Ports in use on the computer Foundry runs on, grouped by what holds them. Stop and release what Foundry, tailscale serve, Docker or your own programs hold; every stop asks first and says what it does.</span>
          </>
        }
        actions={
          <>
            {view && <span className="text-xs text-ink-faint">scanned <span className="mono">{ago(view.scannedAt)}</span> · every 5 s</span>}
            <Button size="sm" disabled={loading} onClick={() => void refresh()}>
              <RefreshCw size={13} className={cn(loading && 'animate-spin')} /> Refresh
            </Button>
          </>
        }
      />

      <div className="flex items-center gap-2 flex-wrap">
        {(['all', ...CATEGORIES.map((c) => c.id)] as const).map((c) => (
          <button key={c} onClick={() => setScope(c)} className={cn(chipClass(scope === c), 'inline-flex items-center gap-1.5')}>
            {c !== 'all' && <i className={holderSquare(c)} aria-hidden="true" />}
            {c === 'all' ? 'all' : CATEGORIES.find((x) => x.id === c)!.label} <span className="mono opacity-60">{count(c)}</span>
          </button>
        ))}
        <label className="flex items-center gap-1.5 text-xs font-semibold text-ink-soft" title="Foundry's, Tailscale's and Docker's ports, the usual dev ports, the preview range and programs in your projects">
          <input type="checkbox" checked={devOnly} onChange={(e) => setDevOnly(e.target.checked)} /> development only
        </label>
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search size={13} className="absolute left-2 top-2 text-ink-faint" />
          <Input className="pl-7 py-1 text-xs" placeholder="search port, program, folder" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {groups.length > 1 && (
          <span className="flex items-center gap-2 text-xs text-ink-faint">
            <button type="button" className="hover:text-ink" onClick={() => setAll(false)}>
              expand all
            </button>
            <span className="text-line-strong">·</span>
            <button type="button" className="hover:text-ink" onClick={() => setAll(true)}>
              collapse all
            </button>
          </span>
        )}
        <button className="lg:hidden text-xs font-semibold underline underline-offset-2 text-ink-soft hover:text-ink" onClick={() => setShowSide(!showSide)}>
          {showSide ? 'hide overview' : 'overview & help'}
        </button>
      </div>

      {/* in its Docker image Foundry sees only its own container: information, not a warning */}
      {view?.inContainer && <div className={cn(notice('work'), 'px-3 py-2 text-xs text-work-ink')}>Foundry runs in its Docker image: only ports inside its container show here, not the host's.</div>}
      {error && view && <div className={cn(notice('bad'), 'px-3 py-2 text-xs text-bad-ink')}>The last scan failed: {error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 min-w-0">
          {!view && <Loading label={error ? 'Ports unavailable; retrying…' : 'Scanning the ports…'} />}
          {view && !matching.length && (all.length ? (
            <EmptyState icon={SearchX} title="Nothing matches">
              Clear the search, pick all, or untick development only.
            </EmptyState>
          ) : (
            <EmptyState icon={Plug} title="No port is in use">
              A dev server, a container or a preview shows here once it listens on a port of this computer.
            </EmptyState>
          ))}
          {CATEGORIES.filter((c) => groups.some((g) => g.category === c.id)).map((c) => {
            const list = groups.filter((g) => g.category === c.id);
            return (
              <Board key={c.id} id={`ports-${c.id}`} icon={<c.icon size={14} strokeWidth={2.25} className={c.code == null ? undefined : code(c.code).ink} aria-hidden="true" />} title={c.heading} count={list.reduce((n, g) => n + g.rows.length, 0)}>
                {list.map((g) => (
                  <GroupCard key={g.key} g={g} onRelease={ask} wanted={wanted} open={isOpen(g)} onToggle={() => toggle(g)} />
                ))}
              </Board>
            );
          })}
        </div>
        <div ref={affix.ref} className={cn(showSide ? 'block' : 'hidden lg:block', affix.className)}>{view && <SidePanel view={view} scoped={scoped} />}</div>
      </div>
      {dialog}
    </div>
  );
}
