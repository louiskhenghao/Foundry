import type { Check, CheckResult } from '@foundry/core/browser';
import { useState } from 'react';
import { api } from '../../api.ts';
import { CodeView } from '../../components/FilePreview.tsx';
import { JsonTree, parseJsonDoc } from '../../components/JsonTree.tsx';
import { MarkdownPanel } from '../../components/Markdown.tsx';
import { Badge, CopyButton, Modal, ago, cn } from '../../ui.tsx';
import { CHECK_RESULT, CheckSquare } from './CompletionCard.tsx';

const WHAT: Record<Check['spec']['type'], string> = {
  command: 'Runs a command; passes when it exits as expected.',
  reviewer: 'An AI reviewer reads the diff and judges it against this rubric.',
  'llm-judge': 'An AI judge answers this prompt.',
  selfcheck: 'Opens the preview in a headless browser, takes a screenshot and fails on console, page or network errors. No AI involved.',
  figure: 'Opens each page the task delivered under artifacts/ in a headless browser, screenshots it (and its see-through) and fails on script errors or a page that drew nothing. No AI involved.',
};

/** a section's label in the dialog, in small capitals */
const LABEL = 'text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink';

/**
 * A run's output the way it reads best: a command's as numbered lines, an AI verdict as Markdown (Preview / Raw), and
 * output that is one JSON document as a tree.
 */
function OutputView({ text, type }: { text: string; type: Check['spec']['type'] }) {
  if (!text) return <div className="text-ink-faint">(no output)</div>;
  const json = parseJsonDoc(text.trim());
  if (json !== undefined && typeof json === 'object' && json !== null) return <JsonTree value={json} />;
  if (type === 'reviewer' || type === 'llm-judge') return <MarkdownPanel title="verdict" source={text} maxHeight={420} />;
  return <CodeView text={text} name="output.txt" className="max-h-[45vh]" />;
}

/**
 * One acceptance check: what it checks, every run it had (newest first; picking one shows its output) and the output
 * of the picked run — the summary Foundry kept by default, the whole output on request.
 */
export function CheckDialog({ goalId, check, results, taskName, initial, onClose }: { goalId: string; check: Check; results: CheckResult[]; taskName: string; initial: CheckResult | undefined; onClose: () => void }) {
  const runs = [...results].filter((r) => r.checkId === check.id).sort((a, b) => b.at.localeCompare(a.at));
  const [picked, setPicked] = useState<CheckResult | undefined>(initial ?? runs[0]);
  // the whole output of one run, kept with the run it belongs to so another run never shows it
  const [loaded, setLoaded] = useState<{ id: string; text: string } | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ id: string; error: string } | null>(null);
  const loadFull = async () => {
    if (!picked) return;
    const id = picked.id;
    setLoading(id);
    setFailed(null);
    try {
      setLoaded({ id, text: (await api.checkOutput(goalId, id)).text });
    } catch (e) {
      setFailed({ id, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading((l) => (l === id ? null : l));
    }
  };
  const spec = check.spec;
  const full = loaded && loaded.id === picked?.id ? loaded.text : null;
  const error = failed && failed.id === picked?.id ? failed.error : null;
  const output = full ?? picked?.summary ?? '';
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={
        // the check as the Acceptance list shows it: its square, its tier in capitals, its name
        <span className="flex items-center gap-2 min-w-0">
          <CheckSquare mark={CHECK_RESULT[initial?.status ?? 'none'].mark} />
          <span className="shrink-0 rounded-sm px-1.5 py-0.5 text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-ink-soft ring-1 ring-inset ring-line-strong" title={check.tier}>{check.tier}</span>
          <span className="truncate">{check.name}</span>
        </span>
      }
    >
      <div className="space-y-5 text-xs">
        <section className="space-y-2">
          <div className="text-[13px] text-ink-soft">
            {WHAT[spec.type]} <span className="text-ink-faint">· {taskName === 'goal' ? 'checks the whole goal' : `checks the task "${taskName}"`}</span>
          </div>
          {spec.type === 'command' && (
            <div className="flex items-start gap-2">
              <pre className="mono flex-1 min-w-0 rounded-md bg-sunken border border-line px-2.5 py-2 text-[11.5px] text-ink whitespace-pre-wrap break-all">{spec.cmd}</pre>
              <CopyButton text={spec.cmd} />
            </div>
          )}
          {spec.type === 'command' && <div className="text-[11px] text-ink-faint">expects exit code <span className="mono">{spec.expectExitCode}</span>{spec.cwd ? ` · in ${spec.cwd}` : ''} · times out after <span className="mono">{Math.round(spec.timeoutMs / 1000)}</span> s</div>}
          {spec.type === 'reviewer' && <MarkdownPanel title={`rubric · ${spec.scope === 'task-diff' ? 'the task diff' : 'the goal diff'}`} source={spec.rubric} maxHeight={200} />}
          {spec.type === 'llm-judge' && <MarkdownPanel title="prompt" source={spec.prompt} maxHeight={200} />}
        </section>

        {runs.length > 1 && (
          <section className="space-y-2">
            <div className={LABEL}>Runs ({runs.length})</div>
            {/* the run shown below is marked by a bar in the accent */}
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
              {runs.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => setPicked(r)} className={cn('w-full flex items-center gap-2 px-2.5 py-2 text-left transition-colors hover:bg-sunken', picked?.id === r.id && 'bg-sunken shadow-[inset_3px_0_0_var(--color-accent)]')}>
                    <Badge state={r.status} />
                    <span className="mono text-ink-soft">{ago(r.at)}</span>
                    <span className="text-ink-faint">{r.attemptId ? 'task attempt' : 'goal review'}</span>
                    <span className="ml-auto text-[11px] text-ink-faint truncate max-w-[50%]">{r.summary.split('\n')[0]}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={LABEL}>Output</span>
            {picked && <Badge state={picked.status} />}
            {picked && <span className="text-[11px] text-ink-faint"><span className="mono">{ago(picked.at)}</span> · <span className="mono">{(picked.durationMs / 1000).toFixed(1)}</span> s{picked.attemptId ? ' · during a task attempt' : ' · goal review'}</span>}
            <span className="ml-auto flex items-center gap-1.5">
              {picked?.rawRef && full === null && (
                <button type="button" className="text-[11px] font-semibold text-work-ink hover:underline disabled:opacity-50" disabled={loading === picked.id} onClick={loadFull} title="Below is what Foundry kept of this run: long output is shortened (or summarised) to its start, its end and its errors. Load everything the command printed.">
                  {loading === picked.id ? 'Loading…' : error ? 'Try again' : 'Show the whole output'}
                </button>
              )}
              {full !== null && (
                <button type="button" className="text-[11px] font-semibold text-work-ink hover:underline" onClick={() => setLoaded(null)} title="Back to what Foundry kept of this run">
                  Show the summary
                </button>
              )}
              {output && <CopyButton text={output} />}
            </span>
          </div>
          {error && <div className="text-[11px] text-bad-ink">Could not load the whole output: {error}</div>}
          {picked && <div className="text-[11px] text-ink-faint">{full !== null ? 'Everything the run printed.' : picked.rawRef ? 'What Foundry kept of the run: long output is shortened to its start, its end and its errors, or summarised when it failed.' : 'Everything the run reported.'}</div>}
          {picked ? (
            <OutputView text={output} type={spec.type} />
          ) : (
            <div className="text-ink-faint">Not run yet.</div>
          )}
        </section>

      </div>
    </Modal>
  );
}
