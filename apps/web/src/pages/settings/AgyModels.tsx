import { useEffect, useState } from 'react';
import { api, type ModelRecordView } from '../../api.ts';
import { Field, Input, Select } from '../../ui.tsx';
import { CliUpdateNote, SyncRow } from './PresetParts.tsx';

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

/** Antigravity's one model and effort for every role, picked from what `agy models` lists (Sync models runs no model). */
export function AgyModelsSection({ model, effort, writer = null, onModel, onEffort, onWriter }: { model: string; effort: string; /** the Write with AI model; null = the Antigravity model */ writer?: string | null; onModel: (value: string) => void; onEffort: (value: string) => void; onWriter?: (value: string | null) => void }) {
  const [known, setKnown] = useState<ModelRecordView[] | null>(null);
  const [sync, setSync] = useState<{ at: string | null; found: number } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);
  const load = () => api.models('agy').then((r) => { setKnown(r.models); setSync(r.sync); }).catch(() => setKnown([]));
  useEffect(() => { void load(); }, []);
  const runSync = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const r = await api.syncModels('agy');
      await load();
      setMessage(`Found ${r.found} model${r.found === 1 ? '' : 's'} with agy models. Sync did not run a model.`);
    } catch (e: any) { setMessage(`Sync failed: ${e.message}`); }
    finally { setSyncing(false); }
  };
  const models = known ?? [];
  // while the list loads, the saved model counts as listed: no custom box flashes up
  const listed = !known || models.some((m) => m.name === model);
  return (
    <div className="space-y-4">
      <SyncRow syncing={syncing} onSync={runSync} title="Lists the account's models with agy models; runs no model" status={sync?.at ? `${models.length} models known · last sync ${new Date(sync.at).toLocaleString()}` : 'not synced yet: only Antigravity default is known'} message={message} />
      <CliUpdateNote provider="agy" onUpdated={() => void load()} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Antigravity model" help="Every role of a new Antigravity goal runs on this model. Antigravity default follows the model agy itself is set to.">
          <div className="min-w-0 space-y-1">
            <Select aria-label="Antigravity model" value={custom || !listed ? '__custom' : model} onChange={(e) => {
              if (e.target.value === '__custom') setCustom(true);
              else { setCustom(false); onModel(e.target.value); }
            }}>
              {!known && <option value={model}>{model}</option>}
              {models.map((m) => <option key={m.name} value={m.name}>{m.label ? `${m.label} · ${m.name}` : m.name}</option>)}
              <option value="__custom">Custom model slug…</option>
            </Select>
            {(custom || !listed) && <Input aria-label="Antigravity model slug" className="mono text-xs" value={model} placeholder="an exact slug from agy models" onChange={(e) => onModel(e.target.value)} />}
          </div>
        </Field>
        <Field label="Reasoning effort" help="The Antigravity reasoning effort of every role.">
          <Select aria-label="Antigravity reasoning effort" value={effort} onChange={(e) => onEffort(e.target.value)}>{EFFORTS.map((e) => <option key={e} value={e}>{e}</option>)}</Select>
        </Field>
        {onWriter && (
          <Field label="Write with AI" help="The model Write it with AI and Fill in with AI run on, on the New goal form and Templates. The first choice keeps the Antigravity model above." setting="models.agyWriter">
            <Select aria-label="Write with AI model" value={writer ?? ''} onChange={(e) => onWriter(e.target.value || null)}>
              <option value="">Same as the Antigravity model</option>
              {writer && !models.some((m) => m.name === writer) && <option value={writer}>{writer}</option>}
              {models.map((m) => <option key={m.name} value={m.name}>{m.label ? `${m.label} · ${m.name}` : m.name}</option>)}
            </Select>
          </Field>
        )}
      </div>
    </div>
  );
}
