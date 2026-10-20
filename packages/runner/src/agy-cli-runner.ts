import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgyStreamDecoder, agyUsage } from './agy-stream-codec.ts';
import { EventQueue } from './event-queue.ts';
import { Semaphore } from './semaphore.ts';
import { LineSplitter } from './stream-codec.ts';
import { classifyFailure, type AgentRunner, type RunHandle, type RunResult, type RunSpec, type RunnerEvent } from './types.ts';

/** `agy-default`: the model the CLI itself is set to (no --model on the command line) */
export const AGY_DEFAULT_MODEL = 'agy-default';
/** the workspace hooks file the CLI reads: Foundry's session canary and tool guard go in before a run and out after it */
export const AGY_HOOKS_FILE = '.agents/hooks.json';
export const AGY_EFFORTS = ['low', 'medium', 'high'] as const;
export type AgyEffort = (typeof AGY_EFFORTS)[number];

export interface AgyCliRunnerOptions {
  agyBin?: string;
  maxConcurrent?: number;
  env?: Record<string, string | undefined> | (() => Record<string, string | undefined>);
  log?: (message: string) => void;
  defaultTimeoutMs?: number;
  defaultIdleTimeoutMs?: number;
}

const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

/** Foundry's effort words on the CLI's three levels */
export function agyEffort(effort: RunSpec['effort'] | null | undefined): AgyEffort | null {
  if (!effort) return null;
  if (effort === 'medium') return 'medium';
  return ['none', 'minimal', 'low'].includes(effort) ? 'low' : 'high';
}

/** the role text goes ahead of the task: the CLI has no developer-instructions switch */
export function agyPrompt(spec: RunSpec): string {
  const role = [
    spec.appendSystemPrompt,
    spec.appendSystemPromptFile ? readFileSync(spec.appendSystemPromptFile, 'utf8') : null,
    'You are running inside Foundry using the Antigravity CLI. Read the installed SKILL.md when a skill is required; there is no Skill tool. Do not push, create PRs, deploy or publish: Foundry handles delivery. Do not ask the person questions: decide, note the decision, and go on.',
    ...Object.entries(spec.agents ?? {}).map(([name, agent]) => `Perform the ${name} role yourself when needed:\n${agent.prompt}`),
  ].filter(Boolean).join('\n\n');
  return `# Role\n\n${role}\n\n# Task\n\n${spec.prompt}`;
}

/** what Foundry adds to the workspace hooks file for one session: its canary at the start, its guard before every tool */
export function agyHooksEntry(files: { canary: string; guard: string; policy: string }): unknown {
  return {
    SessionStart: [{ hooks: [{ type: 'command', command: `cat > ${shellQuote(files.canary)}`, timeout: 10 }] }],
    PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: `${shellQuote(process.execPath)} ${shellQuote(files.guard)} ${shellQuote(files.policy)}`, timeout: 15 }] }],
  };
}

// The hooks file is the workspace's, shared by every session in that folder: entries come and go per session, the
// person's own entries stay, and the file goes when the last Foundry entry does and there was none before. Two
// sessions in one folder run each other's guards too; a guard only ever denies, so the stricter policy wins.
const hooksFiles = new Map<string, { original: string | null; entries: Map<string, unknown> }>();
function installHooks(cwd: string, key: string, entry: unknown): () => void {
  const path = join(cwd, AGY_HOOKS_FILE);
  let state = hooksFiles.get(path);
  if (!state) {
    state = { original: existsSync(path) ? readFileSync(path, 'utf8') : null, entries: new Map() };
    hooksFiles.set(path, state);
    excludeFromGit(cwd, AGY_HOOKS_FILE);
  }
  const current = state;
  const write = () => {
    if (!current.entries.size) {
      if (current.original === null) rmSync(path, { force: true });
      else writeFileSync(path, current.original);
      hooksFiles.delete(path);
      return;
    }
    let base: Record<string, unknown> = {};
    try {
      base = current.original ? (JSON.parse(current.original) as Record<string, unknown>) : {};
    } catch {
      base = {};
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ ...base, ...Object.fromEntries(current.entries) }, null, 2) + '\n');
  };
  current.entries.set(key, entry);
  write();
  return () => {
    current.entries.delete(key);
    write();
  };
}

/** keep the hooks file out of the worker's commits: `git add -A` in the worktree would take it along */
function excludeFromGit(cwd: string, pattern: string): void {
  try {
    const r = Bun.spawnSync(['git', 'rev-parse', '--git-path', 'info/exclude'], { cwd, stdout: 'pipe', stderr: 'ignore', timeout: 5000 });
    if (r.exitCode !== 0) return;
    const file = r.stdout.toString().trim();
    const path = file.startsWith('/') ? file : join(cwd, file);
    const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
    if (text.split('\n').includes(pattern)) return;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${pattern}\n`);
  } catch {
    // not a repository: nothing to exclude
  }
}

/**
 * The Antigravity CLI (`agy`) as a Foundry backend: one turn per session over its stream-json protocol, the prompt
 * sent as a `user` event on stdin (no argv limit, nothing in the process list), the role text ahead of it, structured
 * output through `--json-schema`, a conversation resumed by its id. Foundry's guard is a PreToolUse hook and its canary a
 * SessionStart hook in the workspace hooks file; a session whose canary never appears is stopped before it works.
 */
export class AgyCliRunner implements AgentRunner {
  private sem: Semaphore;
  private procs = new Map<ReturnType<typeof Bun.spawn>, (signal: 'SIGTERM' | 'SIGKILL') => void>();
  constructor(private opts: AgyCliRunnerOptions = {}) {
    this.sem = new Semaphore(opts.maxConcurrent ?? 3);
  }
  active(): number {
    return this.procs.size;
  }
  setMaxConcurrent(n: number): void {
    this.sem.setLimit(n);
  }
  wouldQueue(lane?: RunSpec['lane']): boolean {
    return !this.sem.available(lane);
  }
  killAll(signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): number {
    for (const kill of this.procs.values()) kill(signal);
    return this.procs.size;
  }

  buildArgs(spec: RunSpec, files: { schema?: string }): string[] {
    const args = ['--input-format', 'stream-json', '--output-format', 'stream-json', '--disable-slash-commands', '--dangerously-skip-permissions'];
    if (spec.resumeSessionId) args.push('--conversation', spec.resumeSessionId);
    if (spec.model && spec.model !== AGY_DEFAULT_MODEL) args.push('--model', spec.model);
    const effort = agyEffort(spec.effort);
    if (effort) args.push('--effort', effort);
    if (files.schema) args.push('--json-schema', files.schema);
    // the CLI's own deadline a minute past Foundry's: a silent turn never waits forever
    args.push('--print-timeout', `${Math.max(1, Math.ceil((spec.timeoutMs ?? this.opts.defaultTimeoutMs ?? 20 * 60_000) / 60_000) + 1)}m`);
    return args;
  }
  private readOnly(spec: RunSpec): boolean {
    return spec.permissionMode === 'plan' || !!spec.disallowedTools?.includes('Write') || !spec.allowedTools?.some((tool) => ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool));
  }

  async run(spec: RunSpec): Promise<RunHandle> {
    const release = await this.sem.acquire(spec.lane);
    const queue = new EventQueue();
    const started = Date.now();
    const decoder = new AgyStreamDecoder();
    let dir: string | null = null;
    let proc: ReturnType<typeof Bun.spawn> | null = null;
    let terminate: ((signal?: 'SIGTERM' | 'SIGKILL') => Promise<void>) | null = null;
    let removeHooks: (() => void) | null = null;
    let sessionId: string | null = null;
    let model: string | null = spec.model === AGY_DEFAULT_MODEL ? null : (spec.model ?? null);
    let killed: string | null = null;
    let errorMessage: string | null = null;
    let finalText: string | null = null;
    let stderr = '';
    const toolsUsed: Record<string, number> = {};
    const permissionDenials: RunResult['permissionDenials'] = [];
    const makeResult = (subtype: string, exitCode: number | null = null): RunResult => ({
      sessionId, subtype, isError: subtype !== 'success', costUsd: 0, costStatus: 'unavailable', numTurns: decoder.result?.num_turns ?? (decoder.result ? 1 : 0),
      durationMs: Date.now() - started, usage: agyUsage(decoder.result?.usage), modelUsage: model ? { [model]: agyUsage(decoder.result?.usage) ?? {} } : null,
      permissionDenials, finalText, structuredOutput: null, exitCode, pid: proc?.pid ?? null,
      rateLimit: null, errorMessage, failureClass: classifyFailure(errorMessage, subtype), skillsUsed: [], toolsUsed,
    });
    try {
      dir = mkdtempSync(join(tmpdir(), 'foundry-agy-'));
      const canary = join(dir, 'canary.json');
      const policy = join(dir, 'policy.json');
      const capped = join(dir, 'capped');
      const hooksDir = fileURLToPath(new URL('../hooks/', import.meta.url));
      writeFileSync(policy, JSON.stringify({ canary, counter: join(dir, 'calls'), capped, boundary: join(hooksDir, 'boundary-guard.sh'), readOnly: this.readOnly(spec), noTools: spec.allowedTools?.length === 0, maxToolCalls: spec.maxTurns }));
      const schema = spec.jsonSchema ? join(dir, 'schema.json') : undefined;
      if (schema) writeFileSync(schema, JSON.stringify(spec.jsonSchema));
      if (spec.transcriptPath) mkdirSync(dirname(spec.transcriptPath), { recursive: true });
      let lineNo = spec.transcriptPath && existsSync(spec.transcriptPath) ? readFileSync(spec.transcriptPath, 'utf8').split('\n').length - 1 : 0;
      removeHooks = installHooks(spec.cwd, `foundry-${basename(dir)}`, agyHooksEntry({ canary, guard: join(hooksDir, 'agy-guard.ts'), policy }));
      const args = this.buildArgs(spec, { schema });
      const env: Record<string, string | undefined> = { ...process.env, ...(typeof this.opts.env === 'function' ? this.opts.env() : this.opts.env), ...spec.env, FOUNDRY_AGY_POLICY: policy };
      proc = Bun.spawn([this.opts.agyBin ?? Bun.which('agy') ?? 'agy', ...args], { cwd: spec.cwd, env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', detached: process.platform !== 'win32' });
      const child = proc;
      const group = process.platform !== 'win32';
      const signalOwned = (signal: 'SIGTERM' | 'SIGKILL') => {
        try {
          if (group) process.kill(-child.pid, signal);
          else child.kill(signal);
        } catch {}
      };
      const alive = () => {
        if (!group) return child.exitCode === null;
        try {
          process.kill(-child.pid, 0);
          return true;
        } catch {
          return false;
        }
      };
      let cleanup: Promise<void> | null = null;
      terminate = (signal = 'SIGTERM') => {
        if (cleanup) return cleanup;
        if (!alive()) return (cleanup = Promise.resolve());
        signalOwned(signal);
        // the forced group cleanup stays armed even if the CLI exits before a tool child
        cleanup = signal === 'SIGKILL' ? Promise.resolve() : new Promise((resolve) => setTimeout(() => { signalOwned('SIGKILL'); resolve(); }, 1000));
        return cleanup;
      };
      const kill = (reason: string, signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM') => {
        killed ??= reason;
        void terminate!(signal);
      };
      this.procs.set(child, (signal) => kill('killed_manual', signal));
      (child.stdin as Bun.FileSink).write(JSON.stringify({ event: 'user', message: { content: agyPrompt(spec) } }) + '\n');
      (child.stdin as Bun.FileSink).end();
      this.opts.log?.(`[agy] spawned pid=${child.pid} ${spec.label ?? ''}`);
      const wall = setTimeout(() => kill('killed_timeout'), spec.timeoutMs ?? this.opts.defaultTimeoutMs ?? 20 * 60_000);
      const idleMs = spec.idleTimeoutMs ?? this.opts.defaultIdleTimeoutMs ?? 5 * 60_000;
      let idle = setTimeout(() => kill('killed_idle'), idleMs);
      let pendingInit: RunnerEvent | null = null;
      let verified = false;
      const verify = () => {
        if (verified || !existsSync(canary)) return;
        try {
          const data = JSON.parse(readFileSync(canary, 'utf8') || 'null');
          if (!data || typeof data !== 'object') return;
          model = typeof data.modelName === 'string' && data.modelName ? data.modelName : model;
          verified = true;
          queue.push({ kind: 'hook', name: 'SessionStart:agy', outcome: 'success' });
          if (pendingInit?.kind === 'init') {
            queue.push({ ...pendingInit, model });
            pendingInit = null;
          }
        } catch {
          // the hook may still be writing
        }
      };
      const handleLine = async (line: string) => {
        if (spec.transcriptPath) appendFileSync(spec.transcriptPath, line + '\n');
        const at = lineNo++;
        let raw: any;
        try {
          raw = JSON.parse(line);
        } catch {
          raw = null;
        }
        verify();
        if (raw?.event === 'init' && !verified) {
          // the session starts before its SessionStart hooks have run; without the canary nothing may run
          const deadline = Date.now() + 10_000;
          while (!verified && !killed && Date.now() < deadline) {
            await Bun.sleep(25);
            verify();
          }
          if (!verified) {
            errorMessage = 'Antigravity SessionStart guard is inactive; stopping before work.';
            kill('killed_manual');
          }
        }
        for (const [block, ev] of decoder.decode(raw).entries()) {
          const event = spec.transcriptPath ? { ...ev, ref: { file: basename(spec.transcriptPath), line: at, block } } : ev;
          if (ev.kind === 'init') {
            sessionId = ev.sessionId || sessionId;
            model = ev.model ?? model;
            if (!verified) {
              pendingInit = event;
              continue;
            }
          }
          if (ev.kind === 'text') finalText = ev.text;
          if (ev.kind === 'tool_use') toolsUsed[ev.name] = (toolsUsed[ev.name] ?? 0) + 1;
          queue.push(ev.kind === 'init' ? ({ ...event, model } as RunnerEvent) : event);
        }
      };
      const pump = async (stream: ReadableStream<Uint8Array>, stdout: boolean) => {
        const splitter = new LineSplitter();
        const reader = stream.getReader();
        for (;;) {
          const { value: chunk, done } = await reader.read();
          if (done) break;
          clearTimeout(idle);
          idle = setTimeout(() => kill('killed_idle'), idleMs);
          if (stdout) for (const line of splitter.push(chunk)) await handleLine(line);
          else {
            const text = new TextDecoder().decode(chunk);
            stderr = (stderr + text).slice(-8000);
            queue.push({ kind: 'stderr', text });
          }
        }
        if (stdout) for (const line of splitter.flush()) await handleLine(line);
      };
      const result = (async (): Promise<RunResult> => {
        try {
          await Promise.all([pump(child.stdout as ReadableStream<Uint8Array>, true), pump(child.stderr as ReadableStream<Uint8Array>, false)]);
          const exitCode = await child.exited;
          verify();
          const r = decoder.result;
          sessionId = sessionId ?? r?.conversation_id ?? null;
          if (r?.response) finalText = r.response;
          // the CLI's structured error line, when a model or agent failure ended the run (exit 3)
          const structuredError = /^AGY_ERROR:\s*(\{.*\})\s*$/m.exec(stderr);
          if (structuredError) {
            try {
              const e = JSON.parse(structuredError[1]!);
              errorMessage ??= String(e.message ?? e.error ?? e.status ?? structuredError[1]);
            } catch {
              errorMessage ??= structuredError[1]!;
            }
          }
          if (r && r.status !== 'SUCCESS') errorMessage ??= r.error ? String(r.error) : `the Antigravity CLI ended the run as ${r.status ?? 'unknown'}`;
          // a known print-mode defect: a turn that silently produced nothing reports SUCCESS with an empty answer
          const empty = !!r && r.status === 'SUCCESS' && !r.response && r.structured_output == null && !(r.usage?.total_tokens ?? 0);
          if (empty) errorMessage ??= 'the Antigravity CLI returned an empty response';
          let subtype = killed ?? (exitCode === 0 && r?.status === 'SUCCESS' && !errorMessage && !empty ? 'success' : 'error_during_execution');
          if (!verified && !killed) {
            subtype = 'error_during_execution';
            errorMessage ??= stderr.trim() || 'Antigravity SessionStart guard was not observed: the CLI did not run the workspace hooks file.';
          }
          // it ran into the tool-call allowance: cut, not finished, so the attempt loop continues it
          if (subtype === 'success' && existsSync(capped)) {
            subtype = 'error_max_turns';
            errorMessage ??= 'Foundry tool-call allowance reached';
          }
          if (subtype !== 'success') errorMessage ??= stderr.trim() || subtype;
          for (const d of Array.isArray(r?.denied_actions) ? r!.denied_actions : []) {
            const name = typeof d === 'string' ? d : String((d as any)?.tool ?? (d as any)?.name ?? (d as any)?.action ?? 'tool');
            if (name.length <= 512) permissionDenials.push({ tool_name: name, tool_input: {} });
          }
          const out = makeResult(subtype, exitCode);
          if (spec.jsonSchema && !out.isError) {
            try {
              out.structuredOutput = r?.structured_output ?? JSON.parse(finalText ?? '');
            } catch {
              out.isError = true;
              out.subtype = 'error_during_execution';
              out.errorMessage = 'the Antigravity CLI did not return valid structured JSON';
              out.failureClass = 'other';
            }
          }
          queue.push({ kind: 'result', result: out });
          return out;
        } catch (error) {
          errorMessage = String(error);
          kill('error_during_execution');
          await child.exited;
          return makeResult(killed!);
        } finally {
          clearTimeout(wall);
          clearTimeout(idle);
          await terminate!();
          removeHooks?.();
          removeHooks = null;
          this.procs.delete(child);
          release();
          queue.close();
          if (dir) rmSync(dir, { recursive: true, force: true });
        }
      })();
      return { pid: child.pid, events: queue, kill, result };
    } catch (error) {
      if (proc) {
        try {
          await terminate?.('SIGKILL');
          await proc.exited;
        } catch {}
        this.procs.delete(proc);
      }
      removeHooks?.();
      if (dir) rmSync(dir, { recursive: true, force: true });
      release();
      queue.close();
      errorMessage = String(error);
      return { pid: null, events: queue, kill() {}, result: Promise.resolve(makeResult('spawn_error')) };
    }
  }
}
