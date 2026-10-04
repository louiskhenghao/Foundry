import { ACTION_INFO, BUILTIN_CODEX_PRESETS, CODEX_MODEL_ACTIONS, MODEL_NATURES, NATURE_LABEL, codexBuiltinStatus, codexPresetFingerprint, effectiveCodexPresets, type CodexEffort, type CodexModelAction, type CodexModelChoice, type CodexModelPreset, type ModelNature, type Settings } from '@foundry/core/browser';
import { ArrowDown, ArrowUp, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type ModelRecordView } from '../../api.ts';
import { CodexModelSelect } from '../../components/CodexModelSelect.tsx';
import { Badge, Button, ConfirmDialog, Field, Input, Select, ago, cn } from '../../ui.tsx';

const EFFORTS: CodexEffort[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const PICKS = { code: 'codexPresetCode', docs: 'codexPresetDocs', media: 'codexPresetMedia' } as const;
const roleInfo = (role: CodexModelAction) => role === 'housekeeping'
  ? { label: 'Housekeeping', help: 'Goal classification and short log summaries.' }
  : role === 'planner' ? { label: 'Planner', help: 'Foundry runs a separate planning session before implementation.' }
  : role === 'goalReviewer' ? { label: 'Goal reviewer', help: 'Reviews the complete goal against its acceptance checks. Small goals use the Task reviewer setting.' } : ACTION_INFO[role];

export function CodexModelPresetsSection({ draft, setFields }: { draft: Settings; setFields: (patch: Partial<Settings['models']>) => void }) {
  const saved = (draft.models.codexPresets ?? {}) as Record<string, CodexModelPreset>;
  const presets = effectiveCodexPresets(saved);
  const ids = Object.keys(presets);
  const picks = { code: draft.models.codexPresetCode, docs: draft.models.codexPresetDocs, media: draft.models.codexPresetMedia };
  const [editing, setEditing] = useState(picks.code);
  const [nature, setNature] = useState<ModelNature>('code');
  const [known, setKnown] = useState<ModelRecordView[] | null>(null);
  const [sync, setSync] = useState<{ at: string | null; cliVersion: string | null; found: number } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [probe, setProbe] = useState<Record<string, { busy: boolean; ok?: boolean; text: string }>>({});
  const [deleting, setDeleting] = useState(false);
  const currentId = presets[editing] ? editing : picks.code;
  const current = presets[currentId] ?? presets.production!;
  const status = codexBuiltinStatus(currentId, saved);
  const own = !BUILTIN_CODEX_PRESETS[currentId];
  const fallbacks = draft.models.codexFallbacks;
  const load = () => api.models('codex').then((r) => { setKnown(r.models); setSync(r.sync); });
  useEffect(() => { void load().catch((e) => { setKnown([]); setMessage(`Unable to load models: ${e.message}`); }); }, []);
  const write = (next: CodexModelPreset) => setFields({ codexPresets: { ...saved, [currentId]: next } });
  const setCell = (role: CodexModelAction, value: CodexModelChoice) => {
    const base = saved[currentId] ?? { ...structuredClone(current), basedOn: codexPresetFingerprint(BUILTIN_CODEX_PRESETS[currentId]!) };
    write({ ...base, tables: { ...base.tables, [nature]: { ...base.tables[nature], [role]: value } } });
  };
  const duplicate = () => {
    let number = 1;
    while (presets[`custom-${number}`]) number++;
    const id = `custom-${number}`;
    setFields({ codexPresets: { ...saved, [id]: { ...structuredClone(current), label: `${current.label} copy`, basedOn: null } } });
    setEditing(id);
  };
  const remove = () => {
    const { [currentId]: _, ...rest } = saved;
    const patch: Partial<Settings['models']> = { codexPresets: rest };
    for (const n of MODEL_NATURES) if (picks[n] === currentId) patch[PICKS[n]] = n === 'code' ? 'production' : 'balanced';
    setFields(patch);
    setEditing('production');
    setDeleting(false);
  };
  const runSync = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const r = await api.syncModels('codex');
      await load();
      setMessage(`Found ${r.found} model${r.found === 1 ? '' : 's'}. Sync did not run inference. Use Test to check account access.`);
    } catch (e: any) { setMessage(`Sync failed: ${e.message}`); }
    finally { setSyncing(false); }
  };
  const resolvedModel = (model: string, nativeDefault = false) => !nativeDefault && model === 'codex-default' ? draft.models.codexModel : model;
  const probeKey = (choice: CodexModelChoice, nativeDefault = false) => `${resolvedModel(choice.model, nativeDefault)}:${choice.effort ?? 'default'}`;
  const test = async (choice: CodexModelChoice, nativeDefault = false) => {
    const key = probeKey(choice, nativeDefault);
    setProbe((p) => ({ ...p, [key]: { busy: true, text: 'Testing…' } }));
    try {
      const result = await api.probeModel(resolvedModel(choice.model, nativeDefault).trim(), 'codex', choice.effort ?? undefined);
      setProbe((p) => ({ ...p, [key]: { busy: false, ok: result.ok, text: result.ok ? `Available${result.resolvedId ? ` · ${result.resolvedId}` : ''} · USD cost unavailable` : result.error ?? 'Model test failed' } }));
      await load();
    } catch (e: any) { setProbe((p) => ({ ...p, [key]: { busy: false, ok: false, text: e.message } })); }
  };
  const testButton = (choice: CodexModelChoice, label: string, nativeDefault = false) => <Button size="sm" className="shrink-0" variant="ghost" aria-label={`Test ${label}`} disabled={!resolvedModel(choice.model, nativeDefault).trim() || probe[probeKey(choice, nativeDefault)]?.busy} onClick={() => test(choice, nativeDefault)} title="Runs one short Codex session and consumes account quota.">{probe[probeKey(choice, nativeDefault)]?.busy ? 'Testing…' : 'Test'}</Button>;
  const testStatus = (choice: CodexModelChoice, nativeDefault = false) => {
    const result = probe[probeKey(choice, nativeDefault)];
    return result && <p role="status" className={cn('text-[11px] mt-1 break-words', result.ok === false ? 'text-amber-300' : 'text-zinc-400')}>{result.text}</p>;
  };
  const reorder = (index: number, direction: -1 | 1) => {
    const next = [...fallbacks];
    [next[index], next[index + direction]] = [next[index + direction]!, next[index]!];
    setFields({ codexFallbacks: next });
  };

  return <div className="space-y-5">
    <div className="rounded-md border border-zinc-800 bg-zinc-900/30 p-3 space-y-2">
      <p className="text-xs text-zinc-300">Codex has its own presets, role models and reasoning effort. Saving changes affects new goals. Existing goals keep the settings captured when they were created.</p>
      <p className="text-[11px] text-zinc-500">Preset names describe the amount of reasoning assigned to each role. They do not predict price or guarantee model access.</p>
    </div>
    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
      <Button size="sm" onClick={runSync} disabled={syncing}><RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />{syncing ? 'Syncing…' : 'Sync Codex models'}</Button>
      <span>{sync?.at ? `Synced ${ago(sync.at)} · ${sync.found} models${sync.cliVersion ? ` · Codex ${sync.cliVersion}` : ''}` : 'No catalog synced yet'}</span>
      <p className="w-full text-[11px] text-zinc-500">Sync reads the local CLI model catalog without running inference. Test runs a short session and consumes account quota.</p>
      {message && <p role="status" className="w-full text-xs text-zinc-300">{message}</p>}
    </div>
    <div>
      <Field label="Default Codex model" help="Roles set to Default model use this model when a new goal is created. CLI default model follows Codex's local configuration.">
        <div className="flex items-start gap-2"><CodexModelSelect className="flex-1" known={known} value={draft.models.codexModel} onChange={(v) => setFields({ codexModel: v })} label="Default Codex model" defaultLabel="CLI default model" />{testButton({ model: 'codex-default', effort: null }, 'default Codex model')}</div>
      </Field>
      {testStatus({ model: 'codex-default', effort: null })}
    </div>
    <div className="grid sm:grid-cols-3 gap-3">
      {MODEL_NATURES.map((n) => <Field key={n} label={`${NATURE_LABEL[n]} preset`}><Select aria-label={`Codex ${NATURE_LABEL[n]} preset`} value={picks[n]} onChange={(e) => { setFields({ [PICKS[n]]: e.target.value }); setEditing(e.target.value); setNature(n); }}>{ids.map((id) => <option key={id} value={id}>{presets[id]!.label}{codexBuiltinStatus(id, saved).modified ? ' (modified)' : ''}</option>)}</Select></Field>)}
    </div>
    <div className="border-t border-zinc-800 pt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2"><span className="text-sm mr-1">Edit preset</span>{ids.map((id) => <button type="button" key={id} aria-pressed={currentId === id} onClick={() => setEditing(id)} className={cn('rounded-full border px-3 py-1 text-xs', currentId === id ? 'border-emerald-500 bg-emerald-500/10 text-emerald-200' : 'border-zinc-700 text-zinc-300 hover:border-zinc-500')}>{presets[id]!.label}{codexBuiltinStatus(id, saved).modified ? ' •' : ''}</button>)}<Button size="sm" variant="ghost" onClick={duplicate}><Plus size={12} />Duplicate preset</Button></div>
      <div className="flex flex-wrap items-end gap-3">
        {own ? <><Field label="Preset name" className="w-full sm:w-56"><Input value={current.label} onChange={(e) => write({ ...current, label: e.target.value })} /></Field><Field label="Description" className="flex-1 min-w-[12rem]"><Input value={current.description} onChange={(e) => write({ ...current, description: e.target.value })} /></Field></> : <div className="flex-1 space-y-1"><div className="flex gap-2 items-center text-sm">{current.label}{status.modified && <Badge state="blocked">modified</Badge>}{status.newerDefault && <Badge state="awaiting_brief_approval">newer default available</Badge>}</div><p className="text-xs text-zinc-400">{current.description}</p></div>}
        {status.modified && <Button size="sm" variant="ghost" onClick={() => { const { [currentId]: _, ...rest } = saved; setFields({ codexPresets: rest }); }}><RotateCcw size={12} />Reset to built-in</Button>}
        {own && <Button size="sm" variant="danger" onClick={() => setDeleting(true)}><Trash2 size={12} />Delete preset</Button>}
      </div>
      <div className="flex flex-wrap gap-1">{MODEL_NATURES.map((n) => <button key={n} type="button" aria-pressed={nature === n} onClick={() => setNature(n)} className={cn('rounded px-3 py-1.5 text-xs border', nature === n ? 'border-zinc-500 bg-zinc-800 text-zinc-100' : 'border-transparent text-zinc-400 hover:text-zinc-200')}>{NATURE_LABEL[n]}</button>)}</div>
      <div className="space-y-2">
        <div className="hidden sm:grid grid-cols-[minmax(10rem,1fr)_minmax(10rem,1fr)_9rem_4rem] gap-3 text-[10px] uppercase tracking-wider text-zinc-500 px-3"><span>Role</span><span>Model</span><span>Reasoning effort</span><span /></div>
        {CODEX_MODEL_ACTIONS.map((role) => {
          const choice = current.tables[nature][role];
          const info = roleInfo(role);
          const rec = known?.find((m) => m.name === resolvedModel(choice.model));
          const available = rec?.codex?.available && rec.codex.reasoningEfforts.length ? rec.codex.reasoningEfforts : EFFORTS;
          const unsupported = choice.effort != null && !available.includes(choice.effort);
          return <div key={role} className="rounded border border-zinc-800/80 px-3 py-2.5">
            <div className="grid sm:grid-cols-[minmax(10rem,1fr)_minmax(10rem,1fr)_9rem_4rem] gap-3 items-start">
              <div><div className="text-xs text-zinc-200">{info.label}</div><p className="text-[10px] text-zinc-500 leading-snug mt-0.5">{info.help}</p></div>
              <CodexModelSelect label={`${info.label} model`} known={known} value={choice.model} onChange={(model) => setCell(role, { ...choice, model })} />
              <Select className="text-xs" aria-label={`${info.label} reasoning effort`} value={choice.effort ?? ''} onChange={(e) => setCell(role, { ...choice, effort: (e.target.value || null) as CodexEffort | null })}><option value="">CLI default{rec?.codex?.defaultReasoningEffort ? ` · ${rec.codex.defaultReasoningEffort}` : ''}</option>{available.map((e) => <option key={e} value={e}>{e}</option>)}{unsupported && <option value={choice.effort!}>{choice.effort} · unsupported</option>}</Select>
              {testButton(choice, info.label)}
            </div>
            {unsupported && <p className="text-[11px] text-amber-300 mt-1">This model does not advertise {choice.effort} reasoning. Choose a supported effort before saving.</p>}
            {testStatus(choice)}
          </div>;
        })}
      </div>
      <p className="text-[11px] text-zinc-500">A goal-wide effort selection overrides these role settings. With Default effort, each role uses its preset. A role set to CLI default leaves the choice to Codex.</p>
    </div>
    <div className="border-t border-zinc-800 pt-4 space-y-3">
      <div><h3 className="text-sm">Fallback models, in order</h3><p className="text-xs text-zinc-400 mt-1">Used only when a model is unavailable. Authentication, quota and other failures are reported without switching accounts. Each new goal keeps this order.</p></div>
      {fallbacks.length === 0 && <p className="text-xs text-zinc-500">No fallback configured. An unavailable model pauses the goal for your decision.</p>}
      {fallbacks.map((model, i) => <div key={i}>
        <div className="flex flex-wrap items-start gap-2">
          <span className="text-xs text-zinc-500 pt-2 w-4">{i + 1}</span>
          <CodexModelSelect label={`Fallback model ${i + 1}`} known={known} value={model} defaultLabel="CLI default model" className="flex-1 min-w-[10rem]" onChange={(value) => setFields({ codexFallbacks: fallbacks.map((m, index) => index === i ? value : m) })} />
          <div className="flex gap-1">
            {testButton({ model, effort: null }, `fallback ${i + 1}`, true)}
            <Button size="sm" variant="ghost" disabled={i === 0} aria-label={`Move fallback ${i + 1} up`} onClick={() => reorder(i, -1)}><ArrowUp size={14} /></Button>
            <Button size="sm" variant="ghost" disabled={i === fallbacks.length - 1} aria-label={`Move fallback ${i + 1} down`} onClick={() => reorder(i, 1)}><ArrowDown size={14} /></Button>
            <Button size="sm" variant="ghost" aria-label={`Remove fallback ${i + 1}`} onClick={() => setFields({ codexFallbacks: fallbacks.filter((_, index) => index !== i) })}><Trash2 size={14} /></Button>
          </div>
        </div>
        {testStatus({ model, effort: null }, true)}
      </div>)}
      <Button size="sm" variant="ghost" onClick={() => setFields({ codexFallbacks: [...fallbacks, known?.find((m) => !fallbacks.includes(m.name))?.name ?? 'codex-default'] })}><Plus size={12} />Add fallback</Button>
    </div>
    <p className="text-xs text-amber-300">Codex reports token use without USD cost. Dollar caps cannot be enforced. Time, concurrency and attempt limits still apply.</p>
    <ConfirmDialog open={deleting} title={`Delete preset “${current.label}”?`} danger confirmLabel="Delete preset" onClose={() => setDeleting(false)} onConfirm={remove}><p className="text-sm text-zinc-300">Existing goals retain their captured settings. Goal types using this preset return to their built-in default. This takes effect after Save.</p></ConfirmDialog>
  </div>;
}
