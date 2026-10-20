import type { ScheduleCadence } from '@foundry/core/browser';
import { cadenceLabel } from '@foundry/core/browser';
import { useState } from 'react';
import { WEEKDAY_OPTIONS, defaultCadence } from '../pages/new-goal-schedule.ts';
import { Button, Field, Input, Modal, Select, focusFirst } from '../ui.tsx';

export interface ScheduleMeta {
  name: string;
  cadence: ScheduleCadence;
  autoApprove: boolean;
}

/**
 * "Schedule…" on the New goal form (ADR-0054): the name, when it fires, and whether the engine approves each run's Brief
 * itself. The goal's own fields stay on the form behind it; saving keeps them as the schedule's recipe.
 */
export function ScheduleDialog({ open, ...props }: { open: boolean; initial: ScheduleMeta; editing: boolean; busy: boolean; error: string | null; onClose: () => void; onSave: (meta: ScheduleMeta) => void }) {
  // the form mounts fresh each time the dialog opens, so it starts from what the page knows then (a schedule loaded after the page did, a title typed since)
  return open ? <ScheduleForm {...props} /> : null;
}

function ScheduleForm({ initial, editing, busy, error, onClose, onSave }: { initial: ScheduleMeta; editing: boolean; busy: boolean; error: string | null; onClose: () => void; onSave: (meta: ScheduleMeta) => void }) {
  const [name, setName] = useState(initial.name);
  const [cadence, setCadence] = useState<ScheduleCadence>(initial.cadence);
  const [autoApprove, setAutoApprove] = useState(initial.autoApprove);
  const setKind = (kind: ScheduleCadence['kind']) => setCadence(kind === 'daily' ? { kind, at: cadence.at } : kind === 'weekly' ? { kind, weekday: 1, at: cadence.at } : { kind, day: 1, at: cadence.at });
  return (
    <Modal open title={editing ? 'Edit schedule' : 'Schedule this goal'} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSave({ name: name.trim(), cadence, autoApprove });
        }}
      >
        <Field label="Name" help="Each run is a goal titled after it, with the day it ran.">
          <Input autoFocus={focusFirst} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Weekly dependency upgrade" />
        </Field>
        <Field label="When" help={`Runs ${cadenceLabel(cadence)}, on this computer's clock. A run Foundry missed while it was off fires once when it is back.`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-40">
              <Select value={cadence.kind} onChange={(e) => setKind(e.target.value as ScheduleCadence['kind'])}>
                <option value="daily">every day</option>
                <option value="weekly">every week</option>
                <option value="monthly">every month</option>
              </Select>
            </span>
            {cadence.kind === 'weekly' && (
              <span className="w-36">
                <Select value={String(cadence.weekday)} onChange={(e) => setCadence({ ...cadence, weekday: Number(e.target.value) })} aria-label="Weekday">
                  {WEEKDAY_OPTIONS.map((d) => (
                    <option key={d.id} value={d.id}>
                      on {d.label}
                    </option>
                  ))}
                </Select>
              </span>
            )}
            {cadence.kind === 'monthly' && (
              <span className="w-32">
                <Select value={String(cadence.day)} onChange={(e) => setCadence({ ...cadence, day: Number(e.target.value) })} aria-label="Day of the month">
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      on day {d}
                    </option>
                  ))}
                </Select>
              </span>
            )}
            <span className="flex items-center gap-1.5 text-xs text-zinc-400">
              at <Input type="time" className="w-28" value={cadence.at} onChange={(e) => e.target.value && setCadence({ ...cadence, at: e.target.value })} aria-label="Time" />
            </span>
          </div>
        </Field>
        <label className="flex items-start gap-2 text-xs text-zinc-300 cursor-pointer">
          <input type="checkbox" className="mt-0.5 accent-emerald-500" checked={autoApprove} onChange={(e) => setAutoApprove(e.target.checked)} />
          <span>
            Approve each run's Brief for me
            <span className="block text-[11px] text-zinc-500">The interview is skipped and the engine approves the Brief itself, with the budget the Brief proposes when the budget is Auto; milestones do not pause. Off: the Brief waits for you like any goal's. A Brief with a question only you can answer waits either way.</span>
          </span>
        </label>
        {error && <p className="text-xs text-rose-300">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : editing ? 'Save schedule' : 'Save schedule'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
