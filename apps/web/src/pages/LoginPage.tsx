import { KeyRound, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.ts';
import { Button, Input, PageHeader, cn } from '../ui.tsx';
import { SECTION_STYLE } from './settings/sections.tsx';

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
        className="w-full max-w-md rounded-xl bg-panel p-5 sm:p-7 shadow-[0_0_0_1px_var(--color-line),var(--surface-shadow)]"
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        {/* the key of Settings → Access, where the tokens are made, in that section's colour */}
        <span className={cn('mb-5 grid h-11 w-11 place-items-center rounded-lg bg-sunken inset-ring inset-ring-line', SECTION_STYLE.access!.ink)} aria-hidden="true">
          <KeyRound size={20} strokeWidth={2.25} />
        </span>
        <PageHeader title="Sign in" summary="This Foundry asks for an access token. Paste yours; this browser keeps it for 90 days." />
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink-soft">Access token</span>
            <Input className="mono" value={token} onChange={(e) => setToken(e.target.value)} placeholder="fnd_…" autoFocus autoComplete="off" spellCheck={false} />
          </label>
          {/* a refused token in red words with its mark, on a plain box */}
          {err && (
            <div className="flex items-start gap-2 rounded-md border border-line bg-sunken px-3 py-2 text-sm font-semibold text-bad-ink">
              <XCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-words">{err}</span>
            </div>
          )}
          <Button variant="primary" type="submit" className="w-full justify-center" disabled={busy || !token.trim()}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
          <p className="text-xs text-ink-faint">No token? Ask whoever runs this Foundry: Settings → Access makes one per person.</p>
        </div>
      </form>
    </div>
  );
}
