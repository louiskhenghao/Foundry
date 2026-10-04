import { z } from 'zod';
import { MODEL_ACTIONS, MODEL_NATURES } from './model-presets.ts';

export const CODEX_MODEL_ACTIONS = [...MODEL_ACTIONS, 'housekeeping'] as const;
export type CodexModelAction = (typeof CODEX_MODEL_ACTIONS)[number];
export const CodexEffort = z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
export type CodexEffort = z.infer<typeof CodexEffort>;
export const CodexModelChoice = z.object({ model: z.string().trim().min(1), effort: CodexEffort.nullable() });
export type CodexModelChoice = z.infer<typeof CodexModelChoice>;
export const CodexPresetTable = z.object(Object.fromEntries(CODEX_MODEL_ACTIONS.map((a) => [a, CodexModelChoice])) as Record<CodexModelAction, typeof CodexModelChoice>);
export const CodexModelPreset = z.object({
  label: z.string().trim().min(1), description: z.string().default(''), basedOn: z.string().nullable().default(null),
  tables: z.object({ code: CodexPresetTable, docs: CodexPresetTable, media: CodexPresetTable }),
});
export type CodexModelPreset = z.infer<typeof CodexModelPreset>;

function preset(label: string, description: string, effort: CodexEffort, overrides: Partial<Record<CodexModelAction, CodexEffort>> = {}): CodexModelPreset {
  return { label, description, basedOn: null, tables: Object.fromEntries(MODEL_NATURES.map((n) => [n, Object.fromEntries(CODEX_MODEL_ACTIONS.map((a) => [a, { model: 'codex-default', effort: overrides[a] ?? effort }]))])) as CodexModelPreset['tables'] };
}
/** Models follow the native CLI default; effort profiles make no pricing or entitlement promises. */
export const BUILTIN_CODEX_PRESETS: Record<string, CodexModelPreset> = {
  max: preset('Max', 'Extra-high reasoning across roles. Requires a model supporting xhigh.', 'xhigh'),
  production: preset('Production', 'High reasoning for most work, extra-high for planning, complex tasks and final review.', 'high', { planner: 'xhigh', complex: 'xhigh', goalReviewer: 'xhigh', simple: 'medium', feedback: 'medium', housekeeping: 'low' }),
  balanced: preset('Balanced', 'Medium reasoning for most work, high for planning, complex tasks and final review.', 'medium', { planner: 'high', complex: 'high', goalReviewer: 'high', housekeeping: 'low' }),
  economy: preset('Economy', 'Low reasoning across roles. Actual speed and usage depend on the selected model.', 'low'),
};
export function effectiveCodexPresets(saved: Record<string, CodexModelPreset>): Record<string, CodexModelPreset> { return { ...BUILTIN_CODEX_PRESETS, ...saved }; }
export function codexPresetFingerprint(p: Pick<CodexModelPreset, 'tables'>): string {
  return JSON.stringify(MODEL_NATURES.map((n) => CODEX_MODEL_ACTIONS.map((a) => p.tables[n][a])));
}
export function codexBuiltinStatus(id: string, saved: Record<string, CodexModelPreset>): { builtin: boolean; modified: boolean; newerDefault: boolean } {
  const shipped = BUILTIN_CODEX_PRESETS[id], own = saved[id];
  const modified = !!shipped && !!own && codexPresetFingerprint(own) !== codexPresetFingerprint(shipped);
  return { builtin: !!shipped, modified, newerDefault: modified && own!.basedOn != null && own!.basedOn !== codexPresetFingerprint(shipped!) };
}
