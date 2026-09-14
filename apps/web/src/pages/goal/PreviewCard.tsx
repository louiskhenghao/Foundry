import { ExternalLink, Play, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type PreviewStatus, api } from '../../api.ts';
import { Button, Card, cn } from '../../ui.tsx';
import { LiveLog } from '../LiveLog.tsx';

/**
 * The goal's dev server, started by the engine in the progress folder: what would run, whether it runs, where to open
 * it. Embedded in the milestone card, and its own card on the Overview tab.
 */
export function PreviewCard({ goalId, selfCheck, embedded }: { goalId: string; selfCheck?: boolean; embedded?: boolean }) {
  const [st, setSt] = useState<PreviewStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const load = () => api.preview(goalId).then(setSt).catch(() => {});
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [goalId]);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      await load();
    } catch (e: any) {
      setErr(e.body?.error ?? e.message);
    } finally {
      setBusy(false);
    }
  };
  const body = (
    <div className="text-xs text-zinc-400 space-y-2">
      {!st ? (
        <div className="text-zinc-500">…</div>
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            {st.running ? (
              <>
                <span className={cn('inline-block h-2 w-2 rounded-full', st.ready ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse')} title={st.ready ? 'answering' : 'starting…'} />
                <span className="text-zinc-200">
                  Running on port {st.port}
                  {st.startedBy && <span className="text-zinc-500"> · started {st.startedBy === 'human' ? 'by you' : st.startedBy === 'milestone' ? 'for the milestone' : 'after a task landed'}</span>}
                </span>
                {st.url && (
                  <a href={st.url} target="_blank" rel="noreferrer" onClick={() => void api.previewVisit(goalId)} className="inline-flex items-center gap-1 text-emerald-300 hover:underline">
                    Open preview <ExternalLink size={12} />
                  </a>
                )}
                <Button size="sm" variant="ghost" className="ml-auto" disabled={busy} onClick={() => run(() => api.previewStop(goalId))}>
                  <Square size={12} /> Stop
                </Button>
              </>
            ) : (
              <>
                <span className="text-zinc-300">{st.run?.command ? 'Not running' : 'Nothing to run yet'}</span>
                <Button size="sm" variant="primary" className="ml-auto" disabled={busy || !st.run?.command} onClick={() => run(() => api.previewStart(goalId))} title={st.run?.command ? `runs: ${st.run.command}` : 'no dev/start script in package.json — the Brief\'s "How to run it" can set a command'}>
                  <Play size={12} /> Start preview
                </Button>
              </>
            )}
          </div>
          {st.run?.command ? (
            <div className="text-[11px] text-zinc-500">
              <span className="mono text-zinc-400">{st.running ? st.command : st.run.command}</span> <span>· from {st.source === 'brief' ? 'the Brief' : 'package.json'}{st.run.platform === 'expo' ? ' · Expo web' : ''}</span>
            </div>
          ) : (
            <div className="text-[11px] text-zinc-500">No dev or start script in package.json. Once a task adds one, or the Brief's "How to run it" names a command, the preview can start.</div>
          )}
          {err && <div className="text-rose-300">{err}</div>}
          {st.error && !err && <div className="text-amber-300">last run: {st.error}</div>}
          {selfCheck !== undefined && (
            <label className="flex items-center gap-2 text-[11px] text-zinc-400 cursor-pointer" title="After every task lands, the engine opens this preview in headless Chromium, takes a screenshot and fails a must check on console or network errors. Needs Playwright's Chromium (Settings → Preview).">
              <input type="checkbox" className="accent-emerald-500" checked={selfCheck} onChange={(e) => run(() => api.setSelfCheck(goalId, e.target.checked))} /> Self-check after each task (screenshot + console errors)
            </label>
          )}
          {st.running && (
            <div>
              <button type="button" className="text-[11px] text-zinc-500 hover:text-zinc-300" onClick={() => setShowLog((v) => !v)}>
                {showLog ? '▾ hide output' : '▸ server output'}
              </button>
              {showLog && <LiveLog attemptId={`preview-${goalId}`} className="mt-1 max-h-48" />}
            </div>
          )}
        </>
      )}
    </div>
  );
  return embedded ? body : <Card title="Preview">{body}</Card>;
}
