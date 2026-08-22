import type { DeliveryPolicy } from '@ai-engine/core/browser';
import { Github } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api, type RepoInfo } from '../api.ts';
import { Button, Input, Select, cn } from '../ui.tsx';
import { LiveLog } from '../pages/LiveLog.tsx';

export type PolicyDraft = Partial<DeliveryPolicy> & { mode: DeliveryPolicy['mode'] };
const MODES: { id: DeliveryPolicy['mode']; label: string; desc: string }[] = [
  { id: 'local', label: 'Local only', desc: 'Work stays on a local branch. You push when you want. (default)' },
  { id: 'push', label: 'Push branch', desc: 'When done: sync with the base branch and push. No PR.' },
  { id: 'pr', label: 'Open a PR', desc: 'Push, then open pull request(s) with the Brief and check results. You merge.' },
  { id: 'pr-automerge', label: 'PR + auto-merge', desc: 'Open the PR(s), wait for CI, fix CI if needed, merge when green, delete the remote branch(es).' },
];

function Section({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1.5">{title}</div>
      {children}
    </div>
  );
}

function Option({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex items-start gap-2 cursor-pointer">
      <input type="checkbox" className="mt-0.5 accent-emerald-500" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">
        <span className="block text-xs text-zinc-200">{label}</span>
        <span className="block text-[11px] text-zinc-500">{hint}</span>
      </span>
    </label>
  );
}

/**
 * Delivery policy picker shared by New Goal and the Deliver dialog.
 * `taskCount` (when known) sizes the "one PR per task" hint.
 */
export function DeliveryPolicyForm({ value, onChange, repo, taskCount = null }: { value: PolicyDraft; onChange: (p: PolicyDraft) => void; repo: RepoInfo | null; taskCount?: number | null }) {
  const [gh, setGh] = useState<{ installed: boolean; authenticated: boolean; login: string | null } | null>(null);
  const [orgs, setOrgs] = useState<string[]>([]);
  const [loginOpen, setLoginOpen] = useState(false);
  const loadGh = () =>
    api
      .githubStatus()
      .then((s) => {
        setGh(s);
        if (s.authenticated) api.githubOrgs().then(setOrgs).catch(() => {});
      })
      .catch(() => setGh({ installed: false, authenticated: false, login: null }));
  useEffect(() => {
    loadGh();
  }, []);
  const needsGh = value.mode === 'pr' || value.mode === 'pr-automerge' || !!value.createRepo;
  const hasRemote = !!repo?.remotes?.some((r) => r.name === (value.remote ?? 'origin'));
  const set = (patch: Partial<PolicyDraft>) => onChange({ ...value, ...patch });
  const unit = value.unit ?? 'goal';
  const isPr = value.mode === 'pr' || value.mode === 'pr-automerge';
  const thing = isPr ? 'PR' : 'branch';

  // Prefill "create a GitHub repo" (owner = you, name = folder) when the repository has no remote and gh is signed in.
  useEffect(() => {
    if (value.mode === 'local' || hasRemote || !repo?.ok || !gh?.authenticated || !gh.login) return;
    if (value.createRepo || value.remoteUrl) return;
    set({ createRepo: { owner: gh.login, name: repo.path.split('/').filter(Boolean).pop() ?? 'repo', visibility: 'private' } });
  }, [value.mode, hasRemote, repo?.path, gh?.authenticated]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {MODES.map((m) => (
          <button key={m.id} type="button" onClick={() => set({ mode: m.id })} className={cn('text-left rounded-md border p-2.5', value.mode === m.id ? 'border-emerald-500 bg-emerald-500/5' : 'border-zinc-800 hover:border-zinc-600')}>
            <div className="text-sm text-zinc-100">{m.label}</div>
            <div className="text-[11px] text-zinc-500 mt-0.5">{m.desc}</div>
          </button>
        ))}
      </div>
      {value.mode !== 'local' && (
        <div className="space-y-4 rounded-md border border-zinc-800 p-3">
          <Section title="Target">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <label className="text-[11px] text-zinc-500">remote</label>
                <Input value={value.remote ?? 'origin'} onChange={(e) => set({ remote: e.target.value })} />
              </div>
              <div>
                <label className="text-[11px] text-zinc-500">base branch (blank = goal base)</label>
                <Input value={value.baseBranch ?? ''} onChange={(e) => set({ baseBranch: e.target.value || null })} placeholder={repo?.branch || 'main'} />
              </div>
              <div>
                <label className="text-[11px] text-zinc-500">merge method</label>
                {value.mode === 'pr-automerge' ? (
                  <Select value={value.mergeMethod ?? 'squash'} onChange={(e) => set({ mergeMethod: e.target.value as any })}>
                    <option value="squash">squash</option>
                    <option value="merge">merge commit</option>
                    <option value="rebase">rebase</option>
                  </Select>
                ) : (
                  <div className="rounded-md border border-dashed border-zinc-800 px-2 py-1.5 text-sm text-zinc-600">{value.mode === 'pr' ? 'you merge' : 'no merge'}</div>
                )}
              </div>
            </div>
          </Section>

          {!hasRemote && (
            <Section title="No remote yet">
              <div className="text-xs text-amber-300 mb-2">The repository has no remote named "{value.remote ?? 'origin'}". Choose one:</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] text-zinc-500">existing remote URL</label>
                  <Input placeholder="git@github.com:you/repo.git" value={value.remoteUrl ?? ''} onChange={(e) => set({ remoteUrl: e.target.value || null, createRepo: e.target.value ? null : value.createRepo })} />
                </div>
                <div>
                  <label className="text-[11px] text-zinc-500">or create a GitHub repo {gh?.authenticated ? `(as ${gh.login})` : ''}</label>
                  <div className="flex gap-1 flex-wrap">
                    <span className="w-36">
                      <Select disabled={!gh?.authenticated} value={value.createRepo?.owner ?? ''} onChange={(e) => set({ createRepo: e.target.value ? { owner: e.target.value, name: value.createRepo?.name ?? repo?.path.split('/').pop() ?? 'repo', visibility: value.createRepo?.visibility ?? 'private' } : null, remoteUrl: null })}>
                        <option value="">owner…</option>
                        {orgs.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </Select>
                    </span>
                    <Input className="flex-1 min-w-[8rem]" disabled={!value.createRepo} value={value.createRepo?.name ?? ''} onChange={(e) => set({ createRepo: { ...value.createRepo!, name: e.target.value } })} placeholder="name" />
                    <span className="w-28">
                      <Select disabled={!value.createRepo} value={value.createRepo?.visibility ?? 'private'} onChange={(e) => set({ createRepo: { ...value.createRepo!, visibility: e.target.value as any } })}>
                        <option value="private">private</option>
                        <option value="public">public</option>
                      </Select>
                    </span>
                  </div>
                </div>
              </div>
            </Section>
          )}

          <Section title="Granularity">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button type="button" onClick={() => set({ unit: 'goal' })} className={cn('text-left rounded-md border p-2.5', unit === 'goal' ? 'border-emerald-500 bg-emerald-500/5' : 'border-zinc-800 hover:border-zinc-600')}>
                <div className="text-sm text-zinc-100">One {thing} for the whole goal</div>
                <div className="text-[11px] text-zinc-500 mt-0.5">
                  {isPr ? 'Everything in a single pull request titled after the Brief.' : 'The goal branch as it is.'} <span className="mono">goal/&lt;id&gt;</span>
                </div>
              </button>
              <button type="button" onClick={() => set({ unit: 'task' })} className={cn('text-left rounded-md border p-2.5', unit === 'task' ? 'border-emerald-500 bg-emerald-500/5' : 'border-zinc-800 hover:border-zinc-600')}>
                <div className="text-sm text-zinc-100">One {thing} per task{isPr ? ' — stacked' : ''}</div>
                <div className="text-[11px] text-zinc-500 mt-0.5">
                  {taskCount != null && taskCount > 0 ? `${taskCount} task${taskCount === 1 ? '' : 's'} → ${taskCount} ${thing}${taskCount === 1 ? '' : isPr ? 's' : 'es'}` : 'decided by the Brief'}
                  {isPr ? `, each based on the one below${value.mode === 'pr-automerge' ? ', merged bottom-up' : ''}` : ''}. Titles are the tasks' Conventional Commit headers; a single task falls back to one {thing}.
                </div>
              </button>
            </div>
          </Section>

          {value.mode === 'pr-automerge' && (
            <Section title="Once the PR is open">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
                <Option checked={value.requireChecks ?? true} onChange={(v) => set({ requireChecks: v })} label="Wait for CI checks" hint="Merge only after every check reports. Off = merge as soon as the PR is mergeable." />
                <Option checked={value.mergeIfNoChecks ?? true} onChange={(v) => set({ mergeIfNoChecks: v })} label="Merge when no checks are configured" hint="Off = a repository without CI stops at the PR." />
                <Option checked={value.autoResolveConflicts ?? true} onChange={(v) => set({ autoResolveConflicts: v })} label="Auto-resolve conflicts with the base branch" hint="A Merge Attempt resolves them; off = a conflict stops delivery." />
                <Option checked={value.deleteRemoteBranch ?? true} onChange={(v) => set({ deleteRemoteBranch: v })} label="Delete the remote branch after merging" hint="Only the branch(es) this goal pushed, never the base." />
                <label className="flex items-start gap-2 sm:col-span-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-zinc-200">Fix failing CI</span>
                    <span className="block text-[11px] text-zinc-500">A bounded fix task reads the failed job log and pushes again.</span>
                  </span>
                  <span className="w-36 shrink-0">
                    <Select value={String(value.fixCiCycles ?? 1)} onChange={(e) => set({ fixCiCycles: Number(e.target.value) })}>
                      <option value="0">don't fix</option>
                      <option value="1">up to once</option>
                      <option value="2">up to twice</option>
                    </Select>
                  </span>
                </label>
              </div>
            </Section>
          )}

          <div className="flex items-center gap-2 text-xs flex-wrap border-t border-zinc-800 pt-3">
            <Github size={13} className={gh?.authenticated ? 'text-emerald-400' : needsGh ? 'text-rose-400' : 'text-zinc-500'} />
            {gh === null ? (
              <span className="text-zinc-500">checking GitHub CLI…</span>
            ) : !gh.installed ? (
              <span className={needsGh ? 'text-rose-300' : 'text-zinc-500'}>
                GitHub CLI not installed{needsGh ? ' — required for PR modes' : ''}: <span className="mono">brew install gh</span>
              </span>
            ) : !gh.authenticated ? (
              <>
                <span className={needsGh ? 'text-rose-300' : 'text-zinc-500'}>gh installed, not logged in</span>
                <Button size="sm" onClick={() => { setLoginOpen(true); api.githubLogin().catch(() => {}); }}>
                  Connect GitHub
                </Button>
              </>
            ) : (
              <span className="text-zinc-400">
                GitHub: <span className="text-zinc-200">{gh.login}</span>
              </span>
            )}
            <span className="sm:ml-auto text-zinc-600 basis-full sm:basis-auto">The model is still confined to the worktree; only the engine performs these actions, exactly as listed.</span>
          </div>
          {loginOpen && (
            <div className="space-y-2">
              <div className="text-xs text-zinc-400">Copy the one-time code, open the URL, approve — this panel updates as gh reports progress.</div>
              <LiveLog attemptId="gh-auth" className="max-h-40" />
              <Button size="sm" variant="ghost" onClick={() => { setLoginOpen(false); loadGh(); }}>
                Done
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
