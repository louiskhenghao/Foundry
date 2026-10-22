import { AGENT_PROVIDERS, PROVIDER_LABEL } from '@foundry/core/browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, type AccountInfo, type AccountsInfo, type AgentProvider } from '../api.ts';
import { ProviderMark } from '../components/ProviderMark.tsx';
import { SignInDialog } from '../components/SignInDialog.tsx';
import { Button, ConfirmDialog, cn } from '../ui.tsx';
import { AccountPoolList } from './AccountPoolList.tsx';

type State = 'checking' | 'connected' | 'signin' | 'missing' | 'unknown';
const STATE: Record<State, { label: string; cls: string; dot: string }> = {
  checking: { label: 'Checking…', cls: 'border-zinc-700 text-zinc-400', dot: 'bg-zinc-500 animate-pulse' },
  connected: { label: 'Connected', cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300', dot: 'bg-emerald-400' },
  signin: { label: 'Sign in required', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300', dot: 'bg-amber-400' },
  missing: { label: 'CLI not installed', cls: 'border-zinc-700 text-zinc-400', dot: 'bg-zinc-600' },
  unknown: { label: 'Status unavailable', cls: 'border-zinc-700 text-zinc-400', dot: 'bg-zinc-600' },
};
/** how the CLI says it is signed in, in words; `none` says nothing the state does not */
const METHOD: Record<string, string> = { 'claude.ai': 'Claude subscription', oauth_token: 'Signed in with an OAuth token', api_key: 'API key', api_key_helper: 'API key helper', oauth: 'Google account', ChatGPT: 'ChatGPT account' };
const methodOf = (m: string | null | undefined) => (m && m !== 'none' ? (METHOD[m] ?? m) : null);
const stateOf = (account: AccountInfo | undefined, refreshing: boolean): State => (!account ? (refreshing ? 'checking' : 'unknown') : account.status.loggedIn ? 'connected' : account.installed ? 'signin' : 'missing');

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
  return <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-5">
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div className="max-w-2xl"><h1 className="text-xl font-semibold">Agent accounts</h1><p className="text-sm text-zinc-400 mt-2">Connect Claude Code, Codex and Antigravity independently. Choose the coding agent when creating a goal; it stays fixed for that goal. Claude Code and Codex can hold several of your accounts: new sessions run on the current one.</p></div>
      <Button disabled={busy || refreshing} onClick={load}><RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />Refresh status</Button>
    </div>
    <div className="min-h-5 text-xs" aria-live="polite">{error ? <p role="alert" className="text-rose-400">{error}</p> : <p className="text-zinc-500">{refreshing ? 'Checking native accounts…' : 'Account status is up to date.'}</p>}</div>
    <div className="space-y-4" aria-busy={refreshing}>{AGENT_PROVIDERS.map((provider) => {
      const account = info?.accounts.find(value => value.provider === provider);
      const name = PROVIDER_LABEL[provider];
      const status = account?.status;
      const state = STATE[stateOf(account, refreshing)];
      const who = [status?.email, status?.subscriptionType && `Plan: ${status.subscriptionType}`].filter(Boolean).join(' · ') || methodOf(status?.authMethod) || (provider === 'codex' ? 'Use your ChatGPT account' : provider === 'agy' ? 'Use your Google account' : 'Use your Claude subscription');
      return <section key={provider} aria-labelledby={`agent-${provider}`} className="rounded-xl border border-zinc-800 bg-zinc-900/60">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4 sm:px-5">
          <ProviderMark provider={provider} size="lg" />
          <div className="min-w-0 grow basis-48">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 id={`agent-${provider}`} className="text-base font-semibold text-zinc-100">{name}</h2>
              {info?.defaultProvider === provider && <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] leading-none text-zinc-400">default for new goals</span>}
            </div>
            <p className="text-sm text-zinc-400 mt-0.5 truncate" title={who}>{who}</p>
          </div>
          <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium', state.cls)}><span className={cn('h-1.5 w-1.5 rounded-full', state.dot)} aria-hidden="true" />{state.label}</span>
          {provider !== 'agy' && <Button disabled={busy || refreshing || !account?.installed} variant={status?.loggedIn ? 'default' : 'primary'} onClick={() => status?.loggedIn ? setLogout(provider) : setLogin(provider)}>{status?.loggedIn ? 'Sign out' : `Sign in to ${name}`}</Button>}
        </header>
        {status?.error && <p className="px-4 sm:px-5 -mt-1 pb-3 text-xs text-zinc-400">{status.error}</p>}
        {provider === 'agy'
          ? <div className="border-t border-zinc-800 px-4 sm:px-5 py-4 text-xs text-zinc-400 space-y-1.5">
              <p>Antigravity signs in from a terminal: run <code className="text-zinc-200">agy</code> once (it opens the browser), then refresh. <code className="text-zinc-200">/logout</code> inside agy signs out.</p>
              <p className="text-zinc-500">Antigravity holds one account: its CLI has no folder of its own to point at, and on macOS every agy sign-in shares one Keychain item.</p>
            </div>
          : account?.pool && <div className="border-t border-zinc-800 px-4 sm:px-5 py-4"><AccountPoolList provider={provider} pool={account.pool} installed={account.installed} onChange={load} /></div>}
        <details className="group border-t border-zinc-800">
          <summary className="flex items-center gap-1.5 px-4 sm:px-5 py-2.5 text-xs text-zinc-400 hover:text-zinc-200 list-none [&::-webkit-details-marker]:hidden">
            <ChevronRight size={14} aria-hidden="true" className="transition-transform group-open:rotate-90" />
            What Foundry measures and manages for {name}
          </summary>
          <div className="px-4 sm:px-5 pb-4 space-y-3 text-xs leading-relaxed">
            <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-3">
              <div><dt className="text-zinc-500">Usage & limits</dt><dd>{(account?.capabilities.dollarCosts ?? provider === 'claude') ? 'Estimated cost, tokens and USD budgets' : provider === 'agy' ? 'Foundry tokens, time, attempts and concurrency; no account quota is read' : 'Native ChatGPT account quota, plus Foundry tokens, time, attempts and concurrency. USD cost is unavailable.'}</dd></div>
              <div><dt className="text-zinc-500">Extensions</dt><dd>{provider === 'agy' ? 'Antigravity reads the skills Foundry places in a project\'s .agents folder and the servers configured in agy itself; its skills, MCP servers and plugins are managed in agy.' : 'Select Claude or Codex in Extensions to manage its skills and MCP servers independently.'}</dd></div>
              <div><dt className="text-zinc-500">Observability</dt><dd>{(account?.capabilities.skillTelemetry ?? provider === 'claude') ? 'Skill invocations and external Claude sessions' : provider === 'agy' ? 'Foundry sessions and tool logs' : 'Foundry sessions, tool logs and read-only external Codex history. External process status and skill invocation telemetry are unavailable.'}</dd></div>
              {!(account?.capabilities.nativeSubagents ?? provider === 'claude') && <div><dt className="text-zinc-500">Planning</dt><dd>Foundry schedules parallel tasks; the planner runs a separate read-only session before the Brief is approved.</dd></div>}
            </dl>
            <p className="text-zinc-500">Credentials are managed by {name} and shared with the local CLI. Signing out here also signs out that CLI.</p>
          </div>
        </details>
      </section>;
    })}</div>
    <div className="flex gap-4 text-sm"><Link className="text-emerald-400 self-center" to="/goals/new">Create a goal →</Link></div>
    {login && <SignInDialog provider={login} onClose={() => { setLogin(null); void load(); }} />}
    {logout && <ConfirmDialog open danger busy={busy} title={`Sign out of ${PROVIDER_LABEL[logout]}?`} confirmLabel="Sign out" onConfirm={signOut} onClose={() => setLogout(null)}>This also signs out the local CLI using the same credentials. The other provider stays signed in.</ConfirmDialog>}
  </div>;
}
