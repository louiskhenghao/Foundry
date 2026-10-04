import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventQueue } from './event-queue.ts';
import { Semaphore } from './semaphore.ts';
import { decodeLine, LineSplitter } from './stream-codec.ts';
import { classifyFailure, type AgentRunner, type RunHandle, type RunResult, type RunSpec, type RunnerEvent } from './types.ts';

export const CODEX_DEFAULT_MODEL = 'codex-default';
export interface CodexCliRunnerOptions {
  codexBin?: string;
  codexHome?: string;
  maxConcurrent?: number;
  defaultTimeoutMs?: number;
  defaultIdleTimeoutMs?: number;
  env?: Record<string, string> | (() => Record<string, string>);
  log?: (message: string) => void;
}
const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
/** JSON strings are also valid TOML basic strings; arrays/tables need TOML separators. */
export function toToml(value: any): string {
  if (Array.isArray(value)) return `[${value.map(toToml).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}=${toToml(v)}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Codex strict output schemas require every object property in required. */
export function codexOutputSchema(schema: any): any {
  if (Array.isArray(schema)) return schema.map(codexOutputSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const result = Object.fromEntries(Object.entries(schema).filter(([key]) => !['$schema', 'default'].includes(key)).map(([key, value]) => [key, codexOutputSchema(value)]));
  if (result.properties) { result.required = Object.keys(result.properties); result.additionalProperties = false; }
  return result;
}

/** Native CLI backend. Auth stays with Codex; Foundry owns process lifetime and transcripts. */
export class CodexCliRunner implements AgentRunner {
  private sem: Semaphore;
  private procs = new Set<ReturnType<typeof Bun.spawn>>();
  constructor(private opts: CodexCliRunnerOptions = {}) { this.sem = new Semaphore(opts.maxConcurrent ?? 3); }
  active(): number { return this.procs.size; }
  setMaxConcurrent(n: number): void { this.sem.setLimit(n); }
  killAll(signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): number {
    for (const p of this.procs) { try { p.kill(signal); } catch {} }
    return this.procs.size;
  }

  buildArgs(spec: RunSpec, files: { schema?: string; canary: string; guard: string }): string[] {
    const args = ['exec', ...(spec.resumeSessionId ? ['resume', spec.resumeSessionId] : []), '--json', '--skip-git-repo-check', '--dangerously-bypass-hook-trust'];
    const config = (key: string, value: unknown) => args.push('-c', `${key}=${toToml(value)}`);
    // Override even on resume: previous thread permissions must not leak into a different role.
    config('approval_policy', 'never');
    config('sandbox_mode', this.readOnly(spec) ? 'read-only' : 'workspace-write');
    config('sandbox_workspace_write.network_access', !this.readOnly(spec));
    config('forced_login_method', 'chatgpt');
    config('model_provider', 'openai');
    config('features.hooks', true);
    // Engine orchestrates roles. Inlining the planner avoids depending on Claude's --agents protocol.
    config('features.multi_agent', false);
    config('hooks.SessionStart', [{ hooks: [{ type: 'command', command: `cat > ${shellQuote(files.canary)}` }] }]);
    config('hooks.PreToolUse', [{ hooks: [{ type: 'command', command: `${shellQuote(process.execPath)} ${shellQuote(files.guard)}`, timeout: 10 }] }]);
    if (spec.model && spec.model !== CODEX_DEFAULT_MODEL) args.push('--model', spec.model);
    if (spec.effort) config('model_reasoning_effort', spec.effort === 'max' ? 'xhigh' : spec.effort);
    const role = [spec.appendSystemPrompt, spec.appendSystemPromptFile ? readFileSync(spec.appendSystemPromptFile, 'utf8') : null,
      'You are running inside Foundry using Codex. Read the installed SKILL.md when a skill is required; there is no Claude Skill tool. Do not push, create PRs, deploy or publish: Foundry handles delivery. Do not add AI attribution to commits or PRs.',
      ...Object.entries(spec.agents ?? {}).map(([name, agent]) => `Perform the ${name} role yourself when needed:\n${agent.prompt}`),
    ].filter(Boolean).join('\n\n');
    config('developer_instructions', role);
    if (spec.addDirs?.length) config('sandbox_workspace_write.writable_roots', spec.addDirs);
    if (files.schema) args.push('--output-schema', files.schema);
    // stdin avoids argv length limits and keeps task text out of process listings.
    args.push('-');
    return args;
  }
  private readOnly(spec: RunSpec): boolean {
    return spec.permissionMode === 'plan' || !!spec.disallowedTools?.includes('Write') || !spec.allowedTools?.some((tool) => ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool));
  }

  async run(spec: RunSpec): Promise<RunHandle> {
    const release = await this.sem.acquire();
    const queue = new EventQueue();
    const started = Date.now();
    let dir: string | null = null;
    let proc: ReturnType<typeof Bun.spawn> | null = null;
    let sessionId: string | null = null;
    let model: string | null = spec.model === CODEX_DEFAULT_MODEL ? null : spec.model ?? null;
    let killed: string | null = null;
    let errorMessage: string | null = null;
    let finalText: string | null = null;
    let completed = false;
    let usage: any = null;
    let stderr = '';
    const toolsUsed: Record<string, number> = {};
    const makeResult = (subtype: string, exitCode: number | null = null): RunResult => ({
      sessionId, subtype, isError: subtype !== 'success', costUsd: 0, costStatus: 'unavailable', numTurns: completed ? 1 : 0,
      durationMs: Date.now() - started, usage, modelUsage: model ? { [model]: usage ?? {} } : null,
      permissionDenials: [], finalText, structuredOutput: null, exitCode, pid: proc?.pid ?? null,
      rateLimit: null, errorMessage, failureClass: classifyFailure(errorMessage, subtype), skillsUsed: [], toolsUsed,
    });
    try {
      dir = mkdtempSync(join(tmpdir(), 'foundry-codex-'));
      const canary = join(dir, 'canary.json');
      const policy = join(dir, 'policy.json');
      const hooksDir = fileURLToPath(new URL('../hooks/', import.meta.url));
      writeFileSync(policy, JSON.stringify({ canary, counter: join(dir, 'calls'), boundary: join(hooksDir, 'boundary-guard.sh'), readOnly: this.readOnly(spec), noTools: spec.allowedTools?.length === 0, mcpAllowed: (spec.allowedTools ?? []).filter((t) => t.startsWith('mcp__')), maxToolCalls: spec.maxTurns }));
      const schema = spec.jsonSchema ? join(dir, 'schema.json') : undefined;
      if (schema) writeFileSync(schema, JSON.stringify(codexOutputSchema(spec.jsonSchema)));
      if (spec.transcriptPath) mkdirSync(dirname(spec.transcriptPath), { recursive: true });
      let lineNo = spec.transcriptPath && existsSync(spec.transcriptPath) ? readFileSync(spec.transcriptPath, 'utf8').split('\n').length - 1 : 0;
      const args = this.buildArgs(spec, { canary, schema, guard: join(hooksDir, 'codex-guard.ts') });
      const env: Record<string, string | undefined> = { ...process.env, ...(typeof this.opts.env === 'function' ? this.opts.env() : this.opts.env), ...spec.env, ...(this.opts.codexHome ? { CODEX_HOME: this.opts.codexHome } : {}), FOUNDRY_CODEX_POLICY: policy };
      // Image tools can still receive OPENAI_API_KEY. Codex itself must use the saved ChatGPT login.
      delete env.CODEX_API_KEY;
      proc = Bun.spawn([this.opts.codexBin ?? Bun.which('codex') ?? 'codex', ...args], { cwd: spec.cwd, env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
      this.procs.add(proc);
      const child = proc;
      (child.stdin as Bun.FileSink).write(spec.prompt);
      (child.stdin as Bun.FileSink).end();
      this.opts.log?.(`[codex] spawned pid=${child.pid} ${spec.label ?? ''}`);
      let hardKill: ReturnType<typeof setTimeout> | undefined;
      const kill = (reason: string) => {
        if (killed) return;
        killed = reason;
        try { child.kill('SIGTERM'); } catch {}
        hardKill = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 5000);
      };
      const wall = setTimeout(() => kill('killed_timeout'), spec.timeoutMs ?? this.opts.defaultTimeoutMs ?? 20 * 60_000);
      const idleMs = spec.idleTimeoutMs ?? this.opts.defaultIdleTimeoutMs ?? 5 * 60_000;
      let idle = setTimeout(() => kill('killed_idle'), idleMs);
      let pendingInit: RunnerEvent | null = null;
      let verified = false;
      const verify = () => {
        if (!verified && existsSync(canary)) {
          try {
            const data = JSON.parse(readFileSync(canary, 'utf8'));
            if (data.hook_event_name !== 'SessionStart') return;
            model = data.model ?? model;
            verified = true;
            queue.push({ kind: 'hook', name: 'SessionStart:codex', outcome: 'success' });
            if (pendingInit?.kind === 'init') { queue.push({ ...pendingInit, model }); pendingInit = null; }
          } catch { /* hook may still be writing */ }
        }
      };
      const handleLine = async (line: string) => {
        if (spec.transcriptPath) appendFileSync(spec.transcriptPath, line + '\n');
        const at = lineNo++;
        let raw: any;
        try { raw = JSON.parse(line); } catch { raw = null; }
        verify();
        if (raw?.type === 'turn.started' && !verified) {
          // The CLI can emit turn.started before SessionStart hooks finish.
          const deadline = Date.now() + 10_000;
          while (!verified && !killed && Date.now() < deadline) { await Bun.sleep(25); verify(); }
          if (!verified) { errorMessage = 'Codex SessionStart guard is inactive; stopping before work.'; kill('killed_manual'); }
        }
        if (raw?.type === 'turn.completed') { completed = true; usage = raw.usage ? { ...raw.usage, input_tokens: Math.max(0, (raw.usage.input_tokens ?? 0) - (raw.usage.cached_input_tokens ?? 0)), cache_read_input_tokens: raw.usage.cached_input_tokens ?? 0 } : null; }
        if (raw?.type === 'turn.failed') errorMessage = raw.error?.message ?? 'Codex turn failed';
        for (const [block, ev] of decodeLine(line).entries()) {
          const event = spec.transcriptPath ? { ...ev, ref: { file: basename(spec.transcriptPath), line: at, block } } : ev;
          if (ev.kind === 'init') { sessionId = ev.sessionId; if (!verified) { pendingInit = event; continue; } }
          if (ev.kind === 'text') finalText = ev.text;
          if (ev.kind === 'tool_use') toolsUsed[ev.name] = (toolsUsed[ev.name] ?? 0) + 1;
          queue.push(ev.kind === 'init' ? { ...event, model } as RunnerEvent : event);
        }
      };
      const pump = async (stream: ReadableStream<Uint8Array>, stdout: boolean) => {
        const splitter = new LineSplitter();
        const reader = stream.getReader();
        for (;;) {
          const { value: chunk, done } = await reader.read();
          if (done) break;
          clearTimeout(idle); idle = setTimeout(() => kill('killed_idle'), idleMs);
          if (stdout) for (const line of splitter.push(chunk)) await handleLine(line);
          else { const text = new TextDecoder().decode(chunk); stderr = (stderr + text).slice(-8000); queue.push({ kind: 'stderr', text }); }
        }
        if (stdout) for (const line of splitter.flush()) await handleLine(line);
      };
      const result = (async (): Promise<RunResult> => {
        try {
          await Promise.all([pump(child.stdout as ReadableStream<Uint8Array>, true), pump(child.stderr as ReadableStream<Uint8Array>, false)]);
          const exitCode = await child.exited;
          verify();
          let subtype = killed ?? (exitCode === 0 && completed && !errorMessage ? 'success' : 'error_during_execution');
          if (!verified && !killed) { subtype = 'error_during_execution'; errorMessage ??= stderr.trim() || 'Codex SessionStart guard was not observed. Install a Codex CLI with hooks support.'; }
          if (subtype !== 'success') errorMessage ??= stderr.trim() || subtype;
          const r = makeResult(subtype, exitCode);
          if (spec.jsonSchema && !r.isError) {
            try { r.structuredOutput = JSON.parse(finalText ?? ''); }
            catch { r.isError = true; r.subtype = 'error_during_execution'; r.errorMessage = 'Codex did not return valid structured JSON'; r.failureClass = 'other'; }
          }
          queue.push({ kind: 'result', result: r });
          return r;
        } catch (error) {
          errorMessage = String(error); kill('error_during_execution'); await child.exited;
          return makeResult(killed!);
        } finally {
          clearTimeout(wall); clearTimeout(idle); clearTimeout(hardKill);
          this.procs.delete(child); release(); queue.close();
          if (dir) rmSync(dir, { recursive: true, force: true });
        }
      })();
      return { pid: child.pid, events: queue, kill, result };
    } catch (error) {
      if (proc) { try { proc.kill('SIGKILL'); await proc.exited; } catch {} this.procs.delete(proc); }
      if (dir) rmSync(dir, { recursive: true, force: true });
      release(); queue.close(); errorMessage = String(error);
      return { pid: null, events: queue, kill() {}, result: Promise.resolve(makeResult('spawn_error')) };
    }
  }
}
