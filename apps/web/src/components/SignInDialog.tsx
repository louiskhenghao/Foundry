import { PROVIDER_LABEL } from '@foundry/core/browser';
import { AlertTriangle, Check, CheckCircle2, ExternalLink, Loader2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, type LoginSession, type AgentProvider } from '../api.ts';
import { Button, CopyButton, Input, cn, focusFirst } from '../ui.tsx';
import { ProviderMark } from './ProviderMark.tsx';

/**
 * Runs `claude auth login` through the engine; the browser opens on this machine, the URL is shown too. `add`: the
 * sign-in of one more account, in a home of its own (ADR-0065), instead of this computer's own sign-in.
 */
export function SignInDialog({ onClose, provider: selectedProvider, add = false }: { onClose: () => void; provider?: AgentProvider; add?: boolean }) {
  const [provider, setProvider] = useState<AgentProvider | null>(selectedProvider ?? null);
  useEffect(() => { api.auth(false, selectedProvider).then((info) => setProvider(info.provider)).catch((e) => setErr(e.message)); }, []);
  const [email, setEmail] = useState('');
  const [session, setSession] = useState<LoginSession | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!session || session.done) return;
    const t = setInterval(() => (add && provider ? api.addAccountSession(provider) : api.loginSession(provider ?? undefined)).then((s) => s && setSession(s)).catch(() => {}), 1500);
    return () => clearInterval(t);
  }, [session?.id, session?.done]);

  const submit = async () => {
    setSending(true);
    setErr(null);
    try {
      setSession(await (add && provider ? api.addAccountCode(provider, code) : api.submitLoginCode(code, provider ?? undefined)));
      setCode('');
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSending(false);
    }
  };

  const start = async () => {
    setErr(null);
    try {
      const body = { email: email.trim() || undefined };
      setSession(await (add && provider ? api.addAccount(provider, body) : api.startLogin(body, provider ?? undefined)));
    } catch (e: any) {
      setErr(e.message);
    }
  };
  const cancel = () => (add && provider ? api.addAccountCancel(provider) : api.cancelLogin(provider ?? undefined)).then(onClose);

  const codex = provider === 'codex';
  const name = PROVIDER_LABEL[provider ?? 'claude'];
  const steps = codex ? ['Get a code', 'Approve on OpenAI', 'Signed in'] : ['Start', 'Approve in the browser', 'Signed in'];
  const step = !session ? 0 : session.done ? 2 : 1;
  const failed = !!session?.done && !session.ok;

  // portalled to <body>: the header's backdrop blur would otherwise pin this fixed overlay to the 48px header, cutting the dialog off
  return createPortal(
    <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="sign-in-title" className="w-full max-w-lg overflow-hidden rounded-xl border border-line bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center gap-3 px-5 pt-5 pb-4">
          {provider && <ProviderMark provider={provider} />}
          <div className="min-w-0 grow">
            <h2 id="sign-in-title" className="text-lg font-extrabold leading-tight tracking-tight text-ink">{add ? `Add a ${name} account` : `Sign in to ${name}`}</h2>
            <p className="text-xs text-ink-faint">{codex ? 'Sign in with ChatGPT' : 'Your Claude subscription (Pro or Max)'}</p>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="close">
            <X size={14} />
          </Button>
        </header>

        {/* the steps as the Tasks list draws a task's: leaning chips in their signal colour — done green, the one waiting
            for you yellow (blue while Foundry asks for a code), failed red; the first outlined in ink until you start */}
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-5 pb-4" aria-label="Sign-in steps">
          {steps.map((label, i) => {
            const done = i < step || (i === 2 && !!session?.ok);
            const now = i === step && !done;
            const asking = codex && !!session && !session.done && !session.deviceCode;
            const look = done
              ? { plate: 'bg-ok/15', text: 'text-ok-ink' }
              : now
                ? failed
                  ? { plate: 'bg-bad/15 inset-ring inset-ring-bad', text: 'text-bad-ink' }
                  : step === 0
                    ? { plate: 'inset-ring-[1.5px] inset-ring-ink', text: 'text-ink' }
                    : asking
                      ? { plate: 'bg-work/12 inset-ring inset-ring-work/60', text: 'text-work-ink' }
                      : { plate: 'bg-you', text: 'text-on-you' }
                : { plate: 'inset-ring inset-ring-line-strong', text: 'text-ink-faint' };
            return (
              <li key={label} className={cn('relative isolate inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-1 text-xs font-bold', look.text)} aria-current={now ? 'step' : undefined}>
                <i className={cn('absolute inset-0 -z-10 rounded-[3px] slant', look.plate)} aria-hidden="true" />
                {done ? <Check size={12} strokeWidth={2.5} aria-hidden="true" /> : <span className="mono">{i + 1}</span>}
                {label}
              </li>
            );
          })}
        </ol>

        <div className="space-y-4 border-t border-line px-5 py-4">
          {!session ? (
            <>
              {add && <p className="text-xs text-ink-soft">Sign in with another {codex ? 'ChatGPT' : 'Claude'} subscription of yours. Foundry gives it a folder of its own: only its sign-in is separate, and skills, plugins, settings and session history are shared with this computer's sign-in. Signing in as someone already added changes nothing.</p>}
              {codex
                ? <p className="text-xs text-ink-soft">Sign in with ChatGPT: Foundry asks OpenAI for a one-time code, you enter it on OpenAI's device page and approve, and this window updates by itself. Nothing has to open on the computer running Foundry. Codex stores your credentials.</p>
                : <>
                    <p className="text-xs text-ink-soft">Same flow as Claude Code: a browser window opens on this machine, you sign in, and this page updates by itself. When the engine runs where there is no browser (a container, a remote host), open the link yourself and paste the code it gives you. Foundry never sees your password or token — Claude Code stores the credential. Foundry does not use Anthropic Console API billing.</p>
                    <Input placeholder="email (optional, pre-fills the login page)" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && provider && start()} />
                  </>}
            </>
          ) : session.done ? (
            // the outcome on a plain box: its mark, its words and a thin edge in green or red
            <div className={cn('flex items-start gap-3 rounded-lg border border-line bg-sunken p-3 pl-4 text-sm font-semibold', session.ok ? 'text-ok-ink shadow-[inset_4px_0_0_var(--color-ok)]' : 'text-bad-ink shadow-[inset_4px_0_0_var(--color-bad)]')}>
              {session.ok ? <CheckCircle2 size={18} aria-hidden="true" className="mt-px shrink-0" /> : <AlertTriangle size={18} aria-hidden="true" className="mt-px shrink-0" />}
              <span className="min-w-0 break-words">{session.ok ? (add ? 'Signed in. The account is added.' : 'Signed in.') : (session.error ?? 'Sign-in failed')}</span>
            </div>
          ) : codex ? (
            <div className="space-y-3">
              {session.deviceCode ? (
                <>
                  <p className="text-xs text-ink-soft">Enter this one-time code on the page below (it expires in 15 minutes):</p>
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-line-strong bg-sunken px-4 py-3">
                    <span className="mono text-2xl font-bold tracking-[0.2em] text-ink">{session.deviceCode}</span>
                    <CopyButton text={session.deviceCode} />
                  </div>
                  <p className="flex items-center gap-2 text-xs font-semibold text-you-ink"><Loader2 size={13} aria-hidden="true" className="animate-spin" />Waiting for you to enter the code and approve…</p>
                </>
              ) : (
                <p className="flex items-center gap-2 text-sm font-semibold text-work-ink"><Loader2 size={14} aria-hidden="true" className="animate-spin" />Asking OpenAI for a code…</p>
              )}
            </div>
          ) : session.needsCode ? (
            <div className="space-y-2">
              <p className="text-sm text-ink">Open the link below, sign in, then paste the code Claude shows you.</p>
              <div className="flex gap-2">
                <Input
                  autoFocus={focusFirst}
                  className="mono grow"
                  placeholder="paste the code from the browser"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && code.trim() && submit()}
                />
                <Button variant="primary" className="shrink-0 whitespace-nowrap" disabled={!code.trim() || sending} onClick={submit}>
                  {sending ? 'Sending…' : 'Submit code'}
                </Button>
              </div>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm font-semibold text-you-ink"><Loader2 size={14} aria-hidden="true" className="animate-spin" />Waiting for you to finish in the browser…</p>
          )}

          {session?.url && !session.done && (
            // the words above the link where the line is too short for both (a phone); the link truncates, its copy beside it
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-line bg-sunken px-3 py-2 text-xs">
              <span className="max-w-full text-ink-faint">{codex ? 'Open this page, sign in to ChatGPT and enter the code:' : 'If the browser did not open, use this link:'}</span>
              <span className="flex min-w-40 flex-1 items-center gap-2">
                <a className="flex min-w-0 flex-1 items-center gap-1 truncate font-semibold text-work-ink underline underline-offset-2 max-sm:min-h-8" href={session.url} target="_blank" rel="noreferrer">
                  <ExternalLink size={12} aria-hidden="true" className="shrink-0" />
                  <span className="truncate">{session.url}</span>
                </a>
                <CopyButton text={session.url} />
              </span>
            </div>
          )}
          {err && <p role="alert" className="text-xs text-bad-ink">{err}</p>}
          {session && session.lines.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-ink-faint hover:text-ink">What the sign-in printed</summary>
              <pre className="mono mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-sunken p-2 text-[11px] text-ink-faint">{session.lines.slice(-12).join('\n')}</pre>
            </details>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-line bg-sunken px-5 py-3">
          {!session && (
            <>
              <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button size="sm" variant="primary" disabled={!provider} onClick={start}>Start sign in</Button>
            </>
          )}
          {session && !session.done && <Button size="sm" variant="ghost" onClick={cancel}>Cancel</Button>}
          {session?.done && (
            <>
              {!session.ok && <Button size="sm" onClick={() => setSession(null)}>Try again</Button>}
              <Button size="sm" variant="primary" onClick={onClose}>Done</Button>
            </>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
