import { ArrowDownToLine, Check, FolderGit2, FolderOpen, GitBranch, GitCommitHorizontal, Globe, Pencil, TriangleAlert, User } from 'lucide-react';
import { useState } from 'react';
import { api, type RepoInfo } from '../api.ts';
import { Button, Input, ago, cn } from '../ui.tsx';
import { FolderPicker } from './FolderPicker.tsx';

/**
 * Repository chooser for the New Goal page: "Select folder" (picker modal), the chosen path,
 * a git summary panel, and one-click git init when the folder is not a repository yet.
 */
export function RepoCard({ path, info, onPath, onInfo }: { path: string; info: RepoInfo | null; onPath: (p: string) => void; onInfo: (i: RepoInfo | null) => void }) {
  const [picker, setPicker] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(path);
  const [initMsg, setInitMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [up, setUp] = useState<Awaited<ReturnType<typeof api.repoUpstream>> | null | 'loading'>(null);
  const [pullMsg, setPullMsg] = useState<string | null>(null);

  const checkUpstream = async (p: string, branch: string) => {
    setUp('loading');
    setPullMsg(null);
    setUp(await api.repoUpstream(p, branch).catch(() => null));
  };
  const validate = async (p: string) => {
    if (!p.trim()) return onInfo(null);
    const i = await api.validateRepo(p.trim()).catch((e) => ({ ok: false, branch: '', dirty: false, error: String(e.message), path: p, exists: false, isDir: false, isGitRepo: false, insideRepoAt: null, hasCommits: false, remotes: [], identity: null, commitCount: 0, lastCommit: null, dirtyCount: 0 }));
    onInfo(i);
    if (i.ok && i.remotes.length) void checkUpstream(p.trim(), i.branch);
    else setUp(null);
  };
  const pull = async () => {
    if (!info?.ok) return;
    setBusy(true);
    setPullMsg(null);
    try {
      const r = await api.repoPull(info.path, info.branch);
      setPullMsg(r.detail);
      await validate(info.path);
    } catch (e: any) {
      setPullMsg(e.body?.detail ?? e.message);
    } finally {
      setBusy(false);
    }
  };
  const choose = (p: string) => {
    setPicker(false);
    setEditing(false);
    setDraft(p);
    setInitMsg(null);
    onPath(p);
    void validate(p);
  };
  const gitInit = async () => {
    setBusy(true);
    setInitMsg(null);
    try {
      const r = await api.initRepo(path.trim());
      setInitMsg(`Initialized ${r.branch} with ${r.filesCommitted} file(s)${r.identity === 'fallback' ? ' — commits are authored as ai-engine until you run: git config --global user.name / user.email' : ''}`);
      await validate(path);
    } catch (e: any) {
      setInitMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <Button variant={path ? 'default' : 'primary'} onClick={() => setPicker(true)}>
          <FolderOpen size={14} /> {path ? 'Change folder…' : 'Select folder…'}
        </Button>
        {path && !editing && (
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="mono text-sm text-zinc-200 truncate" title={path}>
              {path}
            </span>
            <button className="text-zinc-500 hover:text-zinc-200 shrink-0" title="edit path" onClick={() => { setDraft(path); setEditing(true); }}>
              <Pencil size={13} />
            </button>
          </div>
        )}
        {(editing || !path) && (
          <form
            className="flex items-center gap-2 flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) choose(draft.trim());
            }}
          >
            <Input className="mono text-xs" placeholder="or type a path: /Users/you/projects/my-app" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft.trim() && draft.trim() !== path && choose(draft.trim())} autoFocus={editing} />
            {editing && (
              <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(false)}>
                cancel
              </Button>
            )}
          </form>
        )}
      </div>

      {info && (
        <div className={cn('rounded-md border p-3 text-xs space-y-1.5', info.ok ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5')}>
          {info.ok ? (
            <>
              <div className="flex items-center gap-2 text-emerald-300">
                <FolderGit2 size={14} /> Git repository
                <span className="text-zinc-500">· {info.commitCount} commit{info.commitCount === 1 ? '' : 's'}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-zinc-300">
                <Row icon={<GitBranch size={12} />} label="branch">
                  <span className="mono">{info.branch}</span>
                  {info.dirty ? <span className="text-amber-300 ml-2">· {info.dirtyCount} uncommitted change{info.dirtyCount === 1 ? '' : 's'} (the Brief will ask)</span> : <span className="text-zinc-500 ml-2">· clean</span>}
                </Row>
                {info.lastCommit && (
                  <Row icon={<GitCommitHorizontal size={12} />} label="last commit">
                    <span className="mono">{info.lastCommit.sha.slice(0, 7)}</span> <span className="text-zinc-400 truncate">{info.lastCommit.subject}</span>
                    {info.lastCommit.date && <span className="text-zinc-500"> · {ago(info.lastCommit.date)}</span>}
                  </Row>
                )}
                <Row icon={<Globe size={12} />} label="remote">
                  {info.remotes.length ? (
                    info.remotes.map((r) => (
                      <span key={r.name} className="mr-3">
                        <span className="mono">{r.name}</span> <span className="text-zinc-400 break-all">→ {r.url}</span>
                      </span>
                    ))
                  ) : (
                    <span className="text-zinc-500">none — Delivery can create one on GitHub</span>
                  )}
                </Row>
                <Row icon={<User size={12} />} label="identity">{info.identity ? `${info.identity.name} <${info.identity.email}>` : <span className="text-amber-300">not configured — commits will be authored as ai-engine</span>}</Row>
                {info.remotes.length > 0 && (
                  <Row icon={<ArrowDownToLine size={12} />} label="upstream">
                    {up === 'loading' ? (
                      <span className="text-zinc-500">fetching {info.remotes[0]!.name}/{info.branch}…</span>
                    ) : up === null ? (
                      <span className="text-zinc-500">could not fetch</span>
                    ) : !up.remote || !up.remoteRef ? (
                      <span className="text-zinc-500">{up.error ?? `no ${info.branch} on the remote yet`}</span>
                    ) : up.behind === 0 && up.ahead === 0 ? (
                      <span className="text-emerald-300">up to date with {up.remote}/{up.base}</span>
                    ) : (
                      <span className={up.behind ? 'text-amber-300' : 'text-zinc-300'}>
                        {up.behind ? `${up.behind} behind` : ''}
                        {up.behind && up.ahead ? ', ' : ''}
                        {up.ahead ? `${up.ahead} ahead (unpushed)` : ''} {up.remote}/{up.base}
                        <span className="text-zinc-500"> — the goal will start from {up.start.from === 'remote' ? `${up.remote}/${up.base}` : `local ${up.base}`}</span>
                        {up.behind > 0 && up.ahead === 0 && (
                          <Button size="sm" variant="ghost" className="ml-2 underline decoration-dotted" disabled={busy} onClick={pull} title="git pull --ff-only into your checkout (refused when you have uncommitted changes)">
                            pull into my checkout
                          </Button>
                        )}
                      </span>
                    )}
                    {pullMsg && <span className="block text-zinc-400 mt-0.5">{pullMsg}</span>}
                  </Row>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 text-amber-300">
                <TriangleAlert size={14} /> {info.error}
              </div>
              {info.exists && info.isDir && !info.isGitRepo && !info.insideRepoAt && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button size="sm" variant="primary" disabled={busy} onClick={gitInit}>
                    <Check size={13} /> Initialize git here
                  </Button>
                  <span className="text-zinc-500">git init + .gitignore + initial commit{info.identity ? ` as ${info.identity.name}` : ' (no git identity configured → authored as ai-engine)'}</span>
                </div>
              )}
              {info.insideRepoAt && <div className="text-zinc-400">Use the repository root instead: <button className="underline mono" onClick={() => choose(info.insideRepoAt!)}>{info.insideRepoAt}</button></div>}
            </>
          )}
          {initMsg && <div className="text-zinc-300 pt-1">{initMsg}</div>}
        </div>
      )}
      {picker && <FolderPicker initial={path || undefined} onPick={choose} onClose={() => setPicker(false)} />}
    </div>
  );
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-1.5 min-w-0">
      <span className="text-zinc-500 mt-0.5 shrink-0">{icon}</span>
      <span className="text-zinc-500 w-16 shrink-0">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}
