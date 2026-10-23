import { ArrowDownToLine, Check, FolderGit2, FolderOpen, GitBranch, GitCommitHorizontal, Globe, Pencil, TriangleAlert, User } from 'lucide-react';
import { useState } from 'react';
import { api, type RepoInfo } from '../api.ts';
import { Button, Input, ago, cn, focusFirst } from '../ui.tsx';
import { FolderPicker } from './FolderPicker.tsx';

/**
 * Repository chooser for the New Goal page: "Select folder" (picker modal), the chosen path,
 * a git summary panel, and one-click git init when the folder is not a repository yet.
 */
export function RepoCard({ path, info, onPath, onValidation }: { path: string; info: RepoInfo | null; onPath: (p: string) => void; onValidation: () => { current: () => boolean; finish: (i: RepoInfo | null) => boolean } }) {
  const [picker, setPicker] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(path);
  const [initMsg, setInitMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [up, setUp] = useState<Awaited<ReturnType<typeof api.repoUpstream>> | null | 'loading'>(null);
  const [pullMsg, setPullMsg] = useState<string | null>(null);

  const checkUpstream = async (p: string, branch: string, current: () => boolean) => {
    setUp('loading');
    setPullMsg(null);
    const upstream = await api.repoUpstream(p, branch).catch(() => null);
    if (current()) setUp(upstream);
  };
  const validate = async (p: string, validation = onValidation()) => {
    if (!validation.current()) return;
    setUp(null);
    if (!p.trim()) return validation.finish(null);
    const i = await api.validateRepo(p.trim()).catch((e) => ({ ok: false, branch: '', dirty: false, error: String(e.message), path: p, exists: false, isDir: false, isGitRepo: false, insideRepoAt: null, hasCommits: false, remotes: [], identity: null, commitCount: 0, lastCommit: null, dirtyCount: 0, lastGoal: null }));
    if (!validation.finish(i)) return;
    if (i.ok && i.remotes.length) void checkUpstream(p.trim(), i.branch, validation.current);
    else setUp(null);
  };
  const pull = async () => {
    if (!info?.ok) return;
    const validation = onValidation();
    setBusy(true);
    setPullMsg(null);
    try {
      const r = await api.repoPull(info.path, info.branch);
      if (!validation.current()) return;
      setPullMsg(r.detail);
      await validate(info.path, validation);
    } catch (e: any) {
      if (validation.finish(info)) setPullMsg(e.body?.detail ?? e.message);
    } finally {
      if (validation.current()) setBusy(false);
    }
  };
  const choose = (p: string) => {
    setPicker(false);
    setEditing(false);
    setDraft(p);
    setInitMsg(null);
    setPullMsg(null);
    setBusy(false);
    onPath(p);
    void validate(p);
  };
  const gitInit = async () => {
    const validation = onValidation();
    setBusy(true);
    setInitMsg(null);
    try {
      const r = await api.initRepo(path.trim());
      if (!validation.current()) return;
      setInitMsg(`Initialized ${r.branch} with ${r.filesCommitted} file(s)${r.identity === 'fallback' ? ' — commits are authored as foundry until you run: git config --global user.name / user.email' : ''}`);
      await validate(path, validation);
    } catch (e: any) {
      if (validation.finish(info)) setInitMsg(e.message);
    } finally {
      if (validation.current()) setBusy(false);
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
            <span className="mono text-sm text-ink truncate" title={path}>
              {path}
            </span>
            <button className="text-ink-faint hover:text-ink shrink-0" title="edit path" onClick={() => { setDraft(path); setEditing(true); }}>
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
            <Input className="mono text-xs" placeholder="or type a path: /Users/you/projects/my-app" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => draft.trim() && draft.trim() !== path && choose(draft.trim())} autoFocus={editing && focusFirst} />
            {editing && (
              <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(false)}>
                cancel
              </Button>
            )}
          </form>
        )}
      </div>

      {info && (
        // a usable repository on a quiet inset box, its heading in green (it passed); a folder that cannot be used on a red
        // edge with its reason in red: the colour goes on the marks and words, never fills the box
        <div className={cn('rounded-lg border bg-sunken p-3 text-xs space-y-1.5', info.ok ? 'border-line' : 'border-bad/50')}>
          {info.ok ? (
            <>
              <div className="flex items-center gap-2 font-bold text-ok-ink">
                <FolderGit2 size={14} /> Git repository
                <span className="font-normal text-ink-faint">· {info.commitCount} commit{info.commitCount === 1 ? '' : 's'}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-ink">
                <Row icon={<GitBranch size={12} />} label="branch">
                  <span className="mono">{info.branch}</span>
                  {info.dirty ? <span className="text-work-ink ml-2">· {info.dirtyCount} uncommitted change{info.dirtyCount === 1 ? '' : 's'} (the Brief will ask)</span> : <span className="text-ok-ink ml-2">· clean</span>}
                </Row>
                {info.lastCommit && (
                  <Row icon={<GitCommitHorizontal size={12} />} label="last commit">
                    {/* the subject is cut with an ellipsis (whole on hover), so a long one neither runs out of the card nor pushes the age off the line */}
                    <span className="flex items-baseline gap-1 min-w-0">
                      <span className="mono shrink-0">{info.lastCommit.sha.slice(0, 7)}</span>
                      <span className="text-ink-soft truncate" title={info.lastCommit.subject}>{info.lastCommit.subject}</span>
                      {info.lastCommit.date && <span className="text-ink-faint shrink-0 whitespace-nowrap">· <span className="mono">{ago(info.lastCommit.date)}</span></span>}
                    </span>
                  </Row>
                )}
                <Row icon={<Globe size={12} />} label="remote">
                  {info.remotes.length ? (
                    info.remotes.map((r) => (
                      <span key={r.name} className="mr-3">
                        <span className="mono">{r.name}</span> <span className="mono text-ink-soft break-all">→ {r.url}</span>
                      </span>
                    ))
                  ) : (
                    <span className="text-ink-faint">none — Delivery can create one on GitHub</span>
                  )}
                </Row>
                <Row icon={<User size={12} />} label="identity">{info.identity ? `${info.identity.name} <${info.identity.email}>` : <span className="text-work-ink">not configured — commits will be authored as foundry</span>}</Row>
                {info.remotes.length > 0 && (
                  <Row icon={<ArrowDownToLine size={12} />} label="upstream">
                    {/* fetching is at work, a failed fetch red, up to date green; a branch not on the remote yet is quiet */}
                    {up === 'loading' ? (
                      <span className="text-work-ink">fetching {info.remotes[0]!.name}/{info.branch}…</span>
                    ) : up === null ? (
                      <span className="text-bad-ink">could not fetch</span>
                    ) : !up.remote || !up.remoteRef ? (
                      <span className={up.error ? 'text-bad-ink' : 'text-ink-faint'}>{up.error ?? `no ${info.branch} on the remote yet`}</span>
                    ) : up.behind === 0 && up.ahead === 0 ? (
                      <span className="text-ok-ink">up to date with {up.remote}/{up.base}</span>
                    ) : (
                      <span className={up.behind ? 'text-work-ink' : 'text-ink'}>
                        {up.behind ? `${up.behind} behind` : ''}
                        {up.behind && up.ahead ? ', ' : ''}
                        {up.ahead ? `${up.ahead} ahead (unpushed)` : ''} {up.remote}/{up.base}
                        <span className="text-ink-faint"> — the goal will start from {up.start.from === 'remote' ? `${up.remote}/${up.base}` : `local ${up.base}`}</span>
                        {up.behind > 0 && up.ahead === 0 && (
                          <Button size="sm" variant="ghost" className="ml-2 underline decoration-dotted" disabled={busy} onClick={pull} title="git pull --ff-only into your checkout (refused when you have uncommitted changes)">
                            pull into my checkout
                          </Button>
                        )}
                      </span>
                    )}
                    {pullMsg && <span className="block text-ink-soft mt-0.5">{pullMsg}</span>}
                  </Row>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 font-semibold text-bad-ink">
                <TriangleAlert size={14} className="shrink-0" /> {info.error}
              </div>
              {info.exists && info.isDir && !info.isGitRepo && !info.insideRepoAt && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button size="sm" variant="primary" disabled={busy} onClick={gitInit}>
                    <Check size={13} /> Initialize git here
                  </Button>
                  <span className="text-ink-faint">git init + .gitignore + initial commit{info.identity ? ` as ${info.identity.name}` : ' (no git identity configured → authored as foundry)'}</span>
                </div>
              )}
              {info.insideRepoAt && <div className="text-ink-soft">Use the repository root instead: <button className="underline mono text-ink" onClick={() => choose(info.insideRepoAt!)}>{info.insideRepoAt}</button></div>}
            </>
          )}
          {/* git init's own report ("Initialized main with…") is green; anything else it says is why it failed */}
          {initMsg && <div className={cn('pt-1 font-semibold', initMsg.startsWith('Initialized') ? 'text-ok-ink' : 'text-bad-ink')}>{initMsg}</div>}
        </div>
      )}
      {picker && <FolderPicker initial={path || undefined} onPick={choose} onClose={() => setPicker(false)} />}
    </div>
  );
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-1.5 min-w-0">
      <span className="text-ink-faint mt-0.5 shrink-0">{icon}</span>
      <span className="text-ink-faint w-16 shrink-0">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}
