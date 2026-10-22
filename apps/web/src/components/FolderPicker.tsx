import { ChevronRight, Clock, Folder, FolderGit2, FolderOpen, FolderPlus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, type DirListing, type FsRecent } from '../api.ts';
import { Button, Input, cn, focusFirst, navItemClass } from '../ui.tsx';

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
      <div className="w-full sm:max-w-3xl h-[calc(100dvh-1.5rem)] sm:h-[min(80vh,42rem)] overflow-hidden rounded-xl border border-line bg-panel shadow-2xl flex flex-col">
        <header className="flex items-center gap-2 px-4 py-3 border-b border-line">
          <FolderOpen size={16} className="text-ink-soft" />
          <h3 className="text-sm font-bold text-ink">Select a folder</h3>
          <span className="text-xs text-ink-faint hidden sm:inline">git repositories are marked</span>
          <button className="ml-auto text-ink-faint hover:text-ink" onClick={onClose} aria-label="close">
            <X size={16} />
          </button>
        </header>
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[220px_1fr]">
          {/* the side list on the inset: recent repositories, then the places to browse from, the one shown marked by a bar */}
          <aside className="bg-sunken border-b md:border-b-0 md:border-r border-line p-2 overflow-auto max-h-40 md:max-h-none">
            {meta?.recent.length ? (
              <>
                <div className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-ink-faint px-2.5 py-1 flex items-center gap-1.5">
                  <Clock size={11} /> Recent
                </div>
                {meta.recent.map((p) => (
                  <button key={p} onClick={() => onPick(p)} onDoubleClick={() => go(p)} className="w-full text-left px-2.5 py-1.5 rounded-md text-[13px] font-semibold text-ink hover:bg-panel truncate" title={`${p}\nclick: use · double-click: browse`}>
                    {p.split('/').pop()}
                    <span className="mono block text-[11px] font-normal text-ink-faint truncate">{p}</span>
                  </button>
                ))}
              </>
            ) : null}
            <div className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-ink-faint px-2.5 py-1 mt-1">Places</div>
            {(meta?.roots ?? []).map((r) => (
              <button key={r.path} onClick={() => go(r.path)} className={navItemClass(listing?.path === r.path)}>
                <span className="flex items-center gap-1.5">
                  <Folder size={12} className="shrink-0" /> {r.label}
                </span>
              </button>
            ))}
          </aside>
          <section className="flex flex-col min-h-0">
            <div className="flex items-center gap-1 px-3 py-2 border-b border-line text-xs overflow-x-auto whitespace-nowrap">
              <button className="mono text-ink-soft hover:text-ink" onClick={() => go('/')} title="/">
                /
              </button>
              {crumbs.map((c, i) => (
                <span key={i} className="flex items-center gap-1">
                  <ChevronRight size={11} className="text-ink-faint" />
                  <button className={cn('mono hover:text-ink', i === crumbs.length - 1 ? 'font-bold text-ink' : 'text-ink-soft')} onClick={() => go(crumbPath(i))}>
                    {c}
                  </button>
                </span>
              ))}
              <span className="ml-auto flex items-center gap-3 pl-3">
                <button type="button" className="flex items-center gap-1 font-semibold text-ink-soft hover:text-ink disabled:opacity-40" disabled={!listing || newName !== null} onClick={() => setNewName('')} title="Make a new folder here">
                  <FolderPlus size={13} /> New folder
                </button>
                <label className="flex items-center gap-1 text-ink-faint">
                  <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> hidden
                </label>
              </span>
            </div>
            <div ref={listRef} className="flex-1 overflow-auto p-1 min-h-[200px]">
              {err && <div className="text-xs text-bad-ink p-2">{err}</div>}
              {newName !== null && (
                <form
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-sunken"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void create();
                  }}
                >
                  <FolderPlus size={14} className="text-ink-soft shrink-0" />
                  <Input autoFocus={focusFirst} className="text-sm py-1 flex-1" placeholder="New folder name" value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="New folder name" />
                  <Button size="sm" variant="primary" type="submit" disabled={creating || !newName.trim()}>
                    {creating ? 'Creating…' : 'Create'}
                  </Button>
                  <Button size="sm" variant="ghost" type="button" onClick={() => setNewName(null)}>
                    Cancel
                  </Button>
                </form>
              )}
              {listing?.parent && (
                <button onClick={() => go(listing.parent!)} className="mono w-full text-left px-2 py-1.5 rounded-md text-xs text-ink-soft hover:bg-sunken">
                  ..
                </button>
              )}
              {listing?.entries.map((e) => (
                // the folder in the path field below is outlined in the accent, as a chosen option is
                <div key={e.path} className={cn('group flex items-center gap-2 px-2 py-1.5 rounded-md text-sm', typed === e.path ? 'bg-accent/[0.06] shadow-[inset_0_0_0_1.5px_var(--color-accent)]' : 'hover:bg-sunken')}>
                  <button className="flex items-center gap-2 flex-1 min-w-0 text-left" onDoubleClick={() => go(e.path)} onClick={() => setTyped(e.path)} title="double-click to open">
                    {e.isGitRepo ? <FolderGit2 size={14} className="text-ink shrink-0" /> : <Folder size={14} className="text-ink-faint shrink-0" />}
                    <span className={cn('truncate text-ink', typed === e.path && 'font-bold')}>{e.name}</span>
                    {e.isGitRepo && <span className="shrink-0 rounded-sm px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.07em] text-ink-soft ring-1 ring-inset ring-line-strong">git</span>}
                  </button>
                  <button className="text-[11px] font-semibold text-ink-faint hover:text-ink opacity-0 group-hover:opacity-100" onClick={() => go(e.path)}>
                    open
                  </button>
                  <Button size="sm" variant={e.isGitRepo ? 'primary' : 'default'} className="py-0.5" onClick={() => onPick(e.path)}>
                    use
                  </Button>
                </div>
              ))}
              {listing && listing.entries.length === 0 && !err && <div className="text-xs text-ink-faint p-3">No sub-folders here.</div>}
              {listing?.truncated && <div className="text-[11px] text-ink-faint p-2">listing truncated at 500 entries</div>}
            </div>
          </section>
        </div>
        <footer className="border-t border-line p-3 flex flex-col sm:flex-row gap-2 sm:items-center">
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
