import type { BudgetPreset, Budgets } from "@foundry/core/browser";
import { BUDGET_PRESETS } from "@foundry/core/browser";
import { Input, choiceClass, cn } from "../ui.tsx";

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
  costAvailable = true,
  onChange
}: {
  value: BudgetDraft;
  costAvailable?: boolean;
  onChange: (v: BudgetDraft) => void;
}) {
  const b = { ...value.budgets, ...(!costAvailable ? { maxCostUsd: null } : {}) };
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
                  budgets: { ...(p === "custom" ? b : def.budgets), ...(!costAvailable ? { maxCostUsd: null } : {}) }
                })
              }
              className={cn(
                "text-left rounded-lg border p-2.5 min-h-[84px] h-full flex flex-col items-start justify-start",
                choiceClass(on)
              )}
            >
              <div className="text-sm font-bold text-ink flex items-center gap-1.5">
                {def.label}
                {p === "auto" && (
                  // a quiet plate: which preset a new goal starts on is a fact, not a signal
                  <span className="rounded-sm px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.07em] text-ink-soft ring-1 ring-inset ring-line-strong">
                    default
                  </span>
                )}
              </div>
              <div className="text-xs text-ink-faint mt-1 leading-snug">
                {costAvailable ? def.blurb : ({ auto: 'The Brief proposes a time limit for your approval. Attempts and concurrency still apply.', quick: 'Small fix · 30 min · 2 parallel · 2 attempts per task.', thorough: 'Feature with review · 8 h · 3 parallel · 4 attempts per task.', unlimited: 'No time cap. Attempts and concurrency still apply.', custom: 'Set time, concurrency and attempts.' })[p]}
              </div>
            </button>
          );
        })}
      </div>
      {value.preset === "custom" ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {costAvailable && <Field label="Max cost (USD est.)" hint="blank = no limit">
            <Input
              type="number"
              min={0.5}
              step={0.5}
              value={b.maxCostUsd ?? ""}
              placeholder="∞"
              onChange={(e) => setField("maxCostUsd", e.target.value)}
            />
          </Field>}
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
        <div className="text-xs text-ink-faint flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {costAvailable && <span>
            cost{" "}
            <span className="mono font-semibold text-ink">
              {b.maxCostUsd == null
                ? value.preset === "auto"
                  ? "from Brief"
                  : "no limit"
                : `$${b.maxCostUsd}`}
            </span>
          </span>}
          <span>
            time{" "}
            <span className="mono font-semibold text-ink">
              {b.maxDurationMin == null
                ? value.preset === "auto"
                  ? "from Brief"
                  : "no limit"
                : `${b.maxDurationMin} min`}
            </span>
          </span>
          <span>
            parallel{" "}
            <span className="mono font-semibold text-ink">{b.maxConcurrent}</span>
          </span>
          <span>
            attempts/task{" "}
            <span className="mono font-semibold text-ink">{b.attemptsPerTask}</span>
          </span>
          <button
            type="button"
            className="underline text-ink-soft hover:text-ink"
            onClick={() => onChange({ preset: "custom", budgets: b })}
          >
            customize
          </button>
        </div>
      )}
      {!costAvailable && <p className="text-xs text-work-ink">This coding agent reports tokens, not dollar cost. USD budgets are unavailable.</p>}
      {invalid && (
        <div className="text-xs text-bad-ink">
          Limits must be positive (leave blank for no limit).
        </div>
      )}
      <p className="text-xs text-ink-faint">
        Exceeding a limit pauses the goal and asks you — it never fails
        silently. Rate limits pause the affected backend regardless of budget.
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
      <label className="block mb-1 text-xs font-semibold text-ink-soft">
        {label} {hint && <span className="font-normal text-ink-faint">· {hint}</span>}
      </label>
      {children}
    </div>
  );
}
