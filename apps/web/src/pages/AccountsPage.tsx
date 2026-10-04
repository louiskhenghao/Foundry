import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, type AccountsInfo, type AgentProvider } from '../api.ts';
import { SignInDialog } from '../components/SignInDialog.tsx';
import { Button, Card, ConfirmDialog } from '../ui.tsx';

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
      <div className="max-w-2xl"><h1 className="text-xl font-semibold">Agent accounts</h1><p className="text-sm text-zinc-400 mt-2">Connect Claude Code and Codex independently. Choose the coding agent when creating a goal; it stays fixed for that goal.</p></div>
      <Button disabled={busy || refreshing} onClick={load}><RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />Refresh status</Button>
    </div>
    <div className="min-h-5 text-xs" aria-live="polite">{error ? <p role="alert" className="text-rose-400">{error}</p> : <p className="text-zinc-500">{refreshing ? 'Checking native accounts…' : 'Account status is up to date.'}</p>}</div>
    <div className="grid md:grid-cols-2 gap-4" aria-busy={refreshing}>{(['claude', 'codex'] as const).map((provider) => {
      const account = info?.accounts.find(value => value.provider === provider);
      const name = provider === 'codex' ? 'Codex' : 'Claude Code';
      const status = account?.status;
      return <Card key={provider} className="min-h-[30rem]" title={<span>{name}{info?.defaultProvider === provider && <span className="ml-2 text-xs text-zinc-500">default for new goals</span>}</span>}>
        <p className={status?.loggedIn ? 'text-emerald-400' : 'text-amber-300'}>{!account ? (refreshing ? 'Checking account…' : 'Account status unavailable') : status?.loggedIn ? 'Connected' : account.installed ? 'Sign in required' : 'CLI not installed'}</p>
        <p className="text-sm text-zinc-400 mt-2">{status?.email ?? status?.authMethod ?? (provider === 'codex' ? 'Use your ChatGPT account' : 'Use your Claude subscription')}</p>
        <p className="text-xs text-zinc-500 mt-2 min-h-10">{status?.subscriptionType ? `Plan: ${status?.subscriptionType}. ` : null}Credentials are managed by {name} and shared with the local CLI. Signing out here also signs out that CLI.</p>
        <div className="flex gap-2 my-4"><Button disabled={busy || refreshing || !account?.installed} onClick={() => status?.loggedIn ? setLogout(provider) : setLogin(provider)}>{status?.loggedIn ? 'Sign out' : `Sign in to ${name}`}</Button></div>
        <p className="text-xs text-zinc-400 mb-3 min-h-4">{status?.error}</p>
        <dl className="text-xs leading-relaxed space-y-2 border-t border-zinc-800 pt-3">
          <div><dt className="text-zinc-500">Usage & limits</dt><dd>{(account?.capabilities.dollarCosts ?? provider === 'claude') ? 'Estimated cost, tokens and USD budgets' : 'Native ChatGPT account quota, plus Foundry tokens, time, attempts and concurrency. USD cost is unavailable.'}</dd></div>
          <div><dt className="text-zinc-500">Extensions</dt><dd>{'Select Claude or Codex in Extensions to manage its skills and MCP servers independently.'}</dd></div>
          <div><dt className="text-zinc-500">Observability</dt><dd>{(account?.capabilities.skillTelemetry ?? provider === 'claude') ? 'Skill invocations and external Claude sessions' : 'Foundry sessions, tool logs and read-only external Codex history. External process status and skill invocation telemetry are unavailable.'}</dd></div>
          {!(account?.capabilities.nativeSubagents ?? provider === 'claude') && <div><dt className="text-zinc-500">Planning</dt><dd>Foundry schedules parallel tasks; the planner runs a separate read-only session before the Brief is approved.</dd></div>}
        </dl>
      </Card>;
    })}</div>
    <div className="flex gap-4 text-sm"><Link className="text-emerald-400 self-center" to="/goals/new">Create a goal →</Link></div>
    {login && <SignInDialog provider={login} onClose={() => { setLogin(null); void load(); }} />}
    {logout && <ConfirmDialog open danger busy={busy} title={`Sign out of ${logout === 'codex' ? 'Codex' : 'Claude Code'}?`} confirmLabel="Sign out" onConfirm={signOut} onClose={() => setLogout(null)}>This also signs out the local CLI using the same credentials. The other provider stays signed in.</ConfirmDialog>}
  </div>;
}
