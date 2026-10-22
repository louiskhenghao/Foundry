import type { ForecastSkill, ReleaseForecast, SuiteReleaseView } from '@foundry/engine/skills-types';

const ROLE: Record<ForecastSkill['rules'][number]['role'], string> = {
  clarifier: 'the Clarifier',
  planner: 'the planner',
  worker: 'workers',
  'reviewer-task': 'the task reviewer',
  'reviewer-goal': 'the Goal Reviewer',
  merger: 'the Merger',
  documenter: 'the Documenter',
  learnings: 'the Learnings session',
};

/** what Foundry's workflow does with a skill, in words: "workers must use it, the planner prefers it" */
export function usedBy(s: ForecastSkill): string | null {
  if (s.rules.length) return s.rules.map((r) => `${ROLE[r.role]} ${r.mandate === 'must' ? 'must use it' : r.role === 'worker' ? 'prefer it' : 'prefers it'}`).join(', ');
  return s.inCatalog ? "it is in Foundry's catalog" : null;
}

/** the skills a forecast removes that Foundry's workflow uses or installs: what a Move costs the goals */
export const workflowLosses = (f: ReleaseForecast | null): ForecastSkill[] => f?.removed.filter((s) => s.inCatalog) ?? [];

/** a release's state on its row: not installed, out of step with the release in use, behind the newest, or the newest */
export function releaseState(v: SuiteReleaseView): { badge: 'update-available' | 'up-to-date' | 'pending'; text: string } {
  if (!v.installed) return { badge: 'pending', text: 'not installed' };
  if (v.installed.ref !== v.ref) return { badge: 'update-available', text: v.installed.ref ? `re-sync to ${v.ref}` : 'not pinned' };
  if (v.forecast) return { badge: 'update-available', text: `${v.forecast.to} available` };
  return { badge: 'up-to-date', text: 'newest release' };
}

/** a forecast in one line: "+2 new · 1 removed (1 deprecated) · 9 stay" */
export function forecastLine(f: ReleaseForecast): string {
  const deprecated = f.removed.filter((s) => s.deprecated).length;
  const parts = [f.added.length ? `+${f.added.length} new` : null, f.removed.length ? `${f.removed.length} removed${deprecated ? ` (${deprecated} deprecated)` : ''}` : null, `${f.kept} stay`];
  return parts.filter(Boolean).join(' · ');
}

/** who holds the release in use: Foundry's pin, or the person's Move */
export const pinnedBy = (v: SuiteReleaseView): string => (v.chosenRef && v.chosenRef === v.ref ? `moved by you · Foundry pins ${v.catalogRef}` : 'pinned by Foundry');

export const INSTALLED_AS: Record<NonNullable<SuiteReleaseView['installed']>['as'], string> = { git: "Foundry's copies", plugin: 'Claude plugin', suite: "Foundry's suite copy" };
