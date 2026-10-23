/**
 * Memory (ADR-0072): a Hindsight server the person runs remembers what a folder's goals did and taught, and Foundry's
 * stages ask it before they start. Everything here is optional and bounded: with no server address nothing happens,
 * a server that does not answer costs a stage its timeout and nothing else, a write that fails is a record on the goal
 * and is not retried. The bank is named as Hindsight's own coding-agent integration names it, so the person's own
 * sessions in the repository and Foundry's goals share one memory.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LEARNINGS_EVERYWHERE, SECRET_SETTINGS, getAttempt, getEscalation, getGoal, getTask, isHistory, listEscalations, listTasks, renderDecisions, type AgentProvider, type Brief, type EngineEvent, type MemorySettings } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { goalRecord } from '../learnings.ts';
import { PreviewEnvStore, redactor } from '../preview/env.ts';
import { BANK_PREFIX, bankIdFor } from './bank.ts';
import { HindsightBackend } from './client.ts';
import { compactTranscript } from './compact.ts';
import { pagesFor } from './pages.ts';
import { answerDocument, briefRevisionDocument, decisionsDocument, feedbackDocument, goalRecordDocument, learningsDocument, personNotebookDocument, replanDocument, reviewDocument, secondOpinionDocument, transcriptDocument } from './record.ts';
import { recentCommits, seedDocument } from './seed.ts';
import type { MemoryAnswer, MemoryBackend, MemoryConnection, MemoryDocument, MemoryFolderStatus, MemoryGoalView, MemoryRecall, MemorySource, MemoryStage, MemoryStatus } from './types.ts';

/** a goal that ended one of these ways has a record worth keeping (a cancelled one teaches nothing, ADR-0040) */
const ENDED = new Set(['done', 'over_delivered', 'failed']);
/** the person's own bank: what they decided, answered and refused across every repository, whatever the folder */
export const PERSON_BANK = 'foundry::person';
const PERSON_MISSION =
  'This bank is the memory of one person across every repository they have work done in: what they decide when asked, what they refuse, what they ask for again and again, how they like work done and reported. Keep their exact words where they matter. A later wish supersedes an earlier one.';

/** a stage waits this long for the server's answer (Settings memory.reflectSec), then takes the memories themselves */
export const REFLECT_TIMEOUT_MS = 20_000;
/** the memories themselves are retrieval, no model: well under a second on a server that is up */
export const RECALL_TIMEOUT_MS = 10_000;
/** what a stage is given of the answer */
export const REFLECT_MAX_CHARS = 1_500;
export const RETAIN_TIMEOUT_MS = 30_000;
/** the server's name in each coding agent's MCP configuration, and its tool prefix (ADR-0016) */
export const MCP_SERVER_NAME = 'hindsight';
export const MCP_SERVER_PREFIX = `mcp__${MCP_SERVER_NAME}`;
/** the variable Codex sessions (and the person's own shell) read the bearer token from */
export const TOKEN_ENV = 'HINDSIGHT_API_TOKEN';

/** what a bank Foundry creates is for; a bank that exists keeps whatever mission it has */
const BANK_MISSION =
  'This bank is the memory of one software repository: how it is built, tested and run; its conventions and the pitfalls met in it; the decisions made in it and why; what its reviews refused; what was tried there and failed. Keep exact identifiers, paths, commands and values verbatim. A later fact about the same thing supersedes an earlier one.';

export type BackendFactory = (c: MemoryConnection) => MemoryBackend;
/** test seam (engine.memoryDeps): a fake server, and timeouts a test can afford to wait for */
export interface MemoryDeps {
  backend?: BackendFactory;
  reflectTimeoutMs?: number;
  recallTimeoutMs?: number;
  retainTimeoutMs?: number;
}

export interface MemoryWhere {
  repoPath: string;
  goalId: string | null;
  taskId?: string | null;
  attemptId?: string | null;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const message = (err: unknown) => clip(String((err as Error)?.message ?? err), 300);

/** the memories themselves as a stage is given them: one line each, no repeats, within what a prompt takes */
export function renderFacts(facts: string[], max = REFLECT_MAX_CHARS): string | null {
  const seen = new Set<string>();
  const lines: string[] = [];
  let used = 0;
  for (const f of facts) {
    const text = f.trim().replace(/\s+/g, ' ');
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    const line = `- ${clip(text, 400)}`;
    if (used + line.length + 1 > max) break;
    seen.add(key);
    lines.push(line);
    used += line.length + 1;
  }
  return lines.length ? lines.join('\n') : null;
}
/** environment entries that are credentials, by their names */
const SECRET_ENV = /(KEY|TOKEN|SECRET|PASSWORD)/;

/** the token Codex sessions read (ADR-0072): only while Memory is on and the server asks for one */
export function memorySessionEnv(s: MemorySettings): Record<string, string> {
  return s.url && s.token ? { [TOKEN_ENV]: s.token } : {};
}

export class Memory {
  private backend: { conn: MemoryConnection; impl: MemoryBackend } | null = null;
  /** repoPath → its bank id, resolved once (a folder does not change repository) */
  private banks = new Map<string, Promise<string | null>>();
  /** repoPath → its bank made ready on the server (created, seeded) once per process */
  private ready = new Map<string, Promise<string | null>>();
  private pending = new Set<Promise<unknown>>();
  private previewEnv: PreviewEnvStore;

  constructor(private engine: Engine) {
    this.previewEnv = new PreviewEnvStore(engine.config.dataDir);
  }

  settings(): MemorySettings {
    return this.engine.settings.values().memory;
  }
  /** a server address is set */
  enabled(): boolean {
    return !!this.settings().url;
  }
  connection(): MemoryConnection | null {
    const s = this.settings();
    return s.url ? { url: s.url.replace(/\/+$/, ''), token: s.token } : null;
  }
  /** the folder is left out (Settings → memory.excludedFolders, switched on the Learnings page) */
  excluded(repoPath: string): boolean {
    const p = resolve(repoPath);
    return this.settings().excludedFolders.some((f) => resolve(f) === p);
  }
  /** the settings changed: the next call connects anew, and every bank is made ready again */
  reconfigure(): void {
    this.backend = null;
    this.ready.clear();
    this.readyPerson = null;
  }

  private client(): MemoryBackend | null {
    const conn = this.connection();
    if (!conn) return null;
    if (!this.backend || this.backend.conn.url !== conn.url || this.backend.conn.token !== conn.token) {
      const make = this.engine.memoryDeps.backend ?? ((c: MemoryConnection) => new HindsightBackend(c));
      this.backend = { conn, impl: make(conn) };
    }
    return this.backend.impl;
  }
  private timeout(kind: 'reflect' | 'recall' | 'retain'): AbortSignal {
    const d = this.engine.memoryDeps;
    const ms = kind === 'reflect' ? (d.reflectTimeoutMs ?? this.settings().reflectSec * 1000) : kind === 'recall' ? (d.recallTimeoutMs ?? RECALL_TIMEOUT_MS) : (d.retainTimeoutMs ?? RETAIN_TIMEOUT_MS);
    return AbortSignal.timeout(ms);
  }

  /** the bank a folder's goals use, Memory on or off; null for a folder that is no repository */
  bankOf(repoPath: string): Promise<string | null> {
    let p = this.banks.get(repoPath);
    if (!p) {
      p = bankIdFor(repoPath);
      this.banks.set(repoPath, p);
      // a folder that is no repository yet may become one: ask again next time
      p.then((b) => b === null && this.banks.delete(repoPath), () => this.banks.delete(repoPath));
    }
    return p;
  }

  /** the bank Memory uses for this folder: on, the folder not left out, and a repository; else null */
  async bankFor(repoPath: string): Promise<string | null> {
    if (!this.enabled() || this.excluded(repoPath)) return null;
    return this.bankOf(repoPath);
  }

  async folderStatus(repoPath: string): Promise<MemoryFolderStatus> {
    // the everywhere notebook's card: the person's own bank, which no folder switch touches
    if (repoPath === LEARNINGS_EVERYWHERE) return { repoPath, bank: PERSON_BANK, excluded: false, enabled: this.enabled() };
    const bank = await this.bankOf(repoPath);
    const excluded = this.excluded(repoPath);
    return { repoPath, bank, excluded, enabled: this.enabled() && !excluded && bank !== null };
  }

  /** leave a folder out of Memory, or take it back in */
  setFolder(repoPath: string, on: boolean): void {
    if (repoPath === LEARNINGS_EVERYWHERE) return;
    const p = resolve(repoPath);
    const rest = this.settings().excludedFolders.filter((f) => resolve(f) !== p);
    this.engine.updateSettings({ memory: { excludedFolders: on ? rest : [...rest, p] } });
  }

  /**
   * The folder's bank, made ready once per process: created with a mission for a coding project when the server has
   * none of that name (a bank that exists keeps its settings), then seeded from the repository's recent commits when it
   * holds no document yet. A failure is forgotten, so the next stage tries again.
   */
  ensureBank(repoPath: string): Promise<string | null> {
    const have = this.ready.get(repoPath);
    if (have) return have;
    const p = this.prepare(repoPath).catch((err) => {
      this.engine.config.log(`[memory] ${repoPath}: the server did not answer (${message(err)})`);
      this.ready.delete(repoPath);
      return null;
    });
    this.ready.set(repoPath, p);
    return p;
  }

  private async prepare(repoPath: string): Promise<string | null> {
    const bank = await this.bankFor(repoPath);
    const backend = this.client();
    if (!bank || !backend) return null;
    const signal = this.timeout('retain');
    const project = bank.slice(BANK_PREFIX.length);
    if (!(await backend.listBanks(signal)).includes(bank)) await backend.createBank(bank, { name: project, mission: BANK_MISSION }, signal);
    // the five pages Hindsight's own integration keeps, for a bank that lacks them; a server without pages is no reason to stop
    await this.ensurePages(backend, bank, project).catch((err) => this.engine.config.log(`[memory] ${bank}: the knowledge pages were not made (${message(err)})`));
    if (!(await backend.hasDocuments(bank, signal))) {
      const seeding = this.seed(repoPath, bank).finally(() => this.seeding.delete(bank));
      this.seeding.set(bank, seeding);
      this.track(seeding);
    }
    return bank;
  }

  /** the banks whose seed is still on its way: asked all the same, where an empty bank is not */
  private seeding = new Map<string, Promise<void>>();

  /** the pages by name: one that exists (made by the person's terminal, or by an earlier Foundry) is left as it is */
  private async ensurePages(backend: MemoryBackend, bank: string, project: string): Promise<void> {
    const have = new Set((await backend.listKnowledgePages(bank, this.timeout('retain'))).map((n) => n.toLowerCase()));
    for (const page of pagesFor(bank, project)) if (!have.has(page.name.toLowerCase())) await backend.createKnowledgePage(bank, page, this.timeout('retain'));
  }

  /** the person's bank, made ready once per process: created with its mission when the server has none; never seeded */
  private readyPerson: Promise<string | null> | null = null;
  ensurePersonBank(): Promise<string | null> {
    if (this.readyPerson) return this.readyPerson;
    const p = (async () => {
      const backend = this.client();
      if (!backend) return null;
      const signal = this.timeout('retain');
      if (!(await backend.listBanks(signal)).includes(PERSON_BANK)) await backend.createBank(PERSON_BANK, { name: 'person', mission: PERSON_MISSION }, signal);
      return PERSON_BANK;
    })().catch((err) => {
      this.engine.config.log(`[memory] ${PERSON_BANK}: the server did not answer (${message(err)})`);
      this.readyPerson = null;
      return null;
    });
    this.readyPerson = p;
    return p;
  }

  /** the repository's recent commits, one document each, a few at a time (the server extracts each with its LLM) */
  private async seed(repoPath: string, bank: string): Promise<void> {
    const commits = await recentCommits(repoPath, this.settings().seedCommits);
    const backend = this.client();
    if (!commits.length || !backend) return;
    let written = 0;
    let chars = 0;
    let error: string | null = null;
    for (let i = 0; i < commits.length && !this.engine.isStopped; i += 4) {
      await Promise.all(
        commits.slice(i, i + 4).map(async (c) => {
          const doc = this.scrub(seedDocument(c));
          try {
            await backend.retain(bank, doc, this.timeout('retain'));
            written++;
            chars += doc.content.length;
          } catch (err) {
            error = message(err);
          }
        }),
      );
    }
    this.engine.store.append({ type: 'memory.retained', goalId: null, payload: { source: 'git', bankId: bank, documentId: null, count: written, chars, error, taskId: null, attemptId: null } });
    this.engine.config.log(`[memory] ${bank}: seeded ${written} of ${commits.length} commits${error ? ` (${error})` : ''}`);
  }

  /** the values of the credentials Foundry keeps, blanked out of everything it sends to the server */
  private scrub(doc: MemoryDocument): MemoryDocument {
    const s = this.engine.settings.values() as unknown as Record<string, Record<string, unknown>>;
    const values: unknown[] = [
      ...SECRET_SETTINGS.map((p) => {
        const [section, key] = p.split('.');
        return s[section!]?.[key!];
      }),
      ...Object.entries(this.engine.sessionEnvExtra()).flatMap(([k, v]) => (SECRET_ENV.test(k) ? [v] : [])),
      ...Object.values(this.previewEnv.all()).flatMap((vars) => Object.values(vars)),
    ];
    const redact = redactor(values.filter((v): v is string => typeof v === 'string'));
    return { ...doc, content: redact(doc.content), context: redact(doc.context) };
  }

  /** write one document into the folder's bank; false when Memory is off for the folder or the server refused */
  async retain(doc: MemoryDocument, where: MemoryWhere & { source: MemorySource }): Promise<boolean> {
    return this.write(await this.ensureBank(where.repoPath), doc, where);
  }

  /** write one document into the person's bank — never for a goal of a folder left out, whose words are its own too */
  async retainPerson(doc: MemoryDocument, where: MemoryWhere & { source: MemorySource }): Promise<boolean> {
    if (!this.enabled() || this.excluded(where.repoPath)) return false;
    return this.write(await this.ensurePersonBank(), doc, where);
  }

  private async write(bank: string | null, doc: MemoryDocument, where: MemoryWhere & { source: MemorySource }): Promise<boolean> {
    const backend = this.client();
    if (!bank || !backend) return false;
    const scrubbed = this.scrub(doc);
    const base = { source: where.source, bankId: bank, documentId: doc.documentId ?? null, chars: scrubbed.content.length, taskId: where.taskId ?? null, attemptId: where.attemptId ?? null };
    try {
      await backend.retain(bank, scrubbed, this.timeout('retain'));
      this.engine.store.append({ type: 'memory.retained', goalId: where.goalId, payload: { ...base, count: 1, error: null } });
      return true;
    } catch (err) {
      const error = message(err);
      this.engine.store.append({ type: 'memory.retained', goalId: where.goalId, payload: { ...base, count: 0, error } });
      this.engine.config.log(`[memory] ${bank}: could not write the ${where.source} (${error})`);
      return false;
    }
  }

  /** write in the background; stop() waits for it */
  retainLater(doc: MemoryDocument, where: MemoryWhere & { source: MemorySource }): void {
    this.track(this.retain(doc, where));
  }
  retainPersonLater(doc: MemoryDocument, where: MemoryWhere & { source: MemorySource }): void {
    this.track(this.retainPerson(doc, where));
  }

  /**
   * What the bank answers a stage before it starts, cut to what a prompt can take — or, when the answer does not come
   * within the wait Settings allow (a server whose LLM is a coding agent's CLI takes a minute or more), the memories
   * themselves that bear on the question, found without a model. Null when Memory is off for the folder, the bank is
   * empty (it is not asked then), or it had nothing. Every ask is recorded on the goal.
   */
  async reflect(stage: MemoryStage, question: string, where: MemoryWhere & { context?: string }): Promise<MemoryAnswer | null> {
    return this.ask(await this.ensureBank(where.repoPath), stage, question, where);
  }

  /** what the person's own bank says about them, for Clarify; nothing for a goal of a folder left out */
  async reflectPerson(question: string, where: MemoryWhere & { context?: string }): Promise<MemoryAnswer | null> {
    if (!this.enabled() || this.excluded(where.repoPath)) return null;
    return this.ask(await this.ensurePersonBank(), 'person', question, where);
  }

  private async ask(bank: string | null, stage: MemoryStage, question: string, where: MemoryWhere & { context?: string }): Promise<MemoryAnswer | null> {
    const backend = this.client();
    if (!bank || !backend) return null;
    const t0 = Date.now();
    const base = { stage, bankId: bank, query: question, taskId: where.taskId ?? null, attemptId: where.attemptId ?? null };
    // a bank with nothing in it is not asked — the server's LLM would spend a minute saying so — unless its seed is on the way
    if (!this.seeding.has(bank) && !(await backend.hasDocuments(bank, this.timeout('recall')).catch(() => true))) {
      this.engine.store.append({ type: 'memory.recalled', goalId: where.goalId, payload: { ...base, kind: 'reflect', text: null, ms: Date.now() - t0, error: null } });
      return null;
    }
    // the memories themselves are fetched beside the answer, so a late answer costs the stage nothing more than the wait
    const plain = backend
      .recall(bank, question, { maxTokens: 500, signal: this.timeout('recall') })
      .then((facts) => renderFacts(facts))
      .catch(() => null);
    try {
      const answer = await backend.reflect(bank, question, { budget: 'low', context: where.context, signal: this.timeout('reflect') });
      const text = clip(answer.trim(), REFLECT_MAX_CHARS) || null;
      this.engine.store.append({ type: 'memory.recalled', goalId: where.goalId, payload: { ...base, kind: 'reflect', text, ms: Date.now() - t0, error: null } });
      return text ? { text, kind: 'reflect' } : null;
    } catch (err) {
      const error = message(err);
      const text = await plain;
      this.engine.store.append({ type: 'memory.recalled', goalId: where.goalId, payload: { ...base, kind: 'recall', text, ms: Date.now() - t0, error: text ? `no answer in time (${error}); the memories themselves served` : error } });
      if (!text) this.engine.config.log(`[memory] ${bank}: nothing for the ${stage} (${error})`);
      return text ? { text, kind: 'recall' } : null;
    }
  }

  /**
   * What a goal did, decided, was refused and wrote, into its folder's bank, as the engine's events say it (ADR-0072).
   * Each write runs in the background; a failure is a record on the goal, never an error here.
   */
  onEvent(e: EngineEvent): void {
    if (!this.enabled()) return;
    try {
      switch (e.type) {
        case 'goal.state_changed':
          if (e.goalId && ENDED.has(e.payload.to)) this.onGoalEnded(e.goalId);
          return;
        case 'learnings.set':
          // an emptied notebook is left as it was; the person's everywhere notebook belongs to no repository but to them
          if (!e.payload.learnings.length) return;
          if (e.payload.repoPath === LEARNINGS_EVERYWHERE) this.track(this.ensurePersonBank().then((bank) => this.write(bank, personNotebookDocument(e.payload.learnings), { repoPath: LEARNINGS_EVERYWHERE, goalId: null, source: 'person' })));
          else this.retainLater(learningsDocument(e.payload.learnings), { repoPath: e.payload.repoPath, goalId: e.payload.goalId, source: 'learnings' });
          return;
        case 'brief.approved': {
          // what the person decided for this goal, in their own words, goes to their bank
          const goal = e.goalId ? getGoal(this.engine.store.db, e.goalId) : null;
          const decided = renderDecisions(e.payload.brief);
          if (goal && decided.trim()) this.track(this.bankOf(goal.repoPath).then((bank) => this.retainPerson(decisionsDocument(goal, bank, decided), { repoPath: goal.repoPath, goalId: goal.id, source: 'person' })));
          return;
        }
        case 'escalation.answered': {
          const db = this.engine.store.db;
          const esc = getEscalation(db, e.payload.escalationId);
          const goal = esc ? getGoal(db, esc.goalId) : null;
          const said = [e.payload.answer.hint, e.payload.answer.feedback].filter((s): s is string => !!s?.trim());
          if (goal && esc && said.length) this.track(this.bankOf(goal.repoPath).then((bank) => this.retainPerson(answerDocument(goal, bank, esc, e.payload.answer), { repoPath: goal.repoPath, goalId: goal.id, source: 'person', taskId: esc.taskId })));
          return;
        }
        case 'goal.checkpoint_closed': {
          const db = this.engine.store.db;
          const goal = e.goalId ? getGoal(db, e.goalId) : null;
          if (goal && e.payload.feedback?.trim()) this.track(this.bankOf(goal.repoPath).then((bank) => this.retainPerson(feedbackDocument(goal, bank, getTask(db, e.payload.taskId)?.title ?? null, e.payload.feedback!, e.ts), { repoPath: goal.repoPath, goalId: goal.id, source: 'person', taskId: e.payload.taskId })));
          return;
        }
        case 'brief.edited':
          if (e.goalId) this.onBriefEdited(e.goalId, e.payload.brief);
          return;
        case 'brief.second_opinion': {
          const goal = e.goalId ? getGoal(this.engine.store.db, e.goalId) : null;
          if (goal) this.retainLater(secondOpinionDocument(goal, e.payload.changeSummary, e.payload.auto, e.ts), { repoPath: goal.repoPath, goalId: goal.id, source: 'brief' });
          return;
        }
        case 'review.task.finished': {
          const db = this.engine.store.db;
          const goal = e.goalId ? getGoal(db, e.goalId) : null;
          const task = getTask(db, e.payload.taskId);
          const attempt = getAttempt(db, e.payload.attemptId);
          if (goal && task) this.retainLater(reviewDocument(goal, task, { id: e.payload.attemptId, index: attempt?.index ?? 0 }, e.payload.verdict), { repoPath: goal.repoPath, goalId: goal.id, source: 'review', taskId: task.id, attemptId: e.payload.attemptId });
          return;
        }
        case 'task.revised': {
          const db = this.engine.store.db;
          const goal = e.goalId ? getGoal(db, e.goalId) : null;
          const task = getTask(db, e.payload.taskId);
          const landed = e.payload.afterTaskId ? getTask(db, e.payload.afterTaskId)?.title ?? null : null;
          if (goal && task) this.retainLater(replanDocument(goal, task, e.payload.reason, e.payload.spec, landed, e.ts), { repoPath: goal.repoPath, goalId: goal.id, source: 'plan', taskId: task.id });
          return;
        }
        case 'attempt.concluded':
          if (e.goalId && this.settings().retainTranscripts) this.track(this.onAttemptConcluded(e.goalId, e.payload));
          return;
      }
    } catch (err) {
      this.engine.config.log(`[memory] ${e.type}: ${message(err)}`);
    }
  }

  /** a goal that ended: its record, as the Learnings session reads it; one that never got to work has none */
  private onGoalEnded(goalId: string): void {
    const db = this.engine.store.db;
    const goal = getGoal(db, goalId);
    if (!goal || isHistory(goal)) return;
    if (!listTasks(db, goal.id).length && !listEscalations(db, { goalId: goal.id }).length) return;
    this.retainLater(goalRecordDocument(goal, goalRecord(this.engine, goal)), { repoPath: goal.repoPath, goalId: goal.id, source: 'record' });
  }

  /** the Brief as it was is the entry before this edit in the goal's Brief history (the subscriber runs after the append) */
  private onBriefEdited(goalId: string, after: Brief): void {
    const goal = getGoal(this.engine.store.db, goalId);
    if (!goal) return;
    const history = this.engine.store.listByGoalOfTypes(goalId, ['brief.skeleton_proposed', 'brief.proposed', 'brief.edited', 'brief.approved']);
    const previous = history.at(-2);
    if (!previous || !('brief' in previous.payload)) return;
    const doc = briefRevisionDocument(goal, previous.payload.brief as Brief, after, history.filter((x) => x.type === 'brief.edited').length);
    if (doc) this.retainLater(doc, { repoPath: goal.repoPath, goalId, source: 'brief' });
  }

  /** an attempt's transcript, read off this computer and compacted, with how the attempt ended */
  private async onAttemptConcluded(goalId: string, p: { attemptId: string; state: string; reason: string }): Promise<void> {
    const db = this.engine.store.db;
    const goal = getGoal(db, goalId);
    const attempt = getAttempt(db, p.attemptId);
    if (!goal || !attempt?.transcriptPath || !existsSync(attempt.transcriptPath)) return;
    const text = await Bun.file(attempt.transcriptPath).text();
    if (!text.trim()) return;
    const promptPath = attempt.transcriptPath.replace(/\.jsonl$/, '.prompt.md');
    const prompt = existsSync(promptPath) ? readFileSync(promptPath, 'utf8') : null;
    const compacted = compactTranscript(text, goal.provider ?? this.engine.config.provider, { prompt });
    if (!compacted.trim()) return;
    const task = getTask(db, attempt.taskId);
    await this.retain(transcriptDocument(goal, task ?? null, attempt, { state: p.state, reason: p.reason }, compacted), { repoPath: goal.repoPath, goalId, source: 'transcript', taskId: attempt.taskId, attemptId: attempt.id });
  }

  /** the goal page's line and its Remembered section: what the bank told each stage, and how much the goal wrote back */
  goalView(goalId: string): MemoryGoalView {
    const recalls: MemoryRecall[] = [];
    let bank: string | null = null;
    let written = 0;
    let failed = 0;
    for (const e of this.engine.store.listByGoalOfTypes(goalId, ['memory.recalled', 'memory.retained'])) {
      if (e.type === 'memory.recalled') {
        bank ??= e.payload.bankId;
        recalls.push({ at: e.ts, stage: e.payload.stage, query: e.payload.query, text: e.payload.text, kind: e.payload.kind ?? 'reflect', ms: e.payload.ms, error: e.payload.error, taskId: e.payload.taskId ?? null, attemptId: e.payload.attemptId ?? null });
      } else if (e.type === 'memory.retained') {
        bank ??= e.payload.bankId;
        if (e.payload.error) failed++;
        else written += e.payload.count;
      }
    }
    return { enabled: this.enabled(), bank, recalls, written, failed };
  }

  /** the Hindsight card: is a server set, does it answer, and how each coding agent has its MCP server */
  async status(): Promise<MemoryStatus> {
    const s = this.settings();
    const conn = this.connection();
    let reachable: boolean | null = null;
    let version: string | null = null;
    let error: string | null = null;
    if (conn) {
      try {
        version = await this.client()!.version(AbortSignal.timeout(4_000));
        reachable = true;
      } catch (err) {
        reachable = false;
        error = message(err);
      }
    }
    return {
      configured: !!conn,
      url: conn?.url ?? null,
      tokenSet: !!conn?.token,
      reachable,
      version,
      error,
      retainTranscripts: s.retainTranscripts,
      reflectSec: s.reflectSec,
      seedCommits: s.seedCommits,
      excludedFolders: s.excludedFolders,
      mcp: { claude: this.mcpState('claude'), codex: await this.codexMcpState() },
    };
  }

  private mcpState(provider: 'claude'): { installed: boolean; allowed: boolean } | null {
    try {
      const installed = this.engine.mcpFor(provider).view();
      return { installed: 'servers' in installed && installed.servers.some((r) => r.source === 'user' && r.name === MCP_SERVER_NAME), allowed: this.engine.config.mcpAllowed.includes(MCP_SERVER_PREFIX) };
    } catch {
      return null;
    }
  }
  private async codexMcpState(): Promise<{ installed: boolean; allowed: boolean } | null> {
    try {
      const view = await this.engine.codexMcp.view();
      return { installed: view.servers.some((r) => r.name === MCP_SERVER_NAME), allowed: this.engine.config.codexMcpAllowed.includes(MCP_SERVER_PREFIX) };
    } catch {
      return null;
    }
  }

  /** try an address before saving it */
  async probe(conn: MemoryConnection): Promise<{ ok: boolean; version: string | null; error: string | null }> {
    const make = this.engine.memoryDeps.backend ?? ((c: MemoryConnection) => new HindsightBackend(c));
    try {
      return { ok: true, version: await make({ ...conn, url: conn.url.replace(/\/+$/, '') }).version(AbortSignal.timeout(5_000)), error: null };
    } catch (err) {
      return { ok: false, version: null, error: message(err) };
    }
  }

  /**
   * The hindsight MCP server in a coding agent's own configuration (user scope, ADR-0016), at the server's multi-bank
   * endpoint, then allowed in goals: a worker is told its bank and may ask the memory itself. Claude Code takes the
   * token as a header; Codex reads it from the session's environment. Antigravity keeps its MCP servers itself.
   */
  installMcp(provider: AgentProvider, say: (line: string) => void = () => {}): Promise<{ ok: boolean; error: string | null }> {
    const conn = this.connection();
    if (!conn) return Promise.resolve({ ok: false, error: 'set the server address first' });
    if (provider === 'agy') return Promise.resolve({ ok: false, error: 'Antigravity keeps its MCP servers itself: add it with agy mcp add' });
    const url = `${conn.url}/mcp/`;
    const config = provider === 'claude' ? { type: 'http' as const, url, ...(conn.token ? { headers: { Authorization: `Bearer ${conn.token}` } } : {}) } : { type: 'http' as const, url, ...(conn.token ? { bearerTokenEnvVar: TOKEN_ENV } : {}) };
    const manager = this.engine.mcpFor(provider);
    return manager.install({ custom: { name: MCP_SERVER_NAME, config } }, {}, say, true).then((r) => {
      if (r.ok) manager.allow(MCP_SERVER_PREFIX, true);
      return r;
    });
  }

  removeMcp(provider: AgentProvider, say: (line: string) => void = () => {}): Promise<{ ok: boolean; error: string | null }> {
    if (provider === 'agy') return Promise.resolve({ ok: false, error: 'Antigravity keeps its MCP servers itself' });
    return this.engine.mcpFor(provider).remove(MCP_SERVER_NAME, say);
  }

  private track<T>(p: Promise<T>): Promise<T> {
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p)).catch(() => {});
    return p;
  }
  /** writes still in flight (stop() waits for them, bounded) */
  pendingWork(): Promise<unknown>[] {
    return [...this.pending];
  }
}
