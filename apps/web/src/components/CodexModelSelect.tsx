import { useState } from 'react';
import type { ModelRecordView } from '../api.ts';
import { Input, Select, cn } from '../ui.tsx';

/** Local catalog plus an escape hatch for a model released since the last sync. */
export function CodexModelSelect({ value, onChange, known, label = 'Codex model', defaultLabel = 'Default model · from Settings', disabled, className }: { value: string; onChange: (value: string) => void; known: ModelRecordView[] | null; label?: string; defaultLabel?: string; disabled?: boolean; className?: string }) {
  const [custom, setCustom] = useState(false);
  const models = (known ?? []).filter((m) => m.name !== 'codex-default');
  const listed = value === 'codex-default' || models.some((m) => m.name === value);
  return (
    <div className={cn('min-w-0 space-y-1', className)}>
      <Select aria-label={label} className="text-xs" disabled={disabled} value={custom || !listed ? '__custom' : value} onChange={(e) => {
        if (e.target.value === '__custom') setCustom(true);
        else { setCustom(false); onChange(e.target.value); }
      }}>
        <option value="codex-default">{defaultLabel}</option>
        {models.map((m) => <option key={m.name} value={m.name}>{m.codex?.displayName || m.label || m.name}{m.codex?.isDefault ? ' · catalog default' : ''}{m.codex?.available === false ? ' · not in current catalog' : ''}</option>)}
        <option value="__custom">Custom model ID…</option>
      </Select>
      {(custom || !listed) && <Input aria-label={`${label} custom ID`} className="mono text-xs" disabled={disabled} value={value} placeholder="Enter an exact Codex model ID" onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}
