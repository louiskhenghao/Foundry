import type { Learning, LearningKind, RepoLearnings } from '@foundry/core/browser';
import { ChevronDown, ChevronRight, Folder, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.ts';
import { useLive } from '../store.ts';
import { useUnsaved } from '../unsaved.ts';
import { AFFIX_SIDE, Button, Card, Empty, Input, Select, Textarea, ago, cn } from '../ui.tsx';
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
const COLLAPSED_KEY = 'foundry.learnings.collapsed';

function readCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '{}');
  } catch {
    return {};
  }
}

/**
 * Learnings (ADR-0040): what Foundry learned about each project folder from its finished goals, and what the person
 * added. Every new goal in a folder is given its notebook. Laid out like Agents and Extensions: the filters on top, one
 * card per folder, an overview beside them. `?repo=` shows one folder, and lets the person start one.
 */
export function LearningsPage() {
  const [params] = useSearchParams();
  const only = params.get('repo');
  const version = useLive((s) => s.globalVersion);
  const [repos, setRepos] = useState<RepoLearnings[] | null>(null);
  const [kind, setKind] = useState<LearningKind | 'all'>('all');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(readCollapsed);
  useEffect(() => {
    const t = setTimeout(() => api.learnings().then((r) => setRepos(r.repos)).catch(() => setRepos([])), 150);
    return () => clearTimeout(t);
  }, [version]);

  const shown = !repos ? null : only ? [repos.find((r) => r.repoPath === only) ?? { repoPath: only, learnings: [], updatedAt: '' }] : repos;
  const all = (shown ?? []).flatMap((r) => r.learnings);
  const q = query.trim().toLowerCase();
  // a folder's learnings that pass the kind and the search (a search that matches the folder keeps all of them)
  const visible = (r: RepoLearnings) => r.learnings.filter((l) => (kind === 'all' || l.kind === kind) && (!q || r.repoPath.toLowerCase().includes(q) || l.text.toLowerCase().includes(q) || (l.goalTitle ?? '').toLowerCase().includes(q)));
  const filtering = kind !== 'all' || !!q;
  // filtering hides the folders it leaves empty; an empty notebook (one being started) stays when nothing filters
  const cards = (shown ?? []).filter((r) => (filtering ? visible(r).length > 0 : true));
  const isOpen = (r: RepoLearnings) => filtering || !collapsed[r.repoPath];
  const remember = (next: Record<string, boolean>) => {
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
    } catch {
      /* private mode */
    }
    return next;
  };
  const toggle = (r: RepoLearnings) => setCollapsed((c) => remember({ ...c, [r.repoPath]: isOpen(r) }));
  const setAll = (fold: boolean) => setCollapsed((c) => remember({ ...c, ...Object.fromEntries((shown ?? []).map((r) => [r.repoPath, fold])) }));
  const counts = Object.fromEntries(KINDS.map((k) => [k, all.filter((l) => l.kind === k).length])) as Record<LearningKind, number>;

  return (
    <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-lg font-semibold text-zinc-100 flex items-center gap-1.5">
          Learnings <HelpLink to="learnings" />
        </h1>
        {shown && (
          <span className="text-xs text-zinc-500">
            {shown.length} folder{shown.length === 1 ? '' : 's'} · {all.length} learning{all.length === 1 ? '' : 's'} · {all.filter((l) => l.by === 'human').length} yours
          </span>
        )}
        {only && (
          <Link to="/learnings" className="ml-auto text-xs text-zinc-400 hover:text-zinc-100">
            ← every folder
          </Link>
        )}
      </div>
      <p className="text-xs text-zinc-500 -mt-2">
        What Foundry learned about each project folder from its finished goals, and what you added. Every new goal in a folder gets its notebook: Clarify all of it, each task a short form. Foundry never changes or removes what you wrote (✎).
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        {(['all', ...KINDS] as const).map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={cn('rounded-md border px-2 py-1 text-xs', kind === k ? 'border-emerald-500 text-emerald-300' : 'border-zinc-800 text-zinc-400')}>
            {k} <span className="text-zinc-600">{shown ? (k === 'all' ? all.length : counts[k]) : ''}</span>
          </button>
        ))}
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search size={13} className="absolute left-2 top-2 text-zinc-500" aria-hidden="true" />
          <Input type="search" className="pl-7 py-1 text-xs" placeholder="search learnings, folders, goals" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search learnings" />
        </div>
        {(shown?.length ?? 0) > 1 && (
          <span className="flex items-center gap-2 text-xs text-zinc-500">
            <button type="button" className="hover:text-zinc-200" onClick={() => setAll(false)}>
              expand all
            </button>
            <span className="text-zinc-700">·</span>
            <button type="button" className="hover:text-zinc-200" onClick={() => setAll(true)}>
              collapse all
            </button>
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-2">
          {!shown ? (
            <Empty>Loading…</Empty>
          ) : shown.length === 0 ? (
            <Empty>No learnings yet. They are written when a goal ends; a goal's page also links here to add your own.</Empty>
          ) : cards.length === 0 ? (
            <Empty>Nothing matches. Pick all, or clear the search.</Empty>
          ) : (
            <>
              <div className="flex items-center gap-2 pt-1">
                <span className="text-[10px] uppercase tracking-wide text-zinc-500">Project folders</span>
                <span className="text-[10px] text-zinc-600">{cards.length}</span>
                <span className="flex-1 h-px bg-zinc-800/70" />
              </div>
              {cards.map((r) => (
                <FolderCard key={r.repoPath} repo={r} rows={visible(r)} filtering={filtering} open={isOpen(r)} onToggle={() => toggle(r)} startEditing={!!only && r.learnings.length === 0} />
              ))}
            </>
          )}
        </div>
        {shown && shown.length > 0 && (
          <div className={AFFIX_SIDE}>
            <Card title="Overview">
              <ul className="text-xs space-y-1.5">
                {KINDS.map((k) => (
                  <li key={k} className="flex items-center gap-2">
                    <KindBadge kind={k} />
                    <span className="ml-auto mono text-zinc-400 tabular-nums">{counts[k]}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-zinc-500 border-t border-zinc-800 mt-3 pt-3">A goal adds what it learned when it ends; Learn from this goal again on a goal's page writes it once more. Edit a folder to change, remove or add your own.</p>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

function KindBadge({ kind }: { kind: LearningKind }) {
  return <span className={cn('shrink-0 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] leading-none', KIND_STYLE[kind])}>{kind}</span>;
}

type Draft = { id: string | null; kind: LearningKind; text: string }[];

/** one project folder: its notebook as a list, or the editor for it */
function FolderCard({ repo, rows, filtering, open, onToggle, startEditing }: { repo: RepoLearnings; rows: Learning[]; filtering: boolean; open: boolean; onToggle: () => void; startEditing: boolean }) {
  const [draft, setDraft] = useState<Draft | null>(startEditing ? [{ id: null, kind: 'convention', text: '' }] : null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useUnsaved(`learnings:${repo.repoPath}`, !!draft);
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
  const name = repo.repoPath.split('/').filter(Boolean).pop() ?? repo.repoPath;
  const panel = `learnings-${repo.repoPath}`;
  const expanded = open || !!draft;
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/60">
      <header className="px-3 sm:px-4 py-2.5 space-y-1">
        <div className="flex items-center gap-2 min-w-0">
          <button type="button" className="flex items-center gap-2 min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-emerald-500 rounded" aria-expanded={expanded} aria-controls={panel} onClick={onToggle} title={expanded ? 'collapse' : 'expand'} disabled={!!draft}>
            {expanded ? <ChevronDown size={14} className="text-zinc-500 shrink-0" /> : <ChevronRight size={14} className="text-zinc-500 shrink-0" />}
            <span className="text-sm font-semibold text-zinc-100 truncate">{name}</span>
          </button>
          <span className="hidden sm:inline shrink-0 text-[11px] text-zinc-500 whitespace-nowrap">
            {filtering ? `${rows.length} of ${n}` : n} learning{n === 1 ? '' : 's'}
            {repo.updatedAt && <> · {ago(repo.updatedAt)}</>}
          </span>
          {!draft && (
            <Button size="sm" variant="ghost" className="shrink-0" onClick={edit} title="Change, remove or add learnings for this folder">
              <Pencil size={12} /> Edit
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-zinc-500 min-w-0 pl-6">
          <span className="flex items-center gap-1.5 min-w-0">
            <Folder size={11} className="shrink-0" aria-hidden="true" />
            <span className="mono truncate" title={repo.repoPath}>
              {shortCwd(repo.repoPath)}
            </span>
          </span>
          <span className="sm:hidden whitespace-nowrap">
            {n} learning{n === 1 ? '' : 's'}
          </span>
        </div>
      </header>
      {expanded && (
        <div id={panel} className="border-t border-zinc-800 px-3 sm:px-4 py-3">
          {draft ? (
            <div className="space-y-3">
              {draft.map((d, i) => (
                <div key={i} className="flex flex-col sm:flex-row sm:items-start gap-2">
                  {/* the kind keeps its width, the text takes the rest (Select is w-full: its box sets the width) */}
                  <div className="sm:w-36 shrink-0">
                    <Select className="text-xs" value={d.kind} onChange={(e) => set(i, { kind: e.target.value as LearningKind })} aria-label="kind">
                      {KINDS.map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="flex-1 min-w-0">
                    <Textarea rows={2} className="w-full text-xs" maxLength={MAX_CHARS} value={d.text} placeholder="One fact that saves the next goal time: a command, a path, a convention, a pitfall…" onChange={(e) => set(i, { text: e.target.value })} />
                    <div className="text-[10px] text-zinc-600 text-right">
                      {d.text.length}/{MAX_CHARS}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" className="self-end sm:self-start shrink-0" onClick={() => setDraft((x) => x && x.filter((_, j) => j !== i))} title="Remove" aria-label="Remove">
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
            <ul className="divide-y divide-zinc-800/70">
              {rows.map((l) => (
                <LearningRow key={l.id} l={l} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function LearningRow({ l }: { l: Learning }) {
  return (
    <li className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-2 py-1.5 first:pt-0 last:pb-0 text-xs">
      <span className="flex items-start gap-2 flex-1 min-w-0">
        <span className="mt-px">
          <KindBadge kind={l.kind} />
        </span>
        <span className="flex-1 min-w-0 text-zinc-200 break-words">{l.text}</span>
      </span>
      <span className="shrink-0 text-[11px] text-zinc-500 sm:max-w-[12rem] truncate" title={l.by === 'human' ? 'written by you' : l.goalTitle ? `learned from “${l.goalTitle}”` : 'learned by Foundry'}>
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
