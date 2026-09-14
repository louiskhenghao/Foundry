import { classifyFailure, type RateLimitInfo, type RunnerEvent } from './types.ts';

/**
 * Parses one `stream-json` NDJSON line from `claude -p --output-format stream-json --verbose`
 * into zero or more RunnerEvents. Unknown shapes become `unknown` events.
 *
 * Observed message types (claude 2.1.x):
 *   system/init, system/hook_started, system/hook_response, system/thinking_tokens,
 *   assistant (content: thinking|text|tool_use), user (content: tool_result),
 *   rate_limit_event, result, stream_event (with --include-partial-messages).
 */
export function decodeLine(line: string): RunnerEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  let msg: any;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return [{ kind: 'stderr', text: trimmed }];
  }
  return decodeMessage(msg);
}

export function decodeMessage(msg: any): RunnerEvent[] {
  if (!msg || typeof msg !== 'object') return [{ kind: 'unknown', raw: msg }];
  switch (msg.type) {
    case 'system': {
      if (msg.subtype === 'init') {
        return [{ kind: 'init', sessionId: String(msg.session_id ?? ''), model: msg.model ?? null, tools: Array.isArray(msg.tools) ? msg.tools : [], raw: msg }];
      }
      if (msg.subtype === 'hook_started' || msg.subtype === 'hook_response') {
        return [{ kind: 'hook', name: String(msg.hook_name ?? msg.hook_event ?? ''), outcome: msg.outcome ?? null }];
      }
      return []; // thinking_tokens etc: noise
    }
    case 'assistant': {
      const out: RunnerEvent[] = [];
      for (const block of msg.message?.content ?? []) {
        if (block.type === 'text' && block.text) out.push({ kind: 'text', text: block.text });
        else if (block.type === 'thinking' && block.thinking) out.push({ kind: 'thinking', text: block.thinking });
        else if (block.type === 'tool_use') out.push({ kind: 'tool_use', id: String(block.id), name: String(block.name), input: block.input });
      }
      return out;
    }
    case 'user': {
      const out: RunnerEvent[] = [];
      const content = msg.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_result') {
            out.push({ kind: 'tool_result', toolUseId: String(block.tool_use_id), isError: !!block.is_error, content: flattenContent(block.content) });
          }
        }
      }
      return out;
    }
    case 'rate_limit_event':
      return [{ kind: 'rate_limit', info: rateLimit(msg.rate_limit_info) }];
    case 'result': {
      const subtype = msg.subtype ?? (msg.is_error ? 'error_during_execution' : 'success');
      const errorMessage = Array.isArray(msg.errors) && msg.errors.length ? String(msg.errors[0]) : msg.is_error && typeof msg.result === 'string' ? msg.result : null;
      return [
        {
          kind: 'result',
          result: {
            sessionId: msg.session_id ?? null,
            subtype,
            isError: !!msg.is_error,
            costUsd: Number(msg.total_cost_usd ?? 0),
            numTurns: Number(msg.num_turns ?? 0),
            durationMs: Number(msg.duration_ms ?? 0),
            usage: msg.usage ?? null,
            modelUsage: msg.modelUsage ?? null,
            permissionDenials: Array.isArray(msg.permission_denials) ? msg.permission_denials : [],
            finalText: typeof msg.result === 'string' ? msg.result : null,
            structuredOutput: msg.structured_output ?? (typeof msg.result === 'object' ? msg.result : null),
            exitCode: null,
            pid: null,
            rateLimit: null,
            errorMessage,
            failureClass: classifyFailure(errorMessage, subtype),
            skillsUsed: [],
            toolsUsed: {},
          },
        },
      ];
    }
    case 'tool_progress':
      // heartbeat for a long tool call (the planner sub-agent runs for minutes): the log would otherwise go silent
      return [{ kind: 'progress', toolUseId: String(msg.tool_use_id ?? '').replace(/-heartbeat-\d+$/, ''), tool: String(msg.tool_name ?? 'tool'), elapsedSeconds: Number(msg.elapsed_time_seconds ?? 0) }];
    case 'stream_event':
      return [];
    default:
      return [{ kind: 'unknown', raw: msg }];
  }
}

/**
 * Name of the skill a `Skill` tool_use invokes, or null for other tools.
 * Claude Code 2.1.x sends `{ skill: "name" | "plugin:name", args? }`; older builds used `command`.
 */
export function skillNameFromToolUse(ev: { kind: string; name?: string; input?: unknown }): string | null {
  if (ev.kind !== 'tool_use' || ev.name !== 'Skill') return null;
  const input: any = ev.input ?? {};
  const raw = input.skill ?? input.command ?? input.name ?? Object.values(input).find((v) => typeof v === 'string');
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return raw.trim().split(/\s+/)[0]!.replace(/^\/+/, '');
}

function flattenContent(c: unknown): string {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((b) => (typeof b === 'string' ? b : b?.text ?? '')).join('\n');
  return c == null ? '' : JSON.stringify(c);
}

function rateLimit(info: any): RateLimitInfo {
  return {
    status: String(info?.status ?? 'unknown'),
    resetsAt: typeof info?.resetsAt === 'number' ? info.resetsAt : null,
    rateLimitType: info?.rateLimitType ?? null,
    isUsingOverage: !!info?.isUsingOverage,
    raw: info,
  };
}

/** Splits a byte stream into complete lines, keeping a partial tail. */
export class LineSplitter {
  private buf = '';
  private decoder = new TextDecoder();
  push(chunk: Uint8Array): string[] {
    this.buf += this.decoder.decode(chunk, { stream: true });
    const parts = this.buf.split('\n');
    this.buf = parts.pop() ?? '';
    return parts;
  }
  flush(): string[] {
    const rest = this.buf;
    this.buf = '';
    return rest ? [rest] : [];
  }
}
