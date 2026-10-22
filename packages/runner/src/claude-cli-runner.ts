import { EventQueue } from './event-queue.ts';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { Semaphore } from './semaphore.ts';
import { LineSplitter, decodeLine, decodeMessage, parseJson, skillNameFromToolUse } from './stream-codec.ts';
import type { ClaudeRunner, RunHandle, RunResult, RunSpec, RunnerEvent } from './types.ts';
import { UsageTally, assistantUsage, readSessionRecord } from './usage-tally.ts';

export interface ClaudeCliRunnerOptions {
  claudeBin?: string;
  maxConcurrent?: number;
  defaultTimeoutMs?: number;
  defaultIdleTimeoutMs?: number;
  /** Extra env for every run (e.g. FOUNDRY_CALLBACK); a function is re-evaluated per run, so settings-sourced values apply without a restart. */
  env?: Record<string, string> | (() => Record<string, string>);
  /** Claude Code's config dir (`~/.claude` unless CLAUDE_CONFIG_DIR): where a cut session's own record is read for its token counts */
  claudeHome?: string;
  log?: (msg: string) => void;
}

export class ClaudeCliRunner implements ClaudeRunner {
  private sem: Semaphore;
  private bin: string;
  private home: string;
  private running = 0;
  constructor(private opts: ClaudeCliRunnerOptions = {}) {
    this.sem = new Semaphore(opts.maxConcurrent ?? 3);
    this.bin = opts.claudeBin ?? Bun.which('claude') ?? 'claude';
    this.home = opts.claudeHome ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
  }

  active(): number {
    return this.running;
  }
  setMaxConcurrent(n: number): void {
    this.sem.setLimit(n);
  }
  wouldQueue(lane?: RunSpec['lane']): boolean {
    return !this.sem.available(lane);
  }
  /** every live child process; killed on shutdown so no session outlives the engine and keeps spending */
  private procs = new Set<ReturnType<typeof Bun.spawn>>();
  killAll(signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): number {
    let n = 0;
    for (const p of this.procs) {
      try {
        p.kill(signal);
        n++;
      } catch {}
    }
    return n;
  }

  buildArgs(spec: RunSpec): string[] {
    const a: string[] = ['-p', spec.prompt, '--output-format', 'stream-json', '--verbose'];
    if (spec.model) a.push('--model', spec.model);
    if (spec.effort) a.push('--effort', spec.effort);
    if (spec.fallbackModel) a.push('--fallback-model', spec.fallbackModel);
    if (spec.maxTurns != null) a.push('--max-turns', String(spec.maxTurns));
    if (spec.maxBudgetUsd != null) a.push('--max-budget-usd', spec.maxBudgetUsd.toFixed(2));
    if (spec.permissionMode) a.push('--permission-mode', spec.permissionMode);
    if (spec.allowedTools?.length) a.push('--allowedTools', spec.allowedTools.join(','));
    if (spec.disallowedTools?.length) a.push('--disallowedTools', spec.disallowedTools.join(','));
    if (spec.appendSystemPrompt) a.push('--append-system-prompt', spec.appendSystemPrompt);
    if (spec.appendSystemPromptFile) a.push('--append-system-prompt-file', spec.appendSystemPromptFile);
    if (spec.agents && Object.keys(spec.agents).length) a.push('--agents', JSON.stringify(spec.agents));
    if (spec.jsonSchema) a.push('--json-schema', JSON.stringify(spec.jsonSchema));
    if (spec.settings) a.push('--settings', JSON.stringify(spec.settings));
    if (spec.settingSources) a.push('--setting-sources', spec.settingSources.join(','));
    if (spec.strictMcp) a.push('--strict-mcp-config');
    for (const d of spec.addDirs ?? []) a.push('--add-dir', d);
    for (const d of spec.pluginDirs ?? []) a.push('--plugin-dir', d);
    if (spec.mcpConfig) a.push('--mcp-config', JSON.stringify(spec.mcpConfig));
    if (spec.resumeSessionId) a.push('--resume', spec.resumeSessionId);
    return a;
  }

  async run(spec: RunSpec): Promise<RunHandle> {
    const release = await this.sem.acquire(spec.lane);
    const queue = new EventQueue();
    const started = Date.now();
    const log = this.opts.log ?? (() => {});
    const timeoutMs = spec.timeoutMs ?? this.opts.defaultTimeoutMs ?? 20 * 60_000;
    const idleMs = spec.idleTimeoutMs ?? this.opts.defaultIdleTimeoutMs ?? 5 * 60_000;

    if (spec.transcriptPath) mkdirSync(dirname(spec.transcriptPath), { recursive: true });
    const transcript = (line: string) => {
      if (spec.transcriptPath) appendFileSync(spec.transcriptPath, line + '\n');
    };
    // events point back at their transcript line; a continuation appends to the same file, so count on from its end
    const refFile = spec.transcriptPath ? basename(spec.transcriptPath) : null;
    let lineNo = spec.transcriptPath ? countLines(spec.transcriptPath) : 0;

    let proc: ReturnType<typeof Bun.spawn> | null = null;
    let killReason: string | null = null;
    let lastResult: RunResult | null = null;
    let sessionId: string | null = null;
    let rateLimit: RunResult['rateLimit'] = null;
    let stderrBuf = '';
    // observed from the stream: which skills / tools the session used, and what each API message used
    const skillsUsed: string[] = [];
    const toolsUsed: Record<string, number> = {};
    const tally = new UsageTally();

    const base = (subtype: string, errorMessage: string | null): RunResult => ({
      sessionId,
      subtype,
      isError: true,
      costUsd: 0,
      numTurns: 0,
      durationMs: Date.now() - started,
      usage: null,
      modelUsage: null,
      permissionDenials: [],
      finalText: null,
      structuredOutput: null,
      exitCode: null,
      pid: proc?.pid ?? null,
      rateLimit,
      errorMessage,
      skillsUsed: [...skillsUsed],
      toolsUsed: { ...toolsUsed },
    });

    // The Bash tool keeps its cwd between calls; a second `cd apps/x && …` then fails with "(eval):cd:1: no such file".
    // This flag returns the shell to the workspace root after every command (verified to apply to `-p` sessions).
    const env = { CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR: '1', ...process.env, ...(typeof this.opts.env === 'function' ? this.opts.env() : (this.opts.env ?? {})), ...(spec.env ?? {}) } as Record<string, string>;
    // Never inherit an API key by accident: the whole point is the host login.
    delete env.ANTHROPIC_API_KEY;
    // an added account's home (ADR-0065): its own sign-in, the rest linked to the native home. A token in the environment
    // (`claude setup-token`) is the native sign-in's and would take precedence over the account's own
    if (spec.configHome) {
      env.CLAUDE_CONFIG_DIR = spec.configHome;
      delete env.CLAUDE_CODE_OAUTH_TOKEN;
      delete env.ANTHROPIC_AUTH_TOKEN;
    }

    try {
      proc = Bun.spawn([this.bin, ...this.buildArgs(spec)], { cwd: spec.cwd, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
      this.procs.add(proc);
      void proc.exited.finally(() => this.procs.delete(proc!));
    } catch (err) {
      release();
      queue.close();
      const r = base('spawn_error', String(err));
      return { pid: null, events: queue, kill() {}, result: Promise.resolve(r) };
    }
    this.running++;
    log(`[runner] spawned pid=${proc.pid} ${spec.label ?? ''} cwd=${spec.cwd}`);

    const kill = (reason: string) => {
      if (killReason || !proc) return;
      killReason = reason;
      log(`[runner] kill pid=${proc.pid} reason=${reason}`);
      try {
        proc.kill('SIGTERM');
      } catch {}
      setTimeout(() => {
        try {
          proc?.kill('SIGKILL');
        } catch {}
      }, 5000);
    };

    const wallTimer = setTimeout(() => kill('killed_timeout'), timeoutMs);
    let idleTimer = setTimeout(() => kill('killed_idle'), idleMs);
    const touch = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => kill('killed_idle'), idleMs);
    };

    const readStdout = async () => {
      const splitter = new LineSplitter();
      const reader = (proc!.stdout as ReadableStream<Uint8Array>).getReader();
      const handle = (line: string) => {
        transcript(line);
        const at = lineNo++;
        const trimmed = line.trim();
        const msg = trimmed ? parseJson(trimmed) : undefined;
        const usage = msg === undefined ? null : assistantUsage(msg);
        if (usage) tally.add(usage);
        for (const [block, decoded] of (msg === undefined ? decodeLine(line) : decodeMessage(msg)).entries()) {
          const ev: RunnerEvent = refFile ? { ...decoded, ref: { file: refFile, line: at, block } } : decoded;
          if (ev.kind === 'init') sessionId = ev.sessionId;
          if (ev.kind === 'rate_limit') rateLimit = ev.info;
          if (ev.kind === 'result') lastResult = ev.result;
          if (ev.kind === 'tool_use') {
            toolsUsed[ev.name] = (toolsUsed[ev.name] ?? 0) + 1;
            const skill = skillNameFromToolUse(ev);
            if (skill && !skillsUsed.includes(skill)) skillsUsed.push(skill);
          }
          queue.push(ev);
        }
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        touch();
        for (const line of splitter.push(value)) handle(line);
      }
      for (const line of splitter.flush()) handle(line);
    };
    const readStderr = async () => {
      const reader = (proc!.stderr as ReadableStream<Uint8Array>).getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const text = dec.decode(value);
        stderrBuf = (stderrBuf + text).slice(-8000);
        queue.push({ kind: 'stderr', text });
      }
    };

    const result: Promise<RunResult> = (async () => {
      let exitCode: number | null = null;
      try {
        await Promise.all([readStdout(), readStderr()]);
        exitCode = await proc!.exited;
      } catch (err) {
        log(`[runner] stream error: ${err}`);
      } finally {
        clearTimeout(wallTimer);
        clearTimeout(idleTimer);
        this.running--;
        release();
        queue.close();
      }
      const durationMs = Date.now() - started;
      if (lastResult) {
        const r = lastResult as RunResult;
        return { ...r, costStatus: r.costStatus ?? 'reported', sessionId: r.sessionId ?? sessionId, durationMs, exitCode, pid: proc!.pid, rateLimit, subtype: killReason ?? r.subtype, skillsUsed: [...skillsUsed], toolsUsed: { ...toolsUsed } };
      }
      const subtype = killReason ?? (exitCode === 0 ? 'no_result' : 'error_during_execution');
      // No result line, so the CLI never said what the session cost. Count what the stream and the session's own
      // record say (turns, tokens, models) and leave the dollars unknown: never book a cut session as free.
      if (sessionId) tally.addAll(readSessionRecord(spec.configHome ?? this.home, sessionId));
      const measured = tally.messages > 0;
      return {
        ...base(subtype, stderrBuf.trim() || null),
        exitCode,
        durationMs,
        costStatus: sessionId ? 'unavailable' : 'reported',
        numTurns: tally.turns(),
        usage: measured ? tally.totals() : null,
        modelUsage: measured ? tally.byModel() : null,
      };
    })();

    return { pid: proc.pid, events: queue, kill, result };
  }
}

/** lines already in a transcript (each written line ends with a newline) */
function countLines(path: string): number {
  if (!existsSync(path)) return 0;
  const buf = readFileSync(path);
  let n = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] === 10) n++;
  return n;
}
