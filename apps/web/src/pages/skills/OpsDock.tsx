import { ChevronDown, ChevronUp, Maximize2, SquareTerminal, X } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Modal, cn } from '../../ui.tsx';
import { LiveLog } from '../LiveLog.tsx';
import { type OpTab, useOpsPoller, useSkillOps } from './ops.ts';

const KIND_LABEL: Record<OpTab['kind'], string> = { install: 'install', 'install-tier': 'install tier', update: 'update', adopt: 'adopt', uninstall: 'uninstall', 'tool-install': 'tool install' };
const DOT: Record<OpTab['status'], string> = { running: 'bg-sky-400 animate-pulse', ok: 'bg-emerald-400', failed: 'bg-rose-400' };
const STATUS_TEXT: Record<OpTab['status'], string> = { running: 'text-sky-300', ok: 'text-emerald-300', failed: 'text-rose-300' };
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const took = (t: OpTab) => {
  if (!t.endedAt) return null;
  const s = Math.max(0, Math.round((Date.parse(t.endedAt) - Date.parse(t.startedAt)) / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
};

/**
 * The Skills page's operations, docked at the bottom across the full width: one tab per install / tier install /
 * update / adoption / uninstall / tool install, running or finished, each with its own live log. Finished tabs stay
 * until dismissed; the dock folds to a one-line bar with counts. Hidden while there is nothing to show.
 */
export function OpsDock() {
  useOpsPoller();
  const { tabs, active, open, show, setOpen, dismiss, clearFinished } = useSkillOps();
  const [wide, setWide] = useState<string | null>(null);
  if (!tabs.length) return null;
  const tab = tabs.find((t) => t.id === active) ?? tabs[tabs.length - 1]!;
  const running = tabs.filter((t) => t.status === 'running').length;
  const ok = tabs.filter((t) => t.status === 'ok').length;
  const failed = tabs.filter((t) => t.status === 'failed').length;
  const big = tabs.find((t) => t.id === wide) ?? null;

  const counts = (
    <span className="flex items-center gap-2.5 text-[11px] text-zinc-400 min-w-0">
      {running > 0 && (
        <span className="flex items-center gap-1 text-sky-300">
          <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" /> {running} running
        </span>
      )}
      {ok > 0 && (
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> {ok} done
        </span>
      )}
      {failed > 0 && (
        <span className="flex items-center gap-1 text-rose-300">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-400" /> {failed} failed
        </span>
      )}
    </span>
  );

  return (
    <section className="border-t border-zinc-800 bg-zinc-950/95 backdrop-blur shadow-[0_-2px_10px_rgba(0,0,0,0.12)]" aria-label="Skills operations">
      <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6">
        <div className="flex items-center gap-2 h-9">
          <button type="button" className="flex items-center gap-2 min-w-0 flex-1 text-left h-full" onClick={() => setOpen(!open)} aria-expanded={open} title={open ? 'fold the operations' : 'show the operations'}>
            <SquareTerminal size={14} className="text-zinc-500 shrink-0" />
            <span className="text-xs font-semibold text-zinc-200 shrink-0">Operations</span>
            {counts}
          </button>
          {open && ok + failed > 0 && (
            <button type="button" className="text-[11px] text-zinc-500 hover:text-zinc-200 underline decoration-dotted shrink-0" onClick={clearFinished}>
              clear finished
            </button>
          )}
          {open && (
            <button type="button" className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 shrink-0" onClick={() => setWide(tab.id)} title="open this log in a large window" aria-label="expand log">
              <Maximize2 size={14} />
            </button>
          )}
          <button type="button" className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 shrink-0" onClick={() => setOpen(!open)} aria-label={open ? 'fold' : 'unfold'}>
            {open ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
          </button>
        </div>
        {open && (
          <div className="pb-3">
            <div className="flex items-stretch gap-1 overflow-x-auto border-b border-zinc-800 -mx-1 px-1" role="tablist">
              {tabs.map((t) => (
                <div key={t.id} className={cn('flex items-center shrink-0 -mb-px border-b-2 max-w-[16rem]', t.id === tab.id ? 'border-emerald-500' : 'border-transparent')}>
                  <button type="button" role="tab" aria-selected={t.id === tab.id} className={cn('flex items-center gap-1.5 pl-2 pr-1 py-1.5 text-xs min-w-0', t.id === tab.id ? 'text-zinc-100' : 'text-zinc-400 hover:text-zinc-200')} onClick={() => show(t.id)} title={`${t.label} — ${t.status}${t.summary ? `: ${t.summary}` : ''}`}>
                    <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', DOT[t.status])} />
                    <span className="truncate">{t.label}</span>
                  </button>
                  {t.status !== 'running' && (
                    <button type="button" className="p-0.5 mr-1 rounded text-zinc-600 hover:text-zinc-200" onClick={() => dismiss(t.id)} aria-label={`dismiss ${t.label}`} title="dismiss">
                      <X size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <OpBody t={tab} logClass="h-36 sm:h-48" />
          </div>
        )}
      </div>
      {/* the dock's backdrop blur would trap a fixed modal inside it: render the large view at the document root */}
      {big &&
        createPortal(
          <Modal open wide onClose={() => setWide(null)} title={<span className="flex items-center gap-2"><span className={cn('h-2 w-2 rounded-full', DOT[big.status])} />{big.label}</span>}>
            <OpBody t={big} logClass="h-[62vh] max-h-none!" />
          </Modal>,
          document.body,
        )}
    </section>
  );
}

/** One operation: kind, start time, status and outcome, then its live log (a click on a line opens it in full). */
function OpBody({ t, logClass }: { t: OpTab; logClass: string }) {
  return (
    <div className="pt-2 space-y-2">
      <div className="flex items-center gap-x-2 gap-y-0.5 flex-wrap text-[11px] text-zinc-500">
        <span className="uppercase tracking-wide text-zinc-400">{KIND_LABEL[t.kind]}</span>
        <span>· started {time(t.startedAt)}</span>
        {took(t) && <span>· took {took(t)}</span>}
        <span className={cn('font-medium', STATUS_TEXT[t.status])}>· {t.status === 'running' ? 'running…' : t.status}</span>
        {t.summary && <span className={cn('min-w-0 break-words basis-full sm:basis-auto', t.status === 'failed' ? 'text-rose-300' : 'text-zinc-300')}>{t.summary}</span>}
      </div>
      {t.refused ? <div className="rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-200">The server did not start this operation, so there is no output.</div> : <LiveLog key={t.channel} attemptId={t.channel} className={logClass} />}
    </div>
  );
}
