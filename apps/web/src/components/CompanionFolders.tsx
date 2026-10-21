import { FolderPlus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type RepoInfo } from '../api.ts';
import { Button, Input } from '../ui.tsx';
import { HelpLink } from '../pages/HelpPage.tsx';

/** one companion folder's standing: a repository on a branch, or why not */
function Standing({ path, main }: { path: string; main: string }) {
  const [info, setInfo] = useState<RepoInfo | null | 'checking'>('checking');
  useEffect(() => {
    let current = true;
    setInfo('checking');
    const t = setTimeout(() => api.validateRepo(path).then((i) => current && setInfo(i)).catch(() => current && setInfo(null)), 300);
    return () => {
      current = false;
      clearTimeout(t);
    };
  }, [path]);
  if (!path.trim()) return null;
  if (path.trim() === main) return <span className="text-rose-300">that is the goal's own folder</span>;
  if (info === 'checking') return <span className="text-zinc-500">checking…</span>;
  if (!info) return <span className="text-rose-300">could not be checked</span>;
  if (!info.ok) return <span className="text-rose-300">{info.error ?? 'not a repository'}</span>;
  return (
    <span className="text-emerald-300">
      repository on <span className="mono">{info.branch}</span>
    </span>
  );
}

/**
 * Companion repositories (ADR-0063): the other folders a goal changes. Each gets its part as a delegated goal in that
 * repository, on its own branch, delivered with this goal.
 */
export function CompanionFolders({ value, onChange, main }: { value: string[]; onChange: (paths: string[]) => void; main: string }) {
  const set = (i: number, p: string) => onChange(value.map((v, j) => (j === i ? p : v)));
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));
  return (
    <div className="mt-3 space-y-1.5" data-testid="companion-folders">
      <div className="text-xs text-zinc-300">
        Also change these folders <span className="text-zinc-500">(optional)</span>
        <HelpLink to="your-first-goal#also-change-companion-folders" className="ml-1.5" />
      </div>
      <p className="text-[11px] text-zinc-500">Other repositories this goal must change too — a backend beside the frontend that calls it. The planner gives each its part as a delegated goal in that repository, on that folder's current branch; it is delivered with this goal, as a pull request of its own.</p>
      {value.map((p, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <Input className="mono text-xs max-w-md" value={p} placeholder="/path/to/the/other/repository" onChange={(e) => set(i, e.target.value)} />
          <span className="text-[11px]">
            <Standing path={p} main={main} />
          </span>
          <Button size="sm" variant="ghost" onClick={() => remove(i)} title="Leave this folder out">
            <X size={13} />
          </Button>
        </div>
      ))}
      <Button size="sm" variant="ghost" onClick={() => onChange([...value, ''])} title="Name another repository this goal changes">
        <FolderPlus size={13} /> Add a folder
      </Button>
    </div>
  );
}
