import { useEffect, useState } from 'react';
import type { CodexPlugin, CodexPluginsView } from '@foundry/engine/plugins-types';
import { apiForProvider } from '../../api.ts';
import { Button, Card, ConfirmDialog, Empty, Input } from '../../ui.tsx';
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
    <div className="flex items-center gap-3 flex-wrap"><h1 className="text-lg font-semibold">Codex plugins</h1><Button className="ml-auto" size="sm" disabled={refreshing || running} onClick={refresh}>{refreshing ? 'Refreshing…' : 'Refresh plugins'}</Button></div>
    <p className="text-sm text-zinc-400">Manage plugins from your native Codex marketplaces. Installation affects the local Codex CLI and new Foundry sessions. Claude plugins remain separate.</p>
    <p className="text-xs text-zinc-500">Plugins can include skills, tools and hooks. Install sources you trust. Connected services still require native authorization; installing does not automatically allow their MCP tools in goals. Marketplace setup and plugin updates remain in the native CLI.</p>
    {error && <div role="alert" className="text-sm text-rose-400">{error}</div>}
    {!view ? <Empty>{error ? 'Could not load plugins. Try Refresh plugins.' : 'Reading native plugins…'}</Empty> : view.state === 'unavailable' ? <Card title="Native plugin list unavailable"><p className="text-sm text-amber-300">{view.message}</p><p className="mt-2 text-xs text-zinc-400">Use a compatible Codex CLI with plugin JSON commands, then refresh. No configuration was changed.</p></Card> : <>
      <Input aria-label="Filter plugins" placeholder="Filter by plugin or marketplace" value={query} onChange={e=>setQuery(e.target.value)} />
      {plugins.length === 0 && <Empty>{view.plugins.length ? 'No matching plugins.' : 'No plugins returned by the native CLI. Configure a marketplace in Codex, then refresh.'}</Empty>}
      {(['Installed', 'Available'] as const).map(group => {
        const rows = plugins.filter(p => p.installed === (group === 'Installed'));
        return rows.length > 0 && <Card key={group} title={`${group} · ${rows.length}`}><div className="divide-y divide-zinc-800">{rows.map(plugin => <PluginRow key={plugin.id} plugin={plugin} busy={running} onChange={()=>setChange(plugin)} />)}</div></Card>;
      })}
    </>}
    <ConfirmDialog open={!!change} title={`${change?.installed ? 'Remove' : 'Install'} ${change?.name ?? 'plugin'}?`} confirmLabel={change?.installed ? 'Remove plugin' : 'Install plugin'} danger={change?.installed} busy={running} onClose={()=>setChange(null)} onConfirm={confirm}>
      <p className="break-all">{change?.id}</p><p className="mt-2">{change?.installed ? 'Codex removes its user installation and cached package. Running sessions may retain loaded components. Reinstall from the marketplace to restore it.' : 'Codex installs this package into its own configuration. Its skills, tools and hooks may load in new sessions. Connected services require their own authorization.'}</p>
    </ConfirmDialog>
    <BottomDock><OpsDock /></BottomDock>
  </div>;
}

export function PluginRow({ plugin, busy, onChange }: { plugin: CodexPlugin; busy: boolean; onChange: () => void }) {
  const managed = plugin.installPolicy !== 'AVAILABLE';
  return <div className="py-3 flex items-start gap-3 flex-wrap">
    <div className="min-w-0 flex-1"><div className="text-sm font-medium break-all">{plugin.name}</div><div className="text-xs text-zinc-500 break-all">{plugin.marketplace} · {plugin.version ?? 'version unknown'}</div><p className="text-xs text-zinc-400 mt-1">{plugin.installed ? plugin.enabled ? 'Installed · enabled' : 'Installed · disabled by native configuration' : 'Available to install'}{managed && ` · ${plugin.installPolicy.toLowerCase().replaceAll('_',' ')}`}</p></div>
    <Button size="sm" disabled={busy || managed} onClick={onChange}>{managed ? 'Managed in Codex' : plugin.installed ? 'Remove' : 'Install'}</Button>
  </div>;
}
