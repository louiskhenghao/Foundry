import type { Learning, LearningKind, RepoLearnings } from '@foundry/core/browser';
import { ChevronDown, ChevronRight, Folder, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.ts';
import { useLive } from '../store.ts';
import { useUnsaved } from '../unsaved.ts';
import { Button, Empty, Field, Input, Modal, Select, Textarea, ago, cn, focusFirst } from '../ui.tsx';
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

/** a learning as a folder's notebook is saved: a new one has no id yet */
type Entry = { id: string | null; kind: LearningKind; text: string };
/** one change to a folder's notebook: a learning added (no id) or changed, or one removed */
export type LearningChange = Entry | { remove: string };

/**
 * A folder's notebook with one change made. It is applied to the list as the server has it just before saving, so a
 * learning a goal added meanwhile stays; one changed after it was removed comes back as a new one.
 */
export function applyChange(list: Entry[], change: LearningChange): Entry[] {
  if ('remove' in change) return list.filter((l) => l.id !== change.remove);
  const { id, kind, text } = change;
  if (id && list.some((l) => l.id === id)) return list.map((l) => (l.id === id ? { id, kind, text } : l));
  return [...list, { id: null, kind, text }];
}

async function saveChange(repoPath: string, change: LearningChange): Promise<Learning[]> {
  const { learnings } = await api.repoLearnings(repoPath);
  return (await api.saveLearnings(repoPath, applyChange(learnings.map((l) => ({ id: l.id, kind: l.kind, text: l.text })), change))).learnings;
}

/**
 * Learnings (ADR-0040): what Foundry learned about each project folder from its finished goals, and what the person
 * added. Every new goal in a folder is given its notebook. Laid out like Agents and Extensions: the filters on top (each
 * kind with its count), one card per folder; a learning is added, changed or removed one at a time, in a window.
 * `?repo=` shows one folder, and opens the window to add one when it has none yet.
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
  // a save shows at once; the live update after it reads the same
  const saved = (repoPath: string, learnings: Learning[]) =>
    setRepos((rs) => {
      const next = { repoPath, learnings, updatedAt: new Date().toISOString() };
      const list = rs ?? [];
      return list.some((r) => r.repoPath === repoPath) ? list.map((r) => (r.repoPath === repoPath ? next : r)) : [...list, next];
    });

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

      <div className="space-y-2">
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
              <FolderCard key={r.repoPath} repo={r} rows={visible(r)} filtering={filtering} open={isOpen(r)} onToggle={() => toggle(r)} startAdding={!!only && r.learnings.length === 0} onSaved={saved} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function KindBadge({ kind }: { kind: LearningKind }) {
  return <span className={cn('shrink-0 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] leading-none', KIND_STYLE[kind])}>{kind}</span>;
}

/** one project folder: its learnings, each changed on its own; Add opens the window to write a new one */
function FolderCard({ repo, rows, filtering, open, onToggle, startAdding, onSaved }: { repo: RepoLearnings; rows: Learning[]; filtering: boolean; open: boolean; onToggle: () => void; startAdding: boolean; onSaved: (repoPath: string, learnings: Learning[]) => void }) {
  // the learning the window is open on (null: a new one); no window when unset
  const [editing, setEditing] = useState<{ learning: Learning | null } | null>(startAdding ? { learning: null } : null);
  const n = repo.learnings.length;
  const name = repo.repoPath.split('/').filter(Boolean).pop() ?? repo.repoPath;
  const panel = `learnings-${repo.repoPath}`;
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/60">
      <header className="px-3 sm:px-4 py-2.5 space-y-1">
        <div className="flex items-center gap-2 min-w-0">
          <button type="button" className="flex items-center gap-2 min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-emerald-500 rounded" aria-expanded={open} aria-controls={panel} onClick={onToggle} title={open ? 'collapse' : 'expand'}>
            {open ? <ChevronDown size={14} className="text-zinc-500 shrink-0" /> : <ChevronRight size={14} className="text-zinc-500 shrink-0" />}
            <span className="text-sm font-semibold text-zinc-100 truncate">{name}</span>
          </button>
          <span className="hidden sm:inline shrink-0 text-[11px] text-zinc-500 whitespace-nowrap">
            {filtering ? `${rows.length} of ${n}` : n} learning{n === 1 ? '' : 's'}
            {repo.updatedAt && <> · {ago(repo.updatedAt)}</>}
          </span>
          <Button size="sm" variant="ghost" className="shrink-0" onClick={() => setEditing({ learning: null })} title="Add a learning to this folder">
            <Plus size={12} /> Add
          </Button>
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
      {open && (
        <div id={panel} className="border-t border-zinc-800 px-3 sm:px-4 py-3">
          {n === 0 ? (
            <div className="text-xs text-zinc-500">Nothing yet. Add a command, a path, a convention or a pitfall the next goal here should know.</div>
          ) : (
            <ul className="divide-y divide-zinc-800/70">
              {rows.map((l) => (
                <LearningRow key={l.id} l={l} onEdit={() => setEditing({ learning: l })} />
              ))}
            </ul>
          )}
        </div>
      )}
      {editing && <LearningDialog repoPath={repo.repoPath} learning={editing.learning} onClose={() => setEditing(null)} onSaved={(ls) => onSaved(repo.repoPath, ls)} />}
    </section>
  );
}

/**
 * A learning in two columns: its kind, in a column of one width so every text starts in line, then the text, with where
 * it came from on the line under it (and the way to change it).
 */
export function LearningRow({ l, onEdit }: { l: Learning; onEdit?: () => void }) {
  return (
    <li className="flex items-start gap-3 py-2 first:pt-0 last:pb-0">
      <span className="w-20 shrink-0 pt-0.5">
        <KindBadge kind={l.kind} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-zinc-200 break-words">{l.text}</p>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-500">
          <span className="min-w-0 truncate" title={l.by === 'human' ? 'written by you' : l.goalTitle ? `learned from “${l.goalTitle}”` : 'learned by Foundry'}>
            {l.by === 'human' ? (
              '✎ yours'
            ) : l.goalId ? (
              <>
                from{' '}
                <Link to={`/goals/${l.goalId}`} className="hover:text-zinc-300 hover:underline">
                  {l.goalTitle ?? 'a goal'}
                </Link>
              </>
            ) : (
              'Foundry'
            )}
            {l.at && <> · {ago(l.at)}</>}
          </span>
          {onEdit && (
            // a small link-like button: a phone's 32px button height would push the line apart, the ::before keeps a thumb-sized target
            <button type="button" onClick={onEdit} className="relative ml-auto shrink-0 inline-flex items-center gap-1 rounded px-1 text-zinc-500 hover:text-zinc-200 before:absolute before:-inset-2 before:content-['']" style={{ minHeight: 0 }} aria-label="Edit this learning" title="Change or remove this learning">
              <Pencil size={11} /> edit
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/** the window to add a learning to a folder, or to change or remove one: one learning at a time, with room to write it */
export function LearningDialog({ repoPath, learning, onClose, onSaved }: { repoPath: string; learning: Learning | null; onClose: () => void; onSaved: (learnings: Learning[]) => void }) {
  const [kind, setKind] = useState<LearningKind>(learning?.kind ?? 'convention');
  const [text, setText] = useState(learning?.text ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const changed = text.trim() !== (learning?.text ?? '') || kind !== (learning?.kind ?? 'convention');
  useUnsaved(`learning:${repoPath}`, learning ? changed : !!text.trim());
  const run = async (change: LearningChange) => {
    setBusy(true);
    setErr(null);
    try {
      onSaved(await saveChange(repoPath, change));
      onClose();
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  };
  return (
    <Modal open title={learning ? 'Edit learning' : 'Add a learning'} onClose={onClose}>
      <div className="space-y-3">
        <div className="flex items-center gap-1.5 min-w-0 text-[11px] text-zinc-500">
          <Folder size={11} className="shrink-0" aria-hidden="true" />
          <span className="mono truncate" title={repoPath}>
            {shortCwd(repoPath)}
          </span>
        </div>
        <Field label="Kind" className="sm:w-48">
          <Select value={kind} onChange={(e) => setKind(e.target.value as LearningKind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="What the next goal here should know"
          aside={
            <span className="mono text-[10px] text-zinc-500">
              {text.length}/{MAX_CHARS}
            </span>
          }
          help="One fact that saves the next goal time: a command, a path, a convention, a pitfall. What you write or change becomes yours (✎), and Foundry keeps it word for word."
        >
          <Textarea rows={6} autoFocus={focusFirst} maxLength={MAX_CHARS} value={text} placeholder="e.g. Run `bun test` from the repository root; the e2e tests need `bun run dev` first." onChange={(e) => setText(e.target.value)} />
        </Field>
        {err && <div className="text-xs text-rose-300">{err}</div>}
        <div className="flex items-center gap-2 pt-1">
          {learning && (
            <Button size="sm" variant="danger" disabled={busy} onClick={() => run({ remove: learning.id })}>
              <Trash2 size={12} /> Remove
            </Button>
          )}
          <span className="ml-auto flex gap-2">
            <Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" disabled={busy || !text.trim() || (!!learning && !changed)} onClick={() => run({ id: learning?.id ?? null, kind, text })}>
              {busy ? 'Saving…' : learning ? 'Save' : 'Add'}
            </Button>
          </span>
        </div>
      </div>
    </Modal>
  );
}
