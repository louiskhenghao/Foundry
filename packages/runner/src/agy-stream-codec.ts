import type { RunnerEvent } from './types.ts';

/** the terminal record of a run: the `json` envelope, and the `result` event of `stream-json` */
export interface AgyResult {
  conversation_id?: string;
  status?: string;
  response?: string;
  error?: string;
  duration_seconds?: number;
  num_turns?: number;
  structured_output?: unknown;
  usage?: { input_tokens?: number; output_tokens?: number; thinking_tokens?: number; cache_read_tokens?: number; total_tokens?: number };
  denied_actions?: unknown;
}

/** token usage the way the ledger counts it: the cached part of the input apart, the thinking tokens kept */
export function agyUsage(u: AgyResult['usage'] | null | undefined): Record<string, number> | null {
  if (!u) return null;
  const cached = u.cache_read_tokens ?? 0;
  return { input_tokens: Math.max(0, (u.input_tokens ?? 0) - cached), cache_read_input_tokens: cached, output_tokens: u.output_tokens ?? 0, thinking_tokens: u.thinking_tokens ?? 0, total_tokens: u.total_tokens ?? 0 };
}

/**
 * Decode the Antigravity CLI's stream-json, one record at a time. An `agent_response` step streams `text_delta`
 * fragments over several records; the decoder joins them and gives one text event when the step is done, so the live
 * feed and a reopened transcript show paragraphs, not fragments. A `tool` step carries its call and its output in one
 * record. Records of kinds the CLI may add later come through as `unknown`.
 */
export class AgyStreamDecoder {
  private text = new Map<number, string>();
  result: AgyResult | null = null;
  /** `deltas`: every text fragment is also given as it comes (`text_delta`), for a feed that shows the answer being written */
  constructor(private opts: { deltas?: boolean } = {}) {}

  decode(msg: any): RunnerEvent[] {
    if (!msg || typeof msg !== 'object') return [{ kind: 'unknown', raw: msg }];
    if (msg.event === 'init') {
      const init = msg.init ?? {};
      return [{ kind: 'init', sessionId: String(msg.conversation_id ?? init.conversation_id ?? ''), model: init.model ?? null, tools: Array.isArray(init.tools) ? init.tools.map(String) : [], raw: msg }];
    }
    if (msg.event === 'result') {
      this.result = (msg.result ?? {}) as AgyResult;
      return this.result.status && this.result.status !== 'SUCCESS' && this.result.error ? [{ kind: 'stderr', text: String(this.result.error) }] : [];
    }
    if (msg.event !== 'step_update' || !msg.step_update) return [{ kind: 'unknown', raw: msg }];
    const s = msg.step_update;
    const index = Number(s.step_index ?? -1);
    if (s.step_type === 'agent_response') {
      const fragment = String(s.text_delta ?? '');
      const soFar = (this.text.get(index) ?? '') + fragment;
      const delta: RunnerEvent[] = this.opts.deltas && fragment ? [{ kind: 'text_delta', text: fragment }] : [];
      if (s.state !== 'DONE') {
        this.text.set(index, soFar);
        return delta;
      }
      this.text.delete(index);
      return soFar ? [...delta, { kind: 'text', text: soFar }] : delta;
    }
    if (s.step_type === 'tool') {
      if (s.state !== 'DONE') return [];
      const info = s.tool_info ?? {};
      const id = `step-${index}`;
      const output = info.error ? JSON.stringify(info.error) : typeof info.output === 'string' ? info.output : info.output == null ? '' : JSON.stringify(info.output);
      return [
        { kind: 'tool_use', id, name: String(s.tool_name ?? info.name ?? 'tool'), input: info.parameters ?? {} },
        { kind: 'tool_result', toolUseId: id, isError: !!info.error, content: output },
      ];
    }
    if (s.subagent_info) return s.state === 'DONE' ? [{ kind: 'tool_use', id: `step-${index}`, name: 'Agent', input: s.subagent_info }] : [];
    if (s.step_type === 'user_input' || s.step_type === 'checkpoint' || s.step_type === 'system_message') return [];
    return [{ kind: 'unknown', raw: msg }];
  }
}

/** every event of a stored stream-json transcript, for reopening it */
export function decodeAgyLines(lines: Iterable<string>): RunnerEvent[] {
  const decoder = new AgyStreamDecoder();
  const out: RunnerEvent[] = [];
  for (const line of lines) {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    out.push(...decoder.decode(raw));
  }
  return out;
}
