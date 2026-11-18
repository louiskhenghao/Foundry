// Browser-safe: imported by the web app via `@foundry/engine/memory-types` — no node imports here.

/** one thing Foundry writes into a folder's bank (ADR-0072) */
export interface MemoryDocument {
  content: string;
  /** what the content is, for the server's extraction ("the record of a Foundry goal …") */
  context: string;
  /** a stable id: the same id written again replaces (updateMode replace) or extends (append) the document */
  documentId?: string;
  tags: string[];
  metadata?: Record<string, string>;
  updateMode?: 'replace' | 'append';
}

export interface ReflectOptions {
  context?: string;
  budget?: 'low' | 'mid' | 'high';
  tags?: string[];
  signal?: AbortSignal;
}

/** a knowledge page: a text the server rewrites from the bank's facts to answer one standing question */
export interface KnowledgePageSpec {
  name: string;
  sourceQuery: string;
  tags: string[];
  maxTokens: number;
  trigger: { refreshCron: string; factTypes: ('world' | 'experience' | 'observation')[]; tagsMatch: 'all' };
}

/** what Memory needs from a server; the Hindsight client implements it, tests put a fake behind it */
export interface MemoryBackend {
  /** the server's version; throws when it cannot be reached */
  version(signal?: AbortSignal): Promise<string>;
  /** the bank ids the server has */
  listBanks(signal?: AbortSignal): Promise<string[]>;
  createBank(bankId: string, opts: { name: string; mission: string }, signal?: AbortSignal): Promise<void>;
  /** whether the bank holds any document already (a bank Hindsight's own integration seeded, or an earlier Foundry) */
  hasDocuments(bankId: string, signal?: AbortSignal): Promise<boolean>;
  retain(bankId: string, doc: MemoryDocument, signal?: AbortSignal): Promise<void>;
  /** an answer over the bank, not memories (the server's LLM at work: seconds to minutes) */
  reflect(bankId: string, query: string, opts: ReflectOptions): Promise<string>;
  /** the memories themselves that bear on the question, found without a model (well under a second), most relevant first */
  recall(bankId: string, query: string, opts: { maxTokens?: number; signal?: AbortSignal }): Promise<string[]>;
  /** the names of the knowledge pages at the bank's root */
  listKnowledgePages(bankId: string, signal?: AbortSignal): Promise<string[]>;
  createKnowledgePage(bankId: string, page: KnowledgePageSpec, signal?: AbortSignal): Promise<void>;
}

export interface MemoryConnection {
  url: string;
  token: string | null;
}

/** where Foundry's own stages ask Memory before they start (Clarify's answer serves the planner too); `person` is Clarify's ask of the person's own bank */
export type MemoryStage = 'attempt' | 'clarify' | 'person' | 'replan' | 'review_task' | 'review_goal';

/** what a stage is given: the bank's answer, or the memories themselves when the answer did not come in time */
export interface MemoryAnswer {
  text: string;
  kind: 'reflect' | 'recall';
}

/** one ask of the bank, as the goal page shows it */
export interface MemoryRecall {
  at: string;
  stage: MemoryStage;
  query: string;
  text: string | null;
  kind: 'reflect' | 'recall';
  ms: number;
  error: string | null;
  taskId: string | null;
  attemptId: string | null;
}

/** the goal page's Memory line and its Remembered section */
export interface MemoryGoalView {
  /** Memory is set up (a server address) */
  enabled: boolean;
  /** the bank the goal's stages used, from its records; null before any */
  bank: string | null;
  recalls: MemoryRecall[];
  /** documents written into the bank for this goal, and writes that failed */
  written: number;
  failed: number;
}

/** what Foundry wrote into a bank, by what it came from */
export type MemorySource = 'record' | 'learnings' | 'brief' | 'review' | 'plan' | 'transcript' | 'git' | 'person';

/** the Hindsight card and the Settings line: is Memory set up, and does the server answer */
/** where the server Foundry runs stands (ADR-0109) */
export type MemoryServerPhase = 'off' | 'installing' | 'starting' | 'running' | 'sign-in' | 'failed';
/** the provider the server's own LLM calls go through: a coding agent's sign-in, no key */
export type MemoryServerLlm = 'claude-code' | 'openai-codex';
/** the server's own Codex sign-in while it is made: the page to open and the code to enter there */
export interface MemorySignIn {
  url: string | null;
  deviceCode: string | null;
  done: boolean;
  ok: boolean | null;
  error: string | null;
}
/** what the Hindsight card shows of the server Foundry runs */
export interface MemoryServerView {
  phase: MemoryServerPhase;
  /** http://127.0.0.1:<port> while it runs */
  url: string | null;
  port: number | null;
  llm: MemoryServerLlm | null;
  /** the Hindsight version installed; null = not installed yet */
  installed: string | null;
  /** where the Python environment is, and the database (null until its first start names it) */
  venv: string;
  database: string | null;
  error: string | null;
  /** the last lines of the install, or of the server's log */
  lines: string[];
  signIn: MemorySignIn | null;
}

export interface MemoryStatus {
  /** Foundry runs the server itself (Settings memory.run, ADR-0109) */
  run: boolean;
  /** the server Foundry runs, whatever `run` says (its install stays when Memory moves to another server) */
  server: MemoryServerView;
  /** a server to use: an address set, or the server Foundry runs answering */
  configured: boolean;
  /** the address of a server the person runs, as saved: kept while Foundry runs its own (`url` is the one in use) */
  ownUrl: string | null;
  url: string | null;
  tokenSet: boolean;
  /** null = not asked (no address) */
  reachable: boolean | null;
  version: string | null;
  error: string | null;
  retainTranscripts: boolean;
  reflectSec: number;
  seedCommits: number;
  excludedFolders: string[];
  /** the hindsight MCP server as each coding agent has it: installed at user scope, and allowed in goals */
  mcp: Record<'claude' | 'codex', { installed: boolean; allowed: boolean } | null>;
}

/** what a folder's card on the Learnings page shows */
export interface MemoryFolderStatus {
  repoPath: string;
  /** the bank this folder's goals use; null = not a git repository (no Memory for it) */
  bank: string | null;
  /** the extension is on and the folder is not left out */
  enabled: boolean;
  excluded: boolean;
}
