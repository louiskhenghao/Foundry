import type { Check, CheckResult } from '@foundry/core/browser';
import { useState } from 'react';
import { api } from '../../api.ts';
import { MarkdownPanel } from '../../components/Markdown.tsx';
import { Badge, CopyButton, Modal, ago, cn } from '../../ui.tsx';

const WHAT: Record<Check['spec']['type'], string> = {
  command: 'Runs a command; passes when it exits as expected.',
  reviewer: 'An AI reviewer reads the diff and judges it against this rubric.',
  'llm-judge': 'An AI judge answers this prompt.',
  selfcheck: 'Opens the preview in a headless browser, takes a screenshot and fails on console, page or network errors. No AI involved.',
};

/**
 * One acceptance check: what it checks, the output of a run (the latest by default, in full on request) and every run
 * it had, newest first; picking a run shows its output.
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
    <Modal open wide onClose={onClose} title={<span className="flex items-center gap-2 min-w-0"><Badge state={check.tier} /><span className="truncate">{check.name}</span></span>}>
      <div className="space-y-4 text-xs">
        <section className="space-y-1.5">
          <div className="text-zinc-400">
            {WHAT[spec.type]} <span className="text-zinc-500">· {taskName === 'goal' ? 'checks the whole goal' : `checks the task "${taskName}"`}</span>
          </div>
          {spec.type === 'command' && (
            <div className="flex items-start gap-2">
              <pre className="mono flex-1 min-w-0 rounded bg-zinc-950 border border-zinc-800 px-2 py-1.5 text-[11px] text-zinc-200 whitespace-pre-wrap break-all">{spec.cmd}</pre>
              <CopyButton text={spec.cmd} />
            </div>
          )}
          {spec.type === 'command' && <div className="text-[11px] text-zinc-500">expects exit code {spec.expectExitCode}{spec.cwd ? ` · in ${spec.cwd}` : ''} · times out after {Math.round(spec.timeoutMs / 1000)} s</div>}
          {spec.type === 'reviewer' && <MarkdownPanel title={`rubric · ${spec.scope === 'task-diff' ? 'the task diff' : 'the goal diff'}`} source={spec.rubric} maxHeight={200} />}
          {spec.type === 'llm-judge' && <MarkdownPanel title="prompt" source={spec.prompt} maxHeight={200} />}
        </section>

        <section className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-zinc-300 font-medium">Output</span>
            {picked && <Badge state={picked.status} />}
            {picked && <span className="text-[11px] text-zinc-500">{ago(picked.at)} · {(picked.durationMs / 1000).toFixed(1)} s{picked.attemptId ? ' · during a task attempt' : ' · goal review'}</span>}
            <span className="ml-auto flex items-center gap-1.5">
              {picked?.rawRef && full === null && (
                <button type="button" className="text-[11px] text-sky-300 hover:underline disabled:opacity-50" disabled={loading === picked.id} onClick={loadFull}>
                  {loading === picked.id ? 'Loading…' : error ? 'Try again' : 'Show the whole output'}
                </button>
              )}
              {output && <CopyButton text={output} />}
            </span>
          </div>
          {error && <div className="text-[11px] text-rose-300">Could not load the whole output: {error}</div>}
          {picked ? (
            <pre className="mono text-[11px] text-zinc-300 bg-zinc-950 border border-zinc-800 rounded p-2 max-h-[45vh] overflow-auto whitespace-pre-wrap break-words">{output || '(no output)'}</pre>
          ) : (
            <div className="text-zinc-500">Not run yet.</div>
          )}
        </section>

        {runs.length > 1 && (
          <section className="space-y-1">
            <div className="text-zinc-300 font-medium">Runs ({runs.length})</div>
            <ul className="divide-y divide-zinc-800/70 rounded border border-zinc-800">
              {runs.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => setPicked(r)} className={cn('w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-zinc-900', picked?.id === r.id && 'bg-zinc-900')}>
                    <Badge state={r.status} />
                    <span className="text-zinc-400">{ago(r.at)}</span>
                    <span className="text-zinc-500">{r.attemptId ? 'task attempt' : 'goal review'}</span>
                    <span className="ml-auto text-[11px] text-zinc-500 truncate max-w-[50%]">{r.summary.split('\n')[0]}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Modal>
  );
}
