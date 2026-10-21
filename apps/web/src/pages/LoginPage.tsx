import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.ts';
import { Button, Input, Page } from '../ui.tsx';

/** Access (ADR-0061): the page a Foundry that asks for tokens sends a browser to; the token becomes a cookie here. */
export function LoginPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const next = params.get('next') || '/';
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.accessLogin(token.trim());
      nav(next.startsWith('/') ? next : '/', { replace: true });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page width="sm">
      <form
        className="mx-auto mt-10 max-w-md rounded-lg border border-zinc-800 bg-zinc-900/60 p-5 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <KeyRound size={18} /> Sign in
        </h1>
        <p className="text-sm text-zinc-400">This Foundry asks for an access token. Paste yours; this browser keeps it for 90 days.</p>
        <label className="block text-xs text-zinc-400">
          Access token
          <Input className="mono mt-1" value={token} onChange={(e) => setToken(e.target.value)} placeholder="fnd_…" autoFocus autoComplete="off" spellCheck={false} />
        </label>
        {err && <div className="text-sm text-rose-300">{err}</div>}
        <div className="flex items-center gap-3">
          <Button variant="primary" type="submit" disabled={busy || !token.trim()}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
          <span className="text-xs text-zinc-500">No token? Ask whoever runs this Foundry: Settings → Access makes one per person.</span>
        </div>
      </form>
    </Page>
  );
}
