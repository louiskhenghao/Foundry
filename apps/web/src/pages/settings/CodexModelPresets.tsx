import { ACTION_INFO, BUILTIN_CODEX_PRESETS, CODEX_MODEL_ACTIONS, MODEL_NATURES, NATURE_LABEL, RARELY_USED, codexBuiltinStatus, codexPresetFingerprint, effectiveCodexPresets, type CodexEffort, type CodexModelAction, type CodexModelChoice, type CodexModelPreset, type ModelNature, type Settings } from '@foundry/core/browser';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type ModelRecordView } from '../../api.ts';
import { CodexModelSelect } from '../../components/CodexModelSelect.tsx';
import { Button, ConfirmDialog, Field, Select, ago, cn } from '../../ui.tsx';
import { FieldGroup, GoalTypePresets, NatureTabs, PresetChips, PresetDetails, RoleRow, SectionTitle, SyncRow } from './PresetParts.tsx';

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

  const options = ids.map((id) => ({ id, label: presets[id]!.label, modified: codexBuiltinStatus(id, saved).modified }));
  const choiceText = (choice: CodexModelChoice) => {
    const model = choice.model === 'codex-default' ? 'Default' : choice.model;
    const effort = choice.effort ?? 'Default';
    return model === effort ? model : `${model} · ${effort}`;
  };
  const rarely = (n: ModelNature, role: CodexModelAction) => (RARELY_USED[n] as string[]).includes(role);
  const editPreset = (n: ModelNature) => {
    setEditing(picks[n]);
    setNature(n);
    document.getElementById('codex-preset-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return <div className="space-y-5">
    <SyncRow
      syncing={syncing}
      onSync={runSync}
      title="Reads the model catalog of your local Codex CLI. Runs no inference and uses no quota."
      status={sync?.at ? `last synced ${ago(sync.at)}${sync.cliVersion ? ` · Codex ${sync.cliVersion}` : ''} · ${sync.found} models` : 'not synced yet'}
      help="Codex goals capture their preset, role models and reasoning effort when they are created. Sync reads the local CLI catalog without running inference; Test runs one short session and uses account quota."
      message={message}
    />

    <GoalTypePresets
      picks={picks}
      options={options}
      selectLabel={(n) => `Codex ${NATURE_LABEL[n]} preset`}
      // "model · effort" is wider than a model alias: one column on a phone
      summaryColumns="grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
      onPick={(n, id) => { setFields({ [PICKS[n]]: id }); setEditing(id); setNature(n); }}
      onEdit={editPreset}
      summary={(n) => {
        const p = presets[picks[n]] ?? presets[n === 'code' ? 'production' : 'balanced']!;
        return CODEX_MODEL_ACTIONS.map((role) => ({ role, label: roleInfo(role).label, value: choiceText(p.tables[n][role]), rare: rarely(n, role) }));
      }}
    />

    <div id="codex-preset-editor" className="scroll-mt-16 space-y-3 border-t border-zinc-800 pt-4">
      <PresetChips options={options} editing={currentId} onSelect={setEditing} onNew={duplicate} />
      <PresetDetails
        label={current.label}
        description={current.description}
        own={own}
        status={status}
        onLabel={(v) => write({ ...current, label: v })}
        onDescription={(v) => write({ ...current, description: v })}
        onReset={() => { const { [currentId]: _, ...rest } = saved; setFields({ codexPresets: rest }); }}
        onDelete={() => setDeleting(true)}
      />
      <NatureTabs value={nature} onChange={setNature} />
      <div className="grid grid-cols-1 gap-y-2">
        {CODEX_MODEL_ACTIONS.map((role) => {
          const choice = current.tables[nature][role];
          const info = roleInfo(role);
          const rec = known?.find((m) => m.name === resolvedModel(choice.model));
          const available = rec?.codex?.available && rec.codex.reasoningEfforts.length ? rec.codex.reasoningEfforts : EFFORTS;
          const unsupported = choice.effort != null && !available.includes(choice.effort);
          const shipped = BUILTIN_CODEX_PRESETS[currentId]?.tables[nature][role];
          const changed = shipped != null && (shipped.model !== choice.model || shipped.effort !== choice.effort);
          return <RoleRow key={role} label={info.label} help={info.help} nature={nature} rare={rarely(nature, role)} shipped={changed ? choiceText(shipped) : null}>
            <div className="flex flex-wrap items-start gap-2">
              <CodexModelSelect className="flex-1 min-w-[10rem]" label={`${info.label} model`} known={known} value={choice.model} onChange={(model) => setCell(role, { ...choice, model })} />
              <div className="w-36 shrink-0"><Select className="text-xs" aria-label={`${info.label} reasoning effort`} title="Reasoning effort" value={choice.effort ?? ''} onChange={(e) => setCell(role, { ...choice, effort: (e.target.value || null) as CodexEffort | null })}><option value="">CLI default{rec?.codex?.defaultReasoningEffort ? ` · ${rec.codex.defaultReasoningEffort}` : ''}</option>{available.map((e) => <option key={e} value={e}>{e}</option>)}{unsupported && <option value={choice.effort!}>{choice.effort} · unsupported</option>}</Select></div>
              {testButton(choice, info.label)}
            </div>
            {unsupported && <p className="text-[11px] text-amber-300 mt-1">This model does not advertise {choice.effort} reasoning. Choose a supported effort before saving.</p>}
            {testStatus(choice)}
          </RoleRow>;
        })}
      </div>
      <p className="text-[11px] text-zinc-500">Each role has a model and a reasoning effort. Changes apply after Save, to new goals. A goal-wide effort selection overrides these role settings. With Default effort, each role uses its preset. A role set to CLI default leaves the choice to Codex.</p>
    </div>

    <div className="border-t border-zinc-800 pt-4 space-y-3">
      <SectionTitle>Other models</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
        <div>
          <Field label="Default Codex model" help="Roles set to Default model use this model when a new goal is created. CLI default model follows Codex's local configuration.">
            <div className="flex items-start gap-2"><CodexModelSelect className="flex-1" known={known} value={draft.models.codexModel} onChange={(v) => setFields({ codexModel: v })} label="Default Codex model" defaultLabel="CLI default model" />{testButton({ model: 'codex-default', effort: null }, 'default Codex model')}</div>
          </Field>
          {testStatus({ model: 'codex-default', effort: null })}
        </div>
        <FieldGroup label="Fallbacks (in order)" help="Used only when a model is unavailable. Authentication, quota and other failures are reported without switching accounts. Each new goal keeps this order.">
          <div className="space-y-2">
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
        </FieldGroup>
      </div>
    </div>
    <p className="text-xs text-amber-300">Codex reports token use without USD cost. Dollar caps cannot be enforced. Time, concurrency and attempt limits still apply.</p>
    <ConfirmDialog open={deleting} title={`Delete preset “${current.label}”?`} danger confirmLabel="Delete" onClose={() => setDeleting(false)} onConfirm={remove}><p className="text-sm text-zinc-300">Existing goals retain their captured settings. Goal types using this preset return to their built-in default. This takes effect after Save.</p></ConfirmDialog>
  </div>;
}
