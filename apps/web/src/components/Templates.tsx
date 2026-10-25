import type { TemplateEntry, TemplateInput, TemplateLang, TemplateNature, TemplateVersionView } from '@foundry/core/browser';
import { bodyWithBlanks, inputRequired, labelOf, renderTemplate, sampleValues } from '@foundry/core/browser';
import { Box, Clapperboard, CodeXml, Copy, FileText, Image as ImageIcon, Lamp, LayoutTemplate, Pencil, Search, Sparkles, Telescope, X, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, type DraftAsk, type DraftView } from '../api.ts';
import { Markdown } from './Markdown.tsx';
import { Button, ButtonGroup, Input, Modal, Select, Textarea, buttonClass, choiceClass, cn, code } from '../ui.tsx';
import { NATURE_WORD, byNature, matchesSearch, shownVersion } from '../pages/new-goal-template.ts';

/** each kind's icon and category colour, as the New goal form's Kind of goal card draws them (ADR-0067) */
export const NATURE_ICON: Record<TemplateNature, { Icon: LucideIcon; ink: string }> = {
  code: { Icon: CodeXml, ink: code(0).ink },
  docs: { Icon: FileText, ink: code(1).ink },
  research: { Icon: Telescope, ink: code(2).ink },
  image: { Icon: ImageIcon, ink: code(6).ink },
  video: { Icon: Clapperboard, ink: code(4).ink },
  figure: { Icon: Lamp, ink: code(3).ink },
  cad: { Icon: Box, ink: code(5).ink },
};

/** English or 中文, for this browser: the templates' names, inputs and words follow */
export function TemplateLangSwitch({ value, onChange, size = 'md' }: { value: TemplateLang; onChange: (l: TemplateLang) => void; size?: 'md' | 'lg' }) {
  return <ButtonGroup<TemplateLang> size={size} label="Template language" value={value} onChange={onChange} options={[{ id: 'en', label: 'EN', title: 'Templates in English' }, { id: 'zh', label: '中文', title: '中文模版' }]} />;
}

/** one template as a card: its kind's icon, its name, its summary, how many inputs it asks for */
export function TemplateCard({ entry, lang, chosen, onChoose, compact, aside }: { entry: TemplateEntry; lang: TemplateLang; chosen?: boolean; onChoose: () => void; compact?: boolean; aside?: ReactNode }) {
  const v = shownVersion(entry, lang);
  const { Icon, ink } = NATURE_ICON[entry.nature];
  const required = v.inputs.filter(inputRequired).length;
  return (
    <div className={cn('flex flex-col rounded-lg border bg-panel text-left', choiceClass(!!chosen), compact ? 'w-56 shrink-0 p-2.5' : 'p-3')}>
      <button type="button" onClick={onChoose} className="flex min-w-0 flex-1 flex-col text-left" aria-pressed={chosen} aria-label={`${v.name}${chosen ? ', chosen' : ''}`}>
        <span className="flex items-center gap-1.5 text-sm font-bold text-ink">
          <Icon size={14} strokeWidth={2.25} className={cn('shrink-0', ink)} aria-hidden="true" />
          <span className="truncate">{v.name}</span>
        </span>
        <span className={cn('mt-1 text-xs leading-snug text-ink-faint', compact ? 'line-clamp-2' : 'line-clamp-3')}>{v.summary || v.body.split('\n')[0]}</span>
        <span className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-0.5 pt-2 text-[11px] text-ink-faint">
          <span>{NATURE_WORD[entry.nature]}</span>
          <span aria-hidden="true">·</span>
          <span>
            {v.inputs.length} input{v.inputs.length === 1 ? '' : 's'}
            {required ? ` (${required} required)` : ''}
          </span>
          {!entry.builtIn && <span className="rounded-sm px-1 py-px font-semibold ring-1 ring-inset ring-line-strong">yours</span>}
          {entry.en && entry.zh && <span title="In English and 中文">EN · 中文</span>}
        </span>
      </button>
      {aside && <div className="mt-2 flex flex-wrap items-center gap-1.5">{aside}</div>}
    </div>
  );
}

/**
 * Every template, by kind, with a search: the dialog the Kind of goal card opens (ADR-0079). It opens on the kind the
 * form has (every kind while the form says Auto); the language switch is this browser's.
 */
export function TemplateGallery({ open, templates, lang, onLang, onClose, onChoose, chosen, initialKind }: { open: boolean; templates: TemplateEntry[]; lang: TemplateLang; onLang: (l: TemplateLang) => void; onClose: () => void; onChoose: (t: TemplateEntry) => void; chosen: TemplateEntry | null; /** the form's kind of goal; auto = every kind */ initialKind: string }) {
  const [q, setQ] = useState('');
  const startKind = (): TemplateNature | 'all' => (initialKind !== 'auto' && templates.some((t) => t.nature === initialKind) ? (initialKind as TemplateNature) : 'all');
  const [kind, setKind] = useState<TemplateNature | 'all'>(startKind);
  // each opening starts on the form's kind again, with the search cleared
  useEffect(() => {
    if (open) {
      setKind(startKind());
      setQ('');
    }
  }, [open, initialKind]);
  const groups = byNature(templates.filter((t) => (kind === 'all' || t.nature === kind) && matchesSearch(t, lang, q)));
  return (
    <Modal open={open} onClose={onClose} wide title={<span className="inline-flex items-center gap-2"><LayoutTemplate size={15} className="text-ink-faint" aria-hidden="true" /> Templates</span>}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
            <Input autoFocus aria-label="Search templates" className="pl-8" placeholder="Search by name, words or inputs…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <TemplateLangSwitch value={lang} onChange={onLang} />
        </div>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Kind of goal">
          {(['all', ...byNature(templates).map((g) => g.nature)] as (TemplateNature | 'all')[]).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={cn('rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset transition-colors', kind === k ? 'bg-ink text-on-ink ring-ink' : 'bg-panel text-ink-soft ring-line hover:text-ink')}>
              {k === 'all' ? 'All' : NATURE_WORD[k]}
            </button>
          ))}
        </div>
        {groups.length === 0 && <p className="text-sm text-ink-faint">No template matches.</p>}
        {groups.map((g) => {
          const { Icon, ink } = NATURE_ICON[g.nature];
          return (
            <section key={g.nature} aria-labelledby={`tpl-${g.nature}`}>
              <h4 id={`tpl-${g.nature}`} className="mb-2 flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-faint">
                <Icon size={13} strokeWidth={2.25} className={ink} aria-hidden="true" /> {NATURE_WORD[g.nature]}
              </h4>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {g.templates.map((t) => (
                  <TemplateCard key={t.id} entry={t} lang={lang} chosen={chosen?.id === t.id} onChoose={() => onChoose(t)} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </Modal>
  );
}

/**
 * A template read in a dialog (ADR-0079): its words with the blanks named, or filled in with each input's example, and
 * above them what can be done with it — a new goal from it, its editor (one of the person's own), a copy of a built-in one.
 */
export function TemplatePreview({ entry, lang, onLang, onClose, onCopy, copying }: { entry: TemplateEntry | null; lang: TemplateLang; onLang: (l: TemplateLang) => void; onClose: () => void; onCopy: (t: TemplateEntry) => void; copying?: boolean }) {
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    if (entry) setFilled(false);
  }, [entry?.id]);
  if (!entry) return null;
  const v = shownVersion(entry, lang);
  const { Icon, ink } = NATURE_ICON[entry.nature];
  const text = filled ? renderTemplate(v, sampleValues(v)).prompt : bodyWithBlanks(v);
  const s = entry.settings;
  const brings = [
    s.videoPack && `engine ${s.videoPack}`,
    s.figurePack && s.figurePack !== 'none' && `style ${s.figurePack}`,
    s.mode && `${s.mode === 'simple' ? 'Simple' : 'Expert'} view`,
    s.workflow?.pace && `${s.workflow.pace} pace`,
    s.workflow?.tdd && `TDD ${s.workflow.tdd}`,
    s.budgetPreset && `${s.budgetPreset} budget`,
    s.interviewDepth !== undefined && `interview depth ${s.interviewDepth}`,
    s.autoBrief && 'skips Clarify',
  ].filter((x): x is string => !!x);
  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={
        <span className="inline-flex items-center gap-2">
          <Icon size={15} strokeWidth={2.25} className={ink} aria-hidden="true" /> {v.name}
          {!entry.builtIn && <span className="rounded-sm px-1 py-px text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-soft ring-1 ring-inset ring-line-strong">yours</span>}
        </span>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/goals/new?template=${encodeURIComponent(entry.id)}`} className={buttonClass('primary', 'sm')} title="A new goal from this template">
            Use on a new goal
          </Link>
          {!entry.builtIn && (
            <Link to={`/templates/${encodeURIComponent(entry.id)}${v.lang === 'zh' ? '?lang=zh' : ''}`} className={buttonClass('default', 'sm')}>
              <Pencil size={13} /> Edit
            </Link>
          )}
          <Button size="sm" disabled={copying} onClick={() => onCopy(entry)} title={entry.builtIn ? 'Writes a copy in your templates folder, in every language it has, to edit' : 'Another template of yours, starting from this one'}>
            <Copy size={13} /> {copying ? 'Copying…' : 'Make a copy'}
          </Button>
          <span className="ml-auto flex items-center gap-2">
            <ButtonGroup<'blanks' | 'filled'> label="Shown" value={filled ? 'filled' : 'blanks'} onChange={(m) => setFilled(m === 'filled')} options={[{ id: 'blanks', label: 'With blanks', title: 'The words as written, each input as a blank' }, { id: 'filled', label: 'Filled in', title: 'The words with an example in every blank' }]} />
            <TemplateLangSwitch value={lang} onChange={onLang} />
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
          {v.summary && <span className="text-ink-soft">{v.summary}</span>}
          <span>
            {v.inputs.length} input{v.inputs.length === 1 ? '' : 's'}
            {v.inputs.filter(inputRequired).length ? ` (${v.inputs.filter(inputRequired).length} required)` : ''}
          </span>
          {brings.length > 0 && <span>brings: {brings.join(', ')}</span>}
        </div>
        <div className="rounded-lg border border-line bg-sunken p-4 text-sm">
          <Markdown source={text} />
        </div>
      </div>
    </Modal>
  );
}

/** one input of a template as a field: a line, a paragraph, or a choice (with its own words where allowed) */
export function TemplateInputField({ input, value, onChange, missing }: { input: TemplateInput; value: string; onChange: (v: string) => void; missing?: boolean }) {
  const label = input.label ?? labelOf(input.key);
  const id = `tpl-in-${input.key}`;
  const required = inputRequired(input);
  const choice = input.type === 'choice' && input.options?.length;
  const custom = !!choice && !!value && !input.options!.includes(value);
  const [other, setOther] = useState(custom);
  useEffect(() => {
    if (custom) setOther(true);
  }, [custom]);
  return (
    <div>
      <label htmlFor={id} className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs font-semibold text-ink-soft">
        <span>
          {label}
          {required && (
            <span className={cn('ml-1 font-normal', missing ? 'text-you-ink' : 'text-ink-faint')} title="Needed before the goal is made">
              *
            </span>
          )}
        </span>
        {input.help && <span className="font-normal text-ink-faint">{input.help}</span>}
      </label>
      {choice && !other ? (
        <Select id={id} value={value} onChange={(e) => (e.target.value === '\u0000other' ? (setOther(true), onChange('')) : onChange(e.target.value))} className={cn(missing && 'ring-1 ring-you')}>
          {!value && <option value="">— choose —</option>}
          {input.options!.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          {input.other && <option value={'\u0000other'}>Something else…</option>}
        </Select>
      ) : input.type === 'textarea' ? (
        <Textarea id={id} rows={3} value={value} onChange={(e) => onChange(e.target.value)} className={cn(missing && 'ring-1 ring-you')} />
      ) : (
        <div className="flex gap-2">
          <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} className={cn('flex-1', missing && 'ring-1 ring-you')} />
          {choice && other && (
            <Button size="sm" variant="ghost" onClick={() => (setOther(false), onChange(input.default ?? ''))} title="Back to the options">
              Options
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** the AI draft, polled until it settles (ADR-0079) */
export function useDraft() {
  const [job, setJob] = useState<DraftView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopPolling = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stopPolling, []);
  const poll = (id: string) => {
    timer.current = setTimeout(async () => {
      try {
        const next = await api.draft(id);
        setJob(next);
        if (next.status === 'running') poll(id);
      } catch (e) {
        setError((e as Error).message);
        setJob(null);
      }
    }, 1500);
  };
  return {
    job,
    error,
    running: job?.status === 'running',
    async start(ask: DraftAsk) {
      setError(null);
      stopPolling();
      try {
        const started = await api.startDraft(ask);
        setJob({ id: started.id, status: started.status, result: null, error: null, elapsedMs: 0 });
        poll(started.id);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    async stop() {
      if (!job) return;
      stopPolling();
      await api.stopDraft(job.id).catch(() => {});
      setJob((j) => (j ? { ...j, status: 'stopped' } : j));
    },
    clear() {
      stopPolling();
      setJob(null);
      setError(null);
    },
  };
}

/** the words beside the AI buttons: what a draft costs and what it reads */
const DRAFT_WORDS = 'One short call on the housekeeping model, a few cents. With the repository read: a few read-only turns in your checkout on the Explainer\'s model, up to a dollar and a few minutes.';

/**
 * The AI draft's controls: the notes, the Fill in / Write button, the repository switch, the wait, and what came back as
 * a preview to take or leave — never written into the form on its own.
 */
export function DraftBox({ mode, notes, onNotes, repoReady, draft, onAsk, onAccept, label }: { mode: 'fill' | 'write'; notes: string; onNotes: (v: string) => void; /** the form's repository passed its check */ repoReady: boolean; draft: ReturnType<typeof useDraft>; onAsk: (readRepo: boolean) => void; onAccept: (r: NonNullable<DraftView['result']>) => void; label?: string }) {
  const [readRepo, setReadRepo] = useState(false);
  const r = draft.job?.result;
  const settledWith = draft.job && draft.job.status !== 'running' ? draft.job : null;
  return (
    <div className="rounded-lg border border-line bg-sunken p-3 space-y-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1.5 font-semibold text-ink-soft">
          <Sparkles size={13} className="text-ink-faint" aria-hidden="true" /> {label ?? (mode === 'fill' ? 'Fill in with AI' : 'Write it with AI')}
        </span>
        <span className="text-ink-faint">{mode === 'fill' ? 'Write what you have in mind, roughly; the AI fills the inputs above from it and leaves empty what you did not say.' : 'Write what you have in mind, roughly; the AI writes the description the way the templates shape one.'}</span>
      </div>
      {mode === 'fill' && <Textarea rows={3} aria-label="Your notes" placeholder="Your notes, in any words…" value={notes} onChange={(e) => onNotes(e.target.value)} />}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {draft.running ? (
          <>
            <span role="status" className="text-xs font-semibold text-work-ink">
              {readRepo ? 'Reading the repository and drafting…' : 'Drafting…'} {draft.job && draft.job.elapsedMs > 0 ? `${Math.round(draft.job.elapsedMs / 1000)} s` : ''}
            </span>
            <Button size="sm" variant="ghost" onClick={() => void draft.stop()}>
              Stop
            </Button>
          </>
        ) : (
          <Button size="sm" disabled={!notes.trim()} onClick={() => onAsk(readRepo)} title={DRAFT_WORDS}>
            <Sparkles size={13} /> {mode === 'fill' ? 'Fill in with AI' : 'Write it with AI'}
          </Button>
        )}
        <label className={cn('flex items-center gap-1.5 text-xs', repoReady ? 'text-ink-soft' : 'text-ink-faint')} title={repoReady ? 'A few read-only turns in your checkout, so the words name real files and commands (slower, up to a dollar)' : 'Choose the repository below first; once it passes its check the draft can read it'}>
          <input type="checkbox" className="shrink-0" disabled={!repoReady || draft.running} checked={readRepo && repoReady} onChange={(e) => setReadRepo(e.target.checked)} /> Also read the repository
        </label>
      </div>
      {draft.error && <p className="text-xs text-bad-ink">{draft.error}</p>}
      {settledWith?.status === 'failed' && <p className="text-xs text-bad-ink">{settledWith.error ?? 'The draft did not finish.'}</p>}
      {settledWith?.status === 'stopped' && <p className="text-xs text-ink-faint">Stopped.</p>}
      {settledWith?.status === 'done' && r && (
        <div className="rounded-md border border-line bg-panel p-2.5 text-xs space-y-2" role="region" aria-label="The AI's draft">
          {r.values ? (
            <ul className="space-y-1">
              {Object.entries(r.values).map(([k, v]) => (
                <li key={k} className="flex gap-2">
                  <span className="shrink-0 font-semibold text-ink-soft">{labelOf(k)}</span>
                  <span className={cn('min-w-0 whitespace-pre-wrap', v ? 'text-ink' : 'italic text-ink-faint')}>{v || 'left empty: the notes said nothing'}</span>
                </li>
              ))}
            </ul>
          ) : (
            <pre className="whitespace-pre-wrap font-sans text-ink">{r.prompt}</pre>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" onClick={() => (onAccept(r), draft.clear())}>
              {r.values ? 'Use these' : 'Use this description'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => draft.clear()}>
              Discard
            </Button>
            <span className="text-ink-faint">
              {r.model}
              {r.costAvailable ? ` · $${r.costUsd.toFixed(3)}` : ''} · {Math.round(r.durationMs / 1000)} s
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The chosen template on the New goal form: its chip, its inputs (what is still missing marked), the AI draft, and the
 * link back to the words it rendered once the person edited them.
 */
export function TemplatePanel({ entry, version, values, onValues, onRemove, edited, onReapply, dropped, draft, notes, onNotes, repoReady, onAsk, onAcceptValues }: { entry: TemplateEntry; version: TemplateVersionView; values: Record<string, string>; onValues: (v: Record<string, string>) => void; onRemove: () => void; /** the description was edited by hand since the template rendered it */ edited: boolean; onReapply: () => void; dropped: string[]; draft: ReturnType<typeof useDraft>; notes: string; onNotes: (v: string) => void; repoReady: boolean; onAsk: (readRepo: boolean) => void; onAcceptValues: (values: Record<string, string>) => void }) {
  const missing = new Set(renderTemplate(version, values).missing);
  const { Icon, ink } = NATURE_ICON[entry.nature];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-panel pl-2 pr-1 py-0.5 text-xs font-semibold text-ink ring-1 ring-inset ring-line-strong">
          <Icon size={12} className={cn('shrink-0', ink)} aria-hidden="true" />
          <span className="truncate">Template: {version.name}</span>
          <button type="button" className="shrink-0 rounded p-0.5 text-ink-soft hover:bg-sunken hover:text-ink" aria-label="Remove template" title="Keep the words and settings as they are, but no template behind them" onClick={onRemove}>
            <X size={12} />
          </button>
        </span>
        {version.summary && <span className="text-xs text-ink-faint">{version.summary}</span>}
      </div>
      {dropped.length > 0 && (
        <p className="text-xs text-work-ink">
          Left out: {dropped.join('; ')}.
        </p>
      )}
      {version.inputs.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {version.inputs.map((i) => (
            <div key={i.key} className={cn(i.type === 'textarea' && 'sm:col-span-2')}>
              <TemplateInputField input={i} value={values[i.key] ?? ''} onChange={(v) => onValues({ ...values, [i.key]: v })} missing={missing.has(i.key) && !!values[i.key] === false} />
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-ink-faint">This template has no inputs: its words are below, to edit as you like.</p>
      )}
      {edited && (
        <p className="text-xs text-ink-faint">
          You edited the description, so the inputs no longer write it.{' '}
          <button type="button" className="font-semibold text-work-ink underline" onClick={onReapply}>
            Write it from the inputs again
          </button>
          .
        </p>
      )}
      {version.inputs.length > 0 && <DraftBox mode="fill" notes={notes} onNotes={onNotes} repoReady={repoReady} draft={draft} onAsk={onAsk} onAccept={(r) => r.values && onAcceptValues(r.values)} />}
    </div>
  );
}
