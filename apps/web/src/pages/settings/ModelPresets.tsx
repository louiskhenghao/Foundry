import { ACTION_INFO, BUILTIN_PRESETS, MODEL_ACTIONS, MODEL_NATURES, RARELY_USED, builtinStatus, effectivePresets, presetFingerprint, type ModelAction, type ModelNature, type ModelPreset, type Settings } from '@foundry/core/browser';
import { useEffect, useState } from 'react';
import { api, type ModelRecordView } from '../../api.ts';
import { ConfirmDialog, Input, Select, ago, cn } from '../../ui.tsx';
import { GoalTypePresets, NatureTabs, PresetChips, PresetDetails, RoleRow, SyncRow } from './PresetParts.tsx';

const ALIASES = [
  { id: 'fable', label: 'Fable' },
  { id: 'opus', label: 'Opus' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'haiku', label: 'Haiku' },
];
const NATURE_PATH: Record<ModelNature, 'models.presetCode' | 'models.presetDocs' | 'models.presetMedia'> = { code: 'models.presetCode', docs: 'models.presetDocs', media: 'models.presetMedia' };

type SetFn = (path: `models.${string}`, value: unknown) => void;

/**
 * One model dropdown: the family aliases (with what each resolves to today), the newest pinned id per family found by a
 * sync, and — behind "show all versions" — every other id the CLI knows. A value outside the list stays selectable.
 */
export function ModelPicker({ value, onChange, known, showAll, disabled, className }: { value: string; onChange: (v: string) => void; known: ModelRecordView[] | null; showAll: boolean; disabled?: boolean; className?: string }) {
  const [custom, setCustom] = useState(false);
  const rec = (id: string) => known?.find((m) => m.name === id);
  const newest = (known ?? []).filter((m) => m.discovered?.newest).map((m) => m.name);
  const others = showAll ? (known ?? []).filter((m) => !m.discovered?.newest && !ALIASES.some((a) => a.id === m.name)).map((m) => m.name).sort() : [];
  const listed = new Set([...ALIASES.map((a) => a.id), ...newest, ...others]);
  if (custom) return <Input className={cn('mono text-xs', className)} autoFocus defaultValue={value} disabled={disabled} placeholder="claude-…" onBlur={(e) => { setCustom(false); if (e.target.value.trim()) onChange(e.target.value.trim()); }} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />;
  return (
    <Select className={cn('text-xs py-1', className)} value={value} disabled={disabled} onChange={(e) => (e.target.value === '__custom' ? setCustom(true) : onChange(e.target.value))}>
      <optgroup label="Latest of each family">
        {ALIASES.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
            {rec(a.id)?.resolvedId ? ` → ${rec(a.id)!.resolvedId}` : ''}
          </option>
        ))}
      </optgroup>
      {newest.length > 0 && (
        <optgroup label="Pinned (newest found)">
          {newest.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </optgroup>
      )}
      {others.length > 0 && (
        <optgroup label="Older versions">
          {others.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </optgroup>
      )}
      {!listed.has(value) && <option value={value}>{value}</option>}
      <option value="__custom">custom id…</option>
    </Select>
  );
}

/** The Models section: sync, the preset each nature uses, and the preset editor. */
export function ModelPresetsSection({ draft, set, known, reloadModels }: { draft: Settings; set: SetFn; known: ModelRecordView[] | null; reloadModels: () => void }) {
  const saved = (draft.models.presets ?? {}) as Record<string, ModelPreset>;
  const presets = effectivePresets(saved);
  const ids = [...Object.keys(BUILTIN_PRESETS), ...Object.keys(saved).filter((id) => !BUILTIN_PRESETS[id])];
  const picks: Record<ModelNature, string> = { code: draft.models.presetCode, docs: draft.models.presetDocs, media: draft.models.presetMedia };
  const [editing, setEditing] = useState<string>(picks.code);
  const [nature, setNature] = useState<ModelNature>('code');
  const [showAll, setShowAll] = useState(false);
  const [sync, setSync] = useState<{ at: string | null; cliVersion: string | null; found: number } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; goals: number } | null>(null);
  useEffect(() => {
    void api.models().then((m) => setSync(m.sync ?? null)).catch(() => {});
  }, []);
  const current = presets[editing] ?? presets[picks.code]!;
  const status = builtinStatus(editing, saved);
  const own = !BUILTIN_PRESETS[editing];

  const writePreset = (id: string, next: ModelPreset) => set('models.presets', { ...saved, [id]: next });
  const setCell = (n: ModelNature, a: ModelAction, model: string) => {
    const base = saved[editing] ?? { ...structuredClone(BUILTIN_PRESETS[editing]!), basedOn: presetFingerprint(BUILTIN_PRESETS[editing]!) };
    writePreset(editing, { ...base, tables: { ...base.tables, [n]: { ...base.tables[n], [a]: model } } });
  };
  const reset = () => {
    const { [editing]: _, ...rest } = saved;
    set('models.presets', rest);
  };
  const duplicate = () => {
    let n = 1;
    while (presets[`custom-${n}`]) n++;
    const id = `custom-${n}`;
    writePreset(id, { ...structuredClone(current), label: `${current.label} copy`, description: current.description, basedOn: null });
    setEditing(id);
  };
  const askDelete = async () => {
    const goals = await api.goals().catch(() => []);
    const inFlight = goals.filter((g: any) => g.modelPreset === editing && !['done', 'over_delivered', 'failed', 'cancelled'].includes(g.state)).length;
    setConfirmDelete({ id: editing, goals: inFlight });
  };
  const doDelete = () => {
    if (!confirmDelete) return;
    const { [confirmDelete.id]: _, ...rest } = saved;
    set('models.presets', rest);
    for (const n of MODEL_NATURES) if (picks[n] === confirmDelete.id) set(NATURE_PATH[n], n === 'code' ? 'production' : 'balanced');
    setEditing(picks.code === confirmDelete.id ? 'production' : picks.code);
    setConfirmDelete(null);
  };
  const runSync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await api.syncModels();
      setSyncMsg(`${r.found} model id(s) found; ${Object.entries(r.resolved).map(([a, v]) => `${a} → ${v ?? '?'}`).join(', ')}`);
      setSync({ at: new Date().toISOString(), cliVersion: r.cliVersion, found: r.found });
      reloadModels();
    } catch (e: any) {
      setSyncMsg(`✘ ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const options = ids.map((id) => ({ id, label: presets[id]!.label, modified: builtinStatus(id, saved).modified }));
  const editPreset = (n: ModelNature) => {
    setEditing(picks[n]);
    setNature(n);
    document.getElementById('model-preset-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="space-y-5">
      <SyncRow
        syncing={syncing}
        onSync={runSync}
        title="Reads every model id your Claude Code knows (free) and resolves fable / opus / sonnet / haiku with one tiny session each (~$0.04). Runs by itself when Claude Code updates."
        status={sync?.at ? `last synced ${ago(sync.at)}${sync.cliVersion ? ` · Claude Code ${sync.cliVersion}` : ''} · ${sync.found} ids` : 'not synced yet'}
        aside={
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" className="accent-emerald-500" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> show all versions
          </label>
        }
        message={syncMsg}
      />

      <GoalTypePresets
        picks={picks}
        options={options}
        onPick={(n, id) => set(NATURE_PATH[n], id)}
        onEdit={editPreset}
        summary={(n) => {
          const p = presets[picks[n]] ?? presets[n === 'code' ? 'production' : 'balanced']!;
          return MODEL_ACTIONS.map((a) => ({ role: a, label: ACTION_INFO[a].label, value: p.tables[n][a], rare: RARELY_USED[n].includes(a) }));
        }}
      />

      <div id="model-preset-editor" className="scroll-mt-16 space-y-3 border-t border-zinc-800 pt-4">
        <PresetChips options={options} editing={editing} onSelect={setEditing} onNew={duplicate} />
        <PresetDetails
          label={current.label}
          description={current.description}
          own={own}
          status={status}
          onLabel={(v) => writePreset(editing, { ...current, label: v || 'Untitled' })}
          onDescription={(v) => writePreset(editing, { ...current, description: v })}
          onReset={reset}
          onDelete={askDelete}
        />
        <NatureTabs value={nature} onChange={setNature} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
          {MODEL_ACTIONS.map((a) => {
            const shipped = BUILTIN_PRESETS[editing]?.tables[nature][a];
            const changed = shipped != null && shipped !== current.tables[nature][a];
            return (
              <RoleRow key={a} label={ACTION_INFO[a].label} help={ACTION_INFO[a].help} nature={nature} rare={RARELY_USED[nature].includes(a)} shipped={changed ? shipped : null}>
                <ModelPicker value={current.tables[nature][a]} onChange={(v) => setCell(nature, a, v)} known={known} showAll={showAll} />
              </RoleRow>
            );
          })}
        </div>
        <p className="text-[11px] text-zinc-500">Changes apply after Save, to new goals and to goals in flight at their next session. The last attempt of a task (budget ≥ 2) and every retry you grant run on the Complex-task model.</p>
      </div>

      <ConfirmDialog open={!!confirmDelete} title={`Delete preset "${confirmDelete ? presets[confirmDelete.id]?.label : ''}"?`} danger confirmLabel="Delete" onClose={() => setConfirmDelete(null)} onConfirm={doDelete}>
        <p className="text-sm text-zinc-300">{confirmDelete?.goals ? `${confirmDelete.goals} goal(s) in flight use it; they continue on their goal type's preset from their next session.` : 'No goal in flight uses it.'} Goal types that pick it switch to their default preset. Takes effect when you Save.</p>
      </ConfirmDialog>
    </div>
  );
}

