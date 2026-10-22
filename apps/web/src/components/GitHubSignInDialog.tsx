import { ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type GhLoginSession } from '../api.ts';
import { Button, CopyButton, Modal, cn } from '../ui.tsx';

/**
 * Signs the GitHub CLI in from the page (`gh auth login --web`, run by the engine): copy the one-time code, enter it on
 * GitHub's device page, approve; the window follows by itself. Works the same when Foundry runs in a container or on
 * another machine, since nothing has to open on the computer running it.
 */
export function GitHubSignInDialog({ onClose }: { onClose: () => void }) {
  const [session, setSession] = useState<GhLoginSession | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.githubLogin().then((r) => setSession(r.session)).catch((e) => setErr(e.message));
  }, []);
  useEffect(() => {
    if (!session || session.done) return;
    const t = setInterval(() => api.githubLoginSession().then((r) => r.session && setSession(r.session)).catch(() => {}), 1500);
    return () => clearInterval(t);
  }, [session?.id, session?.done]);
  const waitingForCode = session && !session.done && !session.code;
  return (
    <Modal open title="Sign in to GitHub" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p className="text-xs text-ink-soft">For pushing branches and opening and merging pull requests. The GitHub CLI keeps the credential; Foundry never sees your password or token.</p>
        {err && <div className="text-xs text-bad-ink">{err}</div>}
        {!session && !err && <div className="text-xs text-ink-faint">Starting…</div>}
        {session && (
          <>
            {/* signed in: green · failed: red · waiting for your approval on GitHub: yellow, it waits for you · asking: quiet */}
            <div className={cn('rounded-md border p-3', session.done ? (session.ok ? 'border-ok/40 bg-ok/5 text-ok-ink' : 'border-bad/40 bg-bad/5 text-bad-ink') : waitingForCode ? 'border-line bg-inset text-ink-soft' : 'border-you/60 bg-you/10 font-semibold text-ink')}>
              {session.done ? (session.ok ? `✔ Signed in${session.login ? ` as ${session.login}` : ''}.` : `✘ ${session.error ?? 'Sign-in failed'}`) : waitingForCode ? 'Asking GitHub for a code…' : 'Waiting for you to approve on GitHub…'}
            </div>
            {!session.done && session.code && (
              <ol className="space-y-3 text-xs text-ink-soft list-decimal pl-4">
                <li>
                  Copy the one-time code:
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="mono text-2xl font-bold tracking-widest text-ink rounded-md bg-inset px-3 py-1 ring-1 ring-inset ring-line-strong">{session.code}</span>
                    <CopyButton text={session.code} />
                  </div>
                </li>
                <li>
                  Open GitHub's device page, paste the code and approve:
                  {session.url && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <a className="underline text-work-ink flex items-center gap-1 truncate" href={session.url} target="_blank" rel="noreferrer noopener">
                        <ExternalLink size={12} /> {session.url}
                      </a>
                      <CopyButton text={session.url} />
                    </div>
                  )}
                </li>
                <li>Come back here: this window updates by itself.</li>
              </ol>
            )}
            {session.lines.length > 0 && (
              <details className="text-[11px] text-ink-faint">
                <summary className="cursor-pointer">gh output</summary>
                <pre className="mono mt-1 bg-inset border border-line rounded-md p-2 max-h-40 overflow-auto whitespace-pre-wrap">{session.lines.slice(-12).join('\n')}</pre>
              </details>
            )}
          </>
        )}
        <div className="flex justify-end gap-2">
          {session && !session.done ? (
            <Button size="sm" variant="ghost" onClick={() => api.githubLoginCancel().finally(onClose)}>
              Cancel
            </Button>
          ) : (
            <Button size="sm" variant="primary" onClick={onClose}>
              {session?.ok ? 'Done' : 'Close'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
