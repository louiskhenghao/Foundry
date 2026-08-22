import { ExternalLink, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type LoginSession } from '../api.ts';
import { Button, CopyButton, Input, cn } from '../ui.tsx';

/** Runs `claude auth login` through the engine; the browser opens on this machine, the URL is shown too. */
export function SignInDialog({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'claudeai' | 'console'>('claudeai');
  const [email, setEmail] = useState('');
  const [session, setSession] = useState<LoginSession | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!session || session.done) return;
    const t = setInterval(() => api.loginSession().then((s) => s && setSession(s)).catch(() => {}), 1500);
    return () => clearInterval(t);
  }, [session?.id, session?.done]);

  const start = async () => {
    setErr(null);
    try {
      setSession(await api.startLogin({ mode, email: email.trim() || undefined }));
    } catch (e: any) {
      setErr(e.message);
    }
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg border border-zinc-800 bg-zinc-950 p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Sign in to Claude</h2>
          <Button size="sm" variant="ghost" onClick={onClose}>
            <X size={14} />
          </Button>
        </div>
        <p className="text-xs text-zinc-400">Same flow as Claude Code: a browser window opens on this machine, you sign in, and this page updates by itself. ai-engine never sees your password or token — Claude Code stores the credential.</p>
        {!session ? (
          <>
            <div className="flex gap-2 text-xs">
              {(['claudeai', 'console'] as const).map((m) => (
                <button key={m} onClick={() => setMode(m)} className={cn('rounded px-2.5 py-1 border', mode === m ? 'border-emerald-500 text-emerald-300' : 'border-zinc-700 text-zinc-400')}>
                  {m === 'claudeai' ? 'Claude subscription (Pro / Max)' : 'Anthropic Console (API billing)'}
                </button>
              ))}
            </div>
            <Input placeholder="email (optional, pre-fills the login page)" value={email} onChange={(e) => setEmail(e.target.value)} />
            {err && <div className="text-xs text-rose-400">{err}</div>}
            <div className="flex justify-end">
              <Button variant="primary" onClick={start}>
                Open browser & sign in
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className={cn('rounded-md border p-3 text-sm', session.done ? (session.ok ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-rose-500/40 bg-rose-500/5') : 'border-zinc-800')}>
              {session.done ? (session.ok ? '✔ Signed in.' : `✘ ${session.error ?? 'Sign-in failed'}`) : 'Waiting for you to finish in the browser…'}
            </div>
            {session.url && !session.done && (
              <div className="text-xs">
                <div className="text-zinc-400 mb-1">If the browser did not open, use this link:</div>
                <div className="flex items-center gap-2">
                  <a className="underline text-sky-300 truncate flex items-center gap-1" href={session.url} target="_blank" rel="noreferrer">
                    <ExternalLink size={12} /> {session.url}
                  </a>
                  <CopyButton text={session.url} />
                </div>
              </div>
            )}
            {session.lines.length > 0 && <pre className="mono text-[11px] text-zinc-500 bg-zinc-900 border border-zinc-800 rounded p-2 max-h-40 overflow-auto whitespace-pre-wrap">{session.lines.slice(-12).join('\n')}</pre>}
            <div className="flex justify-end gap-2">
              {!session.done && (
                <Button size="sm" variant="ghost" onClick={() => api.cancelLogin().then(onClose)}>
                  Cancel
                </Button>
              )}
              {session.done && (
                <Button size="sm" variant="primary" onClick={onClose}>
                  Done
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
