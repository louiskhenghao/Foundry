import { MODEL_NATURES, NATURE_LABEL, type ModelNature } from '@foundry/core/browser';
import { Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge, Button, Field, Input, Select, cn } from '../../ui.tsx';

/**
 * The building blocks both coding agents' Models panels share, so they read the same: a sync row, one card per goal
 * type, the preset editor (preset chips, name and description, nature tabs, one row per role) and the Other models
 * block. Presentational only — each panel keeps its own state, settings keys and API calls.
 */

export const NATURE_HINT: Record<ModelNature, string> = { code: 'software goals, and goals not yet classified', docs: 'documents and cited research reports', media: 'image and video goals' };

export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('text-sm text-zinc-200', className)}>{children}</div>;
}

/** "Sync models", what the last sync found, an optional control on the right and the result of the last run. */
export function SyncRow({ syncing, onSync, title, status, aside, help, message }: { syncing: boolean; onSync: () => void; title?: string; status: string; aside?: ReactNode; help?: ReactNode; message?: string | null }) {
  return (
    <div className="flex items-center gap-2 flex-wrap text-xs text-zinc-400">
      <Button size="sm" onClick={onSync} disabled={syncing} title={title}>
        <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Syncing…' : 'Sync models'}
      </Button>
      <span>{status}</span>
      {aside && <span className="ml-auto">{aside}</span>}
      {help && <p className="w-full text-[11px] text-zinc-500">{help}</p>}
      {message && <p role="status" className="w-full text-[11px] text-zinc-500">{message}</p>}
    </div>
  );
}

export type PresetOption = { id: string; label: string; modified: boolean };
export type RoleSummary = { role: string; label: string; value: string; rare?: boolean };

/** "Preset per goal type": per nature, the preset it uses, what that kind of goal is, every role's model and Edit preset. */
export function GoalTypePresets({ picks, options, onPick, summary, onEdit, selectLabel, summaryColumns = 'grid-cols-2 sm:grid-cols-4' }: { picks: Record<ModelNature, string>; options: PresetOption[]; onPick: (nature: ModelNature, id: string) => void; summary: (nature: ModelNature) => RoleSummary[]; onEdit: (nature: ModelNature) => void; selectLabel?: (nature: ModelNature) => string; summaryColumns?: string }) {
  return (
    <div className="space-y-3">
      <SectionTitle>Preset per goal type</SectionTitle>
      {MODEL_NATURES.map((n) => (
        <div key={n} className="rounded border border-zinc-800 p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-zinc-100 text-sm w-40">{NATURE_LABEL[n]}</span>
            <span className="w-48">
              <Select className="text-xs py-1" aria-label={selectLabel?.(n) ?? `${NATURE_LABEL[n]} preset`} value={picks[n]} onChange={(e) => onPick(n, e.target.value)}>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                    {o.modified ? ' (modified)' : ''}
                  </option>
                ))}
              </Select>
            </span>
            <span className="text-[11px] text-zinc-500">{NATURE_HINT[n]}</span>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onEdit(n)}>
              Edit preset
            </Button>
          </div>
          <div className={cn('grid gap-x-4 gap-y-0.5 text-[11px]', summaryColumns)}>
            {summary(n).map((r) => (
              <div key={r.role} className={cn('flex justify-between gap-2 min-w-0', r.rare && 'opacity-40')}>
                <span className="text-zinc-500 truncate">{r.label}</span>
                <span className="mono text-zinc-300 truncate" title={r.value}>{r.value}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The editor's first line: "Presets", one chip per preset (a dot marks an edited built-in) and New from this. */
export function PresetChips({ options, editing, onSelect, onNew }: { options: PresetOption[]; editing: string; onSelect: (id: string) => void; onNew: () => void }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <SectionTitle className="mr-2">Presets</SectionTitle>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={editing === o.id} onClick={() => onSelect(o.id)} className={cn('rounded-full border px-2.5 py-0.5 text-xs', editing === o.id ? 'border-emerald-500 bg-emerald-500/10 text-emerald-200' : 'border-zinc-700 text-zinc-300 hover:border-zinc-500')}>
          {o.label}
          {o.modified ? ' •' : ''}
        </button>
      ))}
      <Button size="sm" variant="ghost" onClick={onNew} title="A new preset that starts as a copy of the one shown">
        <Plus size={12} /> New from this
      </Button>
    </div>
  );
}

/** Name and description as labelled fields (your presets) or as text (built-ins); Reset and Delete sit on the inputs' line. */
export function PresetDetails({ label, description, own, status, onLabel, onDescription, onReset, onDelete }: { label: string; description: string; own: boolean; status: { modified: boolean; newerDefault: boolean }; onLabel: (v: string) => void; onDescription: (v: string) => void; onReset: () => void; onDelete: () => void }) {
  return (
    <div className="flex items-end gap-3 flex-wrap">
      {own ? (
        <>
          <Field label="Name" className="w-full sm:w-56">
            <Input value={label} onChange={(e) => onLabel(e.target.value)} />
          </Field>
          <Field label="Description" className="flex-1 min-w-[12rem]">
            <Input value={description} placeholder="what this preset is for" onChange={(e) => onDescription(e.target.value)} />
          </Field>
        </>
      ) : (
        <div className="flex-1 min-w-[12rem] space-y-1">
          <div className="text-zinc-100 text-sm flex items-center gap-2 flex-wrap">
            {label} {status.modified && <Badge state="blocked">modified</Badge>} {status.newerDefault && <Badge state="awaiting_brief_approval">newer default available</Badge>}
          </div>
          <p className="text-xs text-zinc-400">{description}</p>
        </div>
      )}
      {(status.modified || own) && (
        <div className="flex items-center gap-2 shrink-0">
          {status.modified && (
            <Button size="sm" variant="ghost" onClick={onReset} title="Restore the values Foundry ships for this preset">
              <RotateCcw size={12} /> Reset
            </Button>
          )}
          {own && (
            // the height of an input, so it lines up with the fields beside it
            <Button size="sm" variant="danger" className="h-[34px]" onClick={onDelete}>
              <Trash2 size={12} /> Delete
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export function NatureTabs({ value, onChange }: { value: ModelNature; onChange: (n: ModelNature) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {MODEL_NATURES.map((n) => (
        <button key={n} type="button" aria-pressed={value === n} onClick={() => onChange(n)} className={cn('rounded px-2.5 py-1 text-xs border', value === n ? 'border-zinc-500 bg-zinc-800 text-zinc-100' : 'border-transparent text-zinc-400 hover:text-zinc-200')}>
          {NATURE_LABEL[n]}
        </button>
      ))}
    </div>
  );
}

/** One role of the preset shown: its name and what it does on the left, its controls on the right. */
export function RoleRow({ label, help, nature, rare, shipped, children }: { label: string; help: string; nature: ModelNature; rare?: boolean; shipped?: string | null; children: ReactNode }) {
  return (
    <div className={cn('flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-2', rare && 'opacity-50')}>
      <div className="sm:w-40 shrink-0 sm:pt-1">
        <div className="text-xs text-zinc-200">
          {label}
          {shipped != null && <span className="text-amber-300" title={`shipped: ${shipped}`}> •</span>}
        </div>
        <div className="text-[10px] text-zinc-500 leading-snug">{rare ? `rarely used for ${NATURE_LABEL[nature].toLowerCase()} · ` : ''}{help}</div>
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

/** A labelled block shaped like a Field, for a control group that must not sit inside one <label> (an ordered list). */
export function FieldGroup({ label, help, children, className }: { label: ReactNode; help?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div role="group" aria-label={typeof label === 'string' ? label : undefined} className={cn('min-w-0', className)}>
      <span className="block text-xs text-zinc-300 mb-1">{label}</span>
      {children}
      {help && <span className="block text-[11px] text-zinc-500 mt-1 leading-snug">{help}</span>}
    </div>
  );
}
