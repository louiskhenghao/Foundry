import type { TemplateEntry, TemplateLang, TemplateProblem } from '@foundry/core/browser';
import { ChevronDown, Copy, Download, FilePenLine, FolderOpen, LayoutTemplate, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2, Upload, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type OpenTarget } from '../api.ts';
import { NATURE_ICON, TemplateLangSwitch } from '../components/Templates.tsx';
import { Button, ConfirmDialog, CopyButton, Card, Input, Menu, MenuItem, PageHeader, buttonClass, cn } from '../ui.tsx';
import { HelpLink } from './HelpPage.tsx';
import { NATURE_WORD, byNature, loadTemplateLang, saveTemplateLang, shownVersion } from './new-goal-template.ts';

/**
 * The Templates page (ADR-0079): the templates Foundry ships and the person's own, each to use on a new goal, copy,
 * edit, rename, export or delete; a template file from elsewhere comes in; the folder opens in an editor; a file with a
 * mistake is listed with what to fix.
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

/** the page's content for a given set of templates (the server's, or a test's) */
export function Templates({ templates, problems, dir, editors, lang, onLang, error, onError, onChanged }: { templates: TemplateEntry[]; problems: TemplateProblem[]; dir: string | null; editors: OpenTarget[]; lang: TemplateLang; onLang: (l: TemplateLang) => void; error: string | null; onError: (e: string | null) => void; onChanged: () => void | Promise<void> }) {
  const [renaming, setRenaming] = useState<{ entry: TemplateEntry; name: string } | null>(null);
  const [deleting, setDeleting] = useState<TemplateEntry | null>(null);
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
    }
  };
  const copy = (t: TemplateEntry) =>
    act(async () => {
      const made = await api.copyTemplate(t.id);
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
  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 pt-6 md:pt-9 pb-24 space-y-4">
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
            <TemplateLangSwitch value={lang} onChange={onLang} />
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

      {note && <div className="rounded-md border border-line bg-sunken px-3 py-2.5 text-xs text-ink-soft">{note}</div>}
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-line bg-sunken px-3 py-2 text-xs text-bad-ink">
          <XCircle size={13} className="mt-px shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      )}

      <Card
        id="own-templates"
        title={
          <span className="inline-flex items-center gap-2">
            Yours <span className="font-normal text-ink-faint">({own.length})</span>
          </span>
        }
      >
        {own.length === 0 ? (
          <p className="text-xs text-ink-faint">
            None yet. Make a copy of one of Foundry's below, press <b className="text-ink">New template</b>, or save a goal you liked as one (its page's ⋯ menu → <b className="text-ink">Save as template…</b>).
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line" aria-label="Your templates">
            {own.map((t) => (
              <TemplateRow key={t.id} entry={t} lang={lang} editors={editors} onError={onError} onCopy={() => void copy(t)} onRename={() => setRenaming({ entry: t, name: shownVersion(t, lang).name })} onExport={(l) => exportFile(t, l)} onDelete={() => setDeleting(t)} />
            ))}
          </ul>
        )}
      </Card>

      <Card
        id="shipped-templates"
        title={
          <span className="inline-flex items-center gap-2">
            Foundry's <span className="font-normal text-ink-faint">({shipped.length})</span>
          </span>
        }
      >
        <div className="space-y-4">
          {byNature(shipped).map((g) => {
            const { Icon, ink } = NATURE_ICON[g.nature];
            return (
              <div key={g.nature}>
                <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-faint">
                  <Icon size={13} strokeWidth={2.25} className={ink} aria-hidden="true" /> {NATURE_WORD[g.nature]}
                </div>
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {g.templates.map((t) => (
                    <TemplateRow key={t.id} entry={t} lang={lang} editors={[]} onError={onError} onCopy={() => void copy(t)} onExport={(l) => exportFile(t, l)} />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </Card>

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

/** one template in the lists: its kind, name, summary and languages; what can be done with it */
function TemplateRow({ entry, lang, editors, onError, onCopy, onRename, onExport, onDelete }: { entry: TemplateEntry; lang: TemplateLang; editors: OpenTarget[]; onError: (e: string | null) => void; onCopy: () => void; onRename?: () => void; onExport: (l: TemplateLang) => void; onDelete?: () => void }) {
  const v = shownVersion(entry, lang);
  const { Icon, ink } = NATURE_ICON[entry.nature];
  const langs = (['en', 'zh'] as TemplateLang[]).filter((l) => entry[l]);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
      <Icon size={14} strokeWidth={2.25} className={cn('shrink-0', ink)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-semibold text-ink">{v.name}</span>
          <span className="mono text-[11px] text-ink-faint">{entry.id}</span>
          {langs.length === 2 && <span className="text-[11px] text-ink-faint">EN · 中文</span>}
        </div>
        {v.summary && <div className="text-xs text-ink-faint">{v.summary}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Link to={`/goals/new?template=${encodeURIComponent(entry.id)}`} className={buttonClass('default', 'sm')} title="A new goal from this template">
          Use
        </Link>
        {entry.builtIn ? (
          <>
            <Link to={`/templates/${encodeURIComponent(entry.id)}`} className={buttonClass('ghost', 'sm')} title="Read it: its inputs, its settings and its words">
              View
            </Link>
            <Button size="sm" variant="ghost" onClick={onCopy} title="Writes a copy in your templates folder, to edit">
              <Copy size={13} /> Make a copy
            </Button>
          </>
        ) : (
          <>
            <Link to={`/templates/${encodeURIComponent(entry.id)}`} className={buttonClass('ghost', 'sm')}>
              <Pencil size={13} /> Edit
            </Link>
            <OpenInEditor template={entry.id} lang={v.lang} editors={editors} onError={onError} />
          </>
        )}
        <Menu
          align="right"
          trigger={({ open, toggle }) => (
            <Button size="sm" variant="ghost" onClick={toggle} aria-expanded={open} aria-label={`More for ${v.name}`}>
              <MoreHorizontal size={14} />
            </Button>
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
                  Make a copy
                </MenuItem>
              )}
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
    </li>
  );
}

/** opens a template of the person's own as its file in an editor found on this computer */
function OpenInEditor({ template, lang, editors, onError }: { template: string; lang: TemplateLang; editors: OpenTarget[]; onError: (e: string | null) => void }) {
  const open = (t: OpenTarget) => {
    onError(null);
    api.openTemplates(t.id, template, lang).catch((e) => onError((e as Error).message));
  };
  if (!editors.length) return null;
  if (editors.length === 1)
    return (
      <Button size="sm" variant="ghost" onClick={() => open(editors[0]!)} title="Opens the template's file; save it there and this page shows the change">
        <FilePenLine size={13} /> Open in {editors[0]!.label}
      </Button>
    );
  return (
    <Menu
      align="right"
      trigger={({ open: shown, toggle }) => (
        <Button size="sm" variant="ghost" onClick={toggle} aria-expanded={shown}>
          <FilePenLine size={13} /> Open in an editor <ChevronDown size={12} />
        </Button>
      )}
    >
      {(close) =>
        editors.map((t) => (
          <MenuItem key={t.id} onClick={() => (close(), open(t))}>
            {t.label}
          </MenuItem>
        ))
      }
    </Menu>
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
