/**
 * A folder's Learnings as a project skill the person's own sessions read (ADR-0050): written into the repository as
 * `.claude/skills/foundry-learnings/SKILL.md` (and `.agents/skills/…` for Codex), kept out of git through
 * `.git/info/exclude`, rewritten whenever the notebook changes and when a goal starts in the folder, removed with the
 * last entry or when the switch is off. Foundry's own sessions keep getting the notebook in their prompts: they run in
 * worktrees, where an excluded file does not exist.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Learning, LearningKind } from '@foundry/core';
import { LEARNINGS_EVERYWHERE, getRepoLearnings } from '@foundry/core';
import type { Engine } from './engine.ts';
import { everywhereLearnings, learningsOf } from './learnings.ts';
import { excludeFromGit } from './skills/autoskills.ts';

export const LEARNINGS_SKILL = 'foundry-learnings';
const DIRS = ['.claude/skills', '.agents/skills'] as const;
/** the line that marks the file as Foundry's: a skill of the same name the person wrote is never touched */
const MARK = 'Written by Foundry from the Learnings of this folder';

const SECTIONS: [LearningKind[], string][] = [
  [['build', 'test', 'run'], 'How to build, test and run it'],
  [['structure'], 'Where things live'],
  [['convention'], 'Conventions'],
  [['preference'], 'What the person prefers'],
  [['pitfall'], 'What goes wrong, and the way past it'],
];

/** the SKILL.md text: a reader-facing notebook, the person's entries marked ✎ */
export function renderLearningsSkill(ls: Learning[], updatedAt: string, everywhere: Learning[] = []): string {
  const groups = SECTIONS.map(([kinds, heading]) => [heading, ls.filter((l) => kinds.includes(l.kind))] as const).filter(([, g]) => g.length);
  // the person's standing wishes for every project come last, as a section of their own (ADR-0055)
  if (everywhere.length) groups.push(['What the person wants in every project', everywhere] as const);
  return [
    '---',
    `name: ${LEARNINGS_SKILL}`,
    "description: What Foundry learned about this repository from the goals it ran here — how to build, test and run it, where things live, its conventions, the person's preferences, what goes wrong. Read it before working in this repository.",
    '---',
    '',
    '# What Foundry learned about this repository',
    '',
    `${MARK} (${ls.length + everywhere.length} ${ls.length + everywhere.length === 1 ? 'entry' : 'entries'}, updated ${updatedAt.slice(0, 10)}). Edit them on Foundry's Learnings page, not here: this file is rewritten whenever they change and is kept out of git. Trust them unless the code says otherwise. An entry marked ✎ is the person's own.`,
    '',
    ...groups.flatMap(([heading, g]) => [`## ${heading}`, '', ...g.map((l) => `- ${l.by === 'human' ? '✎ ' : ''}${l.text}`), '']),
  ].join('\n');
}

/**
 * Write, rewrite or remove the folder's exported skill. Never throws: a folder the engine cannot write to, or that is
 * no repository, is logged and left alone.
 */
export async function exportLearningsSkill(engine: Engine, repoPath: string): Promise<'written' | 'removed' | 'unchanged' | 'skipped'> {
  try {
    // a repository has a .git entry (createGoal checked the folder is one); nothing is spawned to ask again
    if (!existsSync(join(repoPath, '.git'))) return 'skipped';
    const on = engine.settings.values().workflow.learningsSkill;
    const ls = on ? learningsOf(engine, repoPath) : [];
    const everywhere = on ? everywhereLearnings(engine) : [];
    const dirs = DIRS.map((d) => join(repoPath, d, LEARNINGS_SKILL));
    if (!ls.length && !everywhere.length) {
      let removed = false;
      for (const dir of dirs) {
        if (!ours(dir)) continue;
        rmSync(dir, { recursive: true, force: true });
        removed = true;
      }
      return removed ? 'removed' : 'unchanged';
    }
    const updated = [getRepoLearnings(engine.store.db, repoPath)?.updatedAt, getRepoLearnings(engine.store.db, LEARNINGS_EVERYWHERE)?.updatedAt].filter((x): x is string => !!x).sort().at(-1) ?? new Date().toISOString();
    const text = renderLearningsSkill(ls, updated, everywhere);
    const stale = dirs.filter((dir) => {
      const file = join(dir, 'SKILL.md');
      if (existsSync(file) && !ours(dir)) return false;
      return !existsSync(file) || readFileSync(file, 'utf8') !== text;
    });
    if (!stale.length) return 'unchanged';
    // excluded before it exists: the file is never seen by git
    await excludeFromGit(repoPath, DIRS.map((d) => `${d}/${LEARNINGS_SKILL}/`), engine.config.log);
    for (const dir of stale) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), text);
    }
    return 'written';
  } catch (err) {
    engine.config.log(`[learnings] skill export for ${repoPath}: ${String((err as Error).message ?? err)}`);
    return 'skipped';
  }
}

function ours(dir: string): boolean {
  try {
    return readFileSync(join(dir, 'SKILL.md'), 'utf8').includes(MARK);
  } catch {
    return false;
  }
}
