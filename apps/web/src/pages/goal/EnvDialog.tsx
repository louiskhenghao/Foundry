import { Eye, EyeOff, Plus, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button, Input, Modal, cn } from '../../ui.tsx';

/** the shape a set of variables is shown with: names only, what the example files list, what each name is */
export interface EnvView {
  repo: string;
  /** revision of the saved set; a save from an older one is refused (409) */
  rev: number;
  keys: string[];
  checkout: { files: string[]; keys: string[] };
  example: { key: string; example: string; file: string; comment: string | null }[];
  missing: string[];
  notes: Record<string, { comment: string | null; example: string | null; file: string | null; usedIn: string[]; hint: string | null; generate: 'secret' | null }>;
}

/** how the dialog reads and writes a set: the previews' of a repository, or a deploy place's (ADR-0093) */
export interface EnvActions<V extends EnvView> {
  reload: () => Promise<V>;
  save: (vars: Record<string, string | null>, rev: number) => Promise<V>;
  /** copy the checkout's untracked env files' variables (names not set yet); absent = no such button */
  importCheckout?: () => Promise<{ added: string[]; view: V }>;
  /** more one-click sources, each adding names not set yet: label and action */
  extra?: { label: string; title: string; run: () => Promise<{ added: string[]; view: V }> }[];
}

const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
type Row = { id: number; key: string; value: string; saved: boolean; shown?: boolean; custom?: boolean };
let rowIds = 0;

/** a random secret in the browser: 32 bytes, base64 (what `openssl rand -base64 32` prints) */
export const randomSecret = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));

/**
 * The variables as a table, each name with what it is: its example file comment, a note, and the files that read it.
 * The server sends names only: a saved value is never shown again, an empty value field keeps it, typing replaces it.
 */
export function EnvDialog<V extends EnvView>({ open, env, title, intro, savedNote, sectionTitle, actions, onClose, onSaved, onReload }: { open: boolean; env: V; title: ReactNode; intro: ReactNode; /** what follows "Saved." */ savedNote: string; /** the heading of the saved names, e.g. "Set for this repository" */ sectionTitle: string; actions: EnvActions<V>; onClose: () => void; onSaved: (e: V, msg: string) => void; onReload: (e: V) => void }) {
  const fresh = (e: V): Row[] => [...e.keys.map((key) => ({ id: ++rowIds, key, value: '', saved: true })), ...e.missing.map((key) => ({ id: ++rowIds, key, value: '', saved: false }))];
  const [rows, setRows] = useState<Row[]>(() => fresh(env));
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (open) setMsg(null);
  }, [open]);
  useEffect(() => {
    if (open) setRows(fresh(env));
  }, [open, env.rev]);
  const take = (e: V) => {
    onReload(e);
    setRows(fresh(e));
  };

  const names = rows.filter((r) => r.saved || r.custom || r.value).map((r) => r.key.trim());
  // a saved name sends null (keep its value) unless a new value was typed; an unsaved one is sent only with a value
  const next = Object.fromEntries(rows.filter((r) => r.key.trim() && (r.saved || r.value)).map((r) => [r.key.trim(), r.saved && !r.value ? null : r.value]));
  const dirty = JSON.stringify(Object.keys(next).sort()) !== JSON.stringify([...env.keys].sort()) || Object.values(next).some((v) => v !== null);
  const bad = names.filter((k, i) => k && (!KEY.test(k) || names.indexOf(k) !== i));
  const unnamed = rows.some((r) => !r.key.trim() && r.value);
  const set = (id: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const act = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    setMsg(null);
    try {
      await fn();
    } catch (e: any) {
      // changed elsewhere (another tab, another goal of this repository): show the current set, not a stale one
      if (e.status === 409) await actions.reload().then(take).catch(() => {});
      setMsg({ ok: false, text: e.status === 409 ? 'These variables changed elsewhere; showing the current ones. Your unsaved edits were not kept.' : (e.body?.error ?? e.message) });
    } finally {
      setBusy(null);
    }
  };
  const save = () => act('save', async () => onSaved(await actions.save(next, env.rev), `Saved.${savedNote}`));
  const bring = (label: string, run: () => Promise<{ added: string[]; view: V }>) =>
    act(label, async () => {
      const r = await run();
      take(r.view);
      setMsg({ ok: true, text: r.added.length ? `Added ${r.added.length}: ${r.added.join(', ')}.${savedNote}` : 'Nothing new to add: every name is already set here.' });
    });
  const noManager = { autoComplete: 'new-password', 'data-1p-ignore': 'true', 'data-lpignore': 'true' } as const;
  const setRows_ = rows.filter((r) => r.saved);
  const unset = rows.filter((r) => !r.saved && !r.custom);
  const custom = rows.filter((r) => r.custom);

  const row = (r: Row) => {
    const n = env.notes[r.key.trim()];
    const lines = [n?.comment, n?.hint && n.hint !== n?.comment ? n.hint : null].filter(Boolean) as string[];
    return (
      <li key={r.id} className="py-2.5 first:pt-0 last:pb-0">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto_auto] gap-1.5 items-center">
          {/* a saved name is fixed: renaming would need its value, which the page never has; remove and add instead */}
          <Input
            aria-label="Variable name"
            value={r.key}
            readOnly={!r.custom}
            title={r.saved ? 'To rename, remove this variable and add it again with its value' : undefined}
            placeholder="NAME"
            spellCheck={false}
            {...noManager}
            onChange={(e) => set(r.id, { key: e.target.value })}
            className={cn('col-span-3 sm:col-span-1 mono text-[11px] py-1', !r.custom && 'font-semibold text-ink bg-transparent border-transparent px-0', bad.includes(r.key.trim()) && 'border-bad/60')}
          />
          <div className="flex gap-1 min-w-0">
            <Input aria-label={`Value of ${r.key || 'variable'}`} type={r.shown ? 'text' : 'password'} spellCheck={false} {...noManager} value={r.value} placeholder={r.saved ? 'saved · type to replace' : n?.example || 'not set'} onChange={(e) => set(r.id, { value: e.target.value })} className="mono text-[11px] py-1" />
            {n?.generate === 'secret' && (
              <Button size="sm" variant="ghost" className="shrink-0" onClick={() => set(r.id, { value: randomSecret(), shown: true })} title="Fill in a random 32-byte secret">
                Generate
              </Button>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={() => set(r.id, { shown: !r.shown })} aria-label={r.shown ? 'Hide what you typed' : 'Show what you typed'} title={r.saved ? 'Saved values are never shown again; this shows what you type' : r.shown ? 'Hide' : 'Show'}>
            {r.shown ? <EyeOff size={12} /> : <Eye size={12} />}
          </Button>
          {r.saved || r.custom ? (
            <Button size="sm" variant="ghost" onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))} aria-label={`Remove ${r.key || 'variable'}`} title="Remove">
              <X size={12} />
            </Button>
          ) : (
            <span className="w-7" />
          )}
        </div>
        {(lines.length > 0 || (n && (n.file || n.usedIn.length > 0))) && (
          <div className="mt-1 sm:ml-[13.375rem] space-y-0.5 text-[11px]">
            {lines.map((l, i) => (
              <div key={i} className="text-ink-soft">
                {l}
              </div>
            ))}
            {n && (n.file || n.usedIn.length > 0) && (
              <div className="text-ink-faint">
                {n.file && (
                  <>
                    in <span className="mono">{n.file}</span>
                    {n.example && (
                      <>
                        {' '}
                        as <span className="mono">{n.example}</span>
                      </>
                    )}
                  </>
                )}
                {n.file && n.usedIn.length > 0 && ' · '}
                {n.usedIn.length > 0 && (
                  <>
                    read by <span className="mono">{n.usedIn.join(', ')}</span>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <Modal open={open} wide title={title} onClose={onClose}>
      <div className="space-y-4 text-xs">
        <p className="text-ink-soft">{intro}</p>
        {actions.importCheckout && env.checkout.files.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap rounded-lg border border-line bg-sunken px-3 py-2 text-[11px] text-ink-soft">
            <span className="min-w-0 flex-1">
              Your checkout has <span className="mono text-ink">{env.checkout.files.join(', ')}</span> ({env.checkout.keys.length} variables), which git keeps out of the goal's folder.
            </span>
            <Button size="sm" disabled={!!busy || dirty} onClick={() => void bring('import', actions.importCheckout!)} title={dirty ? 'Save or revert your changes first' : 'Copy the variables not set here yet; names already set keep their values'}>
              {busy === 'import' ? 'Importing…' : 'Import from your checkout'}
            </Button>
          </div>
        )}
        {(actions.extra ?? []).map((x) => (
          <div key={x.label} className="flex items-center gap-2 flex-wrap rounded-lg border border-line bg-sunken px-3 py-2 text-[11px] text-ink-soft">
            <span className="min-w-0 flex-1">{x.title}</span>
            <Button size="sm" disabled={!!busy || dirty} onClick={() => void bring(x.label, x.run)} title={dirty ? 'Save or revert your changes first' : 'Names already set keep their values'}>
              {busy === x.label ? 'Adding…' : x.label}
            </Button>
          </div>
        ))}
        {setRows_.length > 0 && (
          <section className="space-y-2">
            <h4 className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-faint">{sectionTitle} · <span className="mono">{setRows_.length}</span></h4>
            <ul className="divide-y divide-line">{setRows_.map(row)}</ul>
          </section>
        )}
        {unset.length > 0 && (
          <section className="space-y-2">
            <h4 className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-faint">Listed in example files, not set · <span className="mono">{unset.length}</span></h4>
            <p className="text-[11px] text-ink-faint">Those without an example value come first. Not every one is needed: example files list optional settings too, and some start scripts write their own. Only the ones you fill in are saved.</p>
            <ul className="divide-y divide-line">{unset.map(row)}</ul>
          </section>
        )}
        {custom.length > 0 && (
          <section className="space-y-2">
            <h4 className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-faint">Added</h4>
            <ul className="divide-y divide-line">{custom.map(row)}</ul>
          </section>
        )}
        {bad.length > 0 && <div className="text-bad-ink text-[11px]">Names use letters, digits and _ (not starting with a digit), each once: {bad.join(', ')}</div>}
        {unnamed && <div className="text-bad-ink text-[11px]">A value has no name yet.</div>}
        <div className="flex items-center gap-2 flex-wrap border-t border-line pt-3">
          <Button size="sm" variant="ghost" onClick={() => setRows((rs) => [...rs, { id: ++rowIds, key: '', value: '', saved: false, shown: true, custom: true }])}>
            <Plus size={12} /> Add variable
          </Button>
          <span role="status" className={cn('text-[11px] min-w-0 flex-1', msg?.ok ? 'text-ok-ink' : 'text-bad-ink')}>
            {msg?.text}
          </span>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" disabled={!dirty || !!busy || bad.length > 0 || unnamed} onClick={save}>
            {busy === 'save' ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
