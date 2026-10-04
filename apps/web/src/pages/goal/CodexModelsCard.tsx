import { ACTION_INFO, CODEX_MODEL_ACTIONS, MODEL_NATURES, NATURE_LABEL, natureKey, type Goal } from '@foundry/core/browser';
import { Card } from '../../ui.tsx';

type ModelGoal = Pick<Goal, 'provider' | 'nature' | 'modelPreset' | 'codexPreset' | 'codexFallbacks' | 'modelSubstitutions' | 'models' | 'effort'>;
const modelLabel = (model: string) => model === 'codex-default' ? 'CLI default model' : model;

/** Match the engine's bounded substitution lookup, retaining the path for the goal's audit view. */
function replacementPath(goal: ModelGoal, model: string): string[] {
  const path = [model];
  for (let i = 0; i < 4 && goal.modelSubstitutions[model]; i++) {
    model = goal.modelSubstitutions[model]!;
    path.push(model);
  }
  return path;
}

export function CodexModelsCard({ goal }: { goal: ModelGoal }) {
  if (goal.provider !== 'codex') return null;
  const preset = goal.codexPreset;
  const currentNature = natureKey(goal.nature);
  const legacyPath = replacementPath(goal, goal.models.worker);
  return (
    <Card title="Codex models">
      <div className="text-xs text-zinc-400 space-y-3">
        {preset ? <>
          <div>
            <span className="text-zinc-200 font-medium">{preset.label}</span>
            {goal.modelPreset && <span className="mono text-zinc-500"> · {goal.modelPreset}</span>}
            <p className="text-zinc-500 mt-1">Role assignments captured when this goal was created. Later Settings edits do not change this snapshot.</p>
            {preset.description && <p className="mt-1">{preset.description}</p>}
          </div>
          <p>Current table: <span className="text-zinc-200">{NATURE_LABEL[currentNature]}</span>{goal.nature === 'auto' && ' (until the goal’s nature is classified)'}.
            {goal.effort !== null && <> Goal-wide reasoning override: <span className="mono text-zinc-200">{goal.effort}</span>.</>}
          </p>
          {MODEL_NATURES.map((nature) => (
            <details key={`${nature}-${currentNature}`} open={nature === currentNature} className="rounded border border-zinc-800">
              <summary className="cursor-pointer px-3 py-2 text-zinc-300">{NATURE_LABEL[nature]}{nature === currentNature ? ' · current' : ' · saved table'}</summary>
              <div className="overflow-x-auto px-3 pb-3">
                <table className="w-full text-left text-[11px]">
                  <thead className="text-zinc-500"><tr><th className="py-1 pr-3 font-normal">Role</th><th className="py-1 pr-3 font-normal">Effective model</th><th className="py-1 font-normal">Reasoning</th></tr></thead>
                  <tbody>{CODEX_MODEL_ACTIONS.map((role) => {
                    const choice = preset.tables[nature][role];
                    const path = replacementPath(goal, choice.model);
                    return <tr key={role} className="border-t border-zinc-800/70 align-top">
                      <td className="py-1.5 pr-3">{role === 'housekeeping' ? 'Housekeeping' : ACTION_INFO[role].label}</td>
                      <td className="py-1.5 pr-3 mono text-zinc-200 break-all">
                        {modelLabel(path.at(-1)!)}
                        {path.length > 1 && <div className="text-zinc-500">{path.map(modelLabel).join(' → ')}</div>}
                      </td>
                      <td className="py-1.5 mono text-zinc-200">
                        {goal.effort ?? choice.effort ?? 'CLI default'}
                        {goal.effort !== null && <div className="text-zinc-500">saved: {choice.effort ?? 'CLI default'}</div>}
                      </td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
            </details>
          ))}
          <p className="text-[11px] text-zinc-500">Models include replacements recorded for this goal. “CLI default” follows the native Codex configuration. The Complex tasks row also applies to escalated final attempts and granted retries; small goal reviews can use the Task reviewer row.</p>
        </> : <>
          <div className="text-zinc-200">Legacy single-model goal</div>
          <p>No per-role preset was captured. Model: <span className="mono text-zinc-200">{modelLabel(legacyPath.at(-1)!)}</span>.</p>
          {legacyPath.length > 1 && <p className="mono break-all">{legacyPath.map(modelLabel).join(' → ')}</p>}
          {goal.models.cheap !== goal.models.worker && <p>Housekeeping: <span className="mono text-zinc-200">{modelLabel(goal.models.cheap)}</span>.</p>}
          <p>Reasoning: <span className="mono text-zinc-200">{goal.effort === 'max' ? 'xhigh (legacy max)' : goal.effort ?? 'CLI default'}</span>. Current per-role presets are not applied to this goal.</p>
        </>}
        <div className="border-t border-zinc-800 pt-2">
          Fallback order: <span className="mono text-zinc-300 break-all">{goal.codexFallbacks?.length ? goal.codexFallbacks.map(modelLabel).join(' → ') : 'None'}</span>
          <p className="text-[11px] text-zinc-500 mt-1">{preset ? 'Captured for this goal. Tried in order only when a model is unavailable before producing work.' : 'Legacy goals without a captured fallback list do not try additional models.'}</p>
        </div>
      </div>
    </Card>
  );
}
