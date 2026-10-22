import { PROVIDER_LABEL } from '@foundry/core/browser';
import { ArrowDown, ArrowUp, Check, Clock, Laptop, Plus, Repeat, Users } from 'lucide-react';
import { useState } from 'react';
import { api, type AccountPoolInfo, type AgentProvider, type PoolAccount } from '../api.ts';
import { PROVIDER_STYLE } from '../components/ProviderMark.tsx';
import { SignInDialog } from '../components/SignInDialog.tsx';
import { Button, ConfirmDialog, choiceClass, cn } from '../ui.tsx';

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
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2.5 text-[12.5px] font-extrabold uppercase tracking-[0.12em] text-ink">
          <Users size={14} aria-hidden="true" />
          Accounts <b className="mono text-[13px] tracking-normal">{pool.accounts.length}</b>
        </h3>
        <Button size="sm" disabled={busy || !installed} onClick={() => setAdding(true)} title={`Sign in with another ${name} subscription of yours`}>
          <Plus size={13} aria-hidden="true" />
          Add account
        </Button>
      </div>
      <ul className="space-y-2" aria-label={`${name} accounts`}>
        {pool.accounts.map((a) => {
          const i = added.findIndex((x) => x.id === a.id);
          const native = a.id === 'native';
          const signedOut = !!a.status && !a.status.loggedIn && !native;
          const meta = [a.plan, native ? (a.email ? 'this computer’s sign-in' : null) : 'added in Foundry'].filter(Boolean).join(' · ');
          return (
            // the current account ringed in the accent with a "current" plate, as the theme in use is on Appearance (an
            // inset-ring: with ring-inset the theme's colour named inset would win over ring-accent)
            <li key={a.id} className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-panel px-3 py-2.5', a.current ? 'inset-ring-2 inset-ring-accent' : 'inset-ring inset-ring-line')}>
              <span aria-hidden="true" className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full border text-xs font-bold uppercase', a.current ? PROVIDER_STYLE[provider].tile : 'border-line-strong bg-inset text-ink-soft')}>
                {a.email ? a.email[0] : <Laptop size={15} strokeWidth={1.75} />}
              </span>
              <div className="min-w-0 grow basis-40">
                <div className="truncate text-sm font-bold text-ink" title={a.email ?? undefined}>{a.email ?? (native ? 'This computer’s sign-in' : 'Signed out')}</div>
                {meta && <div className="truncate text-xs text-ink-faint">{meta}</div>}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {a.current && <span className="inline-flex items-center gap-1 rounded-sm bg-accent px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.07em] text-on-accent"><Check size={11} aria-hidden="true" />current</span>}
                {/* a limit that lifts by itself: a quiet chip; a lost sign-in is yours to redo, so it is yellow */}
                {a.limitedUntil && <span className="inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[11px] font-semibold text-ink-soft inset-ring inset-ring-line-strong"><Clock size={11} aria-hidden="true" />limited until <span className="mono">{at(a.limitedUntil)}</span></span>}
                {signedOut && <span className="rounded-sm bg-you px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.07em] text-on-you" title="Remove it and add it again">signed out</span>}
              </div>
              {(!a.current || !native) && (
                <span className="ml-auto flex items-center gap-0.5">
                  {!a.current && <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => api.useAccount(provider, a.id))} title="New sessions run on this account; sessions already running finish on theirs">Use now</Button>}
                  {i > 0 && <Button size="sm" variant="ghost" disabled={busy} aria-label="Try earlier" title="Try earlier" onClick={() => move(a.id, -1)}><ArrowUp size={13} /></Button>}
                  {i >= 0 && i < added.length - 1 && <Button size="sm" variant="ghost" disabled={busy} aria-label="Try later" title="Try later" onClick={() => move(a.id, 1)}><ArrowDown size={13} /></Button>}
                  {!native && <Button size="sm" variant="ghost" className="hover:text-bad-ink" disabled={busy} onClick={() => setRemoving(a)}>Remove</Button>}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <label className={cn('flex items-start gap-3 rounded-lg border px-3 py-2.5', choiceClass(pool.autoSwitch), pool.accounts.length < 2 && 'opacity-70')}>
        <input type="checkbox" className="mt-0.5" disabled={busy || pool.accounts.length < 2} checked={pool.autoSwitch} onChange={(e) => toggle(e.target.checked)} />
        <span className="min-w-0 grow">
          <span className="block text-sm font-semibold text-ink">Switch accounts when a usage limit stops a session</span>
          <span className="block mt-0.5 text-xs text-ink-faint">{pool.accounts.length < 2 ? 'Add a second account first.' : pool.autoSwitch ? 'On: new sessions move to the next account, and the stopped session resumes there.' : 'Off: new sessions pause until the limit resets; the pause offers to switch.'}</span>
        </span>
        <Repeat size={15} aria-hidden="true" className={cn('mt-0.5 shrink-0', pool.autoSwitch ? 'text-ink' : 'text-ink-faint')} />
      </label>
      {error && <p role="alert" className="text-xs text-bad-ink">{error}</p>}
      {adding && <SignInDialog provider={provider} add onClose={() => { setAdding(false); onChange(); }} />}
      <ConfirmDialog open={!!removing} danger busy={busy} title={`Remove ${removing?.email ?? 'this account'}?`} confirmLabel="Remove" onClose={() => setRemoving(null)} onConfirm={() => act(async () => { await api.removeAccount(provider, removing!.id); setRemoving(null); })}>
        Foundry signs it out and deletes its folder; what it shared with this computer’s sign-in stays. New sessions it was current for go back to this computer’s sign-in.
      </ConfirmDialog>
      <ConfirmDialog open={terms} busy={busy} confirmDisabled={!mine} title={`Switch ${name} accounts automatically?`} confirmLabel="Turn on" onClose={() => setTerms(false)} onConfirm={() => act(async () => { await api.setAutoSwitch(provider, true); setTerms(false); })}>
        <p>When the current account’s usage limit stops a session, new sessions move to your next {name} account and the stopped session resumes there.</p>
        {/* the provider's own words, set apart as a quote */}
        {t && <p className="border-l-[3px] border-line-strong pl-3 text-ink">{t.quote} (<a className="underline" href={t.url} target="_blank" rel="noreferrer">{t.source}</a>)</p>}
        <p>Going on past a limit with another account may be read as against these terms, and the provider may restrict or suspend the accounts. Add only accounts that are yours.</p>
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-0.5" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          <span>These accounts are mine, and I accept that risk.</span>
        </label>
      </ConfirmDialog>
    </div>
  );
}
