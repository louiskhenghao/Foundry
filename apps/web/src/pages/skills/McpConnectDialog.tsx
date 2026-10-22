import { ExternalLink, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiForProvider, type AgentProvider, type McpLoginSession } from '../../api.ts';
import { Button, CopyButton, Input, buttonClass, cn, focusFirst } from '../../ui.tsx';
import { notice } from '../agents/marks.ts';

/**
 * Connect a claude.ai connector (open its claude.ai link and authorize there) or sign in to an HTTP MCP server
 * (a browser opens on this computer; without one, paste back the address the browser ended on).
 */
export function McpConnectDialog({ provider = 'claude', name, onClose }: { provider?: AgentProvider; name: string; onClose: (signedIn: boolean) => void }) {
  const api = apiForProvider(provider);
  const backend = provider === 'codex' ? 'Codex' : 'Claude Code';
  const [s, setS] = useState<McpLoginSession | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .mcpLoginSession()
      .then((current) => {
        if (!alive) return null;
        if (current && !current.done) {
          if (current.name !== name) throw new Error(`Finish or cancel the sign-in for ${current.name} in ${backend} first.`);
          return current;
        }
        return api.mcpLogin(name);
      })
      .then((session) => { if (alive && session) setS(session); })
      .catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
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
    if (err && !s) return <div className="text-sm text-bad-ink">{err}</div>;
    if (!s) return <div className="text-sm text-ink-soft">Asking {backend} how to connect {name}…</div>;
    if (s.connector)
      return s.done && !s.ok ? (
        <div className="space-y-2">
          <div className="text-sm text-bad-ink">{s.error ?? `${backend} gave no link to connect this connector.`}</div>
          <div className="text-xs text-ink-soft">
            Or run this in a terminal and open the link it prints: <code className="mono text-ink bg-sunken border border-line rounded-sm px-1.5 py-0.5">{s.command}</code> <CopyButton text={s.command} />
          </div>
        </div>
      ) : s.url ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-soft">
            {name} is a claude.ai connector: you authorize it once on claude.ai, with the Google (or other) account it should use. Claude Code and Foundry share that connection.
          </p>
          <div className="flex items-center gap-2">
            <a href={s.url} target="_blank" rel="noreferrer" className={buttonClass('primary')}>
              <ExternalLink size={14} /> Open claude.ai to connect
            </a>
            <CopyButton text={s.url} />
          </div>
          <p className="text-xs text-ink-faint">When claude.ai says it is connected, close this and press Check: new goal sessions pick it up. It still needs its Allowed in goals box ticked before goals can use it.</p>
        </div>
      ) : (
        <div className="text-sm text-ink-soft">Getting the claude.ai link…</div>
      );
    return (
      <div className="space-y-3">
        {/* how the sign-in stands, on the box's edge: signed in green, failed red, the sign-in yours to do yellow, starting blue */}
        <div className={cn(notice(s.done ? (s.ok ? 'ok' : 'bad') : s.needsCode ? 'you' : 'work'), 'p-3 text-sm', s.done ? (s.ok ? 'text-ok-ink' : 'text-bad-ink') : s.needsCode ? 'text-ink' : 'text-ink-soft')}>
          {s.done ? (s.ok ? `✔ Signed in to ${name}.` : `✘ ${s.error ?? 'Sign-in failed'}`) : s.needsCode ? 'Open the link below and sign in. If a browser on this computer finishes it, this updates by itself; otherwise the browser lands on an address that may not load: copy that whole address and paste it here.' : 'Starting the sign-in…'}
        </div>
        {s.needsCode && !s.done && (
          <div className="flex gap-2">
            <Input autoFocus={focusFirst} className="mono" placeholder="http://localhost:…/callback?code=…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && url.trim() && void submit()} />
            <Button size="sm" variant="primary" disabled={!url.trim() || sending} onClick={submit}>
              {sending ? 'Sending…' : 'Submit'}
            </Button>
          </div>
        )}
        {s.url && !s.done && (
          <div className="text-xs">
            <div className="text-ink-faint mb-1">{s.needsCode ? 'Sign-in link:' : 'If no browser opened, use this link:'}</div>
            <div className="flex items-center gap-2">
              <a className="font-semibold underline underline-offset-2 text-work-ink min-w-0 flex items-center gap-1" href={s.url} target="_blank" rel="noreferrer" title={s.url}>
                <ExternalLink size={12} className="shrink-0" /> <span className="truncate">{s.url}</span>
              </a>
              <CopyButton text={s.url} />
            </div>
          </div>
        )}
        {err && <div className="text-xs text-bad-ink">{err}</div>}
        {/* the way out when it cannot finish here: the same sign-in in the user's own terminal (yellow once it is the only way: yours to do) */}
        <div className={cn('text-xs px-3 py-2', s.done && !s.ok ? cn(notice('you'), 'text-ink') : 'rounded-md border border-line text-ink-soft')}>
          <div className="mb-1">{s.done && !s.ok ? 'Sign in from a terminal instead: run this, open the link it prints, and paste back the address when it asks.' : 'Or run it in a terminal yourself:'}</div>
          <div className="flex items-center gap-2">
            <code className="mono text-ink bg-sunken border border-line rounded-sm px-2 py-1 break-all">{s.command}</code>
            <CopyButton text={s.command} />
          </div>
        </div>
        {s.lines.length > 0 && <pre className="mono text-[11px] text-ink-faint bg-sunken border border-line rounded-md p-2 max-h-32 overflow-auto whitespace-pre-wrap">{s.lines.slice(-8).join('\n')}</pre>}
      </div>
    );
  })();

  // portalled to <body>: the page's sticky header and the operations dock would otherwise contain or cover a fixed overlay
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3 sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="w-full sm:max-w-lg max-h-[calc(100dvh-1.5rem)] overflow-auto rounded-xl border border-line bg-panel shadow-2xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="min-w-0 break-words text-lg font-extrabold tracking-tight text-ink">Connect {name} · {backend}</h2>
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
