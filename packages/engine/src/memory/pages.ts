/**
 * The five knowledge pages Hindsight's own coding-agent integration keeps in a repository's bank — its names, questions
 * and tags, so a bank Foundry made reads the same as one the person's terminal made (ADR-0071). A page is a wiki-like
 * text the server rewrites from the bank's facts, and what `reflect` reads first. Each refreshes once an hour, at a
 * minute of its own.
 */
import type { KnowledgePageSpec } from './types.ts';

export const PAGE_MAX_TOKENS = 4096;

const TAXONOMY: { name: string; sourceQuery: string; tags: string[] }[] = [
  {
    name: 'Component map',
    sourceQuery: "From this project's commit history and past discussions, what are the main components/modules/subsystems, what is each responsible for, and how do they relate to or depend on one another? Describe the structure and responsibilities.",
    tags: ['knowledge:component'],
  },
  {
    name: 'Core concepts',
    sourceQuery: 'What are the core concepts, domain abstractions, and key entities in this project — the vocabulary a developer must understand? For each, explain what it represents and its role, drawn from how they are introduced and discussed across the history and conversations.',
    tags: ['knowledge:concept'],
  },
  {
    name: 'Conventions and patterns',
    sourceQuery: 'What conventions, idioms, and recurring patterns does this project follow — its approach to testing, error handling, naming, structure, and how changes are typically made? Describe how THIS project does things, as evidenced across its history and discussions.',
    tags: ['knowledge:convention'],
  },
  {
    name: 'Key decisions and rationale',
    sourceQuery: "What are the significant technical decisions made in this project and the rationale behind them — the durable 'why we do it this way' a developer should know? Summarize the decisions and their reasoning from the commit rationales and past conversations.",
    tags: ['knowledge:decision'],
  },
  {
    name: 'Initiatives and enhancements',
    sourceQuery: "Based on this repository's commit history, what are the major initiatives, features, and enhancements the project has worked on? Summarize the themes and notable changes over time. When a source memory's context carries a `[[page:<id>]]` link, repeat that link in the summary of what it describes, so each initiative links to its detailed page.",
    tags: ['knowledge:feature-work'],
  },
];

/** the names of the pages, as a bank's tree lists them */
export const PAGE_NAMES = TAXONOMY.map((p) => p.name);

/** the bank holds facts about the project's dependencies too: a page is about the project itself */
export function pageScope(project: string): string {
  return ` Scope this page to ${project} ITSELF: the bank also holds facts about external tools, libraries and services that ${project} merely uses, configures, deploys or discusses, and those belong to somebody else's codebase. Include something only when its subject is ${project}'s own code, configuration or process; when it is about a dependency, leave it out however well-evidenced it looks — including any commit SHA or identifier that belongs to that dependency's repository rather than this one.`;
}

/** a minute of the hour for this page of this bank, so the pages of many banks do not all refresh at once */
export function refreshMinute(bank: string, page: string): number {
  let h = 2166136261;
  for (const ch of `${bank}\0${page}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h % 60;
}

export function pagesFor(bank: string, project: string): KnowledgePageSpec[] {
  const scope = pageScope(project);
  return TAXONOMY.map((p) => ({
    name: p.name,
    sourceQuery: p.sourceQuery + scope,
    tags: p.tags,
    maxTokens: PAGE_MAX_TOKENS,
    trigger: { refreshCron: `${refreshMinute(bank, p.name)} * * * *`, factTypes: ['world', 'experience', 'observation'], tagsMatch: 'all' },
  }));
}
