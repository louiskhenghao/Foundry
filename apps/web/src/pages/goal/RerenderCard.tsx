import { Clapperboard } from 'lucide-react';
import { useState } from 'react';
import { api, type GoalDetail } from '../../api.ts';
import { BetaChip } from '../../components/conversation/ConversationBubble.tsx';
import { Button, Card, cn } from '../../ui.tsx';
import { LiveLog } from '../LiveLog.tsx';

const basename = (p: string) => p.split('/').pop() ?? p;

/**
 * Re-render (ADR-0086, beta): on a finished HyperFrames goal, after the person's edits in the Editor, Foundry renders
 * the films again itself — no session, no cost — keeps the earlier result, commits the edits and delivers the new
 * files. Below the button, the edits rendered so far, each with the version kept before it. Nothing while the goal has
 * no HyperFrames project.
 */
export function RerenderCard({ d, onChanged }: { d: GoalDetail; onChanged?: () => void }) {
  const g = d.goal;
  const view = d.editor?.rerender;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [log, setLog] = useState(false);
  if (!d.editor?.enabled || !view) return null;
  const send = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.rerender(g.id);
      setLog(true);
      onChanged?.();
    } catch (e: any) {
      setErr(e.body?.error ?? e.message);
    } finally {
      setBusy(false);
    }
  };
  const last = view.last;
  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          <Clapperboard size={15} aria-hidden="true" /> Re-render <BetaChip />
        </span>
      }
    >
      <p className="mb-2 text-sm text-ink-soft">
        Edited the film in the Editor? Foundry renders {d.editor.projects.length === 1 ? 'it' : `the ${d.editor.projects.length} projects`} again itself, with no session: the result as it is now is kept, your edits land as a commit of their own (edit {view.next}), and the new files go to the output folder.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" disabled={busy || !view.can || view.running} onClick={() => void send()} title={view.can ? 'Render the films again now' : view.reason ?? ''}>
          {view.running ? 'Rendering…' : busy ? 'Starting…' : 'Re-render'}
        </Button>
        {!view.can && view.reason && !view.running && <span className="text-[11px] text-ink-soft">Not now: {view.reason}.</span>}
        {(view.running || last) && (
          <button type="button" className="text-[11px] font-semibold text-ink-faint hover:text-ink" onClick={() => setLog((v) => !v)}>
            {log ? '▾ hide output' : '▸ output'}
          </button>
        )}
        {err && <span className="min-w-0 truncate text-[11px] text-bad-ink">{err}</span>}
      </div>
      {log && <LiveLog attemptId={`rerender-${g.id}`} className="mt-2 max-h-48" />}
      {last && !view.running && (
        <div className={cn('mt-2 text-[11px]', last.errors.length ? 'text-bad-ink' : 'text-ink-faint')}>
          Edit {last.n} · {new Date(last.at).toLocaleString()}
          {last.commit ? ` · committed ${last.commit.slice(0, 7)}` : ' · nothing new to commit'}
          {last.files.length > 0 && (
            <span className="ml-2 inline-flex flex-wrap gap-x-2">
              {last.files.map((f) => (
                <a key={f} href={api.artifactUrl(g.id, f)} target="_blank" rel="noreferrer" className="mono text-ink-soft hover:text-ink hover:underline" title={f}>
                  {basename(f)}
                </a>
              ))}
            </span>
          )}
          {last.errors.map((e) => (
            <div key={e.dir || '*'} className="mt-0.5">
              {e.dir ? <span className="mono">{e.dir}</span> : 'the goal'}: {e.error}
            </div>
          ))}
        </div>
      )}
      {view.history.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-faint">Edits</div>
          <ol className="mt-1.5 space-y-2 text-sm">
            {view.history.map((a) => (
              <li key={a.id} className="min-w-0">
                <span className="font-semibold text-ink">{a.n}.</span> <span className="text-ink">{a.text}</span>
                <span className="block text-[11px] text-ink-faint">
                  {new Date(a.at).toLocaleString()}
                  {a.by ? ` · ${a.by}` : ''}
                </span>
                {a.files.length > 0 && (
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-faint">
                    <span>Before it:</span>
                    {a.files.map((f) => (
                      <a key={f} href={api.artifactUrl(g.id, `.history/${a.n}/${f}`)} target="_blank" rel="noreferrer" className="mono text-ink-soft hover:text-ink hover:underline" title={f}>
                        {basename(f)}
                      </a>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Card>
  );
}
