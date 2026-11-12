import type { DeployServer, SecretState } from '@foundry/core/browser';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Field, Input, Textarea } from '../../ui.tsx';

/** a new server's id: unique enough among a person's few servers, stable once saved (deploys name it) */
export const newServerId = () => `srv_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** the key as the page shows it: never the saved one (it stays with the engine), only what was typed since */
const keyPlaceholder = (saved: SecretState | undefined) => (saved?.set ? `saved: ${saved.hint} — paste a key to replace it` : '-----BEGIN OPENSSH PRIVATE KEY-----\n…');

/**
 * The servers Deploy can reach over SSH (ADR-0090), edited in place: each with a name, where it is, who logs in, the
 * key (a secret: the saved one never comes back, pasting replaces it), the folder the projects go under and the
 * address visitors open. Saved with the rest of the Settings page.
 */
export function DeployServers({ servers, secrets, onChange }: { servers: DeployServer[]; secrets: Record<string, SecretState>; onChange: (next: DeployServer[]) => void }) {
  const edit = (id: string, patch: Partial<DeployServer>) => onChange(servers.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const add = () => onChange([...servers, { id: newServerId(), name: `server ${servers.length + 1}`, host: '', port: 22, user: 'root', privateKey: null, dir: '~/foundry', publicUrl: null }]);
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
          </div>
          <Field label="SSH private key" help="The key whose public half is in that user's ~/.ssh/authorized_keys on the server. Kept by the engine only: never shown again, never handed to a coding session, written to a file only while a deploy runs.">
            <Textarea rows={3} className="mono text-[11px]" autoComplete="off" spellCheck={false} value={s.privateKey ?? ''} placeholder={keyPlaceholder(secrets[`delivery.servers.${s.id}.privateKey`])} onChange={(e) => edit(s.id, { privateKey: e.target.value === '' ? null : e.target.value })} />
          </Field>
        </div>
      ))}
      <Button size="sm" onClick={add}>
        <Plus size={12} /> Add a server
      </Button>
    </div>
  );
}
