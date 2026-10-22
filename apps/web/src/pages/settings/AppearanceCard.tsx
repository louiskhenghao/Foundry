import { fillPalette, layoutOf, type Layout, type ThemeEntry } from '@foundry/core/browser';
import { Check, ChevronDown, Copy, Download, FilePenLine, FolderOpen, MoreHorizontal, Pencil, RefreshCw, Trash2, Upload, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, type OpenTarget } from '../../api.ts';
import { loadThemes, selectTheme, setMode, useTheme, type Mode } from '../../theme.ts';
import { Button, ButtonGroup, Card, ConfirmDialog, CopyButton, Input, Menu, MenuItem, cn } from '../../ui.tsx';
import { HelpLink } from '../HelpPage.tsx';
import { SettingsTitle } from './sections.tsx';

/**
 * Settings → Appearance (ADR-0066): the theme and light or dark, for this browser only, applied at once. Under them, how
 * to make a theme of your own: a copy of one is written to the themes folder as a file, edited in any editor, and shown
 * here again as soon as it is saved; a file with a mistake is listed with what to fix.
 */
export function AppearanceCard() {
  const [editors, setEditors] = useState<OpenTarget[]>([]);
  useEffect(() => {
    api
      .openTargets()
      .then((all) => setEditors(all.filter((t) => t.kind === 'editor' && t.available)))
      .catch(() => {});
  }, []);
  return <Appearance {...useTheme()} editors={editors} />;
}

/** the card's content for a given state of this browser's look (the store's, or a test's) */
export function Appearance({ themes, problems, dir, id, mode, light, editors = [] }: Pick<ReturnType<typeof useTheme.getState>, 'themes' | 'problems' | 'dir' | 'id' | 'mode' | 'light'> & { /** the editors found on this computer, to open a theme's file in */ editors?: OpenTarget[] }) {
  const [note, setNote] = useState<{ text: string; file?: string; id?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /** a theme of your own being renamed (with the name typed so far) or about to be deleted */
  const [renaming, setRenaming] = useState<{ entry: ThemeEntry; name: string } | null>(null);
  const [deleting, setDeleting] = useState<ThemeEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const copy = async (from: ThemeEntry) => {
    setErr(null);
    try {
      const made = await api.copyTheme(from.id);
      await loadThemes();
      // the copy looks exactly like what it was made from, so it can be worn at once and every edit shows
      selectTheme(made.id);
      setNote({ text: `“${made.theme.name}” is in use now. Open its file in an editor and change it: this page shows each change once the file is saved.`, file: made.file, id: made.id });
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  /** runs a change to a theme of your own; the note about it goes when the theme it names does */
  const change = async (entry: ThemeEntry, act: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await act();
      if (note?.id === entry.id) setNote(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      setRenaming(null);
      setDeleting(null);
    }
  };
  // renamed, its id follows its name: this browser keeps wearing it under the new one
  const rename = (entry: ThemeEntry, name: string) =>
    change(entry, async () => {
      const made = await api.renameTheme(entry.id, name);
      await loadThemes();
      if (entry.id === id) selectTheme(made.id);
    });
  // deleted, a browser that wore it goes back to the default (loadThemes sees it gone)
  const remove = (entry: ThemeEntry) =>
    change(entry, async () => {
      await api.deleteTheme(entry.id);
      await loadThemes();
    });
  const exportFile = (entry: ThemeEntry) => {
    const a = document.createElement('a');
    a.href = api.themeFileUrl(entry.id);
    a.download = `${entry.id}.json`;
    a.click();
  };
  // a theme file from elsewhere: checked by Foundry, and worn at once as a copy is
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setErr(null);
    try {
      const made = await api.importTheme(file.name, await file.text());
      await loadThemes();
      selectTheme(made.id);
      setNote({ text: `“${made.theme.name}” is imported and in use now.`, file: made.file, id: made.id });
    } catch (e) {
      setErr(`${file.name}: ${(e as Error).message}`);
    } finally {
      if (picker.current) picker.current.value = '';
    }
  };

  return (
    <Card id="appearance" title={<SettingsTitle id="appearance">Appearance<HelpLink to="themes" className="ml-1.5" /></SettingsTitle>} className="scroll-mt-16">
      <div className="space-y-5">
        <p className="text-xs text-ink-faint">How Foundry looks in this browser. Each person and each device picks their own; a change applies at once and needs no Save.</p>

        <div role="radiogroup" aria-label="Theme" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {themes.map((t) => (
            <ThemeOption
              key={t.id}
              entry={t}
              chosen={t.id === id}
              light={light}
              onChoose={() => selectTheme(t.id)}
              onCopy={() => copy(t)}
              editors={editors}
              onError={setErr}
              mine={{ rename: () => setRenaming({ entry: t, name: t.theme.name }), exportFile: () => exportFile(t), remove: () => setDeleting(t) }}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-xs font-semibold text-ink-soft">Light or dark</span>
          <ButtonGroup<Mode>
            label="Light or dark"
            value={mode}
            onChange={setMode}
            options={[
              { id: 'light', label: 'Light' },
              { id: 'dark', label: 'Dark' },
              { id: 'system', label: 'Same as this computer', title: 'Follows the light or dark setting of the computer or phone, and changes with it' },
            ]}
          />
        </div>

        {note && (
          <div className="rounded-md border border-line bg-sunken px-3 py-2.5 text-xs text-ink-soft space-y-2">
            <p>{note.text}</p>
            {note.file && (
              <p className="flex flex-wrap items-center gap-2">
                <span className="mono break-all text-ink">{note.file}</span>
                <CopyButton text={note.file} />
              </p>
            )}
            {note.id && <OpenInEditor theme={note.id} editors={editors} onError={setErr} />}
          </div>
        )}
        {/* a failure in red words with its mark, on a plain box: no red panel */}
        {err && (
          <div className="flex items-start gap-2 rounded-md border border-line bg-sunken px-3 py-2 text-xs text-bad-ink">
            <XCircle size={13} className="mt-px shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words">{err}</span>
          </div>
        )}

        <section aria-labelledby="own-theme" className="border-t border-line pt-4 space-y-3">
          <h4 id="own-theme" className="text-sm font-bold text-ink">Make your own theme</h4>
          <ol className="list-decimal pl-5 space-y-1 text-xs text-ink-soft">
            <li>
              Press <b className="text-ink">Make a copy</b> under the theme closest to what you want. Foundry writes it as a file in the themes folder below, under a name of its own, and puts it in use.
            </li>
            <li>Open the file in an editor. Change its colours (written #rrggbb), its fonts, its corners or its layout (where the navigation sits, how titles, stages, labels and signs look); the editor checks every value and explains each setting as you type.</li>
            <li>Save the file and come back to this window: Foundry shows the change at once. A file with a mistake is listed here with what to fix, and the theme keeps its last good look meanwhile.</li>
          </ol>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-ink-faint">Themes folder</span>
            {dir ? (
              <>
                <span className="mono break-all text-ink">{dir}</span>
                <CopyButton text={dir} />
              </>
            ) : (
              <span className="text-ink-faint">…</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <OpenFolder onError={setErr} />
            <Button size="sm" onClick={() => picker.current?.click()} title="Brings in a theme file from elsewhere (one exported from another Foundry, or written by hand): Foundry checks it and puts it in use">
              <Upload size={13} /> Import a theme file
            </Button>
            <input ref={picker} type="file" accept=".json,application/json" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void importFile(e.target.files?.[0])} />
            <Button size="sm" variant="ghost" onClick={() => void loadThemes()} title="Reads the theme files again (Foundry also does whenever this window comes back to the front)">
              <RefreshCw size={13} /> Read the files again
            </Button>
          </div>
          {problems.length > 0 && (
            <ul className="rounded-md border border-line bg-sunken px-3 py-2 text-xs space-y-1" aria-label="Theme files that cannot be used">
              {problems.map((p) => (
                <li key={p.file}>
                  <span className="mono font-semibold text-bad-ink">{p.file}</span> <span className="text-ink-soft">— {p.error}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-ink-faint">
            Every setting, with an example to start from:{' '}
            <a href="/help/themes" target="_blank" rel="noreferrer" className="underline hover:text-ink">
              Themes in the guide
            </a>
            .
          </p>
        </section>
      </div>

      <ConfirmDialog
        open={!!renaming}
        title="Rename the theme"
        confirmLabel="Rename"
        busy={busy}
        confirmDisabled={!renaming?.name.trim()}
        onConfirm={() => renaming && void rename(renaming.entry, renaming.name)}
        onClose={() => setRenaming(null)}
      >
        <p>Its file takes the new name too.</p>
        <Input
          autoFocus
          aria-label="New name"
          maxLength={40}
          value={renaming?.name ?? ''}
          onChange={(e) => setRenaming((r) => (r ? { ...r, name: e.target.value } : r))}
          onKeyDown={(e) => e.key === 'Enter' && renaming?.name.trim() && void rename(renaming.entry, renaming.name)}
        />
      </ConfirmDialog>
      <ConfirmDialog open={!!deleting} title={`Delete “${deleting?.theme.name}”?`} confirmLabel="Delete" danger busy={busy} onConfirm={() => deleting && void remove(deleting)} onClose={() => setDeleting(null)}>
        <p>
          Its file <span className="mono text-ink">{deleting?.id}.json</span> is removed from the themes folder: export it first to keep a copy. A browser that wears it goes back to Wayfinding.
        </p>
      </ConfirmDialog>
    </Card>
  );
}

/** a theme's layout in a few words, as its card in Appearance lists it */
const LAYOUT_WORDS: { [K in keyof Layout]: Record<Layout[K], string> } = {
  nav: { top: 'Top bar', side: 'Side column' },
  header: { poster: 'Poster titles', compact: 'Compact titles' },
  stages: { plates: 'Stage plates', steps: 'Numbered steps' },
  labels: { caps: 'Capitals', 'small-caps': 'Small capitals', plain: 'Labels as written' },
  signs: { strip: 'Yellow strips', card: 'Cards with an edge' },
  surface: { raised: 'Raised cards', flat: 'Flat cards' },
};
export const layoutWords = (l: Layout): string[] => (Object.keys(LAYOUT_WORDS) as (keyof Layout)[]).map((k) => (LAYOUT_WORDS[k] as Record<string, string>)[l[k]]!);

/**
 * One theme to pick: a small picture drawn from its own colours and layout in the mode the page is in (its top bar or
 * side column, a card with text and the signal colours, its category colours, a Needs you sign as a strip or a card),
 * its name in its own title font, what it is, and its layout in a few words.
 */
function ThemeOption({ entry, chosen, light, onChoose, onCopy, editors, onError, mine }: { entry: ThemeEntry; chosen: boolean; light: boolean; onChoose: () => void; onCopy: () => void; editors: OpenTarget[]; onError: (e: string | null) => void; /** what a theme of your own can have done to it */ mine: { rename: () => void; exportFile: () => void; remove: () => void } }) {
  const t = entry.theme;
  const p = fillPalette(light ? t.light : t.dark, light ? 'light' : 'dark');
  const r = t.shape?.radius ?? 8;
  const layout = layoutOf(t);
  const side = layout.nav === 'side';
  const mark = <span className="h-2.5 w-2.5 shrink-0" style={{ background: p.accent === p.band ? p.bandInk : p.accent, borderRadius: r / 4 }} />;
  return (
    <div className={cn('flex flex-col overflow-hidden rounded-lg bg-panel ring-inset', chosen ? 'ring-2 ring-accent' : 'ring-1 ring-line')}>
      <button type="button" role="radio" aria-checked={chosen} onClick={onChoose} className="block text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent" aria-label={`${t.name}${chosen ? ', in use' : ''}`}>
        <span aria-hidden="true" className={cn('flex h-32 overflow-hidden', side ? 'flex-row' : 'flex-col')} style={{ background: p.page }}>
          {side ? (
            <span className="flex w-10 shrink-0 flex-col gap-1.5 p-1.5" style={{ background: p.band, borderRight: `1px solid ${p.line}` }}>
              {mark}
              {[0, 1, 2].map((i) => (
                <span key={i} className="h-1 w-full rounded-full" style={{ background: p.bandInk, opacity: i ? 0.45 : 0.85 }} />
              ))}
            </span>
          ) : (
            <span className="flex h-5 shrink-0 items-center gap-1.5 px-2" style={{ background: p.band }}>
              {mark}
              <span className="h-1 w-8 rounded-full opacity-80" style={{ background: p.bandInk }} />
              <span className="ml-auto h-2.5 w-4" style={{ background: p.you, borderRadius: r / 5 }} />
            </span>
          )}
          <span className="flex min-w-0 flex-1 gap-2 p-2.5">
            <span className="min-w-0 flex-1 space-y-1.5 p-2" style={{ background: p.panel, border: `1px solid ${p.line}`, borderRadius: r * 0.6 }}>
              <span className="block h-1.5 w-4/5 rounded-full" style={{ background: p.ink }} />
              <span className="block h-1.5 w-3/5 rounded-full" style={{ background: p.inkSoft }} />
              <span className="flex gap-1 pt-1">
                {[p.ok, p.work, p.bad, p.extra].map((c, i) => (
                  <span key={i} className="h-2 w-2" style={{ background: c, borderRadius: 2 }} />
                ))}
              </span>
              <span className="flex gap-[3px] pt-0.5">
                {p.codes.map((c, i) => (
                  <span key={i} className="h-1.5 flex-1 rounded-full" style={{ background: c }} />
                ))}
              </span>
            </span>
            <span className="w-14 shrink-0 p-1.5" style={layout.signs === 'card' ? { background: p.panel, border: `1px solid ${p.line}`, boxShadow: `inset 4px 0 0 ${p.you}`, borderRadius: r * 0.6 } : { background: p.you, borderRadius: r * 0.6 }}>
              <span className="block h-3 w-3" style={{ background: layout.signs === 'card' ? p.you : p.ink, borderRadius: 2 }} />
              <span className="mt-1.5 block h-1.5 w-full rounded-full" style={{ background: p.ink }} />
            </span>
          </span>
        </span>
        <span className="flex flex-col gap-1 px-3 pt-3">
          {/* the name and "in use" wrap as wholes, never inside themselves; where it comes from on a line of its own */}
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <b className="min-w-0 text-[15px] leading-snug text-ink" style={{ fontFamily: t.fonts?.display ?? t.fonts?.sans }}>{t.name}</b>
            {chosen && (
              <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-sm bg-accent px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-on-accent">
                <Check size={11} aria-hidden="true" /> in use
              </span>
            )}
          </span>
          <span className={cn('truncate text-[11px] text-ink-faint', !entry.builtIn && 'mono')}>{entry.builtIn ? 'built in' : `${entry.id}.json`}</span>
          {t.description && <span className="text-xs text-ink-faint">{t.description}</span>}
          <span className="flex flex-wrap gap-1 pt-1" aria-label="Layout">
            {layoutWords(layout).map((w) => (
              <span key={w} className="rounded-sm px-1.5 py-0.5 text-[11px] font-semibold text-ink-soft ring-1 ring-inset ring-line">
                {w}
              </span>
            ))}
          </span>
        </span>
      </button>
      {/* a built-in theme is copied; a theme of your own opens in your editor, the rest it can have done in its "⋯" */}
      <div className="mt-auto flex flex-wrap items-center gap-2 px-3 pb-3 pt-2.5">
        {entry.builtIn ? (
          <Button size="sm" variant="ghost" onClick={onCopy} title="Writes this theme as a new file in the themes folder, to edit by hand">
            <Copy size={13} /> Make a copy
          </Button>
        ) : (
          <>
            <OpenInEditor theme={entry.id} editors={editors} onError={onError} />
            <Menu
              align="left"
              trigger={({ open, toggle }) => (
                <Button size="sm" variant="ghost" onClick={toggle} aria-expanded={open} aria-label={`More for ${t.name}`} title="Rename, make a copy, export or delete">
                  <MoreHorizontal size={14} />
                </Button>
              )}
            >
              {(close) => (
                <>
                  {[
                    { label: 'Rename…', icon: <Pencil size={13} />, run: mine.rename },
                    { label: 'Make a copy', icon: <Copy size={13} />, run: onCopy },
                    { label: 'Export the file', icon: <Download size={13} />, run: mine.exportFile },
                    { label: 'Delete…', icon: <Trash2 size={13} />, run: mine.remove, danger: true },
                  ].map((it) => (
                    <MenuItem
                      key={it.label}
                      icon={it.icon}
                      danger={it.danger}
                      onClick={() => {
                        close();
                        it.run();
                      }}
                    >
                      {it.label}
                    </MenuItem>
                  ))}
                </>
              )}
            </Menu>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Opens a theme of the person's own as its file in an editor found on this computer: one button where there is one
 * editor, a choice where there are several, nothing where there is none (its path can be copied instead).
 */
function OpenInEditor({ theme, editors, onError }: { theme: string; editors: OpenTarget[]; onError: (e: string | null) => void }) {
  const open = (t: OpenTarget) => {
    onError(null);
    api.openThemes(t.id, theme).catch((e) => onError((e as Error).message));
  };
  if (!editors.length) return null;
  if (editors.length === 1)
    return (
      <Button size="sm" onClick={() => open(editors[0]!)} title="Opens the theme's file; save it there and this page shows the change">
        <FilePenLine size={13} /> Open in {editors[0]!.label}
      </Button>
    );
  return (
    <Menu
      align="left"
      trigger={({ open: shown, toggle }) => (
        <Button size="sm" onClick={toggle} aria-expanded={shown}>
          <FilePenLine size={13} /> Open in an editor <ChevronDown size={12} />
        </Button>
      )}
    >
      {(close) =>
        editors.map((t) => (
          <MenuItem
            key={t.id}
            onClick={() => {
              close();
              open(t);
            }}
          >
            {t.label}
          </MenuItem>
        ))
      }
    </Menu>
  );
}

/** opens the themes folder in an editor or file manager found on this computer (Foundry makes the folder first) */
function OpenFolder({ onError }: { onError: (e: string | null) => void }) {
  const [targets, setTargets] = useState<OpenTarget[] | null>(null);
  return (
    <Menu
      align="left"
      trigger={({ open, toggle }) => (
        <Button
          size="sm"
          onClick={() => {
            if (!targets) void api.openTargets().then(setTargets).catch(() => setTargets([]));
            toggle();
          }}
          aria-expanded={open}
        >
          <FolderOpen size={13} /> Open the folder <ChevronDown size={12} />
        </Button>
      )}
    >
      {(close) =>
        !targets ? (
          <div className="px-2 py-1.5 text-ink-faint">Looking…</div>
        ) : targets.filter((t) => t.available).length === 0 ? (
          <div className="px-2 py-1.5 text-ink-faint">No editor or file manager found on this computer: copy the folder's path instead.</div>
        ) : (
          targets
            .filter((t) => t.available)
            .map((t) => (
              <MenuItem
                key={t.id}
                onClick={() => {
                  close();
                  onError(null);
                  api.openThemes(t.id).catch((e) => onError((e as Error).message));
                }}
              >
                {t.label}
              </MenuItem>
            ))
        )
      }
    </Menu>
  );
}
