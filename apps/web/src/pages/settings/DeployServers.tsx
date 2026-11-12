import type { DeployServer, RecipeRun, SecretState, ServerRecipe } from '@foundry/core/browser';
import { Plus, Trash2, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../api.ts';
import { Button, Field, Input, Select, Textarea } from '../../ui.tsx';
import { RecipeDialog, RecipeRuns } from './RecipeDialog.tsx';

/** a new server's id: unique enough among a person's few servers, stable once saved (deploys name it) */
export const newServerId = () => `srv_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** the key as the page shows it: never the saved one (it stays with the engine), only what was typed since */
const keyPlaceholder = (saved: SecretState | undefined) => (saved?.set ? `saved: ${saved.hint} — paste a key to replace it` : '-----BEGIN OPENSSH PRIVATE KEY-----\n…');

/**
 * The servers Deploy can reach over SSH (ADR-0090), edited in place: each with a name, where it is, who logs in, the
 * key (a secret: the saved one never comes back, pasting replaces it), the folder the projects go under and the
 * address visitors open. Saved with the rest of the Settings page.
 */
export function DeployServers({ servers, secrets, savedIds, onChange }: { servers: DeployServer[]; secrets: Record<string, SecretState>; /** the servers the engine has: a script runs on those only (save first) */ savedIds?: string[]; onChange: (next: DeployServer[]) => void }) {
  const saved = new Set(savedIds ?? servers.map((s) => s.id));
  const edit = (id: string, patch: Partial<DeployServer>) => onChange(servers.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const add = () => onChange([...servers, { id: newServerId(), name: `server ${servers.length + 1}`, host: '', port: 22, user: 'root', privateKey: null, dir: '~/foundry', publicUrl: null, allowPrivileged: false, mode: 'docker' }]);
  return (
    <div className="space-y-3">
      {servers.length === 0 && <p className="text-[11px] text-ink-faint">No server yet. Add one to deploy a goal's whole project (its compose file or Dockerfile) to a machine of your own with docker compose.</p>}
      {servers.map((s, i) => (
        <div key={s.id} className="rounded-lg border border-line bg-sunken p-3 space-y-2" data-server={s.id}>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-ink">Server {i + 1}</span>
            <button type="button" className="ml-auto inline-flex items-center gap-1 text-[11px] text-ink-faint hover:text-bad-ink" title="Remove this server (the key saved for it is forgotten when you save)" onClick={() => onChange(servers.filter((x) => x.id !== s.id))}>
              <Trash2 size={11} /> Remove
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" help="How the Deploy card calls it.">
              <Input value={s.name} placeholder="hostinger" onChange={(e) => edit(s.id, { name: e.target.value })} />
            </Field>
            <Field label="Host" help="Its address: a domain or an IP.">
              <Input value={s.host} placeholder="203.0.113.4" onChange={(e) => edit(s.id, { host: e.target.value })} />
            </Field>
            <Field label="User" help="Who logs in; they need Docker (the readiness check says if not).">
              <Input value={s.user} placeholder="root" onChange={(e) => edit(s.id, { user: e.target.value })} />
            </Field>
            <Field label="SSH port">
              <Input type="number" min={1} max={65535} value={String(s.port)} onChange={(e) => edit(s.id, { port: Number(e.target.value) || 22 })} />
            </Field>
            <Field label="Deploy folder" help="On the server; each repository gets a subfolder. ~ is that user's home.">
              <Input value={s.dir} placeholder="~/foundry" onChange={(e) => edit(s.id, { dir: e.target.value })} />
            </Field>
            <Field label="Public address" help="What visitors open, when a domain or a reverse proxy sits in front (with its https://). Empty = http://host:<the first published port>.">
              <Input value={s.publicUrl ?? ''} placeholder="https://app.example.com" onChange={(e) => edit(s.id, { publicUrl: e.target.value === '' ? null : e.target.value })} />
            </Field>
            <Field label="Mode" help="docker compose runs the project's compose file (or Dockerfile) in containers, any language. PM2 runs a Node.js project on the host itself, as this user, with no container around it.">
              <Select value={s.mode} onChange={(e) => edit(s.id, { mode: e.target.value as DeployServer['mode'] })}>
                <option value="docker">docker compose (any project with a compose file or Dockerfile)</option>
                <option value="pm2">PM2 (a Node.js project, no containers)</option>
              </Select>
            </Field>
          </div>
          <Field label="SSH private key" help="The key whose public half is in that user's ~/.ssh/authorized_keys on the server. Kept by the engine only: never shown again, never handed to a coding session, written to a file only while a deploy runs.">
            <Textarea rows={3} className="mono text-[11px]" autoComplete="off" spellCheck={false} value={s.privateKey ?? ''} placeholder={keyPlaceholder(secrets[`delivery.servers.${s.id}.privateKey`])} onChange={(e) => edit(s.id, { privateKey: e.target.value === '' ? null : e.target.value })} />
          </Field>
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={s.allowPrivileged} onChange={(e) => edit(s.id, { allowPrivileged: e.target.checked })} />
            <span className="min-w-0 flex-1">
              <span className="text-xs font-semibold text-ink">Allow a compose file that reaches outside its project</span>
              <span className="block mt-0.5 text-[11px] leading-snug text-ink-faint">Off: a compose file that runs a privileged container, uses the host's network or pid space, mounts the Docker socket or bind-mounts a path outside the project folder is refused with the reasons — a coding session may have written it. On: such a file runs after the confirmation lists what it reaches; the activity records it.</span>
            </span>
          </label>
          <ServerScripts server={s} saved={saved.has(s.id)} />
        </div>
      ))}
      <Button size="sm" onClick={add}>
        <Plus size={12} /> Add a server
      </Button>
    </div>
  );
}

/**
 * The scripts a server can be set up with (ADR-0091) and the runs it had: Foundry's recipes and the person's own,
 * each run from a dialog that shows the whole script first. A server not yet saved has nothing to run on.
 */
export function ServerScripts({ server, saved }: { server: DeployServer; saved: boolean }) {
  const [open, setOpen] = useState(false);
  const [recipes, setRecipes] = useState<ServerRecipe[] | null>(null);
  const [runs, setRuns] = useState<RecipeRun[]>([]);
  const [dialog, setDialog] = useState<string | null>(null);
  const load = () => {
    api.serverRecipes().then((r) => setRecipes(r.recipes)).catch(() => setRecipes([]));
    if (saved) api.serverRecipeRuns(server.id).then((r) => setRuns(r.runs)).catch(() => {});
  };
  useEffect(() => {
    if (open) load();
  }, [open, server.id, saved]);
  return (
    <details className="rounded-md border border-line bg-panel" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold text-ink-soft hover:text-ink flex items-center gap-1.5">
        <Wrench size={11} /> Scripts — set this server up (Docker, nginx with HTTPS, Node and PM2, PostgreSQL, Redis)
      </summary>
      <div className="space-y-2 px-3 pb-3 text-[11px]">
        <p className="text-ink-faint">Each script runs once, over ssh as root, only after you read it and confirm; its output stays in the activity. Yours go in the data folder's <span className="mono">server-recipes/</span>.</p>
        {!saved && <p className="text-you-ink">Save the settings first: a script runs on a server the engine knows.</p>}
        {recipes === null ? (
          <p className="text-ink-faint">Loading…</p>
        ) : (
          <ul className="space-y-1">
            {recipes.map((r) => (
              <li key={r.id} className="flex items-center gap-2">
                <span className="font-semibold text-ink">{r.title}</span>
                <span className="text-ink-faint">{r.source === 'own' ? 'yours' : 'Foundry'} · {r.file.split('/').pop()}</span>
                <Button size="sm" className="ml-auto" disabled={!saved || !server.host} onClick={() => setDialog(r.id)}>
                  Run…
                </Button>
              </li>
            ))}
          </ul>
        )}
        {saved && (
          <div className="pt-1">
            <div className="font-semibold text-ink-soft mb-1">Runs</div>
            <RecipeRuns runs={runs} />
          </div>
        )}
      </div>
      {dialog && <RecipeDialog open server={{ id: server.id, name: server.name, host: server.host, user: server.user }} recipe={dialog} params={{ TARGET_USER: server.user }} onClose={() => setDialog(null)} onFinished={() => (saved ? api.serverRecipeRuns(server.id).then((r) => setRuns(r.runs)).catch(() => {}) : undefined)} />}
    </details>
  );
}
