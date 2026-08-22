import type { EngineEvent } from '@ai-engine/core/browser';
import type { SkillScope, SkillSourceRow, SkillTier, SkillsOverview, SkillsUpdateReport, TrashEntry } from '@ai-engine/engine/skills-types';
import { RefreshCw, Search, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../../api.ts';
import { MarkdownPanel } from '../../components/Markdown.tsx';
import { Button, ConfirmDialog, Empty, Input, Modal, ago, cn } from '../../ui.tsx';
import { CatalogPanel, HistoryPanel, SessionPanel, TrashPanel } from './SidePanels.tsx';
import { SourceGroup } from './SourceGroup.tsx';

type Report = SkillsUpdateReport & { updating: string | null; refreshing: boolean };
type View = { name: string; dir: string; invoke: string; skillMd: string | null; files: { path: string; size: number }[] };

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
  const [busy, setBusy] = useState<string | null>(null);
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

  /** Run an action with immediate feedback; never leaves the page "busy" on failure. */
  const run = async (label: string, pending: string, fn: () => Promise<string | null>) => {
    setBusy(label);
    setMsg({ kind: 'info', text: pending });
    try {
      const text = await fn();
      setMsg(text ? { kind: 'ok', text } : null);
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 422 && e.body?.manual) setMsg({ kind: 'err', text: `${e.body.name}: run this yourself → ${e.body.manual.command}` });
      else setMsg({ kind: 'err', text: e.message });
    } finally {
      setBusy(null);
      void load();
    }
  };

  const checkUpdates = () =>
    run('refresh', 'Checking upstream repositories…', async () => {
      setReport(await api.skillsUpdates(true));
      watch();
      return null;
    });
  const updateSource = (id: string, names?: string[]) =>
    run(id, `Starting update of ${id}…`, async () => {
      await api.updateSource(id, names);
      setReport((r) => (r ? { ...r, updating: id } : r));
      watch();
      return null;
    });
  const adopt = (names: string[]) =>
    run('adopt', `Adopting ${names.join(', ')}…`, async () => {
      const r = await api.adoptSkills(names);
      const n = r.runs.flatMap((x) => x.changed).length;
      const errs = r.runs.filter((x) => x.error).map((x) => x.error);
      return `${n} adopted${errs.length ? `; ${errs.join('; ')}` : ''}`;
    });
  const trashShadows = (names: string[]) =>
    run('shadows', `Moving ${names.length} shadow cop${names.length === 1 ? 'y' : 'ies'} to the trash…`, async () => {
      const r = await api.cleanupShadows(names);
      return `${r.trashed.length} moved to trash${r.skipped.length ? `; skipped ${r.skipped.map((s) => `${s.name} (${s.reason})`).join(', ')}` : ''}`;
    });
  const uninstall = (names: string[]) =>
    run('uninstall', `Uninstalling ${names.length === 1 ? names[0] : `${names.length} skills`}…`, async () => {
      const { results } = await api.uninstallMany(names, true);
      const ok = results.filter((r) => r.ok);
      const bad = results.filter((r) => !r.ok);
      setSelected(new Set());
      return `${ok.length} moved to the trash${ok.some((r) => r.note) ? ` (${[...new Set(ok.map((r) => r.note).filter(Boolean))].join(' · ')})` : ''}${bad.length ? `; not removed: ${bad.map((r) => `${r.name} — ${r.error}`).join(', ')}` : ''}`;
    });
  const install = (id: string, force: boolean) =>
    run(id, `Installing ${id}…`, async () => {
      const r = await api.installSkill(id, force);
      return r.manual ? `${r.name}: run this yourself → ${r.manual.command}` : r.ok ? `${r.name} installed${r.commit ? ` @ ${r.commit.slice(0, 7)}` : ''}` : `${r.name}: ${r.error}`;
    });
  const installTier = (tiers: SkillTier[]) =>
    run('tier', `Installing ${tiers.join(' + ')} skills…`, async () => {
      const { results } = await api.installTier(tiers);
      const ok = results.filter((r) => r.ok).length;
      const manual = results.filter((r) => r.manual);
      return `${ok}/${results.length} satisfied${manual.length ? `; run yourself: ${manual.map((m) => m.manual!.command).join(' ; ')}` : ''}`;
    });
  const restore = (name: string, path: string) => run(name, `Restoring ${name}…`, async () => `${name} restored to ${(await api.restoreSkill(name, path)).path}`);
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
  const actionsBusy = busy !== null; // a running *source update* only disables that source's Update button

  return (
    <div className="max-w-7xl mx-auto p-3 sm:p-4 md:p-6 space-y-4 pb-24">
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
          <Button size="sm" disabled={actionsBusy || report.refreshing} onClick={checkUpdates}>
            <RefreshCw size={13} className={cn(report.refreshing && 'animate-spin')} /> Check for updates
          </Button>
        </div>
      </div>
      <p className="text-xs text-zinc-500 -mt-2">
        Grouped by where each skill comes from. Updates run the source's own tool (npx skills, claude plugin) or ai-engine's installer; every run is recorded below. Uninstall never deletes — copies go to <span className="mono">data/skills-trash</span>.
      </p>

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
          {report.sources.map((s) => (
            <SourceGroup key={s.id} s={s} busy={actionsBusy} updating={report.updating === s.id} filter={filter} a={{ onUpdate: (names) => updateSource(s.id, names), onAdopt: adopt, onTrashShadows: trashShadows, onUninstall: (names) => setConfirmNames(names), onView: openView, selected, onSelect: select }} />
          ))}
          {report.sources.every((s) => !s.skills.some(filter)) && <Empty>Nothing matches.</Empty>}
        </div>
        <div className={cn('space-y-4', showCatalog ? 'block' : 'hidden lg:block')}>
          <CatalogPanel catalog={overview.catalog} busy={busy} onInstall={install} onInstallTier={installTier} />
          <TrashPanel trash={trash} busy={busy} onRestore={restore} />
          <HistoryPanel runs={runs} />
          <SessionPanel view={overview.lastSession} />
        </div>
      </div>

      {/* bulk action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur px-4 py-2.5 flex items-center gap-3 flex-wrap">
          <span className="text-xs text-zinc-300">
            {selected.size} selected: <span className="text-zinc-500">{[...selected].slice(0, 6).join(', ')}{selected.size > 6 ? '…' : ''}</span>
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              clear
            </Button>
            <Button size="sm" variant="danger" disabled={actionsBusy} onClick={() => setConfirmNames([...selected])}>
              <Trash2 size={13} /> Uninstall {selected.size}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmNames !== null}
        title={confirmNames && confirmNames.length === 1 ? `Uninstall ${confirmNames[0]}?` : `Uninstall ${confirmNames?.length ?? 0} skills?`}
        confirmLabel="Move to trash"
        danger
        busy={busy === 'uninstall'}
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
