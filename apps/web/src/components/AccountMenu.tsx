import { LogOut, UserCircle2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type AuthInfo } from '../api.ts';
import { Button, Menu, cn } from '../ui.tsx';
import { SignInDialog } from './SignInDialog.tsx';

/** Header pill with the logged-in Claude account; Sign in / Sign out. */
export function AccountMenu() {
  const [info, setInfo] = useState<AuthInfo | null>(null);
  const [signIn, setSignIn] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const load = (force = false) => api.auth(force).then(setInfo).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(() => load(), 60_000);
    return () => clearInterval(t);
  }, []);

  if (!info) return null;
  const st = info.status;
  if (!st.loggedIn) {
    return (
      <>
        <button onClick={() => setSignIn(true)} className="flex items-center gap-1.5 rounded-md border border-rose-500/50 text-rose-300 px-2 py-1 text-[11px]">
          <UserCircle2 size={13} /> Sign in to Claude
        </button>
        {signIn && <SignInDialog onClose={() => { setSignIn(false); load(true); }} />}
      </>
    );
  }
  return (
    <Menu
      width="w-72"
      trigger={({ open, toggle }) => (
        <button
          onClick={() => {
            if (open) setConfirmOut(false);
            toggle();
          }}
          className={cn('flex items-center gap-1.5 rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-900', open && 'bg-zinc-900')}
          title={st.orgName ?? ''}
        >
          <UserCircle2 size={13} className="text-emerald-400" />
          <span className="mono hidden xl:inline">{st.email ?? 'signed in'}</span>
          {st.subscriptionType && <span className="rounded bg-emerald-500/15 text-emerald-300 px-1 uppercase text-[9px]">{st.subscriptionType}</span>}
        </button>
      )}
    >
      {(close) => (
        <div className="p-1.5 space-y-2">
          <div className="text-zinc-400">Signed in to Claude Code as</div>
          <div className="mono text-zinc-100">{st.email}</div>
          <div className="text-zinc-500">
            {st.subscriptionType ? `${st.subscriptionType} subscription` : st.authMethod} {st.orgName ? `· ${st.orgName}` : ''}
          </div>
          <div className="text-[10px] text-zinc-600">checked {new Date(st.checkedAt).toLocaleTimeString()} · credentials are managed by Claude Code, not by Foundry</div>
          <div className="flex gap-2 pt-1">
            {confirmOut ? (
              <>
                <Button size="sm" variant="danger" onClick={() => api.logout().then(() => { close(); setConfirmOut(false); load(true); })}>
                  Confirm sign out
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmOut(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setConfirmOut(true)}>
                <LogOut size={12} /> Sign out
              </Button>
            )}
          </div>
        </div>
      )}
    </Menu>
  );
}
