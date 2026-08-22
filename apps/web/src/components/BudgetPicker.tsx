import type { BudgetPreset, Budgets } from "@ai-engine/core/browser";
import { BUDGET_PRESETS } from "@ai-engine/core/browser";
import { Input, cn } from "../ui.tsx";

export const PRESET_ORDER: BudgetPreset[] = [
  "auto",
  "quick",
  "thorough",
  "unlimited",
  "custom"
];

export interface BudgetDraft {
  preset: BudgetPreset;
  budgets: Budgets;
}

/** Preset tiles + the four limits (editable under Custom, read-only summary otherwise). */
export function BudgetPicker({
  value,
  onChange
}: {
  value: BudgetDraft;
  onChange: (v: BudgetDraft) => void;
}) {
  const b = value.budgets;
  const setField = (k: keyof Budgets, raw: string) => {
    const n = raw === "" ? null : Number(raw);
    const next: Budgets = {
      ...b,
      [k]:
        k === "maxConcurrent" || k === "attemptsPerTask"
          ? Math.max(1, Math.floor(n ?? 1))
          : n != null && n > 0
            ? n
            : null
    } as Budgets;
    onChange({ preset: "custom", budgets: next });
  };
  const invalid =
    (b.maxCostUsd != null && b.maxCostUsd <= 0) ||
    (b.maxDurationMin != null && b.maxDurationMin <= 0);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {PRESET_ORDER.map((p) => {
          const def = BUDGET_PRESETS[p];
          const on = value.preset === p;
          return (
            <button
              key={p}
              type="button"
              onClick={() =>
                onChange({
                  preset: p,
                  budgets: p === "custom" ? b : def.budgets
                })
              }
              className={cn(
                "text-left rounded-md border p-2.5 min-h-[84px] h-full flex flex-col items-start justify-start",
                on
                  ? "border-emerald-500 bg-emerald-500/5"
                  : "border-zinc-800 hover:border-zinc-600"
              )}
            >
              <div className="text-sm text-zinc-100 flex items-center gap-1.5">
                {def.label}
                {p === "auto" && (
                  <span className="text-[9px] uppercase rounded bg-emerald-500/15 text-emerald-300 px-1">
                    default
                  </span>
                )}
              </div>
              <div className="text-[11px] text-zinc-500 mt-0.5 leading-snug">
                {def.blurb}
              </div>
            </button>
          );
        })}
      </div>
      {value.preset === "custom" ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Max cost (USD est.)" hint="blank = no limit">
            <Input
              type="number"
              min={0.5}
              step={0.5}
              value={b.maxCostUsd ?? ""}
              placeholder="∞"
              onChange={(e) => setField("maxCostUsd", e.target.value)}
            />
          </Field>
          <Field label="Max minutes" hint="blank = no limit">
            <Input
              type="number"
              min={5}
              step={5}
              value={b.maxDurationMin ?? ""}
              placeholder="∞"
              onChange={(e) => setField("maxDurationMin", e.target.value)}
            />
          </Field>
          <Field label="Parallel sessions">
            <Input
              type="number"
              min={1}
              max={8}
              step={1}
              value={b.maxConcurrent}
              onChange={(e) => setField("maxConcurrent", e.target.value)}
            />
          </Field>
          <Field label="Attempts per task">
            <Input
              type="number"
              min={1}
              max={10}
              step={1}
              value={b.attemptsPerTask}
              onChange={(e) => setField("attemptsPerTask", e.target.value)}
            />
          </Field>
        </div>
      ) : (
        <div className="text-xs text-zinc-400 flex flex-wrap gap-x-4 gap-y-1">
          <span>
            cost{" "}
            <span className="text-zinc-200 mono">
              {b.maxCostUsd == null
                ? value.preset === "auto"
                  ? "from Brief"
                  : "no limit"
                : `$${b.maxCostUsd}`}
            </span>
          </span>
          <span>
            time{" "}
            <span className="text-zinc-200 mono">
              {b.maxDurationMin == null
                ? value.preset === "auto"
                  ? "from Brief"
                  : "no limit"
                : `${b.maxDurationMin} min`}
            </span>
          </span>
          <span>
            parallel{" "}
            <span className="text-zinc-200 mono">{b.maxConcurrent}</span>
          </span>
          <span>
            attempts/task{" "}
            <span className="text-zinc-200 mono">{b.attemptsPerTask}</span>
          </span>
          <button
            type="button"
            className="underline text-zinc-500 hover:text-zinc-300"
            onClick={() => onChange({ preset: "custom", budgets: b })}
          >
            customize
          </button>
        </div>
      )}
      {invalid && (
        <div className="text-xs text-rose-400">
          Limits must be positive (leave blank for no limit).
        </div>
      )}
      <p className="text-xs text-zinc-500">
        Exceeding a limit pauses the goal and asks you — it never fails
        silently. Rate limits pause the engine regardless of budget.
      </p>
    </div>
  );
}

function Field({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-xs text-zinc-400">
        {label} {hint && <span className="text-zinc-600">· {hint}</span>}
      </label>
      {children}
    </div>
  );
}
