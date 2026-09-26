import type { EngineEvent } from '@foundry/core/browser';
import type { SkillScope, SkillSourceRow, SkillTier, SkillsOverview, SkillsUpdateReport, TrashEntry } from '@foundry/engine/skills-types';
import { RefreshCw, Search, Trash2 } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { api } from '../../api.ts';
import { MarkdownPanel } from '../../components/Markdown.tsx';
import { Button, ConfirmDialog, Empty, Input, Modal, ago, cn } from '../../ui.tsx';
import { OpsDock } from './OpsDock.tsx';
import { startOp, useRunningOp, useSkillOps } from './ops.ts';
import { SessionLine, SidePanelTabs } from './SidePanels.tsx';
import { SourceGroup } from './SourceGroup.tsx';

type Report = SkillsUpdateReport & { updating: string | null; refreshing: boolean };
type View = { name: string; dir: string; invoke: string; skillMd: string | null; files: { path: string; size: number }[] };

/** Sources of the same kind sit together, engine-managed first, loose copies last. */
const MANAGER_ORDER = ['foundry', 'plugin', 'agents-cli', 'gstack', 'hand', 'project'] as const;
const MANAGER_HEADING: Record<(typeof MANAGER_ORDER)[number], string> = {
  foundry: 'Managed by Foundry',
  plugin: 'Claude plugins',
  'agents-cli': 'npx skills',
  gstack: 'gstack',
  hand: 'Hand-installed',
  project: 'Project skills',
};

/**
 * Skills, grouped by where they come from, with update status per source and per skill,
 * one-click updaters, adoption of loose copies, shadow-copy cleanup, bulk uninstall and SKILL.md viewing.
 */
export function SkillsPage() {
  const [overview, setOverview] = useState<SkillsOverview | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [trash, setTrash] = useState<TrashEntry[]>([]);
  const [runs, setRuns] = useState<(EngineEvent & { seq: number })[]>([]);
  const [scope, setScope] = useState<SkillScope | 'all'>('all');
  const [q, setQ] = useState('');
  const [onlyOutdated, setOnlyOutdated] = useState(false);
  /** quick actions that are not operations (check for updates, trash shadows, restore): what each one is working on */
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmNames, setConfirmNames] = useState<string[] | null>(null);
  const [view, setView] = useState<View | null | 'loading'>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = async (refresh = false) => {
    try {
      const [o, r, t, h] = await Promise.all([api.skills(), api.skillsUpdates(refresh), api.trash(), api.updateRuns().catch(() => [])]);
      setOverview(o);
      setReport(r);
      setTrash(t);
      setRuns(h);
      // drop selections that no longer exist
      setSelected((s) => new Set([...s].filter((n) => o.installed.some((x) => x.name === n && x.scope === 'user'))));
      return r;
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message });
      return null;
    }
  };
  const watch = () => {
    if (poll.current) return;
    poll.current = setInterval(async () => {
      const r = await api.skillsUpdates().catch(() => null);
      if (r) setReport(r);
      if (r && !r.refreshing && !r.updating) {
        clearInterval(poll.current!);
        poll.current = null;
        void load();
      }
    }, 2500);
  };
  useEffect(() => {
    void load().then((r) => r && (r.refreshing || r.updating) && watch());
    return () => {
      if (poll.current) clearInterval(poll.current);
    };
  }, []);
  // every operation that ends (here, after a reload, or in another tab) refreshes the page
  const finished = useSkillOps((s) => s.finished);
  const firstFinished = useRef(finished);
  useEffect(() => {
    if (finished !== firstFinished.current) void load();
  }, [finished]);
  const runningOp = useRunningOp();
  const showOp = useSkillOps((s) => s.show);

  /** A quick action (not an operation): banner feedback, and only its own key is busy meanwhile. */
  const quick = async (key: string, pendingText: string, fn: () => Promise<string | null>) => {
    setPending((p) => new Set(p).add(key));
    setMsg({ kind: 'info', text: pendingText });
    try {
      const text = await fn();
      setMsg(text ? { kind: 'ok', text } : null);
    } catch (e: any) {
      setMsg({ kind: 'err', text: e.message });
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(key);
        return n;
      });
      void load();
    }
  };

  const checkUpdates = () =>
    quick('refresh', 'Checking upstream repositories…', async () => {
      setReport(await api.skillsUpdates(true));
      watch();
      return null;
    });
  // operations: each opens its own tab in the operations dock; the server decides what may run together (one source update at a time)
  const updateSource = (id: string, label: string, names?: string[]) =>
    startOp({
      kind: 'update',
      label: `Update ${label}${names?.length ? ` (${names.join(', ')})` : ''}`,
      targets: [id, ...(names ?? [])],
      call: async (opId) => {
        const r = await api.updateSource(id, names, opId);
        setReport((x) => (x ? { ...x, updating: id } : x));
        watch();
        return r;
      },
    });
  const adopt = (names: string[]) => startOp({ kind: 'adopt', label: `Adopt ${names.length === 1 ? names[0] : `${names.length} skills`}`, targets: names, call: (opId) => api.adoptSkills(names, opId) });
  // a plugin's skills go together: the CLI's own plugin uninstall
  const uninstallPlugin = (sourceId: string) => startOp({ kind: 'uninstall', label: `Uninstall plugin ${sourceId.slice('plugin:'.length)}`, targets: [sourceId], call: (opId) => api.uninstallPlugin(sourceId, opId) });
  const trashShadows = (names: string[]) =>
    quick('shadows', `Moving ${names.length} shadow cop${names.length === 1 ? 'y' : 'ies'} to the trash…`, async () => {
      const r = await api.cleanupShadows(names);
      return `${r.trashed.length} moved to trash${r.skipped.length ? `; skipped ${r.skipped.map((s) => `${s.name} (${s.reason})`).join(', ')}` : ''}`;
    });
  const uninstall = (names: string[]) => {
    setSelected((s) => new Set([...s].filter((n) => !names.includes(n))));
    return startOp({ kind: 'uninstall', label: `Uninstall ${names.length === 1 ? names[0] : `${names.length} skills`}`, targets: names, call: (opId) => api.uninstallMany(names, true, opId) });
  };
  const install = (id: string, force: boolean) => startOp({ kind: 'install', label: `${force ? 'Replace' : 'Install'} ${id}`, targets: [id], call: (opId) => api.installSkill(id, force, opId) });
  const installTier = (tiers: SkillTier[]) => startOp({ kind: 'install-tier', label: `Install ${tiers.join(' + ')}`, targets: ['tier'], call: (opId) => api.installTier(tiers, opId) });
  const installTool = (id: string) => startOp({ kind: 'tool-install', label: `Install ${id}`, targets: [id], call: (opId) => api.installTool(id, opId) });
  const restore = (name: string, path: string) => quick(`restore:${path}`, `Restoring ${name}…`, async () => `${name} restored to ${(await api.restoreSkill(name, path)).path}`);
  const openView = async (row: SkillSourceRow) => {
    setView('loading');
    try {
      setView(await api.viewSkill(row.dir));
    } catch (e: any) {
      setView(null);
      setMsg({ kind: 'err', text: e.message });
    }
  };
  const select = (names: string[], on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      for (const x of names) on ? n.add(x) : n.delete(x);
      return n;
    });

  if (!overview || !report) return <Empty>{msg?.text ?? 'Scanning skills…'}</Empty>;

  const needle = q.trim().toLowerCase();
  const filter = (r: SkillSourceRow) => (scope === 'all' || r.scope === scope) && (!onlyOutdated || r.status === 'outdated' || r.status === 'modified' || !!r.shadowedBy) && (!needle || r.name.includes(needle) || r.invoke.includes(needle) || r.description.toLowerCase().includes(needle));
  const total = overview.installed.length;
  const updates = report.sources.filter((s) => s.updateAvailable === true).length;
  const outdatedSkills = report.sources.flatMap((s) => s.skills).filter((r) => r.status === 'outdated').length;
  const counts = { all: total, user: overview.installed.filter((r) => r.scope === 'user').length, plugin: overview.installed.filter((r) => r.scope === 'plugin').length, project: overview.installed.filter((r) => r.scope === 'project').length };
  /** a row is busy while an operation on it runs; the link opens that operation's tab */
  const opLink = (key: string): ReactNode => {
    const t = runningOp(key);
    return t ? (
      <button type="button" className="inline-flex items-center gap-1 text-[11px] text-sky-300 hover:text-sky-200 underline decoration-dotted" onClick={() => showOp(t.id)} title={`${t.label} — show its log`}>
        <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" /> running…
      </button>
    ) : null;
  };

  return (
    <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-lg font-semibold">Skills</h1>
        <span className="text-xs text-zinc-500">
          {total} installed · <span className={cn(updates ? 'text-amber-300' : 'text-zinc-400')}>{updates} source{updates === 1 ? '' : 's'} with updates</span> ({outdatedSkills} skills)
          {report.shadowed.length > 0 && (
            <>
              {' '}
              · <span className="text-amber-300">{report.shadowed.length} stale copies shadow plugin skills</span>
            </>
          )}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-zinc-500">{report.refreshing ? 'checking upstream…' : `checked ${ago(report.checkedAt)}${report.stale ? ' (stale)' : ''}`}</span>
          <Button size="sm" disabled={pending.has('refresh') || report.refreshing} onClick={checkUpdates}>
            <RefreshCw size={13} className={cn(report.refreshing && 'animate-spin')} /> Check for updates
          </Button>
        </div>
      </div>
      <p className="text-xs text-zinc-500 -mt-2">
        Grouped by where each skill comes from. Updates run the source's own tool (npx skills, claude plugin) or Foundry's installer; every run is recorded in History. Uninstall never deletes — copies go to the Trash tab.
      </p>
      <div className="-mt-1">
        <SessionLine view={overview.lastSession} />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {(['all', 'user', 'plugin', 'project'] as const).map((s) => (
          <button key={s} onClick={() => setScope(s)} className={cn('rounded-md border px-2 py-1 text-xs', scope === s ? 'border-emerald-500 text-emerald-300' : 'border-zinc-800 text-zinc-400')}>
            {s} <span className="text-zinc-600">{counts[s]}</span>
          </button>
        ))}
        <label className="flex items-center gap-1 text-xs text-zinc-400">
          <input type="checkbox" checked={onlyOutdated} onChange={(e) => setOnlyOutdated(e.target.checked)} /> needs attention
        </label>
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search size={13} className="absolute left-2 top-2 text-zinc-500" />
          <Input className="pl-7 py-1 text-xs" placeholder="search" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className="lg:hidden text-xs underline text-zinc-400" onClick={() => setShowCatalog(!showCatalog)}>
          {showCatalog ? 'hide catalog' : 'catalog & history'}
        </button>
      </div>

      {msg && <div className={cn('rounded-md border px-3 py-2 text-xs', msg.kind === 'ok' ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-200' : msg.kind === 'info' ? 'border-sky-500/40 bg-sky-500/5 text-sky-200' : 'border-rose-500/40 bg-rose-500/5 text-rose-200')}>{msg.text}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">
          {MANAGER_ORDER.filter((m) => report.sources.some((s) => s.manager === m && s.skills.some(filter))).map((m) => (
            <div key={m} className="space-y-2">
              <div className="flex items-center gap-2 pt-1">
                <span className="text-[10px] uppercase tracking-wide text-zinc-500">{MANAGER_HEADING[m]}</span>
                <span className="text-[10px] text-zinc-600">{report.sources.filter((s) => s.manager === m).reduce((n, s) => n + s.skills.length, 0)}</span>
                <span className="flex-1 h-px bg-zinc-800/70" />
              </div>
              {report.sources
                .filter((s) => s.manager === m)
                .map((s) => (
                  <SourceGroup key={s.id} s={s} busy={pending.has('shadows') || s.skills.some((r) => runningOp(r.name))} updating={report.updating === s.id || !!runningOp(s.id)} running={opLink(s.id) ?? s.skills.map((r) => opLink(r.name)).find(Boolean) ?? null} filter={filter} a={{ onUpdate: (names) => void updateSource(s.id, s.label, names), onAdopt: (names) => void adopt(names), onTrashShadows: trashShadows, onUninstallPlugin: (id) => void uninstallPlugin(id), onUninstall: (names) => setConfirmNames(names), onView: openView, selected, onSelect: select }} />
                ))}
            </div>
          ))}
          {report.sources.every((s) => !s.skills.some(filter)) && <Empty>Nothing matches.</Empty>}
        </div>
        <div className={cn(showCatalog ? 'block' : 'hidden lg:block')}>
          <SidePanelTabs catalog={overview.catalog} trash={trash} runs={runs} busy={(key) => pending.has(key) || !!runningOp(key)} opLink={opLink} onInstall={(id, force) => void install(id, force)} onInstallTier={(tiers) => void installTier(tiers)} onInstallTool={(id) => void installTool(id)} onRestore={restore} />
        </div>
      </div>

      {/* docked at the bottom: the operations (one tab each), and under them the bulk action bar */}
      <BottomDock>
        <OpsDock />
        {selected.size > 0 && (
          <div className="border-t border-zinc-800 bg-zinc-950/95 backdrop-blur px-4 py-2.5 flex items-center gap-3 flex-wrap">
            <span className="text-xs text-zinc-300">
              {selected.size} selected: <span className="text-zinc-500">{[...selected].slice(0, 6).join(', ')}{selected.size > 6 ? '…' : ''}</span>
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                clear
              </Button>
              <Button size="sm" variant="danger" onClick={() => setConfirmNames([...selected])}>
                <Trash2 size={13} /> Uninstall {selected.size}
              </Button>
            </div>
          </div>
        )}
      </BottomDock>

      <ConfirmDialog
        open={confirmNames !== null}
        title={confirmNames && confirmNames.length === 1 ? `Uninstall ${confirmNames[0]}?` : `Uninstall ${confirmNames?.length ?? 0} skills?`}
        confirmLabel="Move to trash"
        danger
        onClose={() => setConfirmNames(null)}
        onConfirm={() => {
          const names = confirmNames ?? [];
          setConfirmNames(null);
          void uninstall(names);
        }}
      >
        <p>The skill director{(confirmNames?.length ?? 0) === 1 ? 'y is' : 'ies are'} moved to <span className="mono">data/skills-trash</span> (restorable from the Trash panel). Symlinked skills lose only the link; plugin skills cannot be removed here.</p>
        {confirmNames && confirmNames.length > 1 && <div className="mono text-[11px] text-zinc-400 max-h-32 overflow-auto">{confirmNames.join('\n')}</div>}
      </ConfirmDialog>

      <Modal open={view !== null} title={view && view !== 'loading' ? <span className="mono">{view.invoke}</span> : 'Loading…'} onClose={() => setView(null)} wide>
        {view === 'loading' ? (
          <div className="text-xs text-zinc-500">reading SKILL.md…</div>
        ) : view ? (
          <div className="space-y-3">
            <div className="text-[11px] text-zinc-500 mono break-all">{view.dir}</div>
            {view.skillMd ? (
              (() => {
                const m = view.skillMd.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
                const fm = m ? m[1]! : null;
                const body = m ? view.skillMd.slice(m[0].length) : view.skillMd;
                return (
                  <>
                    {fm && (
                      <div className="rounded-md border border-zinc-800 bg-zinc-900/60 p-2 text-[11px] space-y-0.5">
                        {fm.split('\n').map((line, i) => {
                          const k = line.match(/^([\w-]+):\s*(.*)$/);
                          return k ? (
                            <div key={i} className="flex gap-2">
                              <span className="text-zinc-500 w-28 shrink-0">{k[1]}</span>
                              <span className="text-zinc-200 break-words min-w-0">{k[2]}</span>
                            </div>
                          ) : (
                            <div key={i} className="text-zinc-400 pl-30 break-words">{line}</div>
                          );
                        })}
                      </div>
                    )}
                    <MarkdownPanel title="SKILL.md" source={body} maxHeight={520} />
                  </>
                );
              })()
            ) : (
              <div className="text-xs text-amber-300">no SKILL.md in this directory</div>
            )}
            {view.files.length > 1 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-zinc-400">{view.files.length} files in this skill</summary>
                <div className="mono text-[11px] text-zinc-400 mt-1 space-y-0.5 max-h-40 overflow-auto">
                  {view.files.map((f) => (
                    <div key={f.path} className="flex gap-3">
                      <span className="truncate">{f.path}</span>
                      <span className="ml-auto text-zinc-600 shrink-0">{f.size < 1024 ? `${f.size} B` : `${(f.size / 1024).toFixed(0)} KB`}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

/** Fixed to the bottom of the window; an in-flow spacer of the same height keeps the page's end reachable above it. */
function BottomDock({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <>
      <div style={{ height: h }} aria-hidden />
      <div ref={ref} className="fixed bottom-0 left-0 right-0 z-30">
        {children}
      </div>
    </>
  );
}
