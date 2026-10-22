import type { ReleaseForecast, SuiteReleaseView } from '@foundry/engine/skills-types';
import { ChevronDown, ChevronRight, ExternalLink, Milestone, RefreshCw } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Markdown } from '../../components/Markdown.tsx';
import { BOARD_ROW, Badge, Board, Button, Select, ago, cn } from '../../ui.tsx';
import { notice } from '../agents/marks.ts';
import { INSTALLED_AS, forecastLine, pinnedBy, releaseState, usedBy, workflowLosses } from './release-notes.ts';

/**
 * The workflow suites and the release each sits at (ADR-0068). Foundry's catalog pins one; a Move takes a suite to a later
 * one, and back. The forecast comes first: which skills the release removes — the ones Foundry's workflow uses on top,
 * with what it does with them — which it deprecates and which it adds, with the changelog between. A newer release that
 * drops a skill the workflow uses is announced on the row before anything is opened.
 */
export function SuiteReleases({ releases, forecast, busy, running, onMove }: { releases: SuiteReleaseView[]; forecast: (id: string, to: string) => Promise<ReleaseForecast>; busy: (id: string) => boolean; running: (id: string) => ReactNode; onMove: (v: SuiteReleaseView, to: string) => void }) {
  if (!releases.length) return null;
  return (
    <Board id="skills-suites" icon={<Milestone size={14} strokeWidth={2.25} aria-hidden="true" />} title="Workflow suites" count={releases.length} note="each at one release; a Move shows what it changes first">
      {releases.map((v) => (
        <SuiteRow key={v.id} v={v} forecast={forecast} busy={busy(v.id)} running={running(v.id)} onMove={(to) => onMove(v, to)} />
      ))}
    </Board>
  );
}

function SuiteRow({ v, forecast, busy, running, onMove }: { v: SuiteReleaseView; forecast: (id: string, to: string) => Promise<ReleaseForecast>; busy: boolean; running: ReactNode; onMove: (to: string) => void }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(v.latest && v.choices.includes(v.latest) ? v.latest : v.ref);
  const [shown, setShown] = useState<ReleaseForecast | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const state = releaseState(v);
  const losses = workflowLosses(v.forecast);
  const resync = !!v.installed && v.installed.ref !== v.ref;

  // the newest's forecast came with the row; another release's is asked for when it is picked
  useEffect(() => {
    if (!open) return;
    if (v.forecast && to === v.forecast.to) return setShown(v.forecast);
    setShown(null);
    setErr(null);
    let live = true;
    forecast(v.id, to).then(
      (f) => live && setShown(f),
      (e) => live && setErr(String(e?.message ?? e)),
    );
    return () => {
      live = false;
    };
  }, [open, to, v.forecast?.to]);

  const meta = [pinnedBy(v), v.installed ? `${INSTALLED_AS[v.installed.as]}${v.installed.ref ? ` at ${v.installed.ref}` : ', not pinned'}` : 'not installed', v.checkedAt ? `checked ${ago(v.checkedAt)}` : 'releases not checked'];
  return (
    <li>
      <header className={cn(BOARD_ROW, 'px-4 py-3 space-y-1.5')}>
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <button className="flex items-center gap-2 min-w-0 flex-1 text-left" onClick={() => setOpen(!open)} title={open ? 'hide the forecast' : 'show the forecast'}>
            {open ? <ChevronDown size={14} className="text-ink-faint shrink-0" /> : <ChevronRight size={14} className="text-ink-faint shrink-0" />}
            <span className="text-[15px] font-bold text-ink truncate">{v.label}</span>
            <span className="mono text-[13px] text-ink-soft shrink-0">{v.ref}</span>
          </button>
          {v.homepage && (
            <a href={v.homepage} target="_blank" rel="noreferrer" className="text-ink-faint hover:text-ink shrink-0" title={v.homepage}>
              <ExternalLink size={12} />
            </a>
          )}
          {/* a phone gives the name its line: the state and the action go under it */}
          <div className="flex items-center gap-2 w-full sm:w-auto pl-6 sm:pl-0">
            <Badge state={state.badge} className="shrink-0">
              {state.text}
            </Badge>
            {running}
            {resync ? (
              <Button size="sm" variant="primary" disabled={busy} onClick={() => onMove(v.ref)} title={`put what is installed at ${v.ref}`}>
                <RefreshCw size={12} /> Re-sync
              </Button>
            ) : (
              <Button size="sm" variant={v.forecast ? 'primary' : 'default'} onClick={() => setOpen(!open)}>
                {v.forecast ? `Preview ${v.forecast.to}` : 'Releases'}
              </Button>
            )}
          </div>
        </div>
        <div className="text-xs text-ink-faint pl-6 min-w-0">
          {meta.join(' · ')}
          {v.forecast && <span> · {v.forecast.to}: {forecastLine(v.forecast)}</span>}
          {v.error && <span className="text-bad-ink"> · {v.error}</span>}
        </div>
      </header>
      {/* announced before anything is opened: a newer release drops a skill Foundry's workflow uses */}
      {losses.length > 0 && v.forecast && (
        <div className={cn(notice('you'), 'mx-4 mb-3 sm:ml-10 px-3 py-2 text-xs text-ink-soft')}>
          <b className="text-you-ink">{v.forecast.to} no longer ships {losses.map((s) => s.name).join(', ')}.</b> {losses.map((s) => `${s.name}: ${usedBy(s)}`).join('; ')}. Moving to it takes {losses.length === 1 ? 'that skill' : 'those skills'} out of the workflow.
        </div>
      )}
      {open && (
        <div className="border-t border-line bg-sunken/60 px-4 py-3 sm:pl-10 space-y-3 text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-2 font-semibold text-ink-soft">
              Release
              <Select value={to} onChange={(e) => setTo(e.target.value)} className="py-1 text-xs w-auto">
                {v.choices.map((t) => (
                  <option key={t} value={t}>
                    {t}
                    {t === v.ref ? ' (in use)' : t === v.catalogRef ? " (Foundry's pin)" : t === v.latest ? ' (newest)' : ''}
                  </option>
                ))}
              </Select>
            </label>
            <Button size="sm" variant={losses.length && to === v.forecast?.to ? 'danger' : 'primary'} disabled={busy || !shown || to === v.ref} onClick={() => onMove(to)} title={to === v.ref ? 'this is the release in use' : `move ${v.label} to ${to}`}>
              {to === v.ref ? 'In use' : `Move to ${to}`}
            </Button>
            <span className="text-ink-faint">Not while a goal runs. A later Foundry release that pins a newer one takes over.</span>
          </div>
          {err && <div className="text-bad-ink">{err}</div>}
          {!shown && !err && <div className="text-ink-faint">Reading {to}…</div>}
          {shown && <Forecast f={shown} />}
        </div>
      )}
    </li>
  );
}

function Forecast({ f }: { f: ReleaseForecast }) {
  if (f.from === f.to) return <p className="text-ink-faint">{f.to} is the release installed: {f.kept} skills.</p>;
  const used = f.removed.filter((s) => s.inCatalog);
  const other = f.removed.filter((s) => !s.inCatalog);
  return (
    <div className="space-y-3">
      <p className="text-ink-soft">
        <b className="text-ink">
          {f.from} → {f.to}
        </b>
        : {forecastLine(f)}
      </p>
      {used.length > 0 && (
        <Section title="Removed — Foundry's workflow uses these" tone="text-bad-ink">
          {used.map((s) => (
            <Skill key={s.name} name={s.name} deprecated={s.deprecated} why={usedBy(s)} notes={s.notes} />
          ))}
        </Section>
      )}
      {other.length > 0 && (
        <Section title="Removed" tone="text-you-ink">
          {other.map((s) => (
            <Skill key={s.name} name={s.name} deprecated={s.deprecated} why={null} notes={s.notes} />
          ))}
        </Section>
      )}
      {f.added.length > 0 && (
        <Section title="New" tone="text-ok-ink">
          <li className="mono text-ink">{f.added.join(', ')}</li>
        </Section>
      )}
      {f.headlines.length > 0 && (
        <Section title="Changelog" tone="text-ink-soft">
          {f.headlines.map((h) => (
            <li key={h} className="text-ink-soft">
              {h}
            </li>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({ title, tone, children }: { title: string; tone: string; children: ReactNode }) {
  return (
    <div>
      <div className={cn('text-[11px] font-extrabold caps mb-1', tone)}>{title}</div>
      <ul className="space-y-1.5">{children}</ul>
    </div>
  );
}

function Skill({ name, deprecated, why, notes }: { name: string; deprecated: boolean; why: string | null; notes: string[] }) {
  return (
    <li>
      <span className="mono font-semibold text-ink">{name}</span>
      {deprecated && <span className="ml-2 text-ink-faint">deprecated upstream</span>}
      {why && <span className="text-ink-soft"> — {why}</span>}
      {/* a changelog line keeps its own emphasis and code */}
      {notes.map((n) => (
        <Markdown key={n} source={n} className="pl-3 text-xs text-ink-faint [&_p]:my-0" />
      ))}
    </li>
  );
}
