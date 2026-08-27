import { describe, expect, test } from 'bun:test';
import { CatalogEntry, type CatalogEntryStatus } from './types.ts';
import { applicableRules, formatWorkflowSection, goalScenario, mandatedSkillsFor } from './workflow.ts';
import { formatWorkflowObservation, usedSkill } from '../checks/reviewer.ts';
import { summarizeReport } from '../attempt-prompt.ts';

const entry = (o: Partial<CatalogEntry> & { id: string }) => CatalogEntry.parse({ name: o.id, summary: 's', why: 'w', tier: 'recommended', source: { type: 'git', repo: 'mattpocock/skills' }, roles: [], ...o });
const st = (e: CatalogEntry, status: CatalogEntryStatus['status'], installedInvoke: string | null): CatalogEntryStatus => ({ entry: e, status, installedInvoke, commit: null, detail: '', manual: null, missingEnv: [] });

const statuses: CatalogEntryStatus[] = [
  st(entry({ id: 'tdd', roles: ['worker'], workflow: [{ role: 'worker', mandate: 'must', when: 'feature', scenarios: [], instruction: 'tests first' }, { role: 'worker', mandate: 'must', when: 'refactor', scenarios: [], instruction: 'pin behaviour' }] }), 'installed-via-plugin', '/mattpocock-skills:tdd'),
  st(entry({ id: 'diagnosing-bugs', roles: ['worker'], workflow: [{ role: 'worker', mandate: 'must', when: 'bug', scenarios: [], instruction: 'reproduce first' }] }), 'installed', '/diagnosing-bugs'),
  st(entry({ id: 'codebase-design', roles: ['worker', 'planner'], workflow: [{ role: 'worker', mandate: 'prefer', when: 'feature', scenarios: [], instruction: 'deep modules' }] }), 'installed', '/codebase-design'),
  st(entry({ id: 'webapp-testing', roles: ['worker'] }), 'installed', '/webapp-testing'),
  st(entry({ id: 'resolving-merge-conflicts', roles: ['merger'], workflow: [{ role: 'merger', mandate: 'must', when: 'any', scenarios: [], instruction: 'hunk by hunk' }] }), 'missing', null),
];

describe('workflow section', () => {
  test('worker/feature: MUST tdd (plugin invoke), prefer codebase-design, other installed listed, never-run line', () => {
    const s = formatWorkflowSection({ role: 'worker', taskKind: 'feature', profile: 'mattpocock', statuses })!;
    expect(s.startsWith('# Workflow skills')).toBe(true);
    expect(s).toContain('- MUST: invoke `/mattpocock-skills:tdd` — tests first');
    expect(s).toContain('- Prefer: invoke `/codebase-design`');
    expect(s).not.toContain('MUST: invoke `/diagnosing-bugs`');
    expect(s).toContain('Other installed skills relevant to this role (use when appropriate):');
    expect(s).toContain('/webapp-testing');
    expect(s).toContain('Do NOT run /setup-matt-pocock-skills');
  });
  test('a mandated skill with missing requiresEnv gets the degraded-mode warning', () => {
    const img = st(entry({ id: 'gpt-image-2', roles: ['worker'], requiresEnv: ['OPENAI_API_KEY'], workflow: [{ role: 'worker', mandate: 'must', when: 'any', scenarios: ['image'], instruction: 'generate' }] }), 'installed', '/gpt-image-2');
    const degraded = { ...img, missingEnv: ['OPENAI_API_KEY'] };
    const s = formatWorkflowSection({ role: 'worker', scenario: 'image', profile: 'mattpocock', statuses: [degraded] })!;
    expect(s).toContain('MUST: invoke `/gpt-image-2` — generate ⚠ OPENAI_API_KEY is NOT set');
    const ok = formatWorkflowSection({ role: 'worker', scenario: 'image', profile: 'mattpocock', statuses: [img] })!;
    expect(ok).toContain('MUST: invoke `/gpt-image-2` — generate');
    expect(ok).not.toContain('⚠');
  });
  test('worker/bug mandates diagnosing-bugs, not tdd', () => {
    const m = mandatedSkillsFor({ role: 'worker', taskKind: 'bug', profile: 'mattpocock', statuses });
    expect(m.map((x) => x.name)).toEqual(['diagnosing-bugs']);
  });
  test('missing skills never appear; roles without rules get only the hint', () => {
    expect(formatWorkflowSection({ role: 'merger', profile: 'mattpocock', statuses })).toBeNull();
    expect(applicableRules({ role: 'planner', profile: 'mattpocock', statuses })).toEqual([]);
    expect(formatWorkflowSection({ role: 'planner', profile: 'mattpocock', statuses })).toBe('# Workflow skills\nInstalled skills relevant to this role (use when appropriate): /codebase-design');
  });
  test('plain profile falls back to the one-line hint', () => {
    const s = formatWorkflowSection({ role: 'worker', taskKind: 'feature', profile: 'plain', statuses })!;
    expect(s.startsWith('# Skills\nInstalled skills relevant to this role')).toBe(true);
    expect(s).not.toContain('MUST');
  });
});

describe('scenarios and packs', () => {
  const design: CatalogEntryStatus[] = [
    st(entry({ id: 'ui-ux-pro-max', roles: ['worker', 'reviewer-goal'], invoke: '/ui-ux-pro-max:ui-ux-pro-max', pack: 'design', packOption: 'ui-ux-pro-max', scenarios: ['frontend', 'fullstack'], workflow: [{ role: 'worker', mandate: 'must', when: 'any', scenarios: ['frontend', 'fullstack'], instruction: 'style first' }, { role: 'reviewer-goal', mandate: 'prefer', when: 'any', scenarios: ['frontend'], instruction: 'check ux' }] }), 'installed-via-plugin', '/ui-ux-pro-max:ui-ux-pro-max'),
    st(entry({ id: 'impeccable', roles: ['worker'], pack: 'design', packOption: 'impeccable', scenarios: ['frontend'], workflow: [{ role: 'worker', mandate: 'must', when: 'any', scenarios: ['frontend'], instruction: 'craft' }] }), 'installed', '/impeccable'),
    st(entry({ id: 'web-video-presentation', roles: ['worker'], scenarios: ['docs'], workflow: [{ role: 'worker', mandate: 'prefer', when: 'any', scenarios: ['docs'], instruction: 'slides' }] }), 'installed', '/web-video-presentation'),
  ];
  const all = [...statuses, ...design];
  test('only the chosen design pack appears, and only for UI scenarios', () => {
    const ui = formatWorkflowSection({ role: 'worker', taskKind: 'feature', scenario: 'frontend', profile: 'mattpocock', statuses: all, packs: { design: 'ui-ux-pro-max' } })!;
    expect(ui).toContain('Scenario: frontend.');
    expect(ui).toContain('- MUST: invoke `/ui-ux-pro-max:ui-ux-pro-max` — style first');
    expect(ui).not.toContain('/impeccable');
    expect(ui).toContain('- MUST: invoke `/mattpocock-skills:tdd`');
    const api = formatWorkflowSection({ role: 'worker', taskKind: 'feature', scenario: 'backend', profile: 'mattpocock', statuses: all, packs: { design: 'ui-ux-pro-max' } })!;
    expect(api).not.toContain('ui-ux-pro-max');
    expect(api).toContain('Scenario: backend.');
    const other = formatWorkflowSection({ role: 'worker', taskKind: 'feature', scenario: 'frontend', profile: 'mattpocock', statuses: all, packs: { design: 'impeccable' } })!;
    expect(other).toContain('- MUST: invoke `/impeccable` — craft');
    expect(other).not.toContain('ui-ux-pro-max');
  });
  test('pack none / unknown scenario / tail filtering', () => {
    const none = formatWorkflowSection({ role: 'worker', taskKind: 'feature', scenario: 'frontend', profile: 'mattpocock', statuses: all, packs: { design: 'none' } })!;
    expect(none).not.toContain('ui-ux-pro-max');
    expect(none).not.toContain('impeccable');
    // no scenario = general: scenario-bound rules stay out, the docs-only entry is not listed in the tail
    const general = formatWorkflowSection({ role: 'worker', taskKind: 'feature', profile: 'mattpocock', statuses: all, packs: { design: 'ui-ux-pro-max' } })!;
    expect(general).not.toContain('ui-ux-pro-max');
    expect(general).not.toContain('/web-video-presentation');
    const docs = formatWorkflowSection({ role: 'worker', taskKind: 'chore', scenario: 'docs', profile: 'mattpocock', statuses: all, packs: {} })!;
    expect(docs).toContain('- Prefer: invoke `/web-video-presentation` — slides');
    expect(mandatedSkillsFor({ role: 'reviewer-goal', scenario: 'frontend', profile: 'mattpocock', statuses: all, packs: { design: 'ui-ux-pro-max' } })).toEqual([]);
    expect(applicableRules({ role: 'reviewer-goal', scenario: 'frontend', profile: 'mattpocock', statuses: all, packs: { design: 'ui-ux-pro-max' } }).map((r) => r.mandate)).toEqual(['prefer']);
  });
  test('project skills from autoskills are listed for the worker', () => {
    const s = formatWorkflowSection({ role: 'worker', taskKind: 'feature', profile: 'mattpocock', statuses: all, packs: {}, projectSkills: ['react', 'tailwind'] })!;
    expect(s).toContain('Project skills installed for this repository');
    expect(s).toContain('/react, /tailwind');
  });
  test('goalScenario picks the dominant task scenario, ignoring merge tasks', () => {
    expect(goalScenario([])).toBe('general');
    expect(goalScenario([{ scenario: 'frontend', origin: 'brief' }, { scenario: 'backend', origin: 'brief' }, { scenario: 'frontend', origin: 'goal-review-fix' }, { scenario: 'general', origin: 'merge' }])).toBe('frontend');
  });
});

describe('workflow observation', () => {
  test('usedSkill matches bare and plugin-qualified names', () => {
    expect(usedSkill(['mattpocock-skills:tdd'], 'tdd')).toBe(true);
    expect(usedSkill(['tdd'], 'tdd')).toBe(true);
    expect(usedSkill(['webapp-testing'], 'tdd')).toBe(false);
  });
  test('reviewer paragraph and report line say what was and was not invoked', () => {
    const w = { mandated: [{ name: 'tdd', invoke: '/mattpocock-skills:tdd' }], used: ['webapp-testing'] };
    const p = formatWorkflowObservation(w);
    expect(p).toContain('# Workflow');
    expect(p).toContain('/mattpocock-skills:tdd: NOT invoked');
    expect(p).toContain('not a blocker');
    const line = summarizeReport({ results: [], reviewerVerdict: null, changedFiles: [] }, [], w);
    expect(line).toContain('Workflow: /mattpocock-skills:tdd not invoked');
    expect(summarizeReport({ results: [], reviewerVerdict: null, changedFiles: [] }, [], { ...w, used: ['mattpocock-skills:tdd'] })).toContain('/mattpocock-skills:tdd ✓');
    expect(formatWorkflowObservation(null)).toBe('');
  });
});

describe('discipline', () => {
  const base = { role: 'worker' as const, taskKind: 'feature' as const, profile: 'mattpocock' as const, statuses };
  test('tdd off drops the tdd rule, preferred downgrades it, other rules untouched', () => {
    expect(mandatedSkillsFor({ ...base }).map((m) => m.name)).toEqual(['tdd']);
    expect(mandatedSkillsFor({ ...base, discipline: { tdd: 'required' } }).map((m) => m.name)).toEqual(['tdd']);
    expect(mandatedSkillsFor({ ...base, discipline: { tdd: 'preferred' } })).toEqual([]);
    expect(applicableRules({ ...base, discipline: { tdd: 'preferred' } }).map((r) => [r.name, r.mandate])).toEqual([
      ['tdd', 'prefer'],
      ['codebase-design', 'prefer'],
    ]);
    expect(applicableRules({ ...base, discipline: { tdd: 'off' } }).map((r) => r.name)).toEqual(['codebase-design']);
    const off = formatWorkflowSection({ ...base, discipline: { tdd: 'off' } })!;
    expect(off).not.toContain('/mattpocock-skills:tdd');
    const pref = formatWorkflowSection({ ...base, discipline: { tdd: 'preferred' } })!;
    expect(pref).toContain('Prefer: invoke `/mattpocock-skills:tdd`');
    // bug tasks are unaffected
    expect(mandatedSkillsFor({ ...base, taskKind: 'bug', discipline: { tdd: 'off' } }).map((m) => m.name)).toEqual(['diagnosing-bugs']);
  });
});
