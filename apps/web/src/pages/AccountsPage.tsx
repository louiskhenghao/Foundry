import { AGENT_PROVIDERS, PROVIDER_LABEL } from '@foundry/core/browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Ban, Check, ChevronRight, CircleHelp, LoaderCircle, LogIn, RefreshCw, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, type AccountInfo, type AccountsInfo, type AgentProvider } from '../api.ts';
import { ProviderMark } from '../components/ProviderMark.tsx';
import { SignInDialog } from '../components/SignInDialog.tsx';
import { Button, ConfirmDialog, PageHeader, cn } from '../ui.tsx';
import { AccountPoolList } from './AccountPoolList.tsx';

type State = 'checking' | 'connected' | 'signin' | 'missing' | 'unknown';
/** each sign-in state as a plate: graphite once connected, yellow only when signing in is yours to do, hollow when there is nothing to say */
const STATE: Record<State, { label: string; cls: string; Icon: LucideIcon }> = {
  checking: { label: 'Checking…', cls: 'inset-ring-[1.5px] inset-ring-line-strong text-ink-soft', Icon: LoaderCircle },
  connected: { label: 'Connected', cls: 'bg-ink text-on-ink', Icon: Check },
  signin: { label: 'Sign in required', cls: 'bg-you text-on-you', Icon: LogIn },
  missing: { label: 'CLI not installed', cls: 'inset-ring-[1.5px] inset-ring-line-strong text-ink-faint', Icon: Ban },
  unknown: { label: 'Status unavailable', cls: 'inset-ring-[1.5px] inset-ring-line-strong text-ink-faint', Icon: CircleHelp },
};
/** how the CLI says it is signed in, in words; `none` says nothing the state does not */
const METHOD: Record<string, string> = { 'claude.ai': 'Claude subscription', oauth_token: 'Signed in with an OAuth token', api_key: 'API key', api_key_helper: 'API key helper', oauth: 'Google account', ChatGPT: 'ChatGPT account' };
const methodOf = (m: string | null | undefined) => (m && m !== 'none' ? (METHOD[m] ?? m) : null);
const stateOf = (account: AccountInfo | undefined, refreshing: boolean): State => (!account ? (refreshing ? 'checking' : 'unknown') : account.status.loggedIn ? 'connected' : account.installed ? 'signin' : 'missing');
/** a figure's label: small capitals */
const LABEL = 'text-[11px] font-extrabold uppercase tracking-[0.1em] text-ink-faint';

export function AccountsPage() {
  const [info, setInfo] = useState<AccountsInfo | null>(null);
  const [login, setLogin] = useState<AgentProvider | null>(null);
  const [logout, setLogout] = useState<AgentProvider | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(true);
  const request = useRef(0);
  const load = useCallback(async () => {
    const id = ++request.current;
    setRefreshing(true);
    try {
      const value = await api.accounts(true);
      if (id === request.current) { setInfo(value); setError(''); }
    } catch (e: any) { if (id === request.current) setError(e.message); }
    finally { if (id === request.current) setRefreshing(false); }
  }, []);
  useEffect(() => { void load(); return () => { request.current++; }; }, [load]);
  const signOut = async () => {
    if (!logout) return;
    setBusy(true); setError('');
    try { await api.logout(logout); setLogout(null); await load(); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <div className="max-w-5xl mx-auto px-3 sm:px-4 md:px-6 pt-6 md:pt-9 pb-16 space-y-5">
    <PageHeader
      title="Agent accounts"
      summary="Connect Claude Code, Codex and Antigravity independently. Choose the coding agent when creating a goal; it stays fixed for that goal. Claude Code and Codex can hold several of your accounts: new sessions run on the current one."
      actions={<Button disabled={busy || refreshing} onClick={load}><RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />Refresh status</Button>}
    />
    <div className="min-h-5 text-xs" aria-live="polite">{error ? <p role="alert" className="text-bad-ink">{error}</p> : <p className="text-ink-faint">{refreshing ? 'Checking native accounts…' : 'Account status is up to date.'}</p>}</div>
    <div className="space-y-5" aria-busy={refreshing}>{AGENT_PROVIDERS.map((provider) => {
      const account = info?.accounts.find(value => value.provider === provider);
      const name = PROVIDER_LABEL[provider];
      const status = account?.status;
      const at = stateOf(account, refreshing);
      const state = STATE[at];
      const who = [status?.email, status?.subscriptionType && `Plan: ${status.subscriptionType}`].filter(Boolean).join(' · ') || methodOf(status?.authMethod) || (provider === 'codex' ? 'Use your ChatGPT account' : provider === 'agy' ? 'Use your Google account' : 'Use your Claude subscription');
      return <section key={provider} aria-labelledby={`agent-${provider}`} className="rounded-xl bg-panel shadow-[0_0_0_1px_var(--color-line),0_1px_2px_rgb(0_0_0/0.06)]">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4 sm:px-5">
          <ProviderMark provider={provider} size="lg" />
          <div className="min-w-0 grow basis-48">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 id={`agent-${provider}`} className="text-lg font-extrabold tracking-tight text-ink">{name}</h2>
              {info?.defaultProvider === provider && <span className="rounded-sm border border-line-strong/70 px-1.5 py-px text-[10.5px] font-semibold leading-tight text-ink-soft">default for new goals</span>}
            </div>
            <p className="text-sm text-ink-soft mt-0.5 truncate" title={who}>{who}</p>
          </div>
          <span className={cn('inline-flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-[12.5px] font-extrabold uppercase leading-none tracking-[0.12em]', state.cls)}><state.Icon size={13} strokeWidth={2.5} aria-hidden="true" className={cn(at === 'checking' && 'animate-spin')} />{state.label}</span>
          {provider !== 'agy' && <Button disabled={busy || refreshing || !account?.installed} variant={status?.loggedIn ? 'default' : 'primary'} onClick={() => status?.loggedIn ? setLogout(provider) : setLogin(provider)}>{status?.loggedIn ? 'Sign out' : `Sign in to ${name}`}</Button>}
        </header>
        {status?.error && <p className="px-4 sm:px-5 -mt-1 pb-3 text-xs text-ink-faint">{status.error}</p>}
        {provider === 'agy'
          ? <div className="border-t border-line px-4 sm:px-5 py-4 text-[13px] text-ink-soft space-y-1.5">
              <p>Antigravity signs in from a terminal: run <code className="mono rounded-sm bg-inset px-1 py-0.5 text-[12px] text-ink">agy</code> once (it opens the browser), then refresh. <code className="mono rounded-sm bg-inset px-1 py-0.5 text-[12px] text-ink">/logout</code> inside agy signs out.</p>
              <p className="text-ink-faint">Antigravity holds one account: its CLI has no folder of its own to point at, and on macOS every agy sign-in shares one Keychain item.</p>
            </div>
          : account?.pool && <div className="border-t border-line px-4 sm:px-5 py-4"><AccountPoolList provider={provider} pool={account.pool} installed={account.installed} onChange={load} /></div>}
        <details className="group border-t border-line">
          <summary className="flex items-center gap-1.5 px-4 sm:px-5 py-3 text-xs font-semibold text-ink-soft hover:text-ink list-none [&::-webkit-details-marker]:hidden">
            <ChevronRight size={14} aria-hidden="true" className="transition-transform group-open:rotate-90" />
            What Foundry measures and manages for {name}
          </summary>
          <div className="px-4 sm:px-5 pb-4 space-y-3 text-xs leading-relaxed text-ink-soft">
            <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-3">
              <div><dt className={LABEL}>Usage & limits</dt><dd className="mt-1">{(account?.capabilities.dollarCosts ?? provider === 'claude') ? 'Estimated cost, tokens and USD budgets' : provider === 'agy' ? 'Foundry tokens, time, attempts and concurrency; no account quota is read' : 'Native ChatGPT account quota, plus Foundry tokens, time, attempts and concurrency. USD cost is unavailable.'}</dd></div>
              <div><dt className={LABEL}>Extensions</dt><dd className="mt-1">{provider === 'agy' ? 'Antigravity reads the skills Foundry places in a project\'s .agents folder and the servers configured in agy itself; its skills, MCP servers and plugins are managed in agy.' : 'Select Claude or Codex in Extensions to manage its skills and MCP servers independently.'}</dd></div>
              <div><dt className={LABEL}>Observability</dt><dd className="mt-1">{(account?.capabilities.skillTelemetry ?? provider === 'claude') ? 'Skill invocations and external Claude sessions' : provider === 'agy' ? 'Foundry sessions and tool logs' : 'Foundry sessions, tool logs and read-only external Codex history. External process status and skill invocation telemetry are unavailable.'}</dd></div>
              {!(account?.capabilities.nativeSubagents ?? provider === 'claude') && <div><dt className={LABEL}>Planning</dt><dd className="mt-1">Foundry schedules parallel tasks; the planner runs a separate read-only session before the Brief is approved.</dd></div>}
            </dl>
            <p className="text-ink-faint">Credentials are managed by {name} and shared with the local CLI. Signing out here also signs out that CLI.</p>
          </div>
        </details>
      </section>;
    })}</div>
    <div className="flex gap-4 text-sm"><Link className="font-semibold text-work-ink hover:underline self-center" to="/goals/new">Create a goal →</Link></div>
    {login && <SignInDialog provider={login} onClose={() => { setLogin(null); void load(); }} />}
    {logout && <ConfirmDialog open danger busy={busy} title={`Sign out of ${PROVIDER_LABEL[logout]}?`} confirmLabel="Sign out" onConfirm={signOut} onClose={() => setLogout(null)}>This also signs out the local CLI using the same credentials. The other provider stays signed in.</ConfirmDialog>}
  </div>;
}
