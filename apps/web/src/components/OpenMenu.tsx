import { Check, ChevronDown, Code2, Copy, ExternalLink, Folder, TerminalSquare } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type OpenTarget } from '../api.ts';
import { Button, Menu, cn } from '../ui.tsx';

let cached: OpenTarget[] | null = null;

export interface OpenPlace {
  which: 'repo' | 'workspace' | `task:${string}` | `resolve:${string}`;
  label: string;
  path: string;
  hint?: string;
}

const ICON: Record<OpenTarget['id'], typeof Code2> = { vscode: Code2, cursor: Code2, zed: Code2, windsurf: Code2, finder: Folder, terminal: TerminalSquare, iterm: TerminalSquare, warp: TerminalSquare };

/**
 * "Open ▾" dropdown: for each place (repository checkout, goal worktree, task worktree) the editors / file
 * managers / terminals detected on this machine, plus copy-path. Launching happens on the server (same machine).
 */
export function OpenMenu({ goalId, places, size = 'sm', label = 'Open' }: { goalId: string; places: OpenPlace[]; size?: 'sm' | 'md'; label?: string }) {
  const [targets, setTargets] = useState<OpenTarget[] | null>(cached);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
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
        <Button
          size={size}
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
          {places.map((pl) => (
            <div key={pl.which} className="rounded-md border border-zinc-800/80 p-2">
              <div className="flex items-center gap-2">
                <span className="text-zinc-200 font-medium">{pl.label}</span>
                {pl.hint && <span className="text-zinc-500">{pl.hint}</span>}
                <button className="ml-auto text-zinc-500 hover:text-zinc-200 flex items-center gap-1" onClick={() => copy(pl.path)} title={pl.path}>
                  {copied === pl.path ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />} path
                </button>
              </div>
              <div className="mono text-[10px] text-zinc-600 truncate mt-0.5" title={pl.path}>
                {pl.path}
              </div>
              {targets === null ? (
                <div className="text-zinc-500 mt-1.5">detecting apps…</div>
              ) : available.length === 0 ? (
                <div className="text-zinc-500 mt-1.5">no editor / terminal detected — copy the path instead</div>
              ) : (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {[...editors, ...others].map((t) => {
                    const I = ICON[t.id];
                    return (
                      <button key={t.id} onClick={() => launch(pl.which, t, close)} title={t.via ?? t.label} className={cn('flex items-center gap-1 rounded border px-1.5 py-1 hover:border-zinc-500', 'border-zinc-800 text-zinc-200')}>
                        <I size={12} className={['vscode', 'cursor', 'zed', 'windsurf'].includes(t.id) ? 'text-sky-300' : t.id === 'finder' ? 'text-amber-300' : 'text-emerald-300'} /> {t.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
          {status && <div className={status.kind === 'ok' ? 'text-emerald-300' : 'text-rose-300'}>{status.text}</div>}
        </div>
      )}
    </Menu>
  );
}
