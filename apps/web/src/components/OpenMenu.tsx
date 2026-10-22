import { Check, ChevronDown, Code2, Copy, ExternalLink, Folder, Globe, TerminalSquare } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type OpenTarget } from '../api.ts';
import { Button, Menu, buttonClass, cn, code } from '../ui.tsx';

let cached: OpenTarget[] | null = null;

export interface OpenPlace {
  which: 'repo' | 'workspace' | `task:${string}` | `resolve:${string}`;
  label: string;
  path: string;
  hint?: string;
}

const ICON: Record<OpenTarget['id'], typeof Code2> = { vscode: Code2, cursor: Code2, zed: Code2, windsurf: Code2, finder: Folder, terminal: TerminalSquare, iterm: TerminalSquare, warp: TerminalSquare };
/** each kind of app in a category colour of its own (ADR-0067), the hues they had before themes: editors (VS Code on the web too) blue, the file manager amber, terminals green */
const EDITOR_INK = code(0).ink;
const KIND_INK: Record<OpenTarget['id'], string> = { vscode: EDITOR_INK, cursor: EDITOR_INK, zed: EDITOR_INK, windsurf: EDITOR_INK, finder: code(3).ink, terminal: code(1).ink, iterm: code(1).ink, warp: code(1).ink };

/** this page was opened from another device (over the tailnet), where localhost is that device */
const remote = () => typeof location !== 'undefined' && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

/**
 * "Open ▾" dropdown: for each place (repository checkout, goal worktree, task worktree) the editors / file
 * managers / terminals detected on this machine, plus copy-path, plus VS Code in the browser (code-server), which also
 * opens on a phone. Launching apps happens on the server (same machine). `working` = the coding agents are using the
 * goal's folders now, so edits made there can clash with theirs.
 */
export function OpenMenu({ goalId, places, size = 'sm', label = 'Open', working = false }: { goalId: string; places: OpenPlace[]; size?: 'sm' | 'md' | 'lg'; label?: string; working?: boolean }) {
  const [targets, setTargets] = useState<OpenTarget[] | null>(cached);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  // the web editor's password, shown once it opened so it can be pasted on its sign-in page
  const [password, setPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    if (!opened || targets) return;
    api
      .openTargets()
      .then((t) => {
        cached = t;
        setTargets(t);
      })
      .catch(() => setTargets([]));
  }, [opened]);

  const launch = async (which: OpenPlace['which'], t: OpenTarget, close: () => void) => {
    setStatus(null);
    try {
      await api.openGoal(goalId, t.id, which);
      setStatus({ kind: 'ok', text: `opened in ${t.label}` });
      setTimeout(close, 600);
    } catch (e: any) {
      setStatus({ kind: 'err', text: e.message });
    }
  };
  const openWeb = async (which: OpenPlace['which']) => {
    setStatus(null);
    // a window opened right away, before the await, is not taken for a popup
    const win = window.open('', '_blank');
    if (win) win.opener = null;
    try {
      const r = await api.openInEditor(goalId, which);
      setPassword(r.password);
      // on another device localhost is that device: only the tailnet address reaches this computer
      if (remote() && !r.tailnetUrl) {
        win?.close();
        setStatus({ kind: 'err', text: "VS Code (web) is not reachable from this device: it is not on your tailnet (Tailscale off or not running on Foundry's computer)" });
        return;
      }
      const url = remote() ? r.tailnetUrl! : r.url;
      if (win) win.location.href = url;
      else if (!window.open(url, '_blank', 'noopener')) {
        setStatus({ kind: 'err', text: `the browser blocked the new tab: open ${url} yourself` });
        return;
      }
      setStatus({ kind: 'ok', text: 'opened VS Code in the browser — sign in with the password below (once; the browser remembers it)' });
    } catch (e: any) {
      win?.close();
      setStatus({ kind: 'err', text: e.body?.code === 'not-installed' ? 'VS Code in the browser (code-server) is not installed — install it in Settings → Tools' : (e.body?.error ?? e.message) });
    }
  };
  const copy = (p: string) => {
    navigator.clipboard?.writeText(p);
    setCopied(p);
    setTimeout(() => setCopied(null), 1200);
  };
  const available = (targets ?? []).filter((t) => t.available);
  const editors = available.filter((t) => ['vscode', 'cursor', 'zed', 'windsurf'].includes(t.id));
  const others = available.filter((t) => !editors.includes(t));

  return (
    <Menu
      width="w-[22rem]"
      trigger={({ open, toggle }) => (
        // open, it is ringed in the accent (a ring, so it never fights the button's own fill and border)
        <Button
          size={size}
          className={cn(open && 'ring-1 ring-accent')}
          onClick={() => {
            if (!open) setOpened(true);
            toggle();
          }}
          title="Open the repository or the goal workspace in an editor, file manager or terminal"
        >
          <ExternalLink size={13} /> {label} <ChevronDown size={12} />
        </Button>
      )}
    >
      {(close) => (
        <div className="p-0.5 space-y-2">
          {/* each place on an inset box: its name and path, then the apps that open it as small buttons */}
          {places.map((pl) => (
            <div key={pl.which} className="rounded-lg bg-sunken p-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="shrink-0 text-[13px] font-bold text-ink">{pl.label}</span>
                {pl.hint && <span className="min-w-0 truncate text-ink-faint" title={pl.hint}>{pl.hint}</span>}
                <button className="ml-auto shrink-0 font-semibold text-ink-faint hover:text-ink flex items-center gap-1" onClick={() => copy(pl.path)} title={pl.path}>
                  {copied === pl.path ? <Check size={11} className="text-ok-ink" /> : <Copy size={11} />} path
                </button>
              </div>
              <div className="mono text-[11px] text-ink-faint truncate mt-0.5" title={pl.path}>
                {pl.path}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <button onClick={() => openWeb(pl.which)} title="VS Code in the browser (code-server), on this computer or your phone" className={buttonClass('default', 'sm')}>
                  <Globe size={12} className={EDITOR_INK} /> VS Code (web)
                </button>
              </div>
              {/* the goal at work, and looking for the apps, in the blue of work under way */}
              {working && pl.which !== 'repo' && <div className="text-[11px] font-semibold text-work-ink mt-1.5">The goal is running: edits made here can clash with the coding agents' and go into their next commit.</div>}
              {targets === null ? (
                <div className="text-work-ink mt-2">detecting apps…</div>
              ) : available.length === 0 ? (
                <div className="text-ink-faint mt-2">no editor / terminal detected — copy the path instead</div>
              ) : (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {[...editors, ...others].map((t) => {
                    const I = ICON[t.id];
                    return (
                      <button key={t.id} onClick={() => launch(pl.which, t, close)} title={t.via ?? t.label} className={buttonClass('default', 'sm')}>
                        <I size={12} className={KIND_INK[t.id]} /> {t.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
          {status && <div className={cn('px-1 font-semibold', status.kind === 'ok' ? 'text-ok-ink' : 'text-bad-ink')}>{status.text}</div>}
          {password && (
            <div className="flex items-center gap-1.5 px-1 text-ink-soft">
              VS Code (web) password: <span className="mono text-ink select-all">{password}</span>
              <button className="text-ink-faint hover:text-ink flex items-center gap-1" onClick={() => copy(password)} title="Copy the password">
                {copied === password ? <Check size={11} className="text-ok-ink" /> : <Copy size={11} />}
              </button>
            </div>
          )}
        </div>
      )}
    </Menu>
  );
}
