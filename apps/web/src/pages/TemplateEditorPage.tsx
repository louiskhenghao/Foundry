import type { TemplateEntry, TemplateInput, TemplateLang, TemplateNature, TemplateSettings, TemplateVersion } from '@foundry/core/browser';
import { BUDGET_PRESETS, inputRequired, inputsFor, labelOf, templateFromGoal } from '@foundry/core/browser';
import { ArrowLeft, CircleAlert, Copy, LayoutTemplate, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.ts';
import { Markdown } from '../components/Markdown.tsx';
import { NATURE_ICON, TemplateLangSwitch } from '../components/Templates.tsx';
import { Button, Card, EmptyState, Field, Input, Loading, PageHeader, Select, Textarea, buttonClass, cn } from '../ui.tsx';
import { useUnsaved } from '../unsaved.ts';
import { HelpLink } from './HelpPage.tsx';
import { NATURE_WORD, TEMPLATE_NATURES, shownVersion } from './new-goal-template.ts';

/** the interview depths, as the Settings and New goal pages offer them */
const DEPTHS = ['0', '1', '2', '3', '4', '5'] as const;

const blank = (lang: TemplateLang): TemplateVersion => ({ lang, name: '', summary: '', nature: 'code', settings: {}, inputs: [], body: '' });

/**
 * The template editor (ADR-0079): one of the person's own, in one language, whole — name, summary, kind, the settings
 * about the work, the description with its {{placeholders}}, and what each placeholder's input says. A built-in template
 * is read here and copied to edit. Reached from Settings → Templates, and from a goal's page (Save as template).
 */
export function TemplateEditorPage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [entry, setEntry] = useState<TemplateEntry | null | undefined>(undefined);
  const [lang, setLang] = useState<TemplateLang>(params.get('lang') === 'zh' ? 'zh' : 'en');
  const [draft, setDraft] = useState<TemplateVersion | null>(null);
  const [saved, setSaved] = useState<TemplateVersion | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const from = params.get('from');

  // what the editor starts from: the template named, a goal's words (Save as template), or nothing
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (id) {
          const all = await api.templates();
          const t = all.templates.find((x) => x.id === id) ?? null;
          if (!alive) return;
          setEntry(t);
          if (t) {
            const v = shownVersion(t, lang);
            const { file: _f, warnings: _w, ...version } = v;
            setDraft({ ...version, lang });
            setSaved({ ...version, lang });
          }
        } else if (from) {
          const d = await api.goal(from);
          if (!alive) return;
          setEntry(null);
          setDraft(templateFromGoal(d.goal, lang));
        } else {
          setEntry(null);
          setDraft(blank(lang));
        }
      } catch (e) {
        if (alive) setErr((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, from]);

  // the other language of the same template: its own file where there is one, else this one's words to start from
  const switchLang = (l: TemplateLang) => {
    if (!draft || l === lang) return;
    setLang(l);
    const other = entry?.[l];
    if (other) {
      const { file: _f, warnings: _w, ...version } = other;
      setDraft({ ...version, lang: l });
      setSaved({ ...version, lang: l });
    } else {
      setDraft({ ...draft, lang: l });
      setSaved(null);
    }
  };

  const readOnly = !!entry?.builtIn;
  const dirty = !!draft && !readOnly && JSON.stringify(draft) !== JSON.stringify(saved);
  // leaving the page with unsaved changes asks first, as the Brief does
  useUnsaved('template-editor', dirty);
  const derived = useMemo(() => (draft ? inputsFor(draft.body, draft.inputs) : { inputs: [], warnings: [] }), [draft]);
  const problems = draft ? [...(draft.name.trim() ? [] : ['a name']), ...(draft.body.trim() ? [] : ['the description'])] : [];

  const update = (patch: Partial<TemplateVersion>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const updateSettings = (patch: Partial<TemplateSettings>) => update({ settings: Object.fromEntries(Object.entries({ ...draft!.settings, ...patch }).filter(([, v]) => v !== undefined)) as TemplateSettings });
  const updateInput = (key: string, patch: Partial<TemplateInput>) => {
    const inputs = derived.inputs.map((i) => (i.key === key ? { ...i, ...patch } : i));
    update({ inputs: inputs.map((i) => Object.fromEntries(Object.entries(i).filter(([, v]) => v !== undefined)) as TemplateInput) });
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setErr(null);
    try {
      const version: TemplateVersion = { ...draft, name: draft.name.trim(), summary: draft.summary.trim(), inputs: derived.inputs, body: draft.body.replace(/\s+$/, '') };
      const made = entry && !entry.builtIn ? await api.saveTemplate(entry.id, version) : await api.createTemplate(version);
      setSaved(version);
      if (!entry || entry.builtIn) nav(`/templates/${encodeURIComponent(made.id)}${lang === 'zh' ? '?lang=zh' : ''}`, { replace: true });
      else setEntry(made);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!entry) return;
    setBusy(true);
    try {
      const made = await api.copyTemplate(entry.id);
      nav(`/templates/${encodeURIComponent(made.id)}${lang === 'zh' ? '?lang=zh' : ''}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (id && entry === null && !err)
    return (
      <div className="max-w-5xl mx-auto p-3 sm:p-4 md:p-6">
        <EmptyState icon={CircleAlert} tone="bad" title="No such template" actions={<Link to="/settings#templates" className={buttonClass('default', 'lg')}><ArrowLeft size={16} aria-hidden="true" /> Templates</Link>}>
          Nothing is called {id}. It may have been renamed or deleted.
        </EmptyState>
      </div>
    );
  if (!draft) return err ? <div className="max-w-5xl mx-auto p-6 text-sm text-bad-ink">{err}</div> : <Loading size="page" label="Loading the template…" />;

  const { Icon, ink } = NATURE_ICON[draft.nature];
  const preview = draft.body.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_-]*)\s*\}\}/g, (_, k: string) => {
    const i = derived.inputs.find((x) => x.key === k);
    return `**［${i?.label ?? labelOf(k)}］**`;
  });
  const S = draft.settings;

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 pt-6 md:pt-9 pb-24 space-y-4">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2.5 text-sm text-ink-faint">
        <Link to="/settings#templates" className="inline-flex items-center gap-1.5 font-bold text-ink hover:underline underline-offset-[3px]">
          <ArrowLeft size={14} aria-hidden="true" /> Templates
        </Link>
      </nav>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <LayoutTemplate size={22} className="text-ink-faint" aria-hidden="true" /> {entry ? (readOnly ? 'Template' : 'Edit template') : from ? 'Save as template' : 'New template'}
            <HelpLink to="templates" className="ml-1" />
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <TemplateLangSwitch value={lang} onChange={switchLang} />
            {entry && (
              <Link to={`/goals/new?template=${encodeURIComponent(entry.id)}`} className={buttonClass('default', 'md')} title="A new goal from this template">
                Use on a new goal
              </Link>
            )}
            {readOnly ? (
              <Button variant="primary" disabled={busy} onClick={() => void copy()} title="Writes a copy in your templates folder, in every language it has, to edit">
                <Copy size={14} /> Make a copy to edit
              </Button>
            ) : (
              <Button variant="primary" disabled={busy || !dirty || problems.length > 0} onClick={() => void save()} title={problems.length ? `Still needed: ${problems.join(' and ')}` : undefined}>
                <Save size={14} /> {busy ? 'Saving…' : entry ? 'Save' : 'Save template'}
              </Button>
            )}
          </div>
        }
      />
      {readOnly && <p className="text-xs text-ink-faint">One of Foundry's templates: it updates with Foundry and cannot be changed here. Make a copy and the copy is yours.</p>}
      {!entry && !readOnly && !saved && lang === 'zh' && <p className="text-xs text-ink-faint">You are writing the 中文 version; its file ends in .zh.md. The English one is a separate file of the same name.</p>}
      {err && <div className="rounded-md border border-bad/50 bg-panel px-3 py-2 text-sm text-bad-ink">{err}</div>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          <Card title="About">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
              <Field label="Name">
                <Input value={draft.name} maxLength={80} readOnly={readOnly} onChange={(e) => update({ name: e.target.value })} placeholder="Product reel" />
              </Field>
              <Field label="Kind of goal">
                <Select value={draft.nature} disabled={readOnly} onChange={(e) => update({ nature: e.target.value as TemplateNature })}>
                  {TEMPLATE_NATURES.map((n) => (
                    <option key={n} value={n}>
                      {NATURE_WORD[n]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Summary" help="One line under the name in the gallery." className="mt-3">
              <Input value={draft.summary} maxLength={300} readOnly={readOnly} onChange={(e) => update({ summary: e.target.value })} />
            </Field>
          </Card>

          <Card title={<span className="inline-flex items-center gap-2"><Icon size={14} strokeWidth={2.25} className={ink} aria-hidden="true" /> The description</span>}>
            <p className="mb-2 text-xs text-ink-faint">
              What the New goal form starts from. Write <span className="mono text-ink">{'{{a_key}}'}</span> wherever the person fills something in: each key becomes an input, listed on the right to refine. A closing section of what is already decided saves the Clarifier a question.
            </p>
            <Textarea rows={18} className="mono text-[13px]" value={draft.body} readOnly={readOnly} onChange={(e) => update({ body: e.target.value })} placeholder={'Make a {{duration}} product reel for {{product}}.\n\n## The one thing to remember\n{{message}}\n\n## Already decided\n- One timeline; every format cut from it.'} />
            {derived.warnings.length > 0 && (
              <ul className="mt-2 text-xs text-work-ink space-y-0.5">
                {derived.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Settings the template brings">
            <p className="mb-3 text-xs text-ink-faint">Only what is set here changes the form; the rest stays as the person left it. Nothing about a computer or its accounts (the coding agent, models, delivery, folders) belongs in a template.</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="View">
                <Select value={S.mode ?? ''} disabled={readOnly} onChange={(e) => updateSettings({ mode: (e.target.value || undefined) as TemplateSettings['mode'] })}>
                  <option value="">Form default</option>
                  <option value="simple">Simple</option>
                  <option value="expert">Expert</option>
                </Select>
              </Field>
              <Field label="Pace">
                <Select value={S.workflow?.pace ?? ''} disabled={readOnly} onChange={(e) => updateSettings({ workflow: { ...S.workflow, pace: (e.target.value || undefined) as 'thorough' | 'fast' | undefined } })}>
                  <option value="">Form default</option>
                  <option value="thorough">Thorough</option>
                  <option value="fast">Fast</option>
                </Select>
              </Field>
              <Field label="TDD">
                <Select value={S.workflow?.tdd ?? ''} disabled={readOnly} onChange={(e) => updateSettings({ workflow: { ...S.workflow, tdd: (e.target.value || undefined) as 'required' | 'preferred' | 'off' | undefined } })}>
                  <option value="">Form default</option>
                  <option value="required">Required</option>
                  <option value="preferred">Preferred</option>
                  <option value="off">Off</option>
                </Select>
              </Field>
              <Field label="Ponytail">
                <Select value={S.workflow?.ponytail ?? ''} disabled={readOnly} onChange={(e) => updateSettings({ workflow: { ...S.workflow, ponytail: (e.target.value || undefined) as 'on' | 'off' | undefined } })}>
                  <option value="">Form default</option>
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </Select>
              </Field>
              <Field label="Workflow suite">
                <Select value={S.workflow?.profile ?? ''} disabled={readOnly} onChange={(e) => updateSettings({ workflow: { ...S.workflow, profile: (e.target.value || undefined) as 'mattpocock' | 'pstack' | 'plain' | undefined } })}>
                  <option value="">Form default</option>
                  <option value="mattpocock">mattpocock</option>
                  <option value="pstack">pstack</option>
                  <option value="plain">plain</option>
                </Select>
              </Field>
              <Field label="Interview depth">
                <Select value={S.interviewDepth === undefined ? '' : String(S.interviewDepth)} disabled={readOnly} onChange={(e) => updateSettings({ interviewDepth: e.target.value === '' ? undefined : Number(e.target.value) })}>
                  <option value="">Form default</option>
                  {DEPTHS.map((d) => (
                    <option key={d} value={d}>
                      {d === '0' ? '0 — skip, one-shot Brief' : d}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Budget">
                <Select value={S.budgetPreset ?? ''} disabled={readOnly} onChange={(e) => updateSettings({ budgetPreset: (e.target.value || undefined) as TemplateSettings['budgetPreset'], budgets: e.target.value === 'custom' ? S.budgets : undefined })}>
                  <option value="">Form default</option>
                  {(Object.keys(BUDGET_PRESETS) as (keyof typeof BUDGET_PRESETS)[]).map((p) => (
                    <option key={p} value={p}>
                      {BUDGET_PRESETS[p].label}
                    </option>
                  ))}
                </Select>
              </Field>
              {draft.nature === 'video' && (
                <Field label="Video engine" help="Applied while the motion-studio Beta is on.">
                  <Select value={S.videoPack ?? ''} disabled={readOnly} onChange={(e) => updateSettings({ videoPack: (e.target.value || undefined) as TemplateSettings['videoPack'] })}>
                    <option value="">Form default</option>
                    {['motion-studio', 'hyperframes', 'web-video-presentation', 'mmx-cli'].map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {draft.nature === 'figure' && (
                <Field label="Figure style">
                  <Select value={S.figurePack ?? ''} disabled={readOnly} onChange={(e) => updateSettings({ figurePack: (e.target.value || undefined) as TemplateSettings['figurePack'] })}>
                    <option value="">Form default</option>
                    <option value="colorfigures">Colorfigures</option>
                    <option value="iso-glow">iso-glow</option>
                  </Select>
                </Field>
              )}
            </div>
            {S.budgetPreset === 'custom' && (
              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                {(
                  [
                    ['maxCostUsd', 'Max cost ($)'],
                    ['maxDurationMin', 'Max minutes'],
                    ['maxConcurrent', 'Parallel'],
                    ['attemptsPerTask', 'Attempts per task'],
                  ] as const
                ).map(([k, label]) => (
                  <Field key={k} label={label}>
                    <Input type="number" min={1} value={S.budgets?.[k] ?? ''} readOnly={readOnly} onChange={(e) => updateSettings({ budgets: { ...S.budgets, [k]: e.target.value === '' ? undefined : Number(e.target.value) } })} />
                  </Field>
                ))}
              </div>
            )}
            <div className="mt-3 space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="shrink-0" disabled={readOnly} checked={!!S.autoBrief} onChange={(e) => updateSettings({ autoBrief: e.target.checked ? { mustChecks: [], stretchChecks: [] } : undefined })} /> Skip Clarify: one task with command checks
              </label>
              {S.autoBrief && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Must checks (one command per line)">
                    <Textarea rows={3} className="mono" readOnly={readOnly} value={S.autoBrief.mustChecks.join('\n')} onChange={(e) => updateSettings({ autoBrief: { ...S.autoBrief!, mustChecks: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) } })} />
                  </Field>
                  <Field label="Stretch checks">
                    <Textarea rows={3} className="mono" readOnly={readOnly} value={(S.autoBrief.stretchChecks ?? []).join('\n')} onChange={(e) => updateSettings({ autoBrief: { ...S.autoBrief!, stretchChecks: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) } })} />
                  </Field>
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <Card title={`Inputs (${derived.inputs.length})`}>
            {derived.inputs.length === 0 ? (
              <p className="text-xs text-ink-faint">None yet: write <span className="mono text-ink">{'{{a_key}}'}</span> in the description and it appears here.</p>
            ) : (
              <ul className="space-y-4">
                {derived.inputs.map((i) => (
                  <li key={i.key} className="rounded-lg border border-line p-2.5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="mono text-xs font-semibold text-ink">{'{{'}{i.key}{'}}'}</span>
                      <label className="flex items-center gap-1.5 text-xs text-ink-soft">
                        <input type="checkbox" disabled={readOnly} checked={inputRequired(i)} onChange={(e) => updateInput(i.key, { required: e.target.checked })} /> required
                      </label>
                    </div>
                    <Input aria-label={`Label for ${i.key}`} placeholder={labelOf(i.key)} value={i.label ?? ''} readOnly={readOnly} maxLength={80} onChange={(e) => updateInput(i.key, { label: e.target.value || undefined })} />
                    <Input aria-label={`Help for ${i.key}`} placeholder="Help, shown beside the label" value={i.help ?? ''} readOnly={readOnly} maxLength={500} onChange={(e) => updateInput(i.key, { help: e.target.value || undefined })} />
                    <div className="grid grid-cols-2 gap-2">
                      <Select aria-label={`Kind of ${i.key}`} value={i.type} disabled={readOnly} onChange={(e) => updateInput(i.key, { type: e.target.value as TemplateInput['type'], ...(e.target.value !== 'choice' ? { options: undefined, other: false } : {}) })}>
                        <option value="text">One line</option>
                        <option value="textarea">A paragraph</option>
                        <option value="choice">A choice</option>
                      </Select>
                      <Input aria-label={`Default for ${i.key}`} placeholder="Default" value={i.default ?? ''} readOnly={readOnly} onChange={(e) => updateInput(i.key, { default: e.target.value || undefined })} />
                    </div>
                    {i.type === 'choice' && (
                      <>
                        <Input aria-label={`Options for ${i.key}`} placeholder="Options, separated by |" value={(i.options ?? []).join(' | ')} readOnly={readOnly} onChange={(e) => updateInput(i.key, { options: e.target.value.split('|').map((s) => s.trim()).filter(Boolean) })} />
                        <label className="flex items-center gap-1.5 text-xs text-ink-soft">
                          <input type="checkbox" disabled={readOnly} checked={i.other} onChange={(e) => updateInput(i.key, { other: e.target.checked })} /> the person may type something else
                        </label>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="As the form will show it">
            <div className={cn('text-sm', !draft.body.trim() && 'text-ink-faint')}>{draft.body.trim() ? <Markdown source={preview} /> : 'The description, with each input as a blank.'}</div>
          </Card>
        </div>
      </div>
    </div>
  );
}
