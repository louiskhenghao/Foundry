import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.ts';
import { Button, Input, PageHeader } from '../ui.tsx';

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
    // one panel in the middle of the screen: signing in is the only thing to do here
    <div className="min-h-full flex items-center justify-center px-3 py-10 sm:px-4">
      <form
        className="w-full max-w-md rounded-xl bg-panel p-5 sm:p-7 shadow-[0_0_0_1px_var(--color-line),0_24px_44px_-28px_rgb(0_0_0/0.45)]"
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        <span className="mb-5 grid h-11 w-11 place-items-center rounded-lg bg-ink text-on-ink" aria-hidden="true">
          <KeyRound size={20} strokeWidth={2.25} />
        </span>
        <PageHeader title="Sign in" summary="This Foundry asks for an access token. Paste yours; this browser keeps it for 90 days." />
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink-soft">Access token</span>
            <Input className="mono" value={token} onChange={(e) => setToken(e.target.value)} placeholder="fnd_…" autoFocus autoComplete="off" spellCheck={false} />
          </label>
          {err && <div className="rounded-md border border-bad/40 bg-bad/5 px-3 py-2 text-sm text-bad-ink">{err}</div>}
          <Button variant="primary" type="submit" className="w-full justify-center" disabled={busy || !token.trim()}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
          <p className="text-xs text-ink-faint">No token? Ask whoever runs this Foundry: Settings → Access makes one per person.</p>
        </div>
      </form>
    </div>
  );
}
