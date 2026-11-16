import type { TemplateEntry, TemplateLang, TemplateNature, TemplateProblem } from '@foundry/core/browser';
import { inputRequired } from '@foundry/core/browser';
import { ChevronDown, ChevronLeft, ChevronRight, Copy, Download, FilePenLine, FolderOpen, LayoutTemplate, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2, Upload, XCircle } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type OpenTarget } from '../api.ts';
import { NATURE_ICON, TemplateLangSwitch, TemplatePreview, templateBrings } from '../components/Templates.tsx';
import { Button, ConfirmDialog, CopyButton, Card, Input, Menu, MenuItem, PageHeader, buttonClass, cn } from '../ui.tsx';
import { HelpLink } from './HelpPage.tsx';
import { NATURE_WORD, TEMPLATE_NATURES, byNature, loadTemplateLang, saveTemplateLang, shownVersion } from './new-goal-template.ts';

/**
 * The Templates page (ADR-0079): the templates Foundry ships and the person's own, each to use on a new goal, copy,
 * edit, rename, export or delete; a template file from elsewhere comes in; the folder opens in an editor; a file with a
 * mistake is listed with what to fix. A gallery: a row of kinds at the top, then a shelf of cards per kind.
 */
export function TemplatesPage() {
  const [templates, setTemplates] = useState<TemplateEntry[] | null>(null);
  const [problems, setProblems] = useState<TemplateProblem[]>([]);
  const [dir, setDir] = useState<string | null>(null);
  const [editors, setEditors] = useState<OpenTarget[]>([]);
  const [lang, setLangState] = useState<TemplateLang>(() => loadTemplateLang());
  const [err, setErr] = useState<string | null>(null);
  const load = () =>
    api
      .templates()
      .then((v) => {
        setTemplates(v.templates);
        setProblems(v.problems);
        setDir(v.dir);
      })
      .catch((e) => setErr((e as Error).message));
  useEffect(() => {
    void load();
    api
      .openTargets()
      .then((all) => setEditors(all.filter((t) => t.kind === 'editor' && t.available)))
      .catch(() => {});
    // the files may have been edited by hand meanwhile: read them again when the window comes back to the front
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
  const setLang = (l: TemplateLang) => {
    saveTemplateLang(l);
    setLangState(l);
  };
  return <Templates templates={templates ?? []} problems={problems} dir={dir} editors={editors} lang={lang} onLang={setLang} error={err} onError={setErr} onChanged={load} />;
}

/** one line on what each kind of goal makes, under its shelf's title */
const NATURE_LINE: Record<TemplateNature, string> = {
  code: 'Features, fixes, sites and apps, in a repository.',
  docs: 'Documents written for people: a README, an RFC, a report.',
  research: 'A question answered from sources, with the evidence kept.',
  image: 'Pictures made by an image skill.',
  video: 'Films cut and rendered from code.',
  figure: 'Interactive isometric figures of objects and machines.',
  diagram: 'Editorial diagrams: architecture, flows, timelines.',
  deck: 'Slide decks as editable PPTX files.',
  cad: 'Parts and assemblies as CAD models.',
};
/** how many cards a shelf shows at a time: two rows of four on a wide screen */
const SHELF_PAGE = 8;

/** the page's content for a given set of templates (the server's, or a test's) */
export function Templates({ templates, problems, dir, editors, lang, onLang, error, onError, onChanged }: { templates: TemplateEntry[]; problems: TemplateProblem[]; dir: string | null; editors: OpenTarget[]; lang: TemplateLang; onLang: (l: TemplateLang) => void; error: string | null; onError: (e: string | null) => void; onChanged: () => void | Promise<void> }) {
  const navigate = useNavigate();
  /** the kind the row of tabs narrows the page to; all = every kind */
  const [kind, setKind] = useState<TemplateNature | 'all'>('all');
  const [renaming, setRenaming] = useState<{ entry: TemplateEntry; name: string } | null>(null);
  const [deleting, setDeleting] = useState<TemplateEntry | null>(null);
  /** the template Use asks about before the New goal form opens */
  const [using, setUsing] = useState<TemplateEntry | null>(null);
  /** the template Make a copy asks about before the copy is written */
  const [copying, setCopying] = useState<TemplateEntry | null>(null);
  /** the template read in the dialog (View) */
  const [viewing, setViewing] = useState<TemplateEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const act = async (run: () => Promise<void>) => {
    setBusy(true);
    onError(null);
    try {
      await run();
      await onChanged();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
      setRenaming(null);
      setDeleting(null);
      setCopying(null);
    }
  };
  const copy = (t: TemplateEntry) =>
    act(async () => {
      const made = await api.copyTemplate(t.id);
      setViewing(null);
      setNote(`“${shownVersion(made, lang).name}” is yours now: edit it here, or open its file in an editor.`);
    });
  const exportFile = (t: TemplateEntry, l: TemplateLang) => {
    const a = document.createElement('a');
    a.href = api.templateFileUrl(t.id, l);
    a.download = `${t.id}${l === 'zh' ? '.zh' : ''}.md`;
    a.click();
  };
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    await act(async () => {
      const made = await api.importTemplate(file.name, await file.text());
      setNote(`“${shownVersion(made, lang).name}” is imported${made.zh && made.en ? ' in both languages' : ''}.`);
    });
    if (picker.current) picker.current.value = '';
  };
  const own = templates.filter((t) => !t.builtIn);
  const shipped = templates.filter((t) => t.builtIn);
  // the tabs: every kind a template exists for, in the kinds' order
  const kinds = TEMPLATE_NATURES.filter((n) => templates.some((t) => t.nature === n));
  const inKind = (ts: TemplateEntry[]) => (kind === 'all' ? ts : ts.filter((t) => t.nature === kind));
  const shelves = byNature(inKind(shipped));
  const tile = (t: TemplateEntry) => <TemplateTile key={t.id} entry={t} lang={lang} editors={t.builtIn ? [] : editors} onError={onError} onUse={() => setUsing(t)} onView={() => setViewing(t)} onCopy={() => setCopying(t)} onRename={t.builtIn ? undefined : () => setRenaming({ entry: t, name: shownVersion(t, lang).name })} onExport={(l) => exportFile(t, l)} onDelete={t.builtIn ? undefined : () => setDeleting(t)} />;
  const usingName = using ? shownVersion(using, lang) : null;
  const copyingName = copying ? shownVersion(copying, lang).name : '';
  return (
    // wider than the other pages: four cards across, each with room for its row of buttons
    <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 pt-6 md:pt-9 pb-24 space-y-6">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <LayoutTemplate size={24} className="text-ink-faint" aria-hidden="true" /> Templates
            <HelpLink to="templates" className="ml-1" />
          </span>
        }
        summary="A template is a pattern the New goal form starts from: a description with blanks to fill and the settings that suit it. Foundry's own come in English and 中文 and update with Foundry; yours are files in the templates folder."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/templates/new" className={buttonClass('primary', 'md')}>
              <Plus size={14} /> New template
            </Link>
            <Button onClick={() => picker.current?.click()} title="Brings in a template file from elsewhere (one exported from another Foundry, or written by hand): Foundry checks it first">
              <Upload size={14} /> Import a file
            </Button>
            <input ref={picker} type="file" accept=".md,text/markdown" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void importFile(e.target.files?.[0])} />
          </div>
        }
      />

      {/* the kinds as a row of tabs (scrolling sideways on a phone), the language of the templates at its right */}
      <div className="flex items-center gap-3">
        <div role="tablist" aria-label="Kind of goal" className="-mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto whitespace-nowrap px-1 py-1">
          {(['all', ...kinds] as (TemplateNature | 'all')[]).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={cn('shrink-0 rounded-md px-2.5 py-1.5 text-sm font-semibold transition-colors', kind === k ? 'bg-panel text-ink shadow-[0_0_0_1px_var(--color-line)]' : 'text-ink-soft hover:text-ink')}>
              {k === 'all' ? 'All' : NATURE_WORD[k]}
            </button>
          ))}
        </div>
        <TemplateLangSwitch value={lang} onChange={onLang} />
      </div>

      {note && <div className="rounded-md border border-line bg-sunken px-3 py-2.5 text-xs text-ink-soft">{note}</div>}
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-line bg-sunken px-3 py-2 text-xs text-bad-ink">
          <XCircle size={13} className="mt-px shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      )}

      <Shelf id="own-templates" title="Yours" subtitle="Templates you made, copied or saved from a goal: files in your templates folder, to edit as you like." items={inKind(own).map(tile)} empty={
        <>
          None yet{kind === 'all' ? '' : ` for ${NATURE_WORD[kind]}`}. Make a copy of one of Foundry's below, press <b className="text-ink">New template</b>, or save a goal you liked as one (its page's ⋯ menu → <b className="text-ink">Save as template…</b>).
        </>
      } />

      {shelves.map((g) => {
        const { Icon, ink } = NATURE_ICON[g.nature];
        return <Shelf key={g.nature} id={`shipped-${g.nature}`} title={<span className="inline-flex items-center gap-2"><Icon size={18} strokeWidth={2.25} className={ink} aria-hidden="true" />{NATURE_WORD[g.nature]}</span>} subtitle={`Foundry's — ${NATURE_LINE[g.nature]}`} items={g.templates.map(tile)} />;
      })}

      <Card id="templates-folder" title="The templates folder">
        <div className="space-y-3">
          <p className="text-xs text-ink-soft">Every template of yours is a Markdown file there: a frontmatter (name, nature, settings, what the inputs say) over the description with its {'{{placeholders}}'}. Edit a file in any editor and this page shows the change when it comes back to the front; a file with a mistake is listed below with what to fix.</p>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-ink-faint">Templates folder</span>
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
            <OpenFolder onError={onError} />
            <Button size="sm" variant="ghost" onClick={() => void onChanged()} title="Reads the template files again (Foundry also does whenever this window comes back to the front)">
              <RefreshCw size={13} /> Read the files again
            </Button>
          </div>
          {problems.length > 0 && (
            <ul className="rounded-md border border-line bg-sunken px-3 py-2 text-xs space-y-1" aria-label="Template files that cannot be used">
              {problems.map((p) => (
                <li key={p.file}>
                  <span className="mono font-semibold text-bad-ink">{p.file}</span> <span className="text-ink-soft">— {p.error}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-ink-faint">
            The file, line by line, with an example:{' '}
            <a href="/help/templates" target="_blank" rel="noreferrer" className="underline hover:text-ink">
              Templates in the guide
            </a>
            .
          </p>
        </div>
      </Card>

      <TemplatePreview entry={viewing} lang={lang} onLang={onLang} onClose={() => setViewing(null)} onUse={(t) => setUsing(t)} onCopy={(t) => setCopying(t)} copying={busy} />
      <UseTemplateDialog entry={using} lang={lang} onClose={() => setUsing(null)} onConfirm={() => using && navigate(`/goals/new?template=${encodeURIComponent(using.id)}`)} />
      <ConfirmDialog open={!!copying} title={`Make a copy of “${copyingName}”?`} confirmLabel="Make a copy" busy={busy} onConfirm={() => copying && void copy(copying)} onClose={() => setCopying(null)}>
        <p>
          A copy goes into your templates folder{copying?.en && copying.zh ? ', in both its languages,' : ''} under a name of its own; {copying?.builtIn ? "Foundry's" : 'the original'} stays as it is. The copy is yours to edit here or in an editor.
        </p>
      </ConfirmDialog>
      <ConfirmDialog open={!!renaming} title="Rename the template" confirmLabel="Rename" busy={busy} confirmDisabled={!renaming?.name.trim()} onConfirm={() => renaming && void act(async () => void (await api.renameTemplate(renaming.entry.id, renaming.name)))} onClose={() => setRenaming(null)}>
        <p>Its files take the new name too, in every language it has.</p>
        <Input autoFocus aria-label="New name" maxLength={80} value={renaming?.name ?? ''} onChange={(e) => setRenaming((r) => (r ? { ...r, name: e.target.value } : r))} onKeyDown={(e) => e.key === 'Enter' && renaming?.name.trim() && void act(async () => void (await api.renameTemplate(renaming.entry.id, renaming.name)))} />
      </ConfirmDialog>
      <ConfirmDialog open={!!deleting} title={`Delete “${deleting ? shownVersion(deleting, lang).name : ''}”?`} confirmLabel="Delete" danger busy={busy} onConfirm={() => deleting && void act(async () => void (await api.deleteTemplate(deleting.id)))} onClose={() => setDeleting(null)}>
        <p>
          Its file{deleting?.en && deleting.zh ? 's are' : ' is'} removed from the templates folder: export first to keep a copy. Goals made from it keep its name.
        </p>
      </ConfirmDialog>
    </div>
  );
}

/**
 * Use asks before the New goal form opens: which template, what it asks for and what it brings, so a card's button
 * pressed by mistake costs nothing. Nothing is made until the form itself is submitted.
 */
export function UseTemplateDialog({ entry, lang, onClose, onConfirm }: { entry: TemplateEntry | null; lang: TemplateLang; onClose: () => void; onConfirm: () => void }) {
  if (!entry) return null;
  const v = shownVersion(entry, lang);
  const required = v.inputs.filter(inputRequired).length;
  const brings = templateBrings(entry);
  return (
    <ConfirmDialog open title={`Use “${v.name}” for a new goal?`} confirmLabel="Use" onConfirm={onConfirm} onClose={onClose}>
      <div className="space-y-2">
        {v.summary && <p className="text-ink-soft">{v.summary}</p>}
        <p>
          The New goal form opens with it: {v.inputs.length === 0 ? 'no blanks to fill' : `${v.inputs.length} blank${v.inputs.length === 1 ? '' : 's'} to fill${required ? ` (${required} required)` : ''}`}
          {brings.length > 0 && <>, and it brings {brings.join(', ')}</>}. Nothing starts until you submit the form.
        </p>
      </div>
    </ConfirmDialog>
  );
}

/**
 * A shelf of cards under a title: at most SHELF_PAGE at a time, two rows of four on a wide screen, with arrows and dots
 * for the pages when there are more — as a gallery lays its collections out.
 */
function Shelf({ id, title, subtitle, items, empty }: { id: string; title: ReactNode; subtitle: ReactNode; items: ReactNode[]; /** shown in place of the cards when there are none */ empty?: ReactNode }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / SHELF_PAGE));
  // fewer items than before (a tab narrowed them): stay on a page that exists
  const at = Math.min(page, pages - 1);
  return (
    <section id={id} aria-labelledby={`${id}-title`}>
      <div className="mb-3 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-lg font-bold leading-tight text-ink">
            {title}
          </h2>
          <p className="mt-0.5 text-xs text-ink-faint">{subtitle}</p>
        </div>
        {pages > 1 && (
          <div className="flex shrink-0 items-center gap-3">
            <span className="flex items-center gap-1" aria-hidden="true">
              {Array.from({ length: pages }, (_, i) => (
                <span key={i} className={cn('h-1.5 rounded-full transition-all', i === at ? 'w-4 bg-accent' : 'w-1.5 bg-line-strong')} />
              ))}
            </span>
            <span className="sr-only" aria-live="polite">
              page {at + 1} of {pages}
            </span>
            <button type="button" aria-label="Previous page" disabled={at === 0} onClick={() => setPage(at - 1)} className="grid size-8 place-items-center rounded-full border border-line-strong text-ink-soft transition-colors hover:text-ink disabled:opacity-40">
              <ChevronLeft size={14} />
            </button>
            <button type="button" aria-label="Next page" disabled={at >= pages - 1} onClick={() => setPage(at + 1)} className="grid size-8 place-items-center rounded-full border border-line-strong text-ink-soft transition-colors hover:text-ink disabled:opacity-40">
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>
      {items.length === 0 ? <p className="text-xs text-ink-faint">{empty}</p> : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{items.slice(at * SHELF_PAGE, at * SHELF_PAGE + SHELF_PAGE)}</div>}
    </section>
  );
}

/** one template as a card on a shelf: its kind's mark on a tile, its name, whose it is, its summary, what it asks, and what can be done with it */
function TemplateTile({ entry, lang, editors, onError, onUse, onView, onCopy, onRename, onExport, onDelete }: { entry: TemplateEntry; lang: TemplateLang; editors: OpenTarget[]; onError: (e: string | null) => void; onUse: () => void; onView: () => void; onCopy: () => void; onRename?: () => void; onExport: (l: TemplateLang) => void; onDelete?: () => void }) {
  const v = shownVersion(entry, lang);
  const { Icon, ink } = NATURE_ICON[entry.nature];
  const langs = (['en', 'zh'] as TemplateLang[]).filter((l) => entry[l]);
  const required = v.inputs.filter(inputRequired).length;
  const openIn = (t: OpenTarget) => {
    onError(null);
    api.openTemplates(t.id, entry.id, v.lang).catch((e) => onError((e as Error).message));
  };
  return (
    <article className="flex flex-col rounded-xl border border-line bg-panel p-4 shadow-[var(--surface-shadow)]" aria-label={v.name}>
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-sunken ring-1 ring-inset ring-line" aria-hidden="true">
          <Icon size={18} strokeWidth={2} className={ink} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-bold leading-tight text-ink" title={v.name}>
            {v.name}
          </h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-faint">
            <span className={cn(!entry.builtIn && 'font-semibold text-ink-soft')}>{entry.builtIn ? 'Foundry' : 'yours'}</span>
            <span aria-hidden="true">·</span>
            <span>{NATURE_WORD[entry.nature]}</span>
            {langs.length === 2 && (
              <>
                <span aria-hidden="true">·</span>
                <span title="In English and 中文">EN · 中文</span>
              </>
            )}
          </p>
        </div>
      </div>
      <p className="mt-3 line-clamp-2 text-[13px] leading-snug text-ink-soft" title={v.summary}>
        {v.summary || v.body.split('\n')[0]}
      </p>
      {/* what it asks on a line of its own, then the buttons on one row: four of them fit a card of a four-column shelf */}
      <p className="mt-3 text-[11px] text-ink-faint">
        {v.inputs.length} input{v.inputs.length === 1 ? '' : 's'}
        {required ? ` · ${required} required` : ''}
      </p>
      <div className="mt-auto flex flex-wrap items-center gap-1 pt-2">
        <Button size="sm" onClick={onUse} title="A new goal from this template (asks first)">
          Use
        </Button>
        <Button size="sm" variant="ghost" onClick={onView} title="Read it: its words with the blanks named, or filled in with examples">
          View
        </Button>
        {entry.builtIn ? (
          <Button size="sm" variant="ghost" onClick={onCopy} title="Writes a copy in your templates folder, to edit (asks first)">
            <Copy size={13} /> Make a copy
          </Button>
        ) : (
          <Link to={`/templates/${encodeURIComponent(entry.id)}`} className={buttonClass('ghost', 'sm')}>
            <Pencil size={13} /> Edit
          </Link>
        )}
        <Menu
          align="right"
          trigger={({ open, toggle }) => (
            // a square the height of the buttons beside it: narrower than a padded button, so the row stays one row
            <button type="button" onClick={toggle} aria-expanded={open} aria-label={`More for ${v.name}`} className="grid size-7 shrink-0 place-items-center rounded-md text-ink-soft transition hover:bg-line hover:text-ink">
              <MoreHorizontal size={14} />
            </button>
          )}
        >
          {(close) => (
            <>
              {onRename && (
                <MenuItem icon={<Pencil size={13} />} onClick={() => (close(), onRename())}>
                  Rename…
                </MenuItem>
              )}
              {!entry.builtIn && (
                <MenuItem icon={<Copy size={13} />} onClick={() => (close(), onCopy())}>
                  Make a copy…
                </MenuItem>
              )}
              {editors.map((t) => (
                <MenuItem key={t.id} icon={<FilePenLine size={13} />} onClick={() => (close(), openIn(t))}>
                  Open in {t.label}
                </MenuItem>
              ))}
              {langs.map((l) => (
                <MenuItem key={l} icon={<Download size={13} />} onClick={() => (close(), onExport(l))}>
                  Export {l === 'zh' ? 'the 中文 file' : 'the English file'}
                </MenuItem>
              ))}
              {onDelete && (
                <MenuItem icon={<Trash2 size={13} />} danger onClick={() => (close(), onDelete())}>
                  Delete…
                </MenuItem>
              )}
            </>
          )}
        </Menu>
      </div>
    </article>
  );
}

/** opens the templates folder in an editor or file manager found on this computer (Foundry makes the folder first) */
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
                  api.openTemplates(t.id).catch((e) => onError((e as Error).message));
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
