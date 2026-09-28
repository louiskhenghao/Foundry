import type { McpCatalogStatus, McpHealth, McpKey, McpServerRow } from '@foundry/engine/mcp-types';
import { ExternalLink, RefreshCw, Stethoscope } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, type McpCustomServer, type McpView } from '../../api.ts';
import { Badge, Button, Card, ConfirmDialog, Empty, Input, Select, cn } from '../../ui.tsx';
import { HelpLink } from '../HelpPage.tsx';
import { McpConnectDialog } from './McpConnectDialog.tsx';
import { OpsDock } from './OpsDock.tsx';
import { startOp, useRunningOp, useSkillOps } from './ops.ts';
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
  const [connecting, setConnecting] = useState<string | null>(null);
  const runningOp = useRunningOp();
  const load = () =>
    api
      .mcp()
      .then((v) => {
        setView(v);
        setErr(null);
      })
      .catch((e) => setErr(e.message));
  // an install or removal changes the list: reload whenever an MCP operation ends (a new custom name included)
  const mcpOpsEnded = useSkillOps((s) => s.tabs.filter((t) => t.status !== 'running' && t.targets.some((x) => x.startsWith('mcp:'))).length);
  useEffect(() => {
    void load();
  }, [mcpOpsEnded]);

  const check = async () => {
    setChecking(true);
    setErr(null);
    try {
      setHealth((await api.mcpCheck()).health);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setChecking(false);
    }
  };
  // switches are sent one after another, and the server's list is the answer: quick toggles never flip back
  const allowing = useRef<Promise<unknown>>(Promise.resolve());
  const allow = (s: McpServerRow, on: boolean) => {
    setView((v) => (v ? { ...v, servers: v.servers.map((x) => (x.prefix === s.prefix ? { ...x, allowed: on } : x)) } : v));
    allowing.current = allowing.current.then(() =>
      api
        .mcpAllow(s.prefix, on)
        .then(({ allowed }) => setView((v) => (v ? { ...v, servers: v.servers.map((x) => ({ ...x, allowed: allowed.includes(x.prefix) })) } : v)))
        .catch((e) => {
          setErr(e.message);
          void load();
        }),
    );
  };
  const install = (what: { catalogId: string } | { custom: McpCustomServer }, name: string, keys: Record<string, string>, replace = false) =>
    startOp({ kind: 'install', label: `${replace ? 'Change the key of' : 'Install'} MCP server ${name}`, targets: [`mcp:${name}`], call: (opId) => api.mcpInstall(what, keys, opId, replace) });
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
                  <ServerRow key={`${s.source}:${s.plugin ?? ''}:${s.name}`} s={s} health={healthOf(s)} running={!!runningOp(`mcp:${s.name}`)} onAllow={(on) => allow(s, on)} onRemove={() => setRemoving(s.name)} onConnect={() => setConnecting(s.name)} keys={view.catalog.find((c) => c.entry.id === s.catalogId)?.entry.keys ?? []} onChangeKey={(k) => s.catalogId && void install({ catalogId: s.catalogId }, s.name, k, true)} />
                ))}
              </div>
            )}
          </Card>
          <CustomForm onAdd={(c, keys) => void install({ custom: c }, c.name, keys)} running={(n) => !!runningOp(`mcp:${n}`)} installed={(n) => view.servers.some((s) => s.source === 'user' && s.name === n)} />
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

      {connecting && (
        <McpConnectDialog
          name={connecting}
          onClose={(signedIn) => {
            setConnecting(null);
            if (signedIn) void check();
          }}
        />
      )}
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

function ServerRow({ s, health, running, onAllow, onRemove, onConnect, keys, onChangeKey }: { s: McpServerRow; health: McpHealth | null; running: boolean; onAllow: (on: boolean) => void; onRemove: () => void; onConnect: () => void; keys: McpKey[]; onChangeKey: (keys: Record<string, string>) => void }) {
  const [newKeys, setNewKeys] = useState<Record<string, string> | null>(null);
  // connectors authorize on claude.ai, HTTP servers may sign in (OAuth); a stdio server takes its keys at install
  const canConnect = s.source === 'connector' || (s.source === 'user' && (s.transport === 'http' || s.transport === 'sse'));
  const needsAuth = health?.status === 'needs-auth';
  const risky = s.source === 'connector' || (s.source === 'user' && !s.catalogId);
  return (
    <div className="py-2.5 flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3">
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
        {health && health.status !== 'connected' && <div className="text-[11px] text-amber-300/90">{health.detail}{needsAuth ? ' — press Set up to connect it' : ''}</div>}
        <div className="mono text-[11px] text-zinc-500 truncate" title={s.target ?? undefined}>
          {s.source === 'plugin' ? `from plugin ${s.plugin}` : s.source === 'connector' ? 'connected in your claude.ai account' : s.target}
        </div>
        {newKeys !== null && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {keys.map((k) => (
              <Input key={k.name} type="password" autoComplete="off" aria-label={k.label} className="max-w-xs" placeholder={`new ${k.label} (${k.name})`} value={newKeys[k.name] ?? ''} onChange={(e) => setNewKeys({ ...newKeys, [k.name]: e.target.value })} />
            ))}
            <Button
              size="sm"
              variant="primary"
              disabled={running || keys.some((k) => !newKeys[k.name]?.trim())}
              onClick={() => {
                onChangeKey(newKeys);
                setNewKeys(null);
              }}
            >
              Save key
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setNewKeys(null)}>
              Cancel
            </Button>
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 flex-wrap shrink-0">
        {canConnect && (
          <Button size="sm" variant={needsAuth ? 'primary' : 'default'} className="shrink-0" onClick={onConnect} title={s.source === 'connector' ? 'Authorize it on claude.ai with the account it should use' : 'Sign in to this server'}>
            {needsAuth ? 'Set up' : s.source === 'connector' ? 'Connect' : 'Sign in'}
          </Button>
        )}
        <label className="flex items-center gap-1.5 text-xs text-zinc-300 shrink-0 cursor-pointer" title={risky && !s.allowed ? 'Goals will call its tools without asking you' : 'Worker sessions may use its tools'}>
          <input type="checkbox" checked={s.allowed} onChange={(e) => onAllow(e.target.checked)} /> Allowed in goals
        </label>
        {keys.length > 0 && newKeys === null && (
          <Button size="sm" variant="ghost" disabled={running} onClick={() => setNewKeys({})} title="Replace the key this server was installed with">
            Change key…
          </Button>
        )}
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

/** Add a server by hand: a command (stdio) with its environment, or a URL (http) that signs in afterwards. */
function CustomForm({ onAdd, running, installed }: { onAdd: (c: McpCustomServer, keys: Record<string, string>) => void; running: (name: string) => boolean; installed: (name: string) => boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<'stdio' | 'http'>('stdio');
  const [target, setTarget] = useState('');
  const [env, setEnv] = useState('');
  // the name that was sent: the form stays filled in until that server appears, so a failed install loses nothing
  const [sent, setSent] = useState<string | null>(null);
  useEffect(() => {
    if (!sent || !installed(sent)) return;
    setName('');
    setTarget('');
    setEnv('');
    setSent(null);
    setOpen(false);
  });
  // KEY=value, one per line (a command's environment; URL servers sign in instead)
  const lines = type === 'stdio' ? env.split('\n').map((l) => l.trim()).filter(Boolean) : [];
  const keys = Object.fromEntries(lines.map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
  const envOk = lines.every((l) => /^[A-Z][A-Z0-9_]*=.+$/.test(l));
  // the names Claude Code accepts, without "__" (it would split the server's tool rules)
  const valid = /^(?=.{1,64}$)[A-Za-z0-9-]+(?:_[A-Za-z0-9-]+)*$/.test(name) && target.trim().length > 0 && (type === 'stdio' || /^https?:\/\//.test(target.trim())) && envOk;
  const add = () => {
    const [command, ...args] = target.trim().split(/\s+/);
    onAdd({ name, config: type === 'stdio' ? { type: 'stdio', command: command!, args } : { type: 'http', url: target.trim() } }, keys);
    setSent(name);
  };
  if (!open)
    return (
      <button type="button" className="text-xs text-zinc-400 underline decoration-dotted" onClick={() => setOpen(true)}>
        + add your own server
      </button>
    );
  const busy = running(name);
  return (
    <Card title="Add your own server">
      <div className="grid grid-cols-1 sm:grid-cols-[10rem_7rem_1fr] gap-2">
        <Input aria-label="server name" placeholder="name" value={name} onChange={(e) => setName(e.target.value)} />
        <Select aria-label="kind" value={type} onChange={(e) => setType(e.target.value as 'stdio' | 'http')}>
          <option value="stdio">command</option>
          <option value="http">URL</option>
        </Select>
        <Input aria-label={type === 'stdio' ? 'command' : 'URL'} className="mono" placeholder={type === 'stdio' ? 'npx -y some-mcp-server' : 'https://example.com/mcp'} value={target} onChange={(e) => setTarget(e.target.value)} />
      </div>
      {type === 'stdio' ? (
        <>
          <textarea aria-label="environment" className="mt-2 w-full mono text-xs bg-zinc-950 border border-zinc-800 rounded-md px-2 py-1.5 [-webkit-text-security:disc] focus:[-webkit-text-security:none]" rows={2} autoComplete="off" spellCheck={false} placeholder="environment, one per line: API_KEY=…" value={env} onChange={(e) => setEnv(e.target.value)} />
          {!envOk && <div className="text-[11px] text-rose-400">Each line is NAME=value, with NAME in capitals.</div>}
          <p className="text-[11px] text-zinc-500 mt-1">Added at user scope and off in goals until you switch it on. Keys go to Claude Code with the server; Foundry keeps no copy.</p>
        </>
      ) : (
        <p className="text-[11px] text-zinc-500 mt-2">Added at user scope and off in goals until you switch it on. If it needs an account, press <span className="text-zinc-300">Sign in</span> on its row once it is added.</p>
      )}
      <div className="flex items-center gap-2 mt-2">
        <Button size="sm" variant="primary" disabled={!valid || busy} onClick={add}>
          <RefreshCw size={12} className={cn(busy ? 'animate-spin' : 'hidden')} /> Add
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        {sent && !busy && !installed(sent) && <span className="text-[11px] text-rose-300">Not added — see the log in Operations below; the form keeps what you typed.</span>}
      </div>
    </Card>
  );
}
