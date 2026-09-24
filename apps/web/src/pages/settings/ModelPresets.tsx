import { ACTION_INFO, BUILTIN_PRESETS, MODEL_ACTIONS, MODEL_NATURES, NATURE_LABEL, RARELY_USED, builtinStatus, effectivePresets, presetFingerprint, type ModelAction, type ModelNature, type ModelPreset, type Settings } from '@foundry/core/browser';
import { Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type ModelRecordView } from '../../api.ts';
import { Badge, Button, ConfirmDialog, Field, Input, Select, ago, cn } from '../../ui.tsx';

const ALIASES = [
  { id: 'fable', label: 'Fable' },
  { id: 'opus', label: 'Opus' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'haiku', label: 'Haiku' },
];
const NATURE_PATH: Record<ModelNature, 'models.presetCode' | 'models.presetDocs' | 'models.presetMedia'> = { code: 'models.presetCode', docs: 'models.presetDocs', media: 'models.presetMedia' };
const NATURE_HINT: Record<ModelNature, string> = { code: 'software goals, and goals not yet classified', docs: 'documents and cited research reports', media: 'image and video goals' };

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

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 flex-wrap text-xs text-zinc-400">
        <Button size="sm" onClick={runSync} disabled={syncing} title="Reads every model id your Claude Code knows (free) and resolves fable / opus / sonnet / haiku with one tiny session each (~$0.04). Runs by itself when Claude Code updates.">
          <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Syncing…' : 'Sync models'}
        </Button>
        <span>{sync?.at ? `last synced ${ago(sync.at)}${sync.cliVersion ? ` · Claude Code ${sync.cliVersion}` : ''} · ${sync.found} ids` : 'not synced yet'}</span>
        <label className="ml-auto flex items-center gap-1 cursor-pointer">
          <input type="checkbox" className="accent-emerald-500" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> show all versions
        </label>
        {syncMsg && <div className="w-full text-[11px] text-zinc-500">{syncMsg}</div>}
      </div>

      <div className="space-y-3">
        <div className="text-sm text-zinc-200">Preset per goal type</div>
        {MODEL_NATURES.map((n) => {
          const p = presets[picks[n]] ?? presets[n === 'code' ? 'production' : 'balanced']!;
          return (
            <div key={n} className="rounded border border-zinc-800 p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-zinc-100 text-sm w-40">{NATURE_LABEL[n]}</span>
                <span className="w-48">
                  <Select className="text-xs py-1" value={picks[n]} onChange={(e) => set(NATURE_PATH[n], e.target.value)}>
                    {ids.map((id) => (
                      <option key={id} value={id}>
                        {presets[id]!.label}
                        {builtinStatus(id, saved).modified ? ' (modified)' : ''}
                      </option>
                    ))}
                  </Select>
                </span>
                <span className="text-[11px] text-zinc-500">{NATURE_HINT[n]}</span>
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => { setEditing(picks[n]); setNature(n); document.getElementById('model-preset-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
                  Edit preset
                </Button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-0.5 text-[11px]">
                {MODEL_ACTIONS.map((a) => (
                  <div key={a} className={cn('flex justify-between gap-2', RARELY_USED[n].includes(a) && 'opacity-40')}>
                    <span className="text-zinc-500 truncate">{ACTION_INFO[a].label}</span>
                    <span className="mono text-zinc-300">{p.tables[n][a]}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div id="model-preset-editor" className="scroll-mt-16 space-y-3 border-t border-zinc-800 pt-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-zinc-200 mr-2">Presets</span>
          {ids.map((id) => {
            const st = builtinStatus(id, saved);
            return (
              <button key={id} type="button" onClick={() => setEditing(id)} className={cn('rounded-full border px-2.5 py-0.5 text-xs', editing === id ? 'border-emerald-500 bg-emerald-500/10 text-emerald-200' : 'border-zinc-700 text-zinc-300 hover:border-zinc-500')}>
                {presets[id]!.label}
                {st.modified ? ' •' : ''}
              </button>
            );
          })}
          <Button size="sm" variant="ghost" onClick={duplicate} title="A new preset that starts as a copy of the one shown">
            <Plus size={12} /> New from this
          </Button>
        </div>
        <div className="flex items-start gap-3 flex-wrap">
          {own ? (
            <Field label="Name" className="w-56">
              <Input value={current.label} onChange={(e) => writePreset(editing, { ...current, label: e.target.value || 'Untitled' })} />
            </Field>
          ) : (
            <div className="text-zinc-100 text-sm pt-1">
              {current.label} {status.modified && <Badge state="blocked">modified</Badge>} {status.newerDefault && <Badge state="awaiting_brief_approval">newer default available</Badge>}
            </div>
          )}
          <p className="text-xs text-zinc-400 flex-1 min-w-[16rem] pt-1">{own ? <Input className="text-xs" value={current.description} placeholder="what this preset is for" onChange={(e) => writePreset(editing, { ...current, description: e.target.value })} /> : current.description}</p>
          {status.modified && (
            <Button size="sm" variant="ghost" onClick={reset} title="Restore the values Foundry ships for this preset">
              <RotateCcw size={12} /> Reset
            </Button>
          )}
          {own && (
            <Button size="sm" variant="danger" onClick={askDelete}>
              <Trash2 size={12} /> Delete
            </Button>
          )}
        </div>
        <div className="flex gap-1">
          {MODEL_NATURES.map((n) => (
            <button key={n} type="button" onClick={() => setNature(n)} className={cn('rounded px-2.5 py-1 text-xs border', nature === n ? 'border-zinc-500 bg-zinc-800 text-zinc-100' : 'border-transparent text-zinc-400 hover:text-zinc-200')}>
              {NATURE_LABEL[n]}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
          {MODEL_ACTIONS.map((a) => {
            const rare = RARELY_USED[nature].includes(a);
            const shipped = BUILTIN_PRESETS[editing]?.tables[nature][a];
            const changed = shipped != null && shipped !== current.tables[nature][a];
            return (
              <div key={a} className={cn('flex items-start gap-2', rare && 'opacity-50')}>
                <div className="w-40 shrink-0 pt-1">
                  <div className="text-xs text-zinc-200">
                    {ACTION_INFO[a].label}
                    {changed && <span className="text-amber-300" title={`shipped: ${shipped}`}> •</span>}
                  </div>
                  <div className="text-[10px] text-zinc-500 leading-snug">{rare ? `rarely used for ${NATURE_LABEL[nature].toLowerCase()} · ` : ''}{ACTION_INFO[a].help}</div>
                </div>
                <ModelPicker className="flex-1" value={current.tables[nature][a]} onChange={(v) => setCell(nature, a, v)} known={known} showAll={showAll} />
              </div>
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

