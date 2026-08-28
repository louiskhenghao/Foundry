import { ExternalLink } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, type PacksView } from '../api.ts';
import { LiveLog } from '../pages/LiveLog.tsx';
import { Button, CopyButton, cn } from '../ui.tsx';

/**
 * One mutually exclusive skill pack (design / image / video): pick an option (Settings
 * `workflow.<pack>Pack`), see its install state, install it in one click. Used by Setup and Settings.
 * An install streams its log right under the card and the button stays "Installing…" until the
 * entries actually report installed (the API only *starts* the install).
 */
export function DesignPacks({ onInstallStarted, compact, pack = 'design' }: { onInstallStarted?: (option: string) => void; compact?: boolean; pack?: 'design' | 'image' | 'video' }) {
  const [packs, setPacks] = useState<PacksView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const load = () => api.packs().then(setPacks).catch((e) => setMsg(e.message));
  useEffect(() => {
    load();
    return () => {
      if (poll.current) clearInterval(poll.current);
    };
  }, []);
  if (!packs) return <div className="text-xs text-zinc-500">{msg ?? `checking ${pack} skills…`}</div>;
  const choose = async (id: string) => {
    setBusy(id);
    setMsg(null);
    try {
      await api.updateSettings({ workflow: { [`${pack}Pack`]: id } as any });
      await load();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(null);
    }
  };
  const install = async (id: string) => {
    setBusy(`install:${id}`);
    setMsg(null);
    try {
      await api.installPack(pack, id);
      onInstallStarted?.(id);
      setInstalling(id);
      // the API only started the install: poll until this option's entries report installed (or give up)
      const t0 = Date.now();
      if (poll.current) clearInterval(poll.current);
      poll.current = setInterval(async () => {
        const p = await api.packs().catch(() => null);
        if (p) setPacks(p);
        const opt = p?.[pack]?.options.find((o) => o.id === id);
        const done = !!opt && opt.entries.length > 0 && opt.entries.every((e) => e.status.startsWith('installed'));
        if (done || Date.now() - t0 > 120_000) {
          clearInterval(poll.current!);
          poll.current = null;
          setInstalling(null);
          setMsg(done ? `${id} installed ✓` : `${id} is not fully installed yet — see the log above or the Skills page for what happened.`);
        }
      }, 3000);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-2">
      <div className={cn('grid gap-2', compact ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2')}>
        {(packs[pack] ?? packs.design).options.map((o) => {
          const chosen = (packs[pack] ?? packs.design).chosen === o.id;
          const missing = o.entries.filter((e) => e.status === 'missing' || e.status === 'partial');
          const ready = o.entries.length > 0 && missing.length === 0;
          const manualOnly = missing.length > 0 && missing.every((e) => e.sourceType === 'cli' || e.sourceType === 'manual');
          return (
            <div key={o.id} className={cn('rounded-md border p-2.5 flex flex-col gap-1.5', chosen ? 'border-emerald-500 bg-emerald-500/5' : 'border-zinc-800')}>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => choose(o.id)} disabled={busy !== null} className="flex items-center gap-2 text-left min-w-0 flex-1">
                  <span className={cn('h-3.5 w-3.5 rounded-full border shrink-0', chosen ? 'border-emerald-400 bg-emerald-400' : 'border-zinc-600')} />
                  <span className="text-sm text-zinc-100 truncate">{o.label}</span>
                </button>
                {o.id !== 'none' && (
                  <span className={cn('text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 border', installing === o.id ? 'text-sky-300 border-sky-500/40' : ready ? 'text-emerald-300 border-emerald-500/40' : 'text-amber-300 border-amber-500/40')}>
                    {installing === o.id ? 'installing…' : ready ? 'installed' : `${missing.length} missing`}
                  </span>
                )}
                {o.homepage && (
                  <a href={o.homepage} target="_blank" rel="noreferrer" className="text-zinc-500 hover:text-zinc-200" title={o.homepage}>
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>
              <div className="text-[11px] text-zinc-500 leading-snug">{o.summary}</div>
              {o.entries.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {o.entries.map((e) => (
                    <span key={e.id} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950/50 px-1.5 py-0.5 text-[11px]" title={e.detail}>
                      <span className={cn('h-1.5 w-1.5 rounded-full', e.status === 'installed' || e.status === 'installed-via-plugin' ? 'bg-emerald-400' : e.status === 'installed-unmanaged' ? 'bg-amber-400' : 'bg-zinc-600')} />
                      <span className="mono text-zinc-300">{e.invoke}</span>
                    </span>
                  ))}
                </div>
              )}
              {missing.length > 0 && !manualOnly && (
                <div>
                  <Button size="sm" variant={chosen ? 'primary' : 'default'} disabled={busy !== null || installing === o.id} onClick={() => install(o.id)}>
                    {busy === `install:${o.id}` ? 'Starting…' : installing === o.id ? 'Installing…' : `Install ${o.label}`}
                  </Button>
                </div>
              )}
              {installing === o.id && (
                <div className="space-y-1">
                  <div className="text-[11px] text-sky-300 flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" /> installing — live log below; this card updates itself when the skills land
                  </div>
                  <LiveLog attemptId="tool-install" className="max-h-40" />
                </div>
              )}
              {manualOnly && missing[0]!.manual && (
                <div className="text-[11px] text-zinc-400">
                  run yourself: <span className="mono text-zinc-200">{missing[0]!.manual.command}</span> <CopyButton text={missing[0]!.manual.command} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {msg && <div className="text-xs text-zinc-300 whitespace-pre-wrap">{msg}</div>}
    </div>
  );
}
