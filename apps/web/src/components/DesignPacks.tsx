import type { AgentProvider } from '../api.ts';
import { ExternalLink } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { apiForProvider, type PacksView } from '../api.ts';
import { LiveLog } from '../pages/LiveLog.tsx';
import { KeyMissing } from './KeyMissing.tsx';
import { Button, CopyButton, choiceClass, cn } from '../ui.tsx';

/**
 * One mutually exclusive skill pack (design / image / video): pick an option (Settings
 * `workflow.<pack>Pack`), see its install state, install it in one click. Used by Setup and Settings.
 * An install streams its log right under the card and the button stays "Installing…" until the
 * entries actually report installed (the API only *starts* the install).
 */
export function DesignPacks({ onInstallStarted, compact, pack = 'design', provider }: { provider?: AgentProvider; onInstallStarted?: (option: string) => void; compact?: boolean; pack?: 'design' | 'image' | 'video' }) {
  const api = apiForProvider(provider);
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
  if (!packs) return <div className="text-xs text-ink-faint">{msg ?? `checking ${pack} skills…`}</div>;
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
          setMsg(done ? `${id} installed ✓` : `${id} is not fully installed yet — see the log above or the Extensions page for what happened.`);
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
            <div key={o.id} className={cn('rounded-lg border p-2.5 flex flex-col gap-1.5', choiceClass(chosen))}>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => choose(o.id)} disabled={busy !== null} className="flex items-center gap-2 text-left min-w-0 flex-1">
                  {/* a radio's dot in the accent */}
                  <span className={cn('h-3.5 w-3.5 rounded-full border shrink-0', chosen ? 'border-accent bg-accent shadow-[inset_0_0_0_2.5px_var(--color-panel)]' : 'border-line-strong')} />
                  <span className="text-sm font-bold text-ink truncate">{o.label}</span>
                </button>
                {o.id !== 'none' && (
                  // no catalog entry for this backend: nothing to install here, which is not "0 missing"; a quiet plate, green
                  // only once installed (what is missing waits for no one: the Install button is the call)
                  <span className={cn('whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.07em] ring-1 ring-inset', installing === o.id ? 'text-work-ink ring-work/50' : ready ? 'text-ok-ink ring-ok/50' : !o.entries.length ? 'text-ink-faint ring-line' : 'text-ink-soft ring-line-strong')} title={!o.entries.length ? 'This option has nothing to install for the selected coding agent' : undefined}>
                    {installing === o.id ? 'installing…' : ready ? 'installed' : !o.entries.length ? 'not for this agent' : `${missing.length} missing`}
                  </span>
                )}
                {o.homepage && (
                  <a href={o.homepage} target="_blank" rel="noreferrer" className="text-ink-faint hover:text-ink" title={o.homepage}>
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>
              <div className="text-xs text-ink-faint leading-snug">{o.summary}</div>
              {o.entries.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {o.entries.map((e) => (
                    <span key={e.id} className="inline-flex items-center gap-1 rounded-sm bg-sunken px-1.5 py-0.5 text-[11px] ring-1 ring-inset ring-line" title={e.detail}>
                      {/* installed: solid green · a loose copy (installed, not by Foundry): hollow green · missing: grey */}
                      <span className={cn('h-1.5 w-1.5 rounded-full', e.status === 'installed' || e.status === 'installed-via-plugin' ? 'bg-ok' : e.status === 'installed-unmanaged' ? 'ring-1 ring-inset ring-ok' : 'bg-line-strong')} />
                      <span className="mono text-ink-soft">{e.invoke}</span>
                    </span>
                  ))}
                </div>
              )}
              {o.entries
                .filter((e) => e.status !== 'missing' && e.status !== 'partial' && e.missingEnv.length)
                .map((e) => (
                  <KeyMissing key={e.id} keys={e.missingEnv} envFor={e.envFor} />
                ))}
              {missing.length > 0 && !manualOnly && (
                <div>
                  <Button size="sm" variant={chosen ? 'primary' : 'default'} disabled={busy !== null || installing === o.id} onClick={() => install(o.id)}>
                    {busy === `install:${o.id}` ? 'Starting…' : installing === o.id ? 'Installing…' : `Install ${o.label}`}
                  </Button>
                </div>
              )}
              {installing === o.id && (
                <div className="space-y-1">
                  <div className="text-[11px] text-ink-soft flex items-center gap-1.5">
                    {/* work under way: the flowing hatch (an inset-ring: ring-inset would take the theme's colour named inset) */}
                    <span className="h-2.5 w-2.5 shrink-0 rounded-[2px] hatch text-ink inset-ring inset-ring-ink" /> installing — live log below; this card updates itself when the skills land
                  </div>
                  <LiveLog attemptId="tool-install" className="max-h-40" />
                </div>
              )}
              {manualOnly && missing[0]!.manual && (
                <div className="text-[11px] text-ink-soft">
                  run yourself: <span className="mono text-ink">{missing[0]!.manual.command}</span> <CopyButton text={missing[0]!.manual.command} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {msg && <div className="text-xs text-ink-soft whitespace-pre-wrap">{msg}</div>}
    </div>
  );
}
