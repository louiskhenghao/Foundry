/**
 * The `# Workflow skills` prompt section: which installed skills a role MUST / should invoke for this
 * kind of work and scenario, with the invoke name that is actually loaded on this machine (plugin copy first).
 * Replaces the one-line hint when the workflow profile is `mattpocock`; falls back to it otherwise.
 */
import type { Task, TaskKind, TaskScenario } from '@ai-engine/core';
import { SATISFIED } from './catalog.ts';
import { formatSkillsHint } from './hints.ts';
import { packAllows } from './packs.ts';
import type { CatalogEntryStatus, SkillRole, WorkflowRule } from './types.ts';

export interface WorkflowSectionInput {
  role: SkillRole;
  /** worker tasks carry a kind; other roles pass undefined (= any) */
  taskKind?: TaskKind;
  /** the task's (or goal's dominant) scenario; undefined = general */
  scenario?: TaskScenario;
  profile: 'mattpocock' | 'plain';
  statuses: CatalogEntryStatus[];
  /** chosen option per mutually exclusive pack, e.g. { design: 'ui-ux-pro-max' } */
  packs?: Record<string, string | undefined>;
  /** project skills installed by autoskills for this goal's repository */
  projectSkills?: string[];
}

export interface MandatedSkill {
  /** catalog name, e.g. tdd */
  name: string;
  /** invoke as loaded on this machine, e.g. /mattpocock-skills:tdd */
  invoke: string;
  mandate: WorkflowRule['mandate'];
  instruction: string;
}

const NEVER_RUN = ['/setup-matt-pocock-skills', '/to-spec', '/to-tickets', '/triage', '/implement', '/wayfinder'];

/** Entries a session may see at all: installed, and not a member of an unchosen pack. */
export function visibleStatuses(i: Pick<WorkflowSectionInput, 'statuses' | 'packs'>): CatalogEntryStatus[] {
  return i.statuses.filter((s) => SATISFIED.includes(s.status) && packAllows(s.entry, i.packs ?? {}));
}

const scenarioOk = (wanted: readonly string[], scenario: TaskScenario | undefined) => !wanted.length || wanted.includes(scenario ?? 'general');

/** Rules of installed catalog entries that apply to this role, task kind and scenario, with the invoke to use. */
export function applicableRules(i: WorkflowSectionInput): MandatedSkill[] {
  const out: MandatedSkill[] = [];
  for (const s of visibleStatuses(i)) {
    const invoke = s.entry.invoke ?? s.installedInvoke ?? `/${s.entry.name}`;
    for (const r of s.entry.workflow) {
      if (r.role !== i.role) continue;
      if (r.when !== 'any' && i.taskKind && r.when !== i.taskKind) continue;
      if (r.when !== 'any' && !i.taskKind && i.role === 'worker') continue; // unknown kind: only `any` rules
      if (!scenarioOk(r.scenarios, i.scenario)) continue;
      out.push({ name: s.entry.name, invoke, mandate: r.mandate, instruction: r.instruction });
    }
  }
  // must before prefer, stable otherwise
  return out.sort((a, b) => Number(b.mandate === 'must') - Number(a.mandate === 'must'));
}

export function mandatedSkillsFor(i: WorkflowSectionInput): MandatedSkill[] {
  return applicableRules(i).filter((r) => r.mandate === 'must');
}

/** The scenario most of a goal's tasks work in (ties → the first seen); 'general' when there are none. */
export function goalScenario(tasks: Pick<Task, 'scenario' | 'origin'>[]): TaskScenario {
  const counts = new Map<TaskScenario, number>();
  for (const t of tasks) {
    if (t.origin === 'merge') continue;
    counts.set(t.scenario, (counts.get(t.scenario) ?? 0) + 1);
  }
  let best: TaskScenario = 'general';
  let n = 0;
  for (const [s, c] of counts) {
    if (c > n) {
      best = s;
      n = c;
    }
  }
  return best;
}

/** Full prompt section (with its own heading), or null when there is nothing to say. */
export function formatWorkflowSection(i: WorkflowSectionInput): string | null {
  const visible = visibleStatuses(i);
  const hint = formatSkillsHint(i.role, visible);
  if (i.profile === 'plain') return hint ? `# Skills\n${hint}` : null;
  const rules = applicableRules(i);
  const ruleNames = new Set(rules.map((r) => r.invoke));
  const others = visible
    .filter((s) => s.entry.roles.includes(i.role) && scenarioOk(s.entry.scenarios, i.scenario))
    .map((s) => s.entry.invoke ?? s.installedInvoke ?? `/${s.entry.name}`)
    .filter((inv) => !ruleNames.has(inv))
    .slice(0, 8);
  const project = i.projectSkills ?? [];
  if (!rules.length && !others.length && !project.length) return null;
  const lines: string[] = ['# Workflow skills'];
  if (i.scenario && i.scenario !== 'general') lines.push(`Scenario: ${i.scenario}.`);
  if (rules.length) {
    lines.push("This engine follows Matt Pocock's engineering workflow. The skills below are loaded in this session; invoke them with the Skill tool.");
    for (const r of rules) lines.push(`- ${r.mandate === 'must' ? 'MUST' : 'Prefer'}: invoke \`${r.invoke}\` — ${r.instruction}`);
    lines.push(`- Do NOT run ${NEVER_RUN.join(', ')}: ai-engine is the tracker and has already done that work. Never write docs/agents/*.`);
    lines.push('- The engine records which skills you invoked; the reviewer sees it.');
  }
  if (others.length) lines.push(`${rules.length ? 'Other installed' : 'Installed'} skills relevant to this role (use when appropriate): ${others.join(', ')}`);
  if (project.length) lines.push(`Project skills installed for this repository's stack (in .claude/skills, loaded in this session): ${project.map((s) => `/${s}`).join(', ')} — use them for the frameworks and libraries they cover.`);
  return lines.join('\n');
}
