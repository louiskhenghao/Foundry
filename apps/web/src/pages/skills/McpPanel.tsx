import type { McpCatalogStatus, McpHealth, McpServerRow } from '@foundry/engine/mcp-types';
import { ExternalLink, RefreshCw, Stethoscope } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type McpCustomServer, type McpView } from '../../api.ts';
import { Badge, Button, Card, ConfirmDialog, Empty, Input, Select, cn } from '../../ui.tsx';
import { HelpLink } from '../HelpPage.tsx';
import { OpsDock } from './OpsDock.tsx';
import { startOp, useRunningOp } from './ops.ts';
import { BottomDock } from './SkillsPage.tsx';

const SOURCE_LABEL: Record<McpServerRow['source'], string> = { user: 'yours', plugin: 'plugin', connector: 'claude.ai' };
const HEALTH_STATE: Record<McpHealth['status'], string> = { connected: 'pass', failed: 'fail', 'needs-auth': 'warn', pending: 'pending', unknown: 'pending' };

/** MCP servers (ADR-0016): what Claude Code has, which ones goals may use, and Foundry's recommendations. */
export function McpPanel() {
  const [view, setView] = useState<McpView | null>(null);
  const [health, setHealth] = useState<McpHealth[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const runningOp = useRunningOp();
  const load = () =>
    api
      .mcp()
      .then(setView)
      .catch((e) => setErr(e.message));
  useEffect(() => {
    void load();
  }, []);
  // an install or removal changes the list: reload when an MCP operation ends
  const busy = view?.servers.some((s) => runningOp(`mcp:${s.name}`)) || view?.catalog.some((c) => runningOp(`mcp:${c.entry.name}`));
  useEffect(() => {
    if (!busy) void load();
  }, [busy]);

  const check = async () => {
    setChecking(true);
    try {
      setHealth((await api.mcpCheck()).health);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setChecking(false);
    }
  };
  const allow = async (s: McpServerRow, on: boolean) => {
    setView((v) => (v ? { ...v, servers: v.servers.map((x) => (x.prefix === s.prefix ? { ...x, allowed: on } : x)) } : v));
    await api.mcpAllow(s.prefix, on).catch((e) => setErr(e.message));
    void load();
  };
  const install = (what: { catalogId: string } | { custom: McpCustomServer }, name: string, keys: Record<string, string>) =>
    startOp({ kind: 'install', label: `Install MCP server ${name}`, targets: [`mcp:${name}`], call: (opId) => api.mcpInstall(what, keys, opId) });
  const remove = (name: string) => startOp({ kind: 'uninstall', label: `Remove MCP server ${name}`, targets: [`mcp:${name}`], call: (opId) => api.mcpRemove(name, opId) });

  if (!view) return <Empty>{err ?? 'Reading MCP servers…'}</Empty>;
  const healthOf = (s: McpServerRow) => health?.find((h) => h.name === s.name) ?? null;
  const missing = view.catalog.filter((c) => !c.installed);

  return (
    <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          MCP servers <HelpLink to="settings#mcp-servers" />
        </h1>
        <span className="text-xs text-zinc-500">tools Claude Code can call beyond files and the shell</span>
        <Button size="sm" className="ml-auto" disabled={checking} onClick={check} title="Runs claude mcp list: starts or connects to every server">
          <Stethoscope size={13} className={cn(checking && 'animate-pulse')} /> {checking ? 'Checking…' : 'Check'}
        </Button>
      </div>
      <p className="text-xs text-zinc-500 -mt-2">
        Goals run without asking you, so they only use the servers switched to <span className="text-zinc-300">Allowed in goals</span>, and only in the sessions that do the work (never in Clarify or reviews). Servers installed here go to your user scope: they work in your own Claude Code too.
      </p>
      {err && <div className="rounded-md border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-xs text-rose-200">{err}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-3">
          <Card title="On this computer">
            {view.servers.length === 0 ? (
              <div className="text-xs text-zinc-500">No MCP servers yet. Install one from the recommendations, or add your own below.</div>
            ) : (
              <div className="divide-y divide-zinc-800">
                {view.servers.map((s) => (
                  <ServerRow key={`${s.source}:${s.plugin ?? ''}:${s.name}`} s={s} health={healthOf(s)} running={!!runningOp(`mcp:${s.name}`)} onAllow={(on) => void allow(s, on)} onRemove={() => setRemoving(s.name)} />
                ))}
              </div>
            )}
          </Card>
          <CustomForm onAdd={(c, keys) => void install({ custom: c }, c.name, keys)} running={(n) => !!runningOp(`mcp:${n}`)} />
        </div>
        <Card title="Recommended by Foundry">
          <p className="text-[11px] text-zinc-500 mb-3">Curated in catalog/mcp.json. Installed from here, a server is allowed in goals right away.</p>
          {missing.length === 0 && <div className="text-xs text-zinc-500">All installed.</div>}
          <div className="space-y-2">
            {missing.map((c) => (
              <CatalogCard key={c.entry.id} c={c} others={view.catalog.filter((o) => o.entry.pack && o.entry.pack === c.entry.pack && o.entry.id !== c.entry.id)} running={!!runningOp(`mcp:${c.entry.name}`)} onInstall={(keys) => void install({ catalogId: c.entry.id }, c.entry.name, keys)} />
            ))}
          </div>
        </Card>
      </div>

      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing}?`}
        danger
        confirmLabel="Remove"
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) void remove(removing);
          setRemoving(null);
        }}
      >
        <p className="text-sm text-zinc-300">It is removed from your user scope, so it also disappears from the Claude Code in your terminal. Its key, if it had one, goes with it.</p>
      </ConfirmDialog>
      <BottomDock>
        <OpsDock />
      </BottomDock>
    </div>
  );
}

function ServerRow({ s, health, running, onAllow, onRemove }: { s: McpServerRow; health: McpHealth | null; running: boolean; onAllow: (on: boolean) => void; onRemove: () => void }) {
  const risky = s.source === 'connector' || (s.source === 'user' && !s.catalogId);
  return (
    <div className="py-2.5 flex items-start gap-3 flex-wrap sm:flex-nowrap">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="mono text-sm text-zinc-100">{s.name}</span>
          <span className="text-[10px] uppercase rounded bg-zinc-800 text-zinc-400 px-1">{SOURCE_LABEL[s.source]}</span>
          {s.transport && <span className="text-[10px] text-zinc-500">{s.transport}</span>}
          {health && (
            <span title={health.detail}>
              <Badge state={HEALTH_STATE[health.status]}>{health.status.replace('-', ' ')}</Badge>
            </span>
          )}
          {running && <span className="text-[11px] text-sky-300">working…</span>}
        </div>
        <div className="mono text-[11px] text-zinc-500 truncate" title={s.target ?? undefined}>
          {s.source === 'plugin' ? `from plugin ${s.plugin}` : s.source === 'connector' ? 'connected in your claude.ai account' : s.target}
        </div>
      </div>
      <label className="flex items-center gap-1.5 text-xs text-zinc-300 shrink-0 cursor-pointer" title={risky && !s.allowed ? 'Goals will call its tools without asking you' : 'Worker sessions may use its tools'}>
        <input type="checkbox" checked={s.allowed} onChange={(e) => onAllow(e.target.checked)} /> Allowed in goals
      </label>
      {s.source === 'user' ? (
        <Button size="sm" variant="ghost" disabled={running} onClick={onRemove}>
          Remove
        </Button>
      ) : (
        <span className="text-[11px] text-zinc-600 shrink-0 w-16 text-right" title={s.source === 'plugin' ? 'removed with its plugin, on the Skills tab' : 'managed in your claude.ai settings'}>
          {s.source === 'plugin' ? 'with plugin' : 'on claude.ai'}
        </span>
      )}
    </div>
  );
}

function CatalogCard({ c, others, running, onInstall }: { c: McpCatalogStatus; others: McpCatalogStatus[]; running: boolean; onInstall: (keys: Record<string, string>) => void }) {
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const e = c.entry;
  const ready = e.keys.every((k) => keys[k.name]?.trim());
  const otherInstalled = others.find((o) => o.installed);
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/50 p-2.5 space-y-1.5">
      <div className="flex items-center gap-2">
        <Badge state={e.tier} />
        <span className="mono text-sm text-zinc-100 flex-1 truncate">{e.name}</span>
        {e.homepage && (
          <a href={e.homepage} target="_blank" rel="noreferrer" className="text-zinc-500 hover:text-zinc-200" title={e.homepage}>
            <ExternalLink size={12} />
          </a>
        )}
      </div>
      <div className="text-[11px] text-zinc-400">{e.summary}</div>
      <div className="text-[11px] text-zinc-500">{e.why}</div>
      <div className="flex flex-wrap gap-1">
        {e.suits.map((s) => (
          <span key={s} className="text-[10px] rounded border border-zinc-800 px-1 text-zinc-400">
            {s}
          </span>
        ))}
        {others.length > 0 && <span className="text-[10px] text-zinc-500">· or {others.map((o) => o.entry.name).join(', ')}: one is enough</span>}
      </div>
      {otherInstalled && <div className="text-[11px] text-emerald-300/80">{otherInstalled.entry.name} is already installed for this.</div>}
      {e.keys.length > 0 && open && (
        <div className="space-y-1.5">
          {e.keys.map((k) => (
            <div key={k.name}>
              <Input type="password" autoComplete="off" placeholder={`${k.label} (${k.name})`} value={keys[k.name] ?? ''} onChange={(ev) => setKeys({ ...keys, [k.name]: ev.target.value })} />
              {k.url && (
                <a className="text-[10px] text-zinc-500 underline" href={k.url} target="_blank" rel="noreferrer">
                  get a key
                </a>
              )}
            </div>
          ))}
          <div className="text-[10px] text-zinc-500">Stored by Claude Code with the server, not by Foundry.</div>
        </div>
      )}
      <Button size="sm" variant={e.tier === 'recommended' ? 'primary' : 'default'} disabled={running || (open && !ready)} onClick={() => (e.keys.length && !open ? setOpen(true) : onInstall(keys))}>
        {running ? 'Installing…' : e.keys.length && !open ? 'Install…' : 'Install'}
      </Button>
    </div>
  );
}

/** Add a server by hand: a command (stdio) or a URL (http), plus environment variables. */
function CustomForm({ onAdd, running }: { onAdd: (c: McpCustomServer, keys: Record<string, string>) => void; running: (name: string) => boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<'stdio' | 'http'>('stdio');
  const [target, setTarget] = useState('');
  const [env, setEnv] = useState('');
  // KEY=value, one per line
  const keys = Object.fromEntries(env.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
  const envOk = env.split('\n').every((l) => !l.trim() || /^[A-Z][A-Z0-9_]*=.+$/.test(l.trim()));
  const valid = /^[A-Za-z0-9_.-]{1,64}$/.test(name) && target.trim().length > 0 && (type === 'stdio' || /^https?:\/\//.test(target.trim())) && envOk;
  const add = () => {
    const [command, ...args] = target.trim().split(/\s+/);
    onAdd({ name, config: type === 'stdio' ? { type: 'stdio', command: command!, args } : { type: 'http', url: target.trim() } }, keys);
    setName('');
    setTarget('');
    setEnv('');
    setOpen(false);
  };
  if (!open)
    return (
      <button type="button" className="text-xs text-zinc-400 underline decoration-dotted" onClick={() => setOpen(true)}>
        + add your own server
      </button>
    );
  return (
    <Card title="Add your own server">
      <div className="grid grid-cols-1 sm:grid-cols-[10rem_7rem_1fr] gap-2">
        <Input placeholder="name" value={name} onChange={(e) => setName(e.target.value)} />
        <Select value={type} onChange={(e) => setType(e.target.value as 'stdio' | 'http')}>
          <option value="stdio">command</option>
          <option value="http">URL</option>
        </Select>
        <Input className="mono" placeholder={type === 'stdio' ? 'npx -y some-mcp-server' : 'https://example.com/mcp'} value={target} onChange={(e) => setTarget(e.target.value)} />
      </div>
      <textarea className="mt-2 w-full mono text-xs bg-zinc-950 border border-zinc-800 rounded-md px-2 py-1.5 [-webkit-text-security:disc] focus:[-webkit-text-security:none]" rows={2} autoComplete="off" spellCheck={false} placeholder="environment, one per line: API_KEY=…" value={env} onChange={(e) => setEnv(e.target.value)} />
      {!envOk && <div className="text-[11px] text-rose-400">Each line is NAME=value, with NAME in capitals.</div>}
      <p className="text-[11px] text-zinc-500 mt-1">Added at user scope and off in goals until you switch it on. Keys go to Claude Code with the server; Foundry keeps no copy.</p>
      <div className="flex gap-2 mt-2">
        <Button size="sm" variant="primary" disabled={!valid || running(name)} onClick={add}>
          <RefreshCw size={12} className={cn(running(name) ? 'animate-spin' : 'hidden')} /> Add
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
