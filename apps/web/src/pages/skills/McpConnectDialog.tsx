import { ExternalLink, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, type McpLoginSession } from '../../api.ts';
import { Button, CopyButton, Input, cn } from '../../ui.tsx';

/**
 * Connect a claude.ai connector (open its claude.ai link and authorize there) or sign in to an HTTP MCP server
 * (a browser opens on this computer; without one, paste back the address the browser ended on).
 */
export function McpConnectDialog({ name, onClose }: { name: string; onClose: (signedIn: boolean) => void }) {
  const [s, setS] = useState<McpLoginSession | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api
      .mcpLogin(name)
      .then(setS)
      .catch((e) => setErr(e.message));
  }, [name]);
  useEffect(() => {
    if (!s || s.done) return;
    const t = setInterval(() => api.mcpLoginSession().then((x) => x && x.id === s.id && setS(x)).catch(() => {}), 1000);
    return () => clearInterval(t);
  }, [s?.id, s?.done]);

  const submit = async () => {
    setSending(true);
    setErr(null);
    try {
      setS(await api.mcpLoginSubmit(url));
      setUrl('');
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSending(false);
    }
  };
  const close = () => {
    if (s && !s.done) void api.mcpLoginCancel().catch(() => {});
    onClose(!!s?.done && !!s.ok && !s.connector);
  };

  const body = (() => {
    if (err && !s) return <div className="text-sm text-rose-400">{err}</div>;
    if (!s) return <div className="text-sm text-zinc-400">Asking Claude Code how to connect {name}…</div>;
    if (s.connector)
      return s.done && !s.ok ? (
        <div className="space-y-2">
          <div className="text-sm text-rose-400">{s.error ?? 'Claude Code gave no link to connect this connector.'}</div>
          <div className="text-xs text-zinc-300">
            Or run this in a terminal and open the link it prints: <code className="mono bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5">{s.command}</code> <CopyButton text={s.command} />
          </div>
        </div>
      ) : s.url ? (
        <div className="space-y-3">
          <p className="text-sm text-zinc-300">
            {name} is a claude.ai connector: you authorize it once on claude.ai, with the Google (or other) account it should use. Claude Code and Foundry share that connection.
          </p>
          <div className="flex items-center gap-2">
            <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 text-zinc-950 px-3 py-1.5 text-sm font-medium hover:bg-emerald-400">
              <ExternalLink size={14} /> Open claude.ai to connect
            </a>
            <CopyButton text={s.url} />
          </div>
          <p className="text-[11px] text-zinc-500">When claude.ai says it is connected, close this and press Check: new goal sessions pick it up. It still needs its Allowed in goals box ticked before goals can use it.</p>
        </div>
      ) : (
        <div className="text-sm text-zinc-400">Getting the claude.ai link…</div>
      );
    return (
      <div className="space-y-3">
        <div className={cn('rounded-md border p-3 text-sm', s.done ? (s.ok ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-rose-500/40 bg-rose-500/5') : s.needsCode ? 'border-sky-500/40 bg-sky-500/5' : 'border-zinc-800')}>
          {s.done ? (s.ok ? `✔ Signed in to ${name}.` : `✘ ${s.error ?? 'Sign-in failed'}`) : s.needsCode ? 'Open the link below and sign in. If a browser on this computer finishes it, this updates by itself; otherwise the browser lands on an address that may not load: copy that whole address and paste it here.' : 'Starting the sign-in…'}
        </div>
        {s.needsCode && !s.done && (
          <div className="flex gap-2">
            <Input autoFocus className="mono" placeholder="http://localhost:…/callback?code=…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && url.trim() && void submit()} />
            <Button size="sm" variant="primary" disabled={!url.trim() || sending} onClick={submit}>
              {sending ? 'Sending…' : 'Submit'}
            </Button>
          </div>
        )}
        {s.url && !s.done && (
          <div className="text-xs">
            <div className="text-zinc-400 mb-1">{s.needsCode ? 'Sign-in link:' : 'If no browser opened, use this link:'}</div>
            <div className="flex items-center gap-2">
              <a className="underline text-sky-300 truncate flex items-center gap-1" href={s.url} target="_blank" rel="noreferrer">
                <ExternalLink size={12} /> {s.url}
              </a>
              <CopyButton text={s.url} />
            </div>
          </div>
        )}
        {err && <div className="text-xs text-rose-400">{err}</div>}
        {/* the way out when it cannot finish here: the same sign-in in the user's own terminal */}
        <div className={cn('text-xs rounded-md border px-3 py-2', s.done && !s.ok ? 'border-amber-500/40 bg-amber-500/5 text-zinc-200' : 'border-zinc-800 text-zinc-400')}>
          <div className="mb-1">{s.done && !s.ok ? 'Sign in from a terminal instead: run this, open the link it prints, and paste back the address when it asks.' : 'Or run it in a terminal yourself:'}</div>
          <div className="flex items-center gap-2">
            <code className="mono text-zinc-100 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 break-all">{s.command}</code>
            <CopyButton text={s.command} />
          </div>
        </div>
        {s.lines.length > 0 && <pre className="mono text-[11px] text-zinc-500 bg-zinc-900 border border-zinc-800 rounded p-2 max-h-32 overflow-auto whitespace-pre-wrap">{s.lines.slice(-8).join('\n')}</pre>}
      </div>
    );
  })();

  // portalled to <body>: the page's sticky header and the operations dock would otherwise contain or cover a fixed overlay
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="w-full sm:max-w-lg rounded-t-xl sm:rounded-lg border border-zinc-800 bg-zinc-950 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Connect {name}</h2>
          <Button size="sm" variant="ghost" onClick={close} aria-label="close">
            <X size={14} />
          </Button>
        </div>
        {body}
        <div className="flex justify-end">
          <Button size="sm" variant={s?.done || s?.connector ? 'primary' : 'ghost'} onClick={close}>
            {s?.done || s?.connector ? 'Done' : 'Cancel'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
