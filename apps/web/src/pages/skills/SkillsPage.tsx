import type { EngineEvent } from '@foundry/core/browser';
import { PROVIDER_LABEL } from '@foundry/core/browser';
import type { InstalledSkill, SkillScope, SkillSource, SkillSourceRow, SkillTier, SkillUsage, SkillsOverview, SkillsUpdateReport, SuiteReleaseView, TrashEntry } from '@foundry/engine/skills-types';
import { Blocks, FolderGit2, PackageCheck, Plug, RefreshCw, Search, SearchX, SquareTerminal, Trash2, Wrench, type LucideIcon } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { apiForProvider, type AgentProvider } from '../../api.ts';
import { MarkdownPanel } from '../../components/Markdown.tsx';
import { Board, Button, ConfirmDialog, Empty, EmptyState, Input, Modal, ago, chipClass, cn, code, useAffix, useFolds } from '../../ui.tsx';
import { categorySquare, notice } from '../agents/marks.ts';
import { OpsDock } from './OpsDock.tsx';
import { startOp, useRunningOp, useSkillOps } from './ops.ts';
import { SessionLine, SidePanelTabs } from './SidePanels.tsx';
import { MANAGER_CODE, SourceGroup, lastGoals } from './SourceGroup.tsx';
import { SuiteReleases } from './SuiteReleases.tsx';

type Report = SkillsUpdateReport & { updating: string | null; refreshing: boolean };
type View = { name: string; dir: string; invoke: string; skillMd: string | null; files: { path: string; size: number }[] };

/** Sources of the same kind sit together, engine-managed first, loose copies last. */
const MANAGER_ORDER = ['foundry', 'plugin', 'agents-cli', 'hand', 'project'] as const;
const MANAGER_HEADING: Record<(typeof MANAGER_ORDER)[number], string> = {
  foundry: 'Managed by Foundry',
  plugin: 'Claude plugins',
  'agents-cli': 'npx skills',
  hand: 'Hand-installed',
  project: 'Project skills',
};
/** where a skill lives, its filter's square in the colour of the kit's plates for it: user blue, plugin violet, project fuchsia */
const SCOPE_CODE: Record<SkillScope, number> = { user: 0, plugin: 2, project: 6 };
/** each kind of source's mark beside its board's name, in the kind's category colour (as its rows' plates) */
const MANAGER_ICON: Record<(typeof MANAGER_ORDER)[number], LucideIcon> = { foundry: PackageCheck, plugin: Plug, 'agents-cli': SquareTerminal, hand: Wrench, project: FolderGit2 };

/** The rows the list shows: the scope buttons, the search, `needs attention` and `unused only` all apply. */
export function rowFilter({ scope, q, onlyOutdated, onlyUnused, usage }: { scope: SkillScope | 'all'; q: string; onlyOutdated: boolean; onlyUnused: boolean; usage: Map<string, SkillUsage | null> }) {
  const needle = q.trim().toLowerCase();
  return (r: SkillSourceRow) => (scope === 'all' || r.scope === scope) && (!onlyOutdated || r.status === 'outdated' || r.status === 'modified' || !!r.shadowedBy) && (!onlyUnused || usage.get(r.dir)?.unused === true) && (!needle || r.name.includes(needle) || r.invoke.includes(needle) || r.description.toLowerCase().includes(needle));
}

/** How many of the measured skills (user and plugin; project rows carry no usage) no session of the window invoked. */
export function usageNote(installed: Pick<InstalledSkill, 'usage'>[], window: SkillsOverview['usageWindow']): string | null {
  if (!window) return null;
  if (!window.goals) return 'No goals yet: skill usage is unknown';
  const measured = installed.filter((r) => r.usage);
  const unused = measured.filter((r) => r.usage?.unused).length;
  return `${unused} of ${measured.length} installed skills ${unused === 1 ? 'was' : 'were'} never used in ${lastGoals(window.goals)}`;
}

/**
 * Skills, grouped by where they come from, with update status per source and per skill,
 * one-click updaters, adoption of loose copies, shadow-copy cleanup, bulk uninstall and SKILL.md viewing.
 */
export function SkillsPage({ provider = 'claude' }: { provider?: AgentProvider }) {
  const api = apiForProvider(provider);
  const backend = PROVIDER_LABEL[provider];
  const startProviderOp = (operation: Parameters<typeof startOp>[0]) => startOp({ ...operation, label: `${backend} · ${operation.label}`, targets: operation.targets.map((target) => `${provider}:${target}`) });
  const [overview, setOverview] = useState<SkillsOverview | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [releases, setReleases] = useState<SuiteReleaseView[]>([]);
  const [trash, setTrash] = useState<TrashEntry[]>([]);
  const [runs, setRuns] = useState<(EngineEvent & { seq: number })[]>([]);
  const [scope, setScope] = useState<SkillScope | 'all'>('all');
  const [q, setQ] = useState('');
  const [onlyOutdated, setOnlyOutdated] = useState(false);
  const [onlyUnused, setOnlyUnused] = useState(false);
  // every group starts closed, the boards and the sources on them; a search or a filter that picks skills opens each one with a match
  const expand = !!q.trim() || onlyOutdated || onlyUnused;
  const folds = useFolds(expand);
  /** quick actions that are not operations (check for updates, trash shadows, restore): what each one is working on */
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);
  /** the catalog stays in view beside the list while it fits under the top bar */
  const affix = useAffix<HTMLDivElement>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmNames, setConfirmNames] = useState<string[] | null>(null);
  const [view, setView] = useState<View | null | 'loading'>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const alive = useRef(true);

  const load = async (refresh = false) => {
    if (!alive.current) return null;
    // the suites' releases come from upstream tags: they arrive on their own, never holding the page
    void api.suiteReleases(refresh).then(
      (r) => alive.current && setReleases(r.releases),
      () => {},
    );
    try {
      const [o, r, t, h] = await Promise.all([api.skills(), api.skillsUpdates(refresh), api.trash(), api.updateRuns().catch(() => [])]);
      if (!alive.current) return null;
      setOverview(o);
      setReport(r);
      setTrash(t);
      setRuns(h);
      // drop selections that no longer exist
      setSelected((s) => new Set([...s].filter((n) => o.installed.some((x) => x.name === n && x.scope === 'user'))));
      return r;
    } catch (e: any) {
      if (alive.current) setMsg({ kind: 'err', text: e.message });
      return null;
    }
  };
  const watch = () => {
    if (!alive.current || poll.current) return;
    poll.current = setInterval(async () => {
      const r = await api.skillsUpdates().catch(() => null);
      if (!alive.current) return;
      if (r) setReport(r);
      if (r && !r.refreshing && !r.updating) {
        clearInterval(poll.current!);
        poll.current = null;
        void load();
      }
    }, 2500);
  };
  useEffect(() => {
    alive.current = true;
    void load().then((r) => r && (r.refreshing || r.updating) && watch());
    return () => {
      alive.current = false;
      if (poll.current) clearInterval(poll.current);
      poll.current = null;
    };
  }, []);
  // every operation that ends (here, after a reload, or in another tab) refreshes the page
  const finished = useSkillOps((s) => s.finished);
  const firstFinished = useRef(finished);
  useEffect(() => {
    if (finished !== firstFinished.current) void load();
  }, [finished]);
  const running = useRunningOp();
  const runningOp = (target: string) => running(`${provider}:${target}`);
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
      void api.suiteReleases(true).then((r) => alive.current && setReleases(r.releases), () => {});
      setReport(await api.skillsUpdates(true));
      watch();
      return null;
    });
  // operations: each opens its own tab in the operations dock; the server decides what may run together (one source update at a time)
  const updateSource = (id: string, label: string, names?: string[]) =>
    startProviderOp({
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
  // a workflow suite to another release: its own operation, after the forecast the row showed
  const moveRelease = (v: SuiteReleaseView, to: string) => startProviderOp({ kind: 'update', label: to === v.ref ? `Re-sync ${v.label} at ${to}` : `Move ${v.label} to ${to}`, targets: [`release:${v.id}`], call: (opId) => api.moveRelease(v.id, to, opId) });
  const adopt = (names: string[]) => startProviderOp({ kind: 'adopt', label: `Adopt ${names.length === 1 ? names[0] : `${names.length} skills`}`, targets: names, call: (opId) => api.adoptSkills(names, opId) });
  // a plugin's skills go together: the CLI's own plugin uninstall
  const uninstallPlugin = (sourceId: string) => startProviderOp({ kind: 'uninstall', label: `Uninstall plugin ${sourceId.slice('plugin:'.length)}`, targets: [sourceId], call: (opId) => api.uninstallPlugin(sourceId, opId) });
  const trashShadows = (names: string[]) =>
    quick('shadows', `Moving ${names.length} shadow cop${names.length === 1 ? 'y' : 'ies'} to the trash…`, async () => {
      const r = await api.cleanupShadows(names);
      return `${r.trashed.length} moved to trash${r.skipped.length ? `; skipped ${r.skipped.map((s) => `${s.name} (${s.reason})`).join(', ')}` : ''}`;
    });
  const uninstall = (names: string[]) => {
    setSelected((s) => new Set([...s].filter((n) => !names.includes(n))));
    return startProviderOp({ kind: 'uninstall', label: `Uninstall ${names.length === 1 ? names[0] : `${names.length} skills`}`, targets: names, call: (opId) => api.uninstallMany(names, true, opId) });
  };
  const install = (id: string, force: boolean) => startProviderOp({ kind: 'install', label: `${force ? 'Replace' : 'Install'} ${id}`, targets: [id], call: (opId) => api.installSkill(id, force, opId) });
  const installTier = (tiers: SkillTier[]) => startProviderOp({ kind: 'install-tier', label: `Install ${tiers.join(' + ')}`, targets: ['tier'], call: (opId) => api.installTier(tiers, opId) });
  const installTool = (id: string) => startProviderOp({ kind: 'tool-install', label: `Install ${id}`, targets: [id], call: (opId) => api.installTool(id, opId) });
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

  // the rows render from the update report; its rows and the overview's share `dir`
  const usageByDir = new Map<string, SkillUsage | null>(overview.installed.map((r) => [r.dir, r.usage ?? null]));
  const filter = rowFilter({ scope, q, onlyOutdated, onlyUnused, usage: usageByDir });
  const note = usageNote(overview.installed, overview.usageWindow);
  const total = overview.installed.length;
  const updates = report.sources.filter((s) => s.updateAvailable === true).length;
  /** sources of one kind with an update waiting: said on its board's heading, which stays in view when the board is closed */
  const updatesIn = (m: SkillSource['manager']) => report.sources.filter((s) => s.manager === m && s.updateAvailable === true).length;
  const outdatedSkills = report.sources.flatMap((s) => s.skills).filter((r) => r.status === 'outdated').length;
  const counts = { all: total, user: overview.installed.filter((r) => r.scope === 'user').length, plugin: overview.installed.filter((r) => r.scope === 'plugin').length, project: overview.installed.filter((r) => r.scope === 'project').length };
  /** a row is busy while an operation on it runs; the link opens that operation's tab */
  const opLink = (key: string): ReactNode => {
    const t = runningOp(key);
    return t ? (
      <button type="button" className="inline-flex items-center gap-1 text-[11px] font-semibold text-work-ink underline decoration-dotted hover:decoration-solid" onClick={() => showOp(t.id)} title={`${t.label} — show its log`}>
        <span className="h-1.5 w-1.5 rounded-full bg-work animate-pulse" /> running…
      </button>
    ) : null;
  };

  return (
    <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6 space-y-4">
      {/* the tab's own head, in the capitals of a section; what needs your attention (updates, stale copies) in yellow */}
      <div className="flex items-center gap-x-3 gap-y-2 flex-wrap">
        <h2 className="flex items-center gap-2.5 text-[12.5px] font-extrabold caps text-ink">
          <Blocks size={14} aria-hidden="true" />
          Skills
        </h2>
        <span className="text-[13px] font-semibold text-ink-faint">
          {total} installed · <span className={cn(updates ? 'text-you-ink' : 'text-ink-soft')}>{updates} source{updates === 1 ? '' : 's'} with updates</span> ({outdatedSkills} skills)
          {report.shadowed.length > 0 && (
            <>
              {' '}
              · <span className="text-you-ink">{report.shadowed.length} stale copies shadow plugin skills</span>
            </>
          )}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-ink-faint">{report.refreshing ? 'checking upstream…' : `checked ${ago(report.checkedAt)}${report.stale ? ' (stale)' : ''}`}</span>
          <Button size="sm" disabled={pending.has('refresh') || report.refreshing} onClick={checkUpdates}>
            <RefreshCw size={13} className={cn(report.refreshing && 'animate-spin')} /> Check for updates
          </Button>
        </div>
      </div>
      <p className="text-[13px] leading-relaxed text-ink-faint max-w-[80ch] -mt-1">
        {provider === 'agy' ? "Antigravity reads skills only from a goal's workspace: Foundry installs them in the shared ~/.agents/skills folder (Codex and the skills CLI read it too) and links the installed ones into each goal's workspace. Plugins and their servers are not available for Antigravity. Uninstall never deletes — copies go to the Trash tab." : provider === 'codex' ? 'Codex skills are grouped by their native source. Foundry manages supported standalone installs and updates; manage native Codex plugins in the Plugins tab. Skills in the shared ~/.agents/skills folder can be uninstalled here (to the trash), except one Claude Code reaches through a link: remove that one on the Claude Code side.' : "Grouped by where each skill comes from. Updates run the source's own tool (npx skills, claude plugin) or Foundry's installer; every run is recorded in History. Uninstall never deletes — copies go to the Trash tab."}
      </p>
      <div className="-mt-1">
        {provider !== 'claude' ? (
          <p className="text-xs text-ink-faint">Skill invocation telemetry is unavailable for {backend}. Installed or listed skills do not prove a session used them; review the work and tests.</p>
        ) : (
          <>
            <SessionLine view={overview.lastSession} />
            {note && <p className="text-xs text-ink-faint">{note}</p>}
          </>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {(['all', 'user', 'plugin', 'project'] as const).map((s) => (
          <button key={s} onClick={() => setScope(s)} className={cn(chipClass(scope === s), 'inline-flex items-center gap-1.5')}>
            {s !== 'all' && <i className={categorySquare(SCOPE_CODE[s])} aria-hidden="true" />}
            {s} <span className={cn('mono', scope === s ? 'opacity-70' : 'text-ink-faint')}>{counts[s]}</span>
          </button>
        ))}
        <label className="flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
          <input type="checkbox" checked={onlyOutdated} onChange={(e) => setOnlyOutdated(e.target.checked)} /> needs attention
        </label>
        {provider === 'claude' && (
          <label className="flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
            <input type="checkbox" checked={onlyUnused} onChange={(e) => setOnlyUnused(e.target.checked)} /> unused only
          </label>
        )}
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search size={13} className="absolute left-2 top-2 text-ink-faint" />
          <Input className="pl-7 py-1 text-xs" placeholder="search" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className="lg:hidden text-xs font-semibold underline text-ink-soft hover:text-ink" onClick={() => setShowCatalog(!showCatalog)}>
          {showCatalog ? 'hide catalog' : 'catalog & history'}
        </button>
      </div>

      {/* what a quick action came to: its state on the notice's edge and in its words, the panel left as it is */}
      {msg && <div className={cn(notice(msg.kind === 'ok' ? 'ok' : msg.kind === 'info' ? 'work' : 'bad'), 'px-3 py-2 text-xs', msg.kind === 'ok' ? 'text-ok-ink' : msg.kind === 'info' ? 'text-work-ink' : 'text-bad-ink')}>{msg.text}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-6 gap-y-8 items-start">
        {/* each kind of source on a board of its own, as the Goals page's boards: a source is a row, its skills rows under it */}
        <div className="lg:col-span-2 min-w-0">
          <SuiteReleases open={folds.isOpen('suites')} onToggle={() => folds.toggle('suites')} releases={releases} forecast={(id, to) => api.releaseForecast(id, to)} busy={(id) => !!runningOp(`release:${id}`)} running={(id) => opLink(`release:${id}`)} onMove={(v, to) => void moveRelease(v, to)} />
          {MANAGER_ORDER.filter((m) => report.sources.some((s) => s.manager === m && s.skills.some(filter))).map((m) => {
            const Icon = MANAGER_ICON[m];
            return (
              <Board key={m} id={`skills-${m}`} icon={<Icon size={14} strokeWidth={2.25} className={code(MANAGER_CODE[m]).ink} aria-hidden="true" />} title={m === 'plugin' ? `${backend} plugins` : MANAGER_HEADING[m]} count={report.sources.filter((s) => s.manager === m).reduce((n, s) => n + s.skills.length, 0)} open={folds.isOpen(m)} onToggle={() => folds.toggle(m)} note={updatesIn(m) ? <span className="font-bold text-you-ink">{updatesIn(m)} source{updatesIn(m) === 1 ? '' : 's'} with updates</span> : undefined}>
                {report.sources
                  .filter((s) => s.manager === m)
                  .map((s) => (
                    <SourceGroup key={s.id} s={s} busy={pending.has('shadows') || s.skills.some((r) => runningOp(r.name))} updating={report.updating === s.id || !!runningOp(s.id)} running={opLink(s.id) ?? s.skills.map((r) => opLink(r.name)).find(Boolean) ?? null} filter={filter} expand={expand} a={{ onUpdate: (names) => void updateSource(s.id, s.label, names), onAdopt: (names) => void adopt(names), onTrashShadows: trashShadows, onUninstallPlugin: provider === 'claude' ? (id) => void uninstallPlugin(id) : undefined, onUninstall: (names) => setConfirmNames(names), onView: openView, selected, onSelect: select }} usage={usageByDir} windowGoals={overview.usageWindow?.goals} />
                  ))}
              </Board>
            );
          })}
          {report.sources.every((s) => !s.skills.some(filter)) && (
            // under the boards above it (the workflow suites stay), as far below as the next board would be
            <EmptyState icon={SearchX} title="Nothing matches" className="mt-10 first:mt-0">
              No skill matches the search and the filters above.
            </EmptyState>
          )}
        </div>
        {/* level with the boards' panels, under their headings, on a wide screen */}
        <div ref={affix.ref} className={cn(showCatalog ? 'block' : 'hidden lg:block', 'lg:mt-[31px]', affix.className)}>
          <SidePanelTabs catalog={overview.catalog} trash={trash} runs={runs} busy={(key) => pending.has(key) || !!runningOp(key)} opLink={opLink} onInstall={(id, force) => void install(id, force)} onInstallTier={(tiers) => void installTier(tiers)} onInstallTool={(id) => void installTool(id)} onRestore={restore} />
        </div>
      </div>

      {/* docked at the bottom: the operations (one tab each), and under them the bulk action bar */}
      <BottomDock>
        <OpsDock />
        {selected.size > 0 && (
          <div className="border-t border-line bg-panel px-4 py-2.5 flex items-center gap-3 flex-wrap">
            <span className="text-xs font-semibold text-ink">
              {selected.size} selected: <span className="mono font-normal text-ink-faint">{[...selected].slice(0, 6).join(', ')}{selected.size > 6 ? '…' : ''}</span>
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
        <p>The skill director{(confirmNames?.length ?? 0) === 1 ? 'y is' : 'ies are'} moved to this backend's trash (restorable from the Trash panel). Symlinked skills lose only the link; plugin skills cannot be removed here.</p>
        {confirmNames && confirmNames.length > 1 && <div className="mono text-[11px] text-ink-soft max-h-32 overflow-auto">{confirmNames.join('\n')}</div>}
      </ConfirmDialog>

      <Modal open={view !== null} title={view && view !== 'loading' ? <span className="mono">{view.invoke}</span> : 'Loading…'} onClose={() => setView(null)} wide>
        {view === 'loading' ? (
          <div className="text-xs text-ink-faint">reading SKILL.md…</div>
        ) : view ? (
          <div className="space-y-3">
            <div className="text-[11px] text-ink-faint mono break-all">{view.dir}</div>
            {view.skillMd ? (
              (() => {
                const m = view.skillMd.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
                const fm = m ? m[1]! : null;
                const body = m ? view.skillMd.slice(m[0].length) : view.skillMd;
                return (
                  <>
                    {fm && (
                      <div className="rounded-md border border-line bg-sunken p-2.5 text-xs space-y-0.5">
                        {fm.split('\n').map((line, i) => {
                          const k = line.match(/^([\w-]+):\s*(.*)$/);
                          return k ? (
                            <div key={i} className="flex gap-2">
                              <span className="mono text-ink-faint w-28 shrink-0">{k[1]}</span>
                              <span className="text-ink break-words min-w-0">{k[2]}</span>
                            </div>
                          ) : (
                            <div key={i} className="text-ink-soft pl-30 break-words">{line}</div>
                          );
                        })}
                      </div>
                    )}
                    <MarkdownPanel title="SKILL.md" source={body} maxHeight={520} />
                  </>
                );
              })()
            ) : (
              <div className="text-xs text-bad-ink">no SKILL.md in this directory</div>
            )}
            {view.files.length > 1 && (
              <details className="text-xs">
                <summary className="cursor-pointer font-semibold text-ink-soft hover:text-ink">{view.files.length} files in this skill</summary>
                <div className="mono text-[11px] text-ink-soft mt-1 space-y-0.5 max-h-40 overflow-auto">
                  {view.files.map((f) => (
                    <div key={f.path} className="flex gap-3">
                      <span className="truncate">{f.path}</span>
                      <span className="ml-auto text-ink-faint shrink-0">{f.size < 1024 ? `${f.size} B` : `${(f.size / 1024).toFixed(0)} KB`}</span>
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
export function BottomDock({ children }: { children: ReactNode }) {
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
