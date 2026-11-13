/**
 * The skills a goal's sessions were given, as their SKILL.md read then (ADR-0098). A session's prompt names skills from
 * several places — the workflow suite's rules, the other installed entries relevant to its role, the project skills
 * autoskills matched to the repository — and the Extensions page updates every one of them over time. So each skill a
 * role is told about is recorded once per content (a `goal.skills_seen` event), and its SKILL.md is kept
 * content-addressed under `<data>/skill-snapshots/<git blob sha>.md`: one copy per version, however many goals saw it.
 * A skill a session invoked without being told about it is recorded after the session, from the copy installed then.
 */
import { agentsFolder } from '@foundry/core';
import type { AgentProvider, EngineEvent, EventStore, Goal, GoalSkillMandate, GoalSkillSeen, GoalSkillSource } from '@foundry/core';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSkillMd } from './frontmatter.ts';
import type { SkillsPaths } from './paths.ts';
import { gitBlobSha1, localDirOf, sourceOf } from './sources.ts';
import type { GoalSkillView, GoalSkillsView, InstalledSkill, SkillSnapshotView } from './types.ts';
import type { OfferedSkill } from './workflow.ts';

export const SNAPSHOT_DIR = 'skill-snapshots';
export const snapshotPath = (dataDir: string, sha: string): string => join(dataDir, SNAPSHOT_DIR, `${sha}.md`);
const SHA = /^[0-9a-f]{40}$/;
/** a SKILL.md longer than this is cut for the window (the Extensions page cuts at the same length) */
const MAX_SKILL_MD = 200_000;

export interface GoalSkillsDeps {
  dataDir: string;
  store: Pick<EventStore, 'append' | 'listByGoalOfTypes'>;
  /** the skills installed for the goal's coding agent, with the repository's own (the manager's scan) */
  rows: () => InstalledSkill[];
  paths: SkillsPaths;
  provider: AgentProvider;
  /** the goal's workspace, where its project skills live */
  workspaceDir: string;
}

const bare = (invoke: string) => invoke.replace(/^\//, '');
const last = (s: string) => s.split(':').at(-1)!;

/** Does a skill name a session used (`tdd`, `mattpocock-skills:tdd`) mean this invoke? A bare name matches a prefixed one. */
export function sameSkill(used: string, invoke: string): boolean {
  const a = bare(used);
  const b = bare(invoke);
  return a === b || (last(a) === last(b) && (!a.includes(':') || !b.includes(':')));
}

/** Keep the SKILL.md of `dir` under its content's sha (once per content) and say what it is; null when there is none. */
export function snapshotSkillMd(dataDir: string, dir: string): { sha: string; version: string | null } | null {
  let buf: Buffer;
  try {
    buf = readFileSync(join(dir, 'SKILL.md'));
  } catch {
    return null;
  }
  const sha = gitBlobSha1(buf);
  const path = snapshotPath(dataDir, sha);
  if (!existsSync(path)) {
    mkdirSync(join(dataDir, SNAPSHOT_DIR), { recursive: true });
    writeFileSync(path, buf);
  }
  return { sha, version: parseSkillMd(buf.toString('utf8')).version };
}

/** The SKILL.md kept under `sha`, or null when the data folder has no copy (a goal brought in from elsewhere). */
export function readSnapshot(dataDir: string, sha: string): string | null {
  if (!SHA.test(sha)) return null;
  try {
    return readFileSync(snapshotPath(dataDir, sha), 'utf8').slice(0, MAX_SKILL_MD);
  } catch {
    return null;
  }
}

/** The installed row a session's invoke means: the one with that invoke, else a copy of that name (the user's first: that is what loads under a bare name). */
export function resolveRow(invoke: string, rows: InstalledSkill[]): InstalledSkill | null {
  const b = bare(invoke);
  const exact = rows.find((r) => bare(r.invoke) === b);
  if (exact) return exact;
  const byName = rows.filter((r) => r.name === b || r.name === last(b));
  return byName.find((r) => r.scope === 'user') ?? byName.find((r) => r.scope === 'project') ?? byName[0] ?? null;
}

/** how a row reached the machine, in the goal's words, and where it came from */
function sourceOfRow(row: InstalledSkill, paths: SkillsPaths): { source: GoalSkillSource; origin: string | null } {
  if (row.scope === 'project') return { source: 'project', origin: null };
  const s = sourceOf(row, paths);
  if (!s) return { source: 'hand', origin: null };
  if (s.kind === 'suite') return { source: 'suite', origin: s.label };
  if (s.kind === 'plugin') return { source: 'plugin', origin: s.label };
  if (row.managedBy === 'symlink') return { source: 'linked', origin: null };
  if (row.marker?.repo.startsWith('bundled:')) return { source: 'bundled', origin: 'bundled with Foundry' };
  if (s.manager === 'foundry') return { source: 'foundry', origin: s.repo };
  return { source: 'hand', origin: s.repo };
}

const projectDir = (deps: Pick<GoalSkillsDeps, 'workspaceDir' | 'provider'>, name: string) => join(deps.workspaceDir, agentsFolder(deps.provider), 'skills', name);

/** one offered skill as a record: its copy read and kept now */
function recordOf(deps: GoalSkillsDeps, o: OfferedSkill, rows: () => InstalledSkill[]): GoalSkillSeen {
  if (o.mandate === 'project') {
    const dir = projectDir(deps, o.name);
    const snap = snapshotSkillMd(deps.dataDir, dir);
    return { name: o.name, invoke: o.invoke, source: 'project', mandate: 'project', sha: snap?.sha ?? null, dir: snap ? dir : null, version: snap?.version ?? null, origin: null };
  }
  const row = resolveRow(o.invoke, rows());
  if (!row) return { name: o.name, invoke: o.invoke, source: 'unknown', mandate: o.mandate, sha: null, dir: null, version: null, origin: null };
  const snap = snapshotSkillMd(deps.dataDir, localDirOf(row));
  const { source, origin } = sourceOfRow(row, deps.paths);
  return { name: row.name, invoke: o.invoke, source, mandate: o.mandate, sha: snap?.sha ?? null, dir: row.dir, version: snap?.version ?? row.version ?? null, origin };
}

type SeenEvent = Extract<EngineEvent, { type: 'goal.skills_seen' }>;
const seenEvents = (deps: Pick<GoalSkillsDeps, 'store'>, goalId: string): SeenEvent[] => deps.store.listByGoalOfTypes(goalId, ['goal.skills_seen']).filter((e): e is SeenEvent & { seq: number } => e.type === 'goal.skills_seen');

/**
 * Record the skills a role's prompt names, each read and kept now; only the ones this goal has not recorded for that role
 * with that content. A command-line tool among them has no SKILL.md and is left out. Returns what was recorded.
 */
export function recordSkillsSeen(deps: GoalSkillsDeps, goal: Pick<Goal, 'id'>, role: string, offered: OfferedSkill[]): GoalSkillSeen[] {
  const wanted = offered.filter((o) => !o.cli);
  if (!wanted.length) return [];
  const seen = new Set<string>();
  for (const e of seenEvents(deps, goal.id)) if (e.payload.role === role) for (const s of e.payload.skills) seen.add(`${s.invoke}\0${s.sha ?? ''}`);
  let rows: InstalledSkill[] | null = null;
  const scan = () => (rows ??= deps.rows());
  const out: GoalSkillSeen[] = [];
  for (const o of wanted) {
    const entry = recordOf(deps, o, scan);
    const key = `${entry.invoke}\0${entry.sha ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  if (out.length) deps.store.append({ type: 'goal.skills_seen', goalId: goal.id, payload: { role, skills: out } });
  return out;
}

/**
 * Record the skills a session invoked that no session of the goal was told about (a skill of the machine the agent chose
 * itself), as installed when the session ended. Returns what was recorded.
 */
export function recordInvokedSkills(deps: GoalSkillsDeps, goal: Pick<Goal, 'id'>, role: string, used: string[]): GoalSkillSeen[] {
  if (!used.length) return [];
  const known: string[] = [];
  for (const e of seenEvents(deps, goal.id)) for (const s of e.payload.skills) known.push(s.invoke);
  const fresh = [...new Set(used)].filter((u) => !known.some((k) => sameSkill(u, k)));
  if (!fresh.length) return [];
  const rows = deps.rows();
  const out: GoalSkillSeen[] = [];
  for (const u of fresh) {
    if (known.some((k) => sameSkill(u, k))) continue;
    const invoke = `/${bare(u)}`;
    const row = resolveRow(invoke, rows);
    if (row) {
      const snap = snapshotSkillMd(deps.dataDir, localDirOf(row));
      const { source, origin } = sourceOfRow(row, deps.paths);
      out.push({ name: row.name, invoke, source, mandate: 'invoked', sha: snap?.sha ?? null, dir: row.dir, version: snap?.version ?? row.version ?? null, origin });
    } else out.push({ name: last(u), invoke, source: 'unknown', mandate: 'invoked', sha: null, dir: null, version: null, origin: null });
    known.push(invoke);
  }
  deps.store.append({ type: 'goal.skills_seen', goalId: goal.id, payload: { role, skills: out } });
  return out;
}

const MANDATE_ORDER: Record<GoalSkillMandate, number> = { must: 0, prefer: 1, project: 2, available: 3, invoked: 4 };

/** Every skill the goal's sessions were given or invoked, merged from its records, with how often each was invoked. */
export function goalSkillsView(deps: Pick<GoalSkillsDeps, 'store' | 'workspaceDir' | 'provider'>, goal: Pick<Goal, 'id' | 'provider' | 'autoskills'>): GoalSkillsView {
  const events = deps.store.listByGoalOfTypes(goal.id, ['goal.skills_seen', 'attempt.started', 'attempt.session', 'attempt.finished', 'session.usage']);
  const byInvoke = new Map<string, GoalSkillView & { shas: Set<string> }>();
  const sessionOf = new Map<string, string>();
  const attemptRole = new Map<string, string>();
  const calls: { session: string; ts: string; role: string; skills: string[] }[] = [];
  for (const e of events) {
    switch (e.type) {
      case 'goal.skills_seen':
        for (const s of e.payload.skills) {
          const v = byInvoke.get(s.invoke);
          if (!v) {
            byInvoke.set(s.invoke, { ...s, roles: [e.payload.role], versions: 0, firstSeenAt: e.ts, lastSeenAt: e.ts, used: null, shas: new Set(s.sha ? [s.sha] : []) });
            continue;
          }
          // the latest record says what the skill is now; the strongest mandate and every role stay
          if (!v.roles.includes(e.payload.role)) v.roles.push(e.payload.role);
          if (MANDATE_ORDER[s.mandate] < MANDATE_ORDER[v.mandate]) v.mandate = s.mandate;
          if (s.sha) v.shas.add(s.sha);
          Object.assign(v, { name: s.name, source: s.source, origin: s.origin, sha: s.sha ?? v.sha, dir: s.dir ?? v.dir, version: s.version ?? v.version, lastSeenAt: e.ts });
        }
        break;
      case 'attempt.started':
        if (e.payload.attempt.sessionId) sessionOf.set(e.payload.attempt.id, e.payload.attempt.sessionId);
        attemptRole.set(e.payload.attempt.id, e.payload.attempt.kind === 'merge' ? 'merge' : 'attempt');
        break;
      case 'attempt.session':
        sessionOf.set(e.payload.attemptId, e.payload.sessionId);
        break;
      case 'attempt.finished':
        if (e.payload.skillsUsed.length) calls.push({ session: sessionOf.get(e.payload.attemptId) ?? `attempt:${e.payload.attemptId}`, ts: e.ts, role: attemptRole.get(e.payload.attemptId) ?? 'attempt', skills: e.payload.skillsUsed });
        break;
      case 'session.usage':
        if (e.payload.skillsUsed.length) calls.push({ session: e.payload.sessionId ?? `usage:${e.id}`, ts: e.ts, role: e.payload.kind, skills: e.payload.skillsUsed });
        break;
    }
  }
  // a goal from before the record: its project skills are known by name from the autoskills run alone
  if (goal.autoskills?.status === 'installed') {
    for (const name of goal.autoskills.skills) {
      const invoke = `/${name}`;
      if (!byInvoke.has(invoke)) byInvoke.set(invoke, { name, invoke, source: 'project', origin: null, mandate: 'project', roles: ['attempt'], sha: null, version: null, versions: 0, firstSeenAt: goal.autoskills.at, lastSeenAt: goal.autoskills.at, dir: projectDir({ workspaceDir: deps.workspaceDir, provider: goal.provider ?? deps.provider }, name), used: null, shas: new Set() });
    }
  }
  const usage = new Map<string, { sessions: Set<string>; lastAt: string | null; roles: Set<string> }>();
  for (const c of calls) {
    for (const s of new Set(c.skills)) {
      const entries = [...byInvoke.values()];
      const target = entries.find((v) => bare(v.invoke) === bare(s)) ?? entries.find((v) => sameSkill(s, v.invoke));
      const key = target?.invoke ?? `/${bare(s)}`;
      // invoked, never recorded (a goal from before the record): known by the name the session used
      if (!target) byInvoke.set(key, { name: last(s), invoke: key, source: 'unknown', origin: null, mandate: 'invoked', roles: [], sha: null, version: null, versions: 0, firstSeenAt: null, lastSeenAt: null, dir: null, used: null, shas: new Set() });
      const u = usage.get(key) ?? { sessions: new Set<string>(), lastAt: null, roles: new Set<string>() };
      u.sessions.add(c.session);
      u.roles.add(c.role);
      if (!u.lastAt || u.lastAt < c.ts) u.lastAt = c.ts;
      usage.set(key, u);
    }
  }
  const skills = [...byInvoke.values()]
    .map(({ shas, ...v }) => {
      const u = usage.get(v.invoke);
      return { ...v, versions: shas.size, used: u ? { sessions: u.sessions.size, lastAt: u.lastAt, roles: [...u.roles] } : null };
    })
    .sort((a, b) => MANDATE_ORDER[a.mandate] - MANDATE_ORDER[b.mandate] || a.name.localeCompare(b.name));
  return { skills, observable: (goal.provider ?? deps.provider) === 'claude' };
}

/** One skill of the goal for the window: the content its sessions saw, and the copy installed now (the project folder for a project skill). */
export function skillSnapshotView(deps: GoalSkillsDeps, goal: Pick<Goal, 'id' | 'provider' | 'autoskills'>, invoke: string): SkillSnapshotView | null {
  const skill = goalSkillsView(deps, goal).skills.find((s) => s.invoke === invoke);
  if (!skill) return null;
  const content = skill.sha ? readSnapshot(deps.dataDir, skill.sha) : null;
  const snapshot = skill.sha && content !== null ? { sha: skill.sha, content } : null;
  let dir: string | null = null;
  if (skill.source === 'project') dir = projectDir({ workspaceDir: deps.workspaceDir, provider: goal.provider ?? deps.provider }, skill.name);
  else {
    const row = resolveRow(invoke, deps.rows());
    dir = row ? localDirOf(row) : null;
  }
  let current: SkillSnapshotView['current'] = null;
  if (dir) {
    try {
      const buf = readFileSync(join(dir, 'SKILL.md'));
      current = { sha: gitBlobSha1(buf), content: buf.toString('utf8').slice(0, MAX_SKILL_MD), dir };
    } catch {}
  }
  return { skill, snapshot, current };
}
