import type { Learning, LearningKind, RepoLearnings } from '@foundry/core/browser';
import { LEARNINGS_EVERYWHERE } from '@foundry/core/browser';
import type { MemoryFolderStatus } from '@foundry/engine/memory-types';
import { Brain, Globe, NotebookPen, SearchX } from 'lucide-react';
import { ChevronDown, ChevronRight, Folder, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.ts';
import { useLive } from '../store.ts';
import { useUnsaved } from '../unsaved.ts';
import { BOARD_ROW, Board, Button, EmptyState, Field, Input, Loading, Modal, PageHeader, Select, Textarea, ago, chipClass, cn, code, focusFirst } from '../ui.tsx';
import { categorySquare } from './agents/marks.ts';
import { BOARD_PANEL, shortCwd } from './agents/rows.tsx';
import { HelpLink } from './HelpPage.tsx';

const KINDS: LearningKind[] = ['build', 'test', 'run', 'structure', 'convention', 'preference', 'pitfall'];
/**
 * Each kind of learning in a category colour of its own (code(i)), on its chip and its filter's square, in the hues it
 * had before themes: build blue, test green, run teal, convention violet, preference amber, pitfall rose; structure,
 * grey then, takes the eighth so every kind tells apart.
 */
const KIND_CODE: Record<LearningKind, number> = { build: 0, test: 1, run: 5, structure: 7, convention: 2, preference: 3, pitfall: 4 };
const MAX_CHARS = 300;
const COLLAPSED_KEY = 'foundry.learnings.collapsed';

function readCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '{}');
  } catch {
    return {};
  }
}

/** the everywhere notebook apart from the folders', and an empty one when the person wrote none yet (ADR-0055) */
export function splitEverywhere(repos: RepoLearnings[]): { everywhere: RepoLearnings; folders: RepoLearnings[] } {
  return { everywhere: repos.find((r) => r.repoPath === LEARNINGS_EVERYWHERE) ?? { repoPath: LEARNINGS_EVERYWHERE, learnings: [], updatedAt: '' }, folders: repos.filter((r) => r.repoPath !== LEARNINGS_EVERYWHERE) };
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
  // the first load at once; a live change refetches after a short quiet, so a burst of events asks once
  useEffect(() => {
    const t = setTimeout(() => api.learnings().then((r) => setRepos(r.repos)).catch(() => setRepos([])), repos === null ? 0 : 150);
    return () => clearTimeout(t);
  }, [version]);
  // a save shows at once; the live update after it reads the same
  const saved = (repoPath: string, learnings: Learning[]) =>
    setRepos((rs) => {
      const next = { repoPath, learnings, updatedAt: new Date().toISOString() };
      const list = rs ?? [];
      return list.some((r) => r.repoPath === repoPath) ? list.map((r) => (r.repoPath === repoPath ? next : r)) : [...list, next];
    });

  const split = repos ? splitEverywhere(repos) : null;
  const shown = !split ? null : only ? [split.folders.find((r) => r.repoPath === only) ?? { repoPath: only, learnings: [], updatedAt: '' }] : split.folders;
  const everywhere = split?.everywhere ?? null;
  const all = [...(shown ?? []), ...(everywhere ? [everywhere] : [])].flatMap((r) => r.learnings);
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
    <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 pt-6 md:pt-9 pb-16 space-y-4">
      <PageHeader
        title="Learnings"
        help={<HelpLink to="learnings" />}
        summary={
          <>
            {shown && (
              <span className="block">
                <span className="mono">{shown.length}</span> folder{shown.length === 1 ? '' : 's'} · <span className="mono">{all.length}</span> learning{all.length === 1 ? '' : 's'} · <span className="mono">{all.filter((l) => l.by === 'human').length}</span> yours{everywhere && everywhere.learnings.length ? ` (${everywhere.learnings.length} everywhere)` : ''}
              </span>
            )}
            <span className="block mt-1">
              What Foundry learned about each project folder from its finished goals, and what you added. Every new goal in a folder gets its notebook: Clarify all of it, each task a short form. Foundry never changes or removes what you wrote (✎). What you write under <span className="font-semibold text-ink-soft">Yours, everywhere</span> goes to every goal in every folder.
            </span>
          </>
        }
        actions={
          only && (
            <Link to="/learnings" className="inline-flex min-h-8 items-center text-sm font-semibold text-ink-soft hover:text-ink hover:underline underline-offset-2">
              ← every folder
            </Link>
          )
        }
      />

      <div className="flex items-center gap-2 flex-wrap">
        {(['all', ...KINDS] as const).map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={cn(chipClass(kind === k), 'inline-flex items-center gap-1.5')}>
            {k !== 'all' && <i className={categorySquare(KIND_CODE[k])} aria-hidden="true" />}
            {k} <span className="mono opacity-60">{shown ? (k === 'all' ? all.length : counts[k]) : ''}</span>
          </button>
        ))}
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search size={13} className="absolute left-2 top-2 text-ink-faint" aria-hidden="true" />
          <Input type="search" className="pl-7 py-1 text-xs" placeholder="search learnings, folders, goals" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search learnings" />
        </div>
        {(shown?.length ?? 0) > 1 && (
          <span className="flex items-center gap-2 text-xs text-ink-faint">
            <button type="button" className="hover:text-ink" onClick={() => setAll(false)}>
              expand all
            </button>
            <span className="text-line-strong">·</span>
            <button type="button" className="hover:text-ink" onClick={() => setAll(true)}>
              collapse all
            </button>
          </span>
        )}
      </div>

      {/* the notebook for every folder first, on a panel of its own (its row names it), then the folders' board */}
      <div className="space-y-6">
        {everywhere && (!filtering || visible(everywhere).length > 0) && (
          <div className={BOARD_PANEL}>
            <ul>
              <FolderCard repo={everywhere} rows={visible(everywhere)} filtering={filtering} open={filtering || !collapsed[LEARNINGS_EVERYWHERE]} onToggle={() => toggle(everywhere)} startAdding={false} onSaved={saved} everywhere />
            </ul>
          </div>
        )}
        {!shown ? (
          <Loading label="Loading Learnings…" />
        ) : shown.length === 0 ? (
          <EmptyState icon={NotebookPen} title="No learnings for a folder yet">
            They are written when a goal ends; a goal's page also links here to add your own.
          </EmptyState>
        ) : cards.length === 0 ? (
          <EmptyState icon={SearchX} title="Nothing matches">
            Pick all, or clear the search.
          </EmptyState>
        ) : (
          <Board id="project-folders" icon={<Folder size={14} aria-hidden="true" />} title="Project folders" count={cards.length}>
            {cards.map((r) => (
              <FolderCard key={r.repoPath} repo={r} rows={visible(r)} filtering={filtering} open={isOpen(r)} onToggle={() => toggle(r)} startAdding={!!only && r.learnings.length === 0} onSaved={saved} />
            ))}
          </Board>
        )}
      </div>
    </div>
  );
}

/** a learning's kind as a chip in small letters, tinted in the kind's category colour */
function KindBadge({ kind }: { kind: LearningKind }) {
  return <span className={cn('inline-flex shrink-0 items-center whitespace-nowrap rounded-sm px-1.5 py-px text-[11px] font-semibold leading-tight', code(KIND_CODE[kind]).chip)}>{kind}</span>;
}

/**
 * One project folder (or the notebook for every folder) as a row of its board: fold, name, how many learnings and Add,
 * the folder under it; open, its learnings are listed under it, indented, each changed on its own.
 */
function FolderCard({ repo, rows, filtering, open, onToggle, startAdding, onSaved, everywhere = false }: { repo: RepoLearnings; rows: Learning[]; filtering: boolean; open: boolean; onToggle: () => void; startAdding: boolean; onSaved: (repoPath: string, learnings: Learning[]) => void; everywhere?: boolean }) {
  // the learning the window is open on (null: a new one); no window when unset
  const [editing, setEditing] = useState<{ learning: Learning | null } | null>(startAdding ? { learning: null } : null);
  const n = repo.learnings.length;
  const name = everywhere ? 'Yours, everywhere' : (repo.repoPath.split('/').filter(Boolean).pop() ?? repo.repoPath);
  const panel = `learnings-${repo.repoPath}`;
  return (
    <li>
      <div className={cn(BOARD_ROW, 'px-4 md:px-5 py-3.5')}>
        <div className="flex items-center gap-2.5 min-w-0">
          {/* the fold button covers the row, as a goal's title link covers its row; Add stays above it */}
          <button type="button" className="flex items-center gap-2.5 min-w-0 flex-1 text-left rounded after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-accent" aria-expanded={open} aria-controls={panel} onClick={onToggle} title={open ? 'collapse' : 'expand'}>
            {open ? <ChevronDown size={14} className="text-ink-faint shrink-0" /> : <ChevronRight size={14} className="text-ink-faint shrink-0" />}
            <span className="min-w-0 text-[15px] font-bold leading-snug text-ink break-words line-clamp-2 sm:line-clamp-1 group-hover:underline decoration-2 underline-offset-[3px]">{name}</span>
          </button>
          <span className="hidden sm:inline shrink-0 text-xs text-ink-faint whitespace-nowrap">
            <span className="mono">{filtering ? `${rows.length} of ${n}` : n}</span> learning{n === 1 ? '' : 's'}
            {repo.updatedAt && <> · <span className="mono">{ago(repo.updatedAt)}</span></>}
          </span>
          <Button size="sm" variant="ghost" className="relative z-10 shrink-0" onClick={() => setEditing({ learning: null })} title={everywhere ? 'Add something every goal in every folder should know: how you like things done' : 'Add a learning to this folder'}>
            <Plus size={12} /> Add
          </Button>
        </div>
        <div className="mt-1 flex items-center gap-3 text-xs text-ink-faint min-w-0 pl-6">
          <span className="flex items-center gap-1.5 min-w-0">
            {everywhere ? <Globe size={12} className="shrink-0" aria-hidden="true" /> : <Folder size={12} className="shrink-0" aria-hidden="true" />}
            <span className={cn('truncate', !everywhere && 'mono')} title={everywhere ? 'Given to every goal, in every folder, with the folder’s own learnings; only you write here' : repo.repoPath}>
              {everywhere ? 'given to every goal in every folder, with the folder’s own; only you write here' : shortCwd(repo.repoPath)}
            </span>
          </span>
          <span className="sm:hidden ml-auto shrink-0 whitespace-nowrap">
            <span className="mono">{n}</span> learning{n === 1 ? '' : 's'}
          </span>
        </div>
        {!everywhere && <MemoryLine repoPath={repo.repoPath} />}
      </div>
      {open && (
        <div id={panel} className="border-t border-line bg-sunken/60">
          {n === 0 ? (
            <div className="pl-8 sm:pl-12 pr-4 md:pr-5 py-3.5 text-[13px] text-ink-faint">{everywhere ? 'Nothing yet. Add how you like things done in every project: the package manager, the language of comments and commits, a rule for every reviewer.' : 'Nothing yet. Add a command, a path, a convention or a pitfall the next goal here should know.'}</div>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((l) => (
                <LearningRow key={l.id} l={l} onEdit={() => setEditing({ learning: l })} />
              ))}
            </ul>
          )}
        </div>
      )}
      {editing && <LearningDialog repoPath={repo.repoPath} learning={editing.learning} onClose={() => setEditing(null)} onSaved={(ls) => onSaved(repo.repoPath, ls)} />}
    </li>
  );
}

/**
 * Memory (ADR-0071) under a folder: the Hindsight bank its goals share with the person's own sessions there, and the
 * switch that leaves the folder out or takes it back in. Nothing for a folder that is no git repository.
 */
export function MemoryLine({ repoPath, initial = null }: { repoPath: string; initial?: MemoryFolderStatus | null }) {
  const [mem, setMem] = useState<MemoryFolderStatus | null>(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (initial) return;
    api.memoryFolder(repoPath).then(setMem).catch(() => setMem(null));
  }, [repoPath]);
  if (!mem) return null;
  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      setMem(await api.setMemoryFolder(repoPath, on));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-1 flex items-center gap-2 text-xs text-ink-faint min-w-0 pl-6">
      <Brain size={12} className="shrink-0" aria-hidden="true" />
      {mem.bank === null ? (
        <span>no Memory: not a git repository</span>
      ) : (
        <>
          <span className="mono truncate" title="the Hindsight bank this folder's goals share with your own sessions here">
            {mem.bank}
          </span>
          {/* above the fold button, which covers the row */}
          <label className="relative z-10 flex items-center gap-1.5 font-semibold text-ink-soft cursor-pointer shrink-0" title={mem.excluded ? 'Left out: its goals neither read nor write the bank' : 'Its goals read and write the bank while a Hindsight server is set up (Extensions → MCP servers)'}>
            <input type="checkbox" checked={!mem.excluded} disabled={busy} onChange={(e) => void toggle(e.target.checked)} /> Memory
            {!mem.excluded && !mem.enabled && <span className="font-normal">(no server set)</span>}
          </label>
        </>
      )}
    </div>
  );
}

/**
 * A learning in two columns: its kind, in a column of one width so every text starts in line, then the text, with where
 * it came from on the line under it (and the way to change it). A row of its folder's board, indented under the folder.
 */
export function LearningRow({ l, onEdit }: { l: Learning; onEdit?: () => void }) {
  return (
    <li className={cn('flex items-start gap-3', BOARD_ROW, 'pl-8 sm:pl-12 pr-4 md:pr-5 py-3')}>
      <span className="w-20 shrink-0 pt-0.5">
        <KindBadge kind={l.kind} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug text-ink break-words">{l.text}</p>
        <div className="mt-1 flex items-center gap-2 text-xs text-ink-faint">
          <span className="min-w-0 truncate" title={l.by === 'human' ? 'written by you' : l.goalTitle ? `learned from “${l.goalTitle}”` : 'learned by Foundry'}>
            {l.by === 'human' ? (
              '✎ yours'
            ) : l.goalId ? (
              <>
                from{' '}
                <Link to={`/goals/${l.goalId}`} className="font-semibold text-ink-soft hover:text-ink hover:underline">
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
            <button type="button" onClick={onEdit} className="relative ml-auto shrink-0 inline-flex items-center gap-1 rounded px-1 font-semibold text-ink-faint hover:text-ink before:absolute before:-inset-2 before:content-['']" style={{ minHeight: 0 }} aria-label="Edit this learning" title="Change or remove this learning">
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
        <div className="flex items-center gap-1.5 min-w-0 text-xs text-ink-faint">
          <Folder size={12} className="shrink-0" aria-hidden="true" />
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
            <span className="mono text-[11px] text-ink-faint">
              {text.length}/{MAX_CHARS}
            </span>
          }
          help="One fact that saves the next goal time: a command, a path, a convention, a pitfall. What you write or change becomes yours (✎), and Foundry keeps it word for word."
        >
          <Textarea rows={6} autoFocus={focusFirst} maxLength={MAX_CHARS} value={text} placeholder="e.g. Run `bun test` from the repository root; the e2e tests need `bun run dev` first." onChange={(e) => setText(e.target.value)} />
        </Field>
        {err && <div className="text-xs text-bad-ink">{err}</div>}
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
