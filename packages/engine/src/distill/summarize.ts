import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ClaudeRunner, RunResult } from '@foundry/runner';
import { truncateOutput } from './truncate.ts';

const Summary = z.object({
  summary: z.string().describe('2-5 sentences: what ran, what failed, the root-cause error(s).'),
  keyErrors: z.array(z.string()).describe('Verbatim error lines worth keeping, max 8.'),
});

/** Threshold above which we pay for a cheap-model summary instead of relying on truncation alone. */
export const SUMMARIZE_ABOVE_BYTES = 12_000;

/**
 * Cheap-model distillation of a huge check output. Returns the structural truncation if the
 * model is unavailable or fails — never throws.
 */
export async function summarizeOutput(runner: ClaudeRunner, raw: string, opts: { model: string; cwd: string; onCost?: (usd: number) => void; onResult?: (r: RunResult) => void }): Promise<string> {
  const structural = truncateOutput(raw);
  if (raw.length < SUMMARIZE_ABOVE_BYTES) return structural;
  try {
    const head = raw.slice(0, 30_000);
    const tail = raw.length > 60_000 ? raw.slice(-30_000) : raw.slice(30_000);
    const handle = await runner.run({
      prompt: `Summarize this command output for an engineer who must fix the failure. Output JSON only.\n\n--- head ---\n${head}\n${raw.length > 60_000 ? `--- [${raw.length - 60_000} bytes omitted] ---\n` : ''}--- tail ---\n${tail}`,
      cwd: opts.cwd,
      model: opts.model,
      maxTurns: 1,
      maxBudgetUsd: 0.1,
      permissionMode: 'dontAsk',
      allowedTools: [],
      disallowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Task', 'WebFetch', 'WebSearch'],
      jsonSchema: zodToJsonSchema(Summary, { $refStrategy: 'none' }),
      timeoutMs: 90_000,
      label: 'distill',
    });
    for await (const _ of handle.events) {
      /* drain */
    }
    const r = await handle.result;
    opts.onCost?.(r.costUsd);
    opts.onResult?.(r);
    const parsed = Summary.safeParse(r.structuredOutput ?? safeJson(r.finalText));
    if (!parsed.success) return structural;
    return `${parsed.data.summary}\n\nKey errors:\n${parsed.data.keyErrors.map((e) => `- ${e}`).join('\n')}\n\n(structural excerpt)\n${structural.slice(0, 2000)}`;
  } catch {
    return structural;
  }
}

function safeJson(s: string | null): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    const m = s.match(/\{[\s\S]*\}/);
    try {
      return m ? JSON.parse(m[0]) : null;
    } catch {
      return null;
    }
  }
}
