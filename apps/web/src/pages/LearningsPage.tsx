import type { Learning, LearningKind, RepoLearnings } from '@foundry/core/browser';
import { Folder, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.ts';
import { useLive } from '../store.ts';
import { Button, Card, Empty, Page, Select, Textarea, ago, cn } from '../ui.tsx';
import { shortCwd } from './agents/rows.tsx';
import { HelpLink } from './HelpPage.tsx';

const KINDS: LearningKind[] = ['build', 'test', 'run', 'structure', 'convention', 'preference', 'pitfall'];
const KIND_STYLE: Record<LearningKind, string> = {
  build: 'border-sky-800 text-sky-300',
  test: 'border-emerald-800 text-emerald-300',
  run: 'border-teal-800 text-teal-300',
  structure: 'border-zinc-700 text-zinc-300',
  convention: 'border-violet-800 text-violet-300',
  preference: 'border-amber-800 text-amber-300',
  pitfall: 'border-rose-800 text-rose-300',
};
const MAX_CHARS = 300;

/**
 * Learnings (ADR-0040): what Foundry learned about each project folder from its finished goals, and what the person
 * added. Every new goal in a folder is given its notebook. `?repo=` shows one folder, and lets the person start one.
 */
export function LearningsPage() {
  const [params] = useSearchParams();
  const only = params.get('repo');
  const version = useLive((s) => s.globalVersion);
  const [repos, setRepos] = useState<RepoLearnings[] | null>(null);
  useEffect(() => {
    const t = setTimeout(() => api.learnings().then((r) => setRepos(r.repos)).catch(() => setRepos([])), 150);
    return () => clearTimeout(t);
  }, [version]);

  const shown = !repos ? null : only ? [repos.find((r) => r.repoPath === only) ?? { repoPath: only, learnings: [], updatedAt: '' }] : repos;
  return (
    <Page width="md">
      <div>
        <h1 className="text-lg font-semibold flex items-center gap-1.5">
          Learnings <HelpLink to="learnings" />
        </h1>
        <p className="text-xs text-zinc-500 mt-1">
          What Foundry learned about each project folder from its finished goals, and what you added. Every new goal in a folder gets its notebook: Clarify all of it, each task a short form. Foundry never changes or removes what you wrote (✎).
        </p>
        {only && (
          <Link to="/learnings" className="text-xs text-zinc-400 hover:underline">
            ← every folder
          </Link>
        )}
      </div>
      {!shown ? (
        <Empty>Loading…</Empty>
      ) : shown.length === 0 ? (
        <Empty>No learnings yet. They are written when a goal ends; a goal's page also links here to add your own.</Empty>
      ) : (
        shown.map((r) => <RepoCard key={r.repoPath} repo={r} startEditing={!!only && r.learnings.length === 0} />)
      )}
    </Page>
  );
}

type Draft = { id: string | null; kind: LearningKind; text: string }[];

function RepoCard({ repo, startEditing }: { repo: RepoLearnings; startEditing: boolean }) {
  const [draft, setDraft] = useState<Draft | null>(startEditing ? [{ id: null, kind: 'convention', text: '' }] : null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const edit = () => setDraft(repo.learnings.map((l) => ({ id: l.id, kind: l.kind, text: l.text })));
  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setErr(null);
    try {
      await api.saveLearnings(repo.repoPath, draft.filter((d) => d.text.trim()));
      setDraft(null);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const set = (i: number, patch: Partial<Draft[number]>) => setDraft((d) => d && d.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const n = repo.learnings.length;
  return (
    <Card
      title={
        <span className="flex items-center gap-1.5 min-w-0">
          <Folder size={13} className="shrink-0 text-zinc-500" />
          <span className="mono truncate" title={repo.repoPath}>
            {shortCwd(repo.repoPath)}
          </span>
        </span>
      }
      actions={
        draft ? null : (
          <Button size="sm" variant="ghost" onClick={edit} title="Change, remove or add learnings for this folder">
            <Pencil size={12} /> Edit
          </Button>
        )
      }
    >
      <div className="text-[11px] text-zinc-500 mb-2">
        {n} learning{n === 1 ? '' : 's'}
        {repo.updatedAt && <> · updated {ago(repo.updatedAt)}</>}
      </div>
      {draft ? (
        <div className="space-y-2">
          {draft.map((d, i) => (
            <div key={i} className="flex items-start gap-2">
              <Select className="w-32 shrink-0 text-xs" value={d.kind} onChange={(e) => set(i, { kind: e.target.value as LearningKind })} aria-label="kind">
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </Select>
              <div className="flex-1 min-w-0">
                <Textarea rows={2} className="w-full text-xs" maxLength={MAX_CHARS} value={d.text} placeholder="One fact that saves the next goal time: a command, a path, a convention, a pitfall…" onChange={(e) => set(i, { text: e.target.value })} />
                <div className="text-[10px] text-zinc-600 text-right">{d.text.length}/{MAX_CHARS}</div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setDraft((x) => x && x.filter((_, j) => j !== i))} title="Remove" aria-label="Remove">
                <Trash2 size={13} />
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="ghost" onClick={() => setDraft((x) => [...(x ?? []), { id: null, kind: 'convention', text: '' }])}>
              <Plus size={12} /> Add a learning
            </Button>
            <span className="ml-auto flex gap-2">
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => (setDraft(null), setErr(null))}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" disabled={busy} onClick={save}>
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </span>
          </div>
          <p className="text-[11px] text-zinc-500">What you add or change becomes yours (✎): Foundry keeps it word for word.</p>
          {err && <div className="text-xs text-rose-300">{err}</div>}
        </div>
      ) : n === 0 ? (
        <div className="text-xs text-zinc-500">Nothing yet.</div>
      ) : (
        <ul className="space-y-1.5">
          {repo.learnings.map((l) => (
            <LearningRow key={l.id} l={l} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function LearningRow({ l }: { l: Learning }) {
  return (
    <li className="flex items-start gap-2 text-xs">
      <span className={cn('shrink-0 mt-px inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] leading-none', KIND_STYLE[l.kind])}>{l.kind}</span>
      <span className="flex-1 min-w-0 text-zinc-200 break-words">{l.text}</span>
      <span className="shrink-0 text-[11px] text-zinc-500 max-w-[12rem] truncate" title={l.by === 'human' ? 'written by you' : l.goalTitle ? `learned from “${l.goalTitle}”` : 'learned by Foundry'}>
        {l.by === 'human' ? (
          '✎ yours'
        ) : l.goalId ? (
          <Link to={`/goals/${l.goalId}`} className="hover:underline">
            from {l.goalTitle ?? 'a goal'}
          </Link>
        ) : (
          'Foundry'
        )}
      </span>
    </li>
  );
}
