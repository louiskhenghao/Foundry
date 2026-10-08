import { useState } from 'react';
import { FolderOpen } from 'lucide-react';
import type { Goal } from '@foundry/core/browser';
import { api } from '../../api.ts';
import { FolderPicker } from '../../components/FolderPicker.tsx';
import { Button, Card, ConfirmDialog, Input } from '../../ui.tsx';

/**
 * A goal that came through a Transfer (ADR-0030) and is history here: where it came from, mapping its repository to a
 * checkout on this computer (which restores its branch), and Reattaching it when it was unfinished.
 */
export function ImportedCard({ goal, onChanged }: { goal: Goal; onChanged: () => void }) {
  const t = goal.transfer!;
  const [path, setPath] = useState(t.original.repoPath);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      onChanged();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };
  return (
    <Card title="Came from another computer">
      <div className="space-y-3 text-xs text-zinc-400">
        <p>
          Imported from <b className="text-zinc-200">{t.from.hostname}</b> (Foundry <span className="mono">{t.from.release}</span>, written {new Date(t.from.exportedAt).toLocaleString()}). It is history here: Foundry does not run, deliver or watch it
          {t.unfinished ? ' until you Reattach it.' : '.'}
          {!t.transcripts && ' Its session logs stayed on the computer it came from.'}
        </p>
        {t.repoMapped ? (
          <p>
            Repository: <span className="mono text-zinc-300">{t.original.repoPath}</span> → <span className="mono text-zinc-200">{t.repoMapped.to}</span>
            {t.branchRestored && (
              <>
                {' '}
                · branch <span className="mono">{goal.branch}</span> restored at <span className="mono">{t.branchRestored.head.slice(0, 7)}</span>
              </>
            )}
          </p>
        ) : (
          <div className="space-y-1.5">
            <p>
              Its repository was <span className="mono text-zinc-300">{t.original.repoPath}</span> there. Choose its checkout on this computer{t.bundle ? ': the goal’s branch is restored into it' : ''}.
            </p>
            <div className="flex gap-1.5 items-center max-w-xl">
              <Input className="mono text-xs" value={path} onChange={(e) => setPath(e.target.value)} />
              <Button size="sm" variant="ghost" onClick={() => setPicking(true)} title="Choose the folder">
                <FolderOpen size={13} />
              </Button>
              <Button size="sm" className="shrink-0 whitespace-nowrap" disabled={busy || !path.trim()} onClick={() => act(() => api.mapRepo(goal.id, path.trim()))}>
                Map repository
              </Button>
            </div>
          </div>
        )}
        {t.unfinished ? (
          <div className="flex items-center gap-3 flex-wrap">
            <Button size="sm" variant="primary" disabled={busy || !t.repoMapped} onClick={() => setConfirm(true)} title={t.repoMapped ? undefined : 'Map its repository first'}>
              Reattach
            </Button>
            <span>It gets a progress folder here and carries on; work that was cut off starts again in a fresh session.</span>
          </div>
        ) : (
          <p>It was finished there. {t.repoMapped ? 'Continue it with a Follow-up.' : 'Map its repository to continue it with a Follow-up.'}</p>
        )}
        {err && <p className="text-rose-300">✘ {err}</p>}
      </div>
      {picking && <FolderPicker initial={path} onPick={(p) => (setPath(p), setPicking(false))} onClose={() => setPicking(false)} />}
      <ConfirmDialog open={confirm} title={`Reattach "${goal.title}"?`} confirmLabel="Reattach" busy={busy} onClose={() => setConfirm(false)} onConfirm={() => act(() => api.reattach(goal.id))}>
        <p>Foundry gives it a progress folder next to {t.repoMapped?.to ?? 'its repository'} and takes it up again.</p>
        <p className="text-amber-300">If it is still running on the other computer, the two now diverge: stop or delete it there.</p>
      </ConfirmDialog>
    </Card>
  );
}
