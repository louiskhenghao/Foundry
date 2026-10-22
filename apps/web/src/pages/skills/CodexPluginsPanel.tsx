import { useEffect, useState } from 'react';
import { Package, PackageCheck, Plug, Puzzle, SearchX } from 'lucide-react';
import type { CodexPlugin, CodexPluginsView } from '@foundry/engine/plugins-types';
import { apiForProvider } from '../../api.ts';
import { BOARD_ROW, Board, Button, Card, ConfirmDialog, Empty, EmptyState, Input, cn } from '../../ui.tsx';
import { stateDot } from '../agents/marks.ts';
import { OpsDock } from './OpsDock.tsx';
import { BottomDock } from './SkillsPage.tsx';
import { startOp, useSkillOps } from './ops.ts';

const api = apiForProvider('codex');
export function CodexPluginsPanel() {
  const [view, setView] = useState<CodexPluginsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [change, setChange] = useState<CodexPlugin | null>(null);
  const finished = useSkillOps(s => s.finished);
  const running = useSkillOps(s => s.tabs.some(t => t.status === 'running' && t.targets.some(target => target.startsWith('codex:plugin:'))));
  useEffect(() => {
    let alive = true;
    void api.plugins().then(value => { if (alive) { setView(value); setError(null); } }).catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [finished]);
  const refresh = async () => {
    setRefreshing(true);
    try { setView(await api.plugins(true)); setError(null); } catch (e: any) { setError(e.message); }
    finally { setRefreshing(false); }
  };
  const confirm = () => {
    if (!change) return;
    const action = change.installed ? 'remove' : 'install';
    void startOp({ kind: change.installed ? 'uninstall' : 'install', label: `Codex · ${action} ${change.id}`, targets: [`codex:plugin:${change.id}`], call: opId => api.changePlugin(change.id, action, opId) });
    setChange(null);
  };
  const plugins = view?.state === 'available' ? view.plugins.filter(p => `${p.name} ${p.marketplace}`.toLowerCase().includes(query.toLowerCase())) : [];
  return <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6 space-y-4">
    {/* the tab's own head, in the capitals of a section */}
    <div className="flex items-center gap-3 flex-wrap"><h2 className="flex items-center gap-2.5 text-[12.5px] font-extrabold caps text-ink"><Plug size={14} aria-hidden="true" />Codex plugins</h2><Button className="ml-auto" size="sm" disabled={refreshing || running} onClick={refresh}>{refreshing ? 'Refreshing…' : 'Refresh plugins'}</Button></div>
    <p className="text-sm text-ink-soft">Manage plugins from your native Codex marketplaces. Installation affects the local Codex CLI and new Foundry sessions. Claude plugins remain separate.</p>
    <p className="text-xs text-ink-faint">Plugins can include skills, tools and hooks. Install sources you trust. Connected services still require native authorization; installing does not automatically allow their MCP tools in goals. Marketplace setup and plugin updates remain in the native CLI.</p>
    {error && <div role="alert" className="text-sm text-bad-ink">{error}</div>}
    {!view ? <Empty>{error ? 'Could not load plugins. Try Refresh plugins.' : 'Reading native plugins…'}</Empty> : view.state === 'unavailable' ? <Card title="Native plugin list unavailable"><p className="text-sm text-you-ink">{view.message}</p><p className="mt-2 text-xs text-ink-soft">Use a compatible Codex CLI with plugin JSON commands, then refresh. No configuration was changed.</p></Card> : <>
      <Input aria-label="Filter plugins" placeholder="Filter by plugin or marketplace" value={query} onChange={e=>setQuery(e.target.value)} />
      {plugins.length === 0 && (view.plugins.length ? <EmptyState icon={SearchX} title="No matching plugins">Clear the filter to see every plugin.</EmptyState> : <EmptyState icon={Puzzle} title="No plugins returned by the native CLI">Configure a marketplace in Codex, then refresh.</EmptyState>)}
      {(['Installed', 'Available'] as const).map(group => {
        const rows = plugins.filter(p => p.installed === (group === 'Installed'));
        return rows.length > 0 && <Board key={group} id={`plugins-${group.toLowerCase()}`} icon={group === 'Installed' ? <PackageCheck size={14} strokeWidth={2.25} className="text-ok-ink" aria-hidden="true" /> : <Package size={14} aria-hidden="true" />} title={group} count={rows.length}>{rows.map(plugin => <PluginRow key={plugin.id} plugin={plugin} busy={running} onChange={()=>setChange(plugin)} />)}</Board>;
      })}
    </>}
    <ConfirmDialog open={!!change} title={`${change?.installed ? 'Remove' : 'Install'} ${change?.name ?? 'plugin'}?`} confirmLabel={change?.installed ? 'Remove plugin' : 'Install plugin'} danger={change?.installed} busy={running} onClose={()=>setChange(null)} onConfirm={confirm}>
      <p className="break-all">{change?.id}</p><p className="mt-2">{change?.installed ? 'Codex removes its user installation and cached package. Running sessions may retain loaded components. Reinstall from the marketplace to restore it.' : 'Codex installs this package into its own configuration. Its skills, tools and hooks may load in new sessions. Connected services require their own authorization.'}</p>
    </ConfirmDialog>
    <BottomDock><OpsDock /></BottomDock>
  </div>;
}

/** one native plugin, a row of its board; how it stands on a dot and in its words: installed and enabled green, disabled or not installed hollow */
export function PluginRow({ plugin, busy, onChange }: { plugin: CodexPlugin; busy: boolean; onChange: () => void }) {
  const managed = plugin.installPolicy !== 'AVAILABLE';
  const on = plugin.installed && plugin.enabled;
  return <li className={cn(BOARD_ROW, 'px-4 md:px-5 py-3 flex items-start gap-3 flex-wrap')}>
    <div className="min-w-0 flex-1"><div className="text-[15px] font-bold text-ink break-all">{plugin.name}</div><div className="text-xs text-ink-faint break-all">{plugin.marketplace} · {plugin.version ? <span className="mono">{plugin.version}</span> : 'version unknown'}</div><p className="text-xs text-ink-soft mt-1 flex items-center gap-1.5"><span className={stateDot(on ? 'ok' : 'none')} /><span><span className={cn(on && 'font-semibold text-ok-ink')}>{plugin.installed ? plugin.enabled ? 'Installed · enabled' : 'Installed · disabled by native configuration' : 'Available to install'}</span>{managed && ` · ${plugin.installPolicy.toLowerCase().replaceAll('_',' ')}`}</span></p></div>
    <Button size="sm" disabled={busy || managed} onClick={onChange}>{managed ? 'Managed in Codex' : plugin.installed ? 'Remove' : 'Install'}</Button>
  </li>;
}
