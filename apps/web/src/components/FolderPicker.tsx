import { ChevronRight, Clock, Folder, FolderGit2, FolderOpen, FolderPlus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, type DirListing, type FsRecent } from '../api.ts';
import { Button, Input, cn } from '../ui.tsx';

/** opened from another device (over the tailnet): a Finder dialog would open on Foundry's computer, out of reach */
const remote = typeof location !== 'undefined' && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

/**
 * Folder chooser: recent repositories + well-known roots on the left, a directory listing with
 * git badges on the right and New folder above it, a native macOS dialog button when the engine reports one and the
 * page is on Foundry's computer, and a typed path as fallback. Its height is fixed, so a long or short listing never
 * makes it jump.
 */
export function FolderPicker({ initial, onPick, onClose }: { initial?: string; onPick: (path: string) => void; onClose: () => void }) {
  const [meta, setMeta] = useState<FsRecent | null>(null);
  const [listing, setListing] = useState<DirListing | null>(null);
  const [typed, setTyped] = useState(initial ?? '');
  const [hidden, setHidden] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  // New folder: the name being typed (null = not making one), and whether it is being created
  const [newName, setNewName] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const go = (path?: string) => {
    setErr(null);
    api
      .fsList(path, hidden)
      .then((l) => {
        setListing(l);
        setTyped(l.path);
        setNewName(null);
        listRef.current?.scrollTo({ top: 0 });
      })
      .catch((e) => setErr(e.message));
  };
  const create = async () => {
    if (!listing || !newName?.trim()) return;
    setCreating(true);
    setErr(null);
    try {
      const { path } = await api.fsMkdir(listing.path, newName.trim());
      setListing(await api.fsList(listing.path, hidden));
      setNewName(null);
      setTyped(path);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setCreating(false);
    }
  };
  useEffect(() => {
    api.fsRecent().then(setMeta).catch(() => setMeta({ recent: [], roots: [], nativePicker: false }));
    go(initial || undefined);
  }, []);
  useEffect(() => {
    if (listing) go(listing.path);
  }, [hidden]);
  useEffect(() => {
    // Escape leaves the New folder field first, then the picker
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (newName !== null) setNewName(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, newName]);

  const native = async () => {
    setPicking(true);
    setErr(null);
    try {
      const r = await api.fsPick(listing?.path);
      if (r.path) onPick(r.path);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setPicking(false);
    }
  };

  const crumbs = listing ? listing.path.split('/').filter(Boolean) : [];
  const crumbPath = (i: number) => '/' + crumbs.slice(0, i + 1).join('/');

  return (
    <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-3 sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full sm:max-w-3xl h-[calc(100dvh-1.5rem)] sm:h-[min(80vh,42rem)] rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl flex flex-col">
        <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
          <FolderOpen size={16} className="text-emerald-400" />
          <h3 className="text-sm font-semibold">Select a folder</h3>
          <span className="text-xs text-zinc-500 hidden sm:inline">git repositories are marked</span>
          <button className="ml-auto text-zinc-400 hover:text-zinc-100" onClick={onClose} aria-label="close">
            <X size={16} />
          </button>
        </header>
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[220px_1fr]">
          <aside className="border-b md:border-b-0 md:border-r border-zinc-800 p-2 overflow-auto max-h-40 md:max-h-none">
            {meta?.recent.length ? (
              <>
                <div className="text-[10px] uppercase tracking-wide text-zinc-500 px-2 py-1 flex items-center gap-1">
                  <Clock size={10} /> Recent
                </div>
                {meta.recent.map((p) => (
                  <button key={p} onClick={() => onPick(p)} onDoubleClick={() => go(p)} className="w-full text-left px-2 py-1 rounded text-xs text-zinc-300 hover:bg-zinc-900 truncate" title={`${p}\nclick: use · double-click: browse`}>
                    {p.split('/').pop()}
                    <span className="block text-[10px] text-zinc-600 truncate">{p}</span>
                  </button>
                ))}
              </>
            ) : null}
            <div className="text-[10px] uppercase tracking-wide text-zinc-500 px-2 py-1 mt-1">Places</div>
            {(meta?.roots ?? []).map((r) => (
              <button key={r.path} onClick={() => go(r.path)} className={cn('w-full text-left px-2 py-1 rounded text-xs hover:bg-zinc-900 flex items-center gap-1.5', listing?.path === r.path ? 'text-emerald-300' : 'text-zinc-300')}>
                <Folder size={12} /> {r.label}
              </button>
            ))}
          </aside>
          <section className="flex flex-col min-h-0">
            <div className="flex items-center gap-1 px-3 py-2 border-b border-zinc-800 text-xs overflow-x-auto whitespace-nowrap">
              <button className="text-zinc-400 hover:text-zinc-100" onClick={() => go('/')} title="/">
                /
              </button>
              {crumbs.map((c, i) => (
                <span key={i} className="flex items-center gap-1">
                  <ChevronRight size={11} className="text-zinc-600" />
                  <button className={cn('hover:text-zinc-100', i === crumbs.length - 1 ? 'text-zinc-100' : 'text-zinc-400')} onClick={() => go(crumbPath(i))}>
                    {c}
                  </button>
                </span>
              ))}
              <span className="ml-auto flex items-center gap-3 pl-3">
                <button type="button" className="flex items-center gap-1 text-zinc-400 hover:text-zinc-100 disabled:opacity-40" disabled={!listing || newName !== null} onClick={() => setNewName('')} title="Make a new folder here">
                  <FolderPlus size={13} /> New folder
                </button>
                <label className="flex items-center gap-1 text-zinc-500">
                  <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> hidden
                </label>
              </span>
            </div>
            <div ref={listRef} className="flex-1 overflow-auto p-1 min-h-[200px]">
              {err && <div className="text-xs text-rose-400 p-2">{err}</div>}
              {newName !== null && (
                <form
                  className="flex items-center gap-2 px-2 py-1.5 rounded bg-zinc-900"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void create();
                  }}
                >
                  <FolderPlus size={14} className="text-emerald-400 shrink-0" />
                  <Input autoFocus className="text-sm py-1 flex-1" placeholder="New folder name" value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="New folder name" />
                  <Button size="sm" variant="primary" type="submit" disabled={creating || !newName.trim()}>
                    {creating ? 'Creating…' : 'Create'}
                  </Button>
                  <Button size="sm" variant="ghost" type="button" onClick={() => setNewName(null)}>
                    Cancel
                  </Button>
                </form>
              )}
              {listing?.parent && (
                <button onClick={() => go(listing.parent!)} className="w-full text-left px-2 py-1.5 rounded text-xs text-zinc-400 hover:bg-zinc-900">
                  ..
                </button>
              )}
              {listing?.entries.map((e) => (
                <div key={e.path} className="group flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-900 text-sm">
                  <button className="flex items-center gap-2 flex-1 min-w-0 text-left" onDoubleClick={() => go(e.path)} onClick={() => setTyped(e.path)} title="double-click to open">
                    {e.isGitRepo ? <FolderGit2 size={14} className="text-emerald-400 shrink-0" /> : <Folder size={14} className="text-zinc-500 shrink-0" />}
                    <span className={cn('truncate', typed === e.path ? 'text-emerald-300' : 'text-zinc-200')}>{e.name}</span>
                    {e.isGitRepo && <span className="text-[9px] uppercase rounded bg-emerald-500/15 text-emerald-300 px-1">git</span>}
                  </button>
                  <button className="text-[11px] text-zinc-500 hover:text-zinc-200 opacity-0 group-hover:opacity-100" onClick={() => go(e.path)}>
                    open
                  </button>
                  <Button size="sm" variant={e.isGitRepo ? 'primary' : 'default'} className="py-0.5" onClick={() => onPick(e.path)}>
                    use
                  </Button>
                </div>
              ))}
              {listing && listing.entries.length === 0 && !err && <div className="text-xs text-zinc-500 p-3">No sub-folders here.</div>}
              {listing?.truncated && <div className="text-[11px] text-zinc-500 p-2">listing truncated at 500 entries</div>}
            </div>
          </section>
        </div>
        <footer className="border-t border-zinc-800 p-3 flex flex-col sm:flex-row gap-2 sm:items-center">
          <Input className="mono text-xs flex-1" value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && typed.trim() && onPick(typed.trim())} placeholder="/path/to/repository" />
          <div className="flex gap-2 justify-end">
            {meta?.nativePicker && !remote && (
              <Button onClick={native} disabled={picking} title="Opens the macOS folder dialog (look for it behind this window or in the Dock)">
                {picking ? 'Finder dialog open…' : 'Choose with Finder…'}
              </Button>
            )}
            <Button variant="primary" disabled={!typed.trim()} onClick={() => onPick(typed.trim())}>
              Use this folder
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
