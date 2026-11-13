import { Download, ExternalLink, Loader2, LogIn } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { api, type SignInPlace, type SignInState, type ToolState } from '../../api.ts';
import { Button, Input, cn } from '../../ui.tsx';

/**
 * Signing in to a place through its CLI (ADR-0097): one click starts it, the browser opens the place's page (or the
 * page is shown to click, where no browser can open), and the token the CLI ends with lands in Settings. Fly.io's
 * approval page also shows a code that finishes the login from another machine.
 */
export function SignInPanel({ place, label, onSignedIn, where }: { place: SignInPlace; label: string; onSignedIn: () => void; /** the other way in: the page a token is made on, pasted below */ where?: ReactNode }) {
  const [st, setSt] = useState<SignInState | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const opened = useRef<string | null>(null);
  // the tab for the place's page, opened on the click itself (a tab opened later, from a timer, is what browsers block)
  const tab = useRef<Window | null>(null);
  useEffect(() => {
    api.signInStatus(place).then(setSt).catch(() => {});
  }, [place]);
  // while it waits, ask every two seconds; the first address that appears opens in a new tab once
  useEffect(() => {
    if (st?.status !== 'waiting') return;
    const t = setInterval(() => {
      api
        .signInStatus(place)
        .then((s) => {
          setSt(s);
          if (s.status === 'done') onSignedIn();
        })
        .catch(() => {});
    }, 2000);
    return () => clearInterval(t);
  }, [st?.status, place]);
  useEffect(() => {
    if (st?.status === 'waiting' && st.url && opened.current !== st.url) {
      opened.current = st.url;
      if (tab.current && !tab.current.closed) tab.current.location.href = st.url;
      else window.open(st.url, '_blank', 'noopener');
      tab.current = null;
    }
    // a sign-in that ended before its page was known leaves no blank tab behind
    if (st && st.status !== 'waiting' && tab.current && !tab.current.closed && !opened.current) tab.current.close();
    if (st && st.status !== 'waiting') tab.current = null;
  }, [st?.url, st?.status]);
  const start = () => {
    opened.current = null;
    try {
      tab.current = window.open('about:blank', '_blank');
    } catch {
      tab.current = null;
    }
    void act(() => api.signIn(place));
  };
  const act = async (fn: () => Promise<SignInState>) => {
    setBusy(true);
    setErr(null);
    try {
      const s = await fn();
      setSt(s);
      if (s.status === 'done') onSignedIn();
    } catch (e: any) {
      setErr(e.body?.error ?? e.message);
    } finally {
      setBusy(false);
    }
  };
  const waiting = st?.status === 'waiting';
  const blurb = place === 'fly' ? 'Runs fly auth login; you approve the page; a long-lived organization token is saved here.' : 'Asks Netlify for a sign-in ticket; you approve the page; the token Netlify makes is saved here.';
  return (
    <div className="text-[11px]" data-testid={`signin-${place}`}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
        <div className="min-w-0 text-ink-soft">
          <span className="font-semibold text-ink">Sign in with the browser</span> — {blurb}
          {where}
        </div>
        {waiting ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(() => api.signInCancel(place))}>
            Cancel
          </Button>
        ) : (
          <Button size="sm" disabled={busy} onClick={start}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : <LogIn size={12} />} Sign in
          </Button>
        )}
      </div>
      {st && st.status !== 'idle' && (
        <div className={cn('mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1', st.status === 'failed' ? 'text-bad-ink' : st.status === 'done' ? 'text-ok-ink' : 'text-ink-soft')}>
          {waiting && <Loader2 size={11} className="shrink-0 animate-spin" />}
          <span>{st.detail}</span>
          {waiting && st.url && (
            <a href={st.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-work-ink hover:underline">
              Open the {label} page <ExternalLink size={10} />
            </a>
          )}
        </div>
      )}
      {waiting && st?.code && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-md border border-you/40 bg-you/5 px-2 py-1.5">
          <span className="text-ink">After you approve, the page shows a code — paste it here to finish:</span>
          <Input aria-label="Approval code" value={code} placeholder="code from the page" spellCheck={false} autoComplete="off" onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && code.trim() && void act(() => api.signInCode(place, code.trim()))} className="mono w-44 py-1 text-[11px]" />
          <Button size="sm" variant="primary" disabled={busy || !code.trim()} onClick={() => void act(() => api.signInCode(place, code.trim()))}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : null} Finish sign-in
          </Button>
          <span className="text-ink-faint">(or wait: a login approved on this machine may finish by itself)</span>
        </div>
      )}
      {waiting && st?.output && <pre className="mono mt-1.5 max-h-24 overflow-auto whitespace-pre-wrap rounded border border-line bg-surface p-2 text-[10.5px] text-ink-faint">{st.output}</pre>}
      {err && <div className="mt-1 text-bad-ink">{err}</div>}
    </div>
  );
}

/** flyctl on this computer, installed on a click with Fly.io's own installer (into ~/.fly) when it is missing */
export function FlyctlRow({ onState }: { onState?: (installed: boolean) => void }) {
  const [st, setSt] = useState<ToolState | null>(null);
  useEffect(() => {
    if (st) onState?.(!!st.installed);
  }, [st?.installed]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.flyctl().then(setSt).catch(() => {});
  }, []);
  useEffect(() => {
    if (st?.status !== 'installing') return;
    const t = setInterval(() => api.flyctl().then(setSt).catch(() => {}), 2000);
    return () => clearInterval(t);
  }, [st?.status]);
  const install = async () => {
    setErr(null);
    try {
      setSt(await api.installFlyctl());
    } catch (e: any) {
      setErr(e.body?.error ?? e.message);
    }
  };
  return (
    <div className="text-[11px]" data-testid="flyctl-row">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
        <div className="min-w-0 text-ink-soft">
          <span className="font-semibold text-ink">flyctl</span>
          {st?.installed ? (
            <>
              {' '}
              · {st.installed.version} <span className="mono text-ink-faint">· {st.installed.path}</span>
            </>
          ) : st ? (
            <> — not on this computer yet; Fly.io deploys run it from here. Install runs Fly.io’s own installer into ~/.fly.</>
          ) : (
            <> — looking…</>
          )}
        </div>
        {st && !st.installed ? (
          <Button size="sm" disabled={st.status === 'installing'} onClick={() => void install()} title="Runs Fly.io's installer (curl -L https://fly.io/install.sh | sh), which puts flyctl in ~/.fly/bin — what you would run by hand">
            {st.status === 'installing' ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Install
          </Button>
        ) : (
          <span />
        )}
      </div>
      {st && st.status !== 'idle' && <div className={cn('mt-1.5', st.status === 'failed' ? 'text-bad-ink' : st.status === 'done' ? 'text-ok-ink' : 'text-ink-soft')}>{st.detail}</div>}
      {st?.status === 'failed' && st.output && <pre className="mono mt-1.5 max-h-24 overflow-auto whitespace-pre-wrap rounded border border-line bg-surface p-2 text-[10.5px] text-ink-faint">{st.output}</pre>}
      {err && <div className="mt-1 text-bad-ink">{err}</div>}
    </div>
  );
}
