import { useEffect, useState } from 'react';
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
  const load = () => api.accounts(true).then((value) => { setInfo(value); setError(''); }).catch((e) => setError(e.message));
  useEffect(() => { void load(); }, []);
  const signOut = async () => {
    if (!logout) return;
    setBusy(true); setError('');
    try { await api.logout(logout); setLogout(null); await load(); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-5">
    <div><h1 className="text-xl font-semibold">Agent accounts</h1><p className="text-sm text-zinc-400 mt-2">Connect Claude Code and Codex independently. Choose the backend when creating a goal; it stays fixed for that goal.</p></div>
    {error && <p role="alert" className="text-sm text-rose-400">{error}</p>}
    {!info && !error && <p>Loading accounts…</p>}
    <div className="grid md:grid-cols-2 gap-4">{info?.accounts.map((account) => {
      const name = account.provider === 'codex' ? 'Codex' : 'Claude Code';
      return <Card key={account.provider} title={<span>{name}{info.defaultProvider === account.provider && <span className="ml-2 text-xs text-zinc-500">default for new goals</span>}</span>}>
        <p className={account.status.loggedIn ? 'text-emerald-400' : 'text-amber-300'}>{account.status.loggedIn ? 'Connected' : account.installed ? 'Sign in required' : 'CLI not installed'}</p>
        <p className="text-sm text-zinc-400 mt-2">{account.status.email ?? account.status.authMethod ?? (account.provider === 'codex' ? 'Use your ChatGPT account' : 'Use your Claude subscription')}</p>
        <p className="text-xs text-zinc-500 mt-2">{account.status.subscriptionType ? `Plan: ${account.status.subscriptionType}. ` : null}Credentials are managed by {name} and shared with the local CLI. Signing out here also signs out that CLI.</p>
        <div className="flex gap-2 my-4"><Button disabled={busy || !account.installed} onClick={() => account.status.loggedIn ? setLogout(account.provider) : setLogin(account.provider)}>{account.status.loggedIn ? 'Sign out' : `Sign in to ${name}`}</Button></div>
        {account.status.error && <p className="text-xs text-zinc-400 mb-3">{account.status.error}</p>}
        <dl className="text-sm space-y-2 border-t border-zinc-800 pt-3">
          <div><dt className="text-zinc-500">Usage & limits</dt><dd>{account.capabilities.dollarCosts ? 'Estimated cost, tokens and USD budgets' : 'Native ChatGPT account quota, plus Foundry tokens, time, attempts and concurrency. USD cost is unavailable.'}</dd></div>
          <div><dt className="text-zinc-500">Extensions</dt><dd>{'Select Claude or Codex in Extensions to manage its skills and MCP servers independently.'}</dd></div>
          <div><dt className="text-zinc-500">Observability</dt><dd>{account.capabilities.skillTelemetry ? 'Skill invocations and external Claude sessions' : 'Foundry sessions, tool logs and read-only external Codex history. External process status and skill invocation telemetry are unavailable.'}</dd></div>
          {!account.capabilities.nativeSubagents && <div><dt className="text-zinc-500">Planning</dt><dd>Foundry schedules parallel tasks; the planner runs a separate read-only session before the Brief is approved.</dd></div>}
        </dl>
      </Card>;
    })}</div>
    <div className="flex gap-4 text-sm"><Button disabled={busy} onClick={load}>Refresh status</Button><Link className="text-emerald-400 self-center" to="/goals/new">Create a goal →</Link></div>
    {login && <SignInDialog provider={login} onClose={() => { setLogin(null); void load(); }} />}
    {logout && <ConfirmDialog open danger busy={busy} title={`Sign out of ${logout === 'codex' ? 'Codex' : 'Claude Code'}?`} confirmLabel="Sign out" onConfirm={signOut} onClose={() => setLogout(null)}>This also signs out the local CLI using the same credentials. The other provider stays signed in.</ConfirmDialog>}
  </div>;
}
