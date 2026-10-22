import { PROVIDER_LABEL } from '@foundry/core/browser';
import { ArrowDown, ArrowUp, Plus } from 'lucide-react';
import { useState } from 'react';
import { api, type AccountPoolInfo, type AgentProvider, type PoolAccount } from '../api.ts';
import { SignInDialog } from '../components/SignInDialog.tsx';
import { Button, ConfirmDialog, cn } from '../ui.tsx';

/**
 * What the provider's terms say about going on past a usage limit with another account, quoted where Auto switch is
 * turned on (ADR-0065): the person decides knowing it, and only for accounts of their own.
 */
const TERMS: Partial<Record<AgentProvider, { quote: string; source: string; url: string }>> = {
  claude: {
    quote: '“Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK.” Anthropic “reserves the right to take measures to enforce these restrictions and may do so without prior notice.”',
    source: 'Claude Code legal and compliance',
    url: 'https://code.claude.com/docs/en/legal-and-compliance',
  },
  codex: {
    quote: 'OpenAI’s Terms of Use forbid using the services to “circumvent any rate limits or restrictions”.',
    source: 'OpenAI Terms of Use',
    url: 'https://openai.com/policies/terms-of-use/',
  },
};

/** "15:04" today, "Tue 14:04" another day */
const at = (iso: string) => {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
};

/** A coding agent's sign-ins on the Accounts page: which one new sessions run on, the others, and Auto switch. */
export function AccountPoolList({ provider, pool, installed, onChange }: { provider: AgentProvider; pool: AccountPoolInfo; installed: boolean; onChange: () => void }) {
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<PoolAccount | null>(null);
  const [terms, setTerms] = useState(false);
  const [mine, setMine] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const name = PROVIDER_LABEL[provider];
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      onChange();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const added = pool.accounts.filter((a) => a.id !== 'native');
  const move = (id: string, by: -1 | 1) => {
    const order = added.map((a) => a.id);
    const i = order.indexOf(id);
    [order[i], order[i + by]] = [order[i + by]!, order[i]!];
    void act(() => api.orderAccounts(provider, order));
  };
  const toggle = (on: boolean) => {
    if (on) {
      setMine(false);
      setTerms(true);
    } else void act(() => api.setAutoSwitch(provider, false));
  };
  const t = TERMS[provider];
  return (
    <div className="border-t border-zinc-800 pt-3 mb-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-zinc-300">Accounts</h3>
        <Button size="sm" disabled={busy || !installed} onClick={() => setAdding(true)} title={`Sign in with another ${name} subscription of yours`}>
          <Plus size={12} aria-hidden="true" />
          Add account
        </Button>
      </div>
      <ul className="space-y-1.5" aria-label={`${name} accounts`}>
        {pool.accounts.map((a) => {
          const i = added.findIndex((x) => x.id === a.id);
          return (
            <li key={a.id} className={cn('rounded-md border px-2 py-1.5 text-xs', a.current ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-zinc-800')}>
              <div className="flex items-center gap-2 min-w-0">
                <span className="truncate text-zinc-200" title={a.email ?? undefined}>{a.email ?? (a.id === 'native' ? 'this computer’s sign-in' : 'signed out')}</span>
                {a.current && <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 text-[10px] text-emerald-300">current</span>}
              </div>
              <div className="flex items-center gap-2 flex-wrap mt-1 text-[11px] text-zinc-500">
                {/* the native sign-in without an email is named so above already */}
                <span>{[a.plan, a.id === 'native' && a.email ? 'this computer’s sign-in' : null].filter(Boolean).join(' · ')}</span>
                {a.limitedUntil && <span className="text-amber-300">limited until {at(a.limitedUntil)}</span>}
                {a.status && !a.status.loggedIn && a.id !== 'native' && <span className="text-rose-300">signed out — remove it and add it again</span>}
                <span className="ml-auto flex items-center gap-1">
                  {!a.current && <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => api.useAccount(provider, a.id))} title="New sessions run on this account; sessions already running finish on theirs">Use now</Button>}
                  {i > 0 && <Button size="sm" variant="ghost" disabled={busy} aria-label="Try earlier" onClick={() => move(a.id, -1)}><ArrowUp size={12} /></Button>}
                  {i >= 0 && i < added.length - 1 && <Button size="sm" variant="ghost" disabled={busy} aria-label="Try later" onClick={() => move(a.id, 1)}><ArrowDown size={12} /></Button>}
                  {a.id !== 'native' && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRemoving(a)}>Remove</Button>}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      <label className="flex items-start gap-2 text-xs text-zinc-300">
        <input type="checkbox" className="mt-0.5 accent-emerald-500" disabled={busy || pool.accounts.length < 2} checked={pool.autoSwitch} onChange={(e) => toggle(e.target.checked)} />
        <span>
          Switch accounts when a usage limit stops a session
          <span className="block text-[11px] text-zinc-500">{pool.accounts.length < 2 ? 'Add a second account first.' : pool.autoSwitch ? 'On: new sessions move to the next account, and the stopped session resumes there.' : 'Off: new sessions pause until the limit resets; the pause offers to switch.'}</span>
        </span>
      </label>
      {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}
      {adding && <SignInDialog provider={provider} add onClose={() => { setAdding(false); onChange(); }} />}
      <ConfirmDialog open={!!removing} danger busy={busy} title={`Remove ${removing?.email ?? 'this account'}?`} confirmLabel="Remove" onClose={() => setRemoving(null)} onConfirm={() => act(async () => { await api.removeAccount(provider, removing!.id); setRemoving(null); })}>
        Foundry signs it out and deletes its folder; what it shared with this computer’s sign-in stays. New sessions it was current for go back to this computer’s sign-in.
      </ConfirmDialog>
      <ConfirmDialog open={terms} busy={busy} confirmDisabled={!mine} title={`Switch ${name} accounts automatically?`} confirmLabel="Turn on" onClose={() => setTerms(false)} onConfirm={() => act(async () => { await api.setAutoSwitch(provider, true); setTerms(false); })}>
        <p>When the current account’s usage limit stops a session, new sessions move to your next {name} account and the stopped session resumes there.</p>
        {t && <p className="text-amber-200">{t.quote} (<a className="underline" href={t.url} target="_blank" rel="noreferrer">{t.source}</a>)</p>}
        <p>Going on past a limit with another account may be read as against these terms, and the provider may restrict or suspend the accounts. Add only accounts that are yours.</p>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5 accent-emerald-500" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          <span>These accounts are mine, and I accept that risk.</span>
        </label>
      </ConfirmDialog>
    </div>
  );
}
