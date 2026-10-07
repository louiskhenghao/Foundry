import type { Goal } from '@foundry/core/browser';
import { useEffect, useState } from 'react';
import { api } from '../../api.ts';
import { OpenMenu } from '../../components/OpenMenu.tsx';
import { Button, CopyButton } from '../../ui.tsx';

/** what happens to this branch when the goal is done, per delivery mode (changeable on the Delivery tab) */
const DELIVERY_NOTE: Record<string, string> = {
  local: 'Delivery is Local only: nothing is pushed, the branch stays on this machine. Change it on the Delivery tab.',
  push: 'When the goal is done, Foundry pushes this branch.',
  pr: 'When the goal is done, Foundry pushes this branch and opens a pull request.',
  'pr-automerge': 'When the goal is done, Foundry opens a pull request and merges it once its checks pass.',
};

/**
 * "Where is the work and how do I try it by hand?", the top of the Workspace & preview card: the goal branch lives in an
 * engine-owned worktree, never in the person's checkout. The commands to run it yourself are folded away. Nothing is
 * shown once the folder was cleaned up after the merge; the preview's location line says where it runs instead.
 */
export function WorkspaceDetails({ goal: g }: { goal: Goal }) {
  const [ws, setWs] = useState<Awaited<ReturnType<typeof api.workspace>> | null>(null);
  const [pullMsg, setPullMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api.workspace(g.id).then(setWs).catch(() => setWs(null));
  useEffect(() => {
    load();
  }, [g.id, g.updatedAt]);
  if (!ws?.exists) return null;
  const cd = `cd "${ws.path}"`;
  const sync = ws.baseSync;
  const up = ws.upstream;
  const pull = async () => {
    setBusy(true);
    setPullMsg(null);
    try {
      const r = await api.repoPull(g.repoPath, g.baseBranch);
      setPullMsg(r.detail);
      await load();
    } catch (e: any) {
      setPullMsg(e.body?.detail ?? e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-1.5 border-b border-zinc-800 pb-2.5">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[11px] text-zinc-500">
          Workers commit to <span className="mono text-zinc-300">{g.branch}</span> in the goal's folder, a worktree of your repository; your own checkout on <span className="mono">{g.baseBranch}</span> is never touched.
          {ws.head && (
            <>
              {' '}
              Latest commit <span className="mono text-zinc-400">{ws.head}</span>.
            </>
          )}
        </p>
        <OpenMenu goalId={g.id} places={[{ which: 'workspace', label: 'Goal workspace', path: ws.path, hint: `branch ${g.branch}` }, { which: 'repo', label: 'Repository', path: g.repoPath, hint: `your checkout · ${g.baseBranch}` }]} working={['running', 'goal_review'].includes(g.state)} />
      </div>
      {sync && (
        <div className="text-[11px] text-zinc-500">
          {sync.startedFrom === 'remote' ? (
            <>
              Started from <span className="mono text-zinc-300">{sync.remote}/{sync.base}</span>; your local <span className="mono">{sync.base}</span> was {sync.behind} commit{sync.behind === 1 ? '' : 's'} behind when the goal began.
            </>
          ) : sync.startedFrom === 'previous' ? (
            <>Started from the previous goal's branch ({sync.detail}).</>
          ) : (
            <>
              Started from local <span className="mono text-zinc-300">{sync.base}</span> ({sync.detail}).
            </>
          )}
          {up && up.remoteRef && up.behind > 0 && (
            <>
              {' '}
              Your checkout is still {up.behind} behind {up.remote}/{up.base}
              {up.ahead === 0 && (
                <Button size="sm" variant="ghost" className="ml-1 underline decoration-dotted" disabled={busy} onClick={pull} title="git pull --ff-only into your checkout (refused when you have uncommitted changes)">
                  pull into my checkout
                </Button>
              )}
            </>
          )}
          {pullMsg && <span className="block text-zinc-400 mt-0.5">{pullMsg}</span>}
        </div>
      )}
      {ws.tasks.length > 0 && <div className="text-[11px] text-zinc-500">Tasks running in parallel have their own worktrees ({ws.tasks.length}); they are merged into the goal branch when their checks pass. Open one from its task drawer.</div>}
      <details className="text-[11px]">
        <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">Run it yourself</summary>
        <div className="mt-1.5 space-y-1.5">
          <div className="rounded-md border border-zinc-800 bg-zinc-950 p-2 mono text-zinc-300 space-y-1">
            <div className="flex items-center gap-2">
              <span className="truncate">{cd}</span> <CopyButton text={cd} />
            </div>
            {ws.install && (
              <div className="flex items-center gap-2">
                <span>{ws.install}</span> <CopyButton text={ws.install} />
              </div>
            )}
            {ws.scripts.map((s) => (
              <div key={s.name} className="flex items-center gap-2">
                <span>{s.command}</span> <span className="text-zinc-600">({s.name})</span> <CopyButton text={s.command} />
              </div>
            ))}
            {!ws.scripts.length && !ws.install && <div className="text-zinc-600">no package.json scripts detected; open the folder and run the project as you normally would</div>}
          </div>
          <p className="text-zinc-500">
            This folder <em>is</em> the branch <span className="mono">{g.branch}</span>, checked out here, so it cannot also be switched to in your own checkout. {DELIVERY_NOTE[g.delivery.policy.mode]}
          </p>
        </div>
      </details>
    </div>
  );
}
