import type { SkillSource, SkillSourceRow } from '@foundry/engine/skills-types';
import { ChevronDown, ChevronRight, ExternalLink, Eye, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, CopyButton, ago, cn } from '../../ui.tsx';
import { LiveLog } from '../LiveLog.tsx';

const MANAGER_LABEL: Record<SkillSource['manager'], string> = { 'foundry': 'Foundry', 'agents-cli': 'npx skills', plugin: 'Claude plugin', gstack: 'gstack', hand: 'hand-installed', project: 'project' };
const STATUS_LABEL: Record<SkillSourceRow['status'], string> = { 'up-to-date': 'up to date', outdated: 'outdated', unreleased: 'unreleased', modified: 'modified', unknown: 'unknown', broken: 'broken' };
const DOT: Record<string, string> = { 'up-to-date': 'bg-emerald-400', outdated: 'bg-amber-400', unreleased: 'bg-violet-400', modified: 'bg-sky-400', broken: 'bg-rose-400', unknown: 'bg-zinc-600' };
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) : null);

export interface SourceGroupActions {
  onUpdate: (names?: string[]) => void;
  onAdopt: (names: string[]) => void;
  onTrashShadows: (names: string[]) => void;
  onUninstall: (names: string[]) => void;
  /** remove a whole Claude plugin (its skills come and go together) */
  onUninstallPlugin?: (sourceId: string) => void;
  onView: (row: SkillSourceRow) => void;
  selected: Set<string>;
  onSelect: (names: string[], on: boolean) => void;
}

/**
 * One source of skills.
 * Desktop: one row — identity (label truncates) · state badge at a fixed x · actions column of fixed width.
 * Mobile: identity, then state + counts, then actions — all left-aligned, nothing floating.
 */
export function SourceGroup({ s, busy, updating, filter, a }: { s: SkillSource; busy: boolean; updating: boolean; filter: (r: SkillSourceRow) => boolean; a: SourceGroupActions }) {
  const [open, setOpen] = useState(s.skills.length <= 12);
  const rows = s.skills.filter(filter);
  const counts = s.skills.reduce<Record<string, number>>((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
  const shadows = s.skills.filter((r) => r.actions.includes('trash-shadow')).map((r) => r.name);
  const adoptable = s.skills.filter((r) => r.actions.includes('adopt')).map((r) => r.name);
  const removable = s.skills.filter((r) => r.actions.includes('uninstall')).map((r) => r.name);
  // a plugin whose upstream changes are unreleased: Update would only confirm the same version
  const canUpdate = (s.updater.kind === 'foundry' || s.updater.kind === 'agents-cli' || s.updater.kind === 'plugin') && !(s.manager === 'plugin' && s.updateAvailable === false && s.skills.some((r) => r.status === 'unreleased'));
  const [confirmPlugin, setConfirmPlugin] = useState(false);
  const pluginRemovable = s.manager === 'plugin' && !!a.onUninstallPlugin;
  const state = s.updateAvailable === true ? 'update-available' : s.updateAvailable === false ? 'up-to-date' : 'unknown';
  const allSelected = removable.length > 0 && removable.every((n) => a.selected.has(n));
  if (!rows.length) return null;

  const meta = [
    `${s.skills.length} skill${s.skills.length === 1 ? '' : 's'}`,
    s.local.version ? `v${s.local.version}` : null,
    s.local.installedAt ? `installed ${fmtDate(s.local.installedAt)}` : null,
    s.local.updatedAt && s.local.updatedAt !== s.local.installedAt ? `updated ${fmtDate(s.local.updatedAt)}` : null,
    s.local.commit ? s.local.commit.slice(0, 7) : null,
    s.upstream ? `upstream ${s.upstream.commit.slice(0, 7)} · ${fmtDate(s.upstream.committedAt)} (${ago(s.upstream.committedAt)})` : 'upstream not checked',
  ].filter(Boolean) as string[];

  const stateBadge = (
    <Badge state={state} className="shrink-0">
      {state === 'update-available' ? 'update available' : state === 'up-to-date' ? 'up to date' : 'unknown'}
    </Badge>
  );
  const countsEl = (
    <div className="flex items-center gap-3 text-[10px] text-zinc-500 whitespace-nowrap">
      {(['outdated', 'unreleased', 'modified', 'up-to-date', 'unknown', 'broken'] as const)
        .filter((k) => counts[k])
        .map((k) => (
          <span key={k}>
            <span className={cn('inline-block h-1.5 w-1.5 rounded-full mr-1', DOT[k])} />
            {counts[k]} {STATUS_LABEL[k]}
          </span>
        ))}
    </div>
  );
  const actions = (
    <>
      {canUpdate && (
        <Button size="sm" variant={s.updateAvailable ? 'primary' : 'default'} disabled={busy || updating} onClick={() => a.onUpdate()} title={s.updater.command ? s.updater.command.join(' ') : 'update via Foundry'}>
          <RefreshCw size={12} className={cn(updating && 'animate-spin')} /> {updating ? 'Updating…' : s.updater.kind === 'plugin' ? 'Update plugin' : s.updater.kind === 'agents-cli' ? 'Update (npx)' : 'Update'}
        </Button>
      )}
      {adoptable.length > 0 && (
        <Button size="sm" variant="primary" disabled={busy} onClick={() => a.onAdopt(adoptable)} title="Replace these loose copies with Foundry-managed installs from the catalog (old copies go to the trash)">
          Adopt {adoptable.length}
        </Button>
      )}
      {shadows.length > 0 && (
        <Button size="sm" variant="danger" disabled={busy} onClick={() => a.onTrashShadows(shadows)} title={`Trash ${shadows.join(', ')} — the plugin provides newer copies`}>
          Trash {shadows.length} shadow{shadows.length === 1 ? '' : 's'}
        </Button>
      )}
      {removable.length > 0 && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => a.onUninstall(removable)} title={`Uninstall all ${removable.length} user-level skills of this source (to the trash)`}>
          Uninstall all
        </Button>
      )}
      {pluginRemovable &&
        (confirmPlugin ? (
          <>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => (setConfirmPlugin(false), a.onUninstallPlugin!(s.id))} title="Runs the CLI's own plugin uninstall: every skill of this plugin goes">
              Remove {s.skills.length} skill{s.skills.length === 1 ? '' : 's'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmPlugin(false)}>
              Keep
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmPlugin(true)} title="A plugin's skills cannot be removed one by one; this removes the whole plugin">
            Uninstall plugin
          </Button>
        ))}
    </>
  );
  const hasActions = canUpdate || adoptable.length > 0 || shadows.length > 0 || removable.length > 0 || pluginRemovable;

  return (
    <section className={cn('rounded-lg border bg-zinc-900/60', s.updateAvailable ? 'border-amber-500/30' : 'border-zinc-800')}>
      <header className="px-3 sm:px-4 py-2.5 space-y-1.5">
        {/* row 1: identity gets the width — name truncates last; actions sit at the right edge */}
        <div className="flex items-center gap-2 min-w-0">
          {removable.length > 0 && <input type="checkbox" className="shrink-0" checked={allSelected} onChange={(e) => a.onSelect(removable, e.target.checked)} title="select all removable skills in this source" />}
          <button className="flex items-center gap-2 min-w-0 flex-1 text-left" onClick={() => setOpen(!open)} title={open ? 'collapse' : 'expand'}>
            {open ? <ChevronDown size={14} className="text-zinc-500 shrink-0" /> : <ChevronRight size={14} className="text-zinc-500 shrink-0" />}
            <Badge state={s.manager} className="shrink-0 hidden sm:inline-flex">
              {MANAGER_LABEL[s.manager]}
            </Badge>
            <span className="text-sm font-semibold text-zinc-100 truncate">{s.label}</span>
          </button>
          {s.homepage && (
            <a href={s.homepage} target="_blank" rel="noreferrer" className="text-zinc-500 hover:text-zinc-200 shrink-0" title={s.homepage}>
              <ExternalLink size={12} />
            </a>
          )}
          <div className="hidden sm:flex items-center gap-1.5 shrink-0">{hasActions ? actions : <span className="text-[11px] text-zinc-500 max-w-[16rem] truncate text-right" title={s.updater.hint ?? ''}>{s.updater.hint ?? (s.manager === 'project' ? 'edit in the repository' : 'no updater')}</span>}</div>
        </div>
        {/* mobile: manager + state + counts, then actions */}
        <div className="sm:hidden flex items-center gap-2 flex-wrap">
          <Badge state={s.manager}>{MANAGER_LABEL[s.manager]}</Badge>
          {stateBadge}
          {countsEl}
        </div>
        {(hasActions || s.updater.hint) && <div className="sm:hidden flex items-center gap-1.5 flex-wrap">{hasActions ? actions : <span className="text-[11px] text-zinc-500">{s.updater.hint}</span>}</div>}
        {/* row 2 (desktop): all the status — state badge, metadata, per-skill counts */}
        <div className="hidden sm:flex items-center gap-3 text-[11px] text-zinc-500 min-w-0 pl-6">
          {stateBadge}
          <span className="truncate flex-1" title={meta.join(' · ')}>
            {meta.join(' · ')}
            {s.error && <span className="text-rose-400"> · {s.error}</span>}
          </span>
          <div className="shrink-0">{countsEl}</div>
        </div>
        {/* mobile keeps the metadata on its own line */}
        <div className="sm:hidden text-[11px] text-zinc-500 min-w-0">
          <span className="block truncate" title={meta.join(' · ')}>
            {meta.join(' · ')}
            {s.error && <span className="text-rose-400"> · {s.error}</span>}
          </span>
        </div>
      </header>
      {s.updater.command && open && (
        <div className="px-3 sm:px-4 pb-1 sm:pl-10 text-[10px] text-zinc-600 mono truncate">
          {s.updater.command.join(' ')} <CopyButton text={s.updater.command.join(' ')} />
        </div>
      )}
      {updating && (
        <div className="px-3 sm:px-4 pb-3">
          <LiveLog attemptId="skills-update" className="max-h-56" />
        </div>
      )}
      {open && (
        <div className="border-t border-zinc-800">
          {rows.map((r, i) => (
            <Row key={r.invoke} r={r} odd={i % 2 === 1} busy={busy} selected={a.selected.has(r.name)} onSelect={(on) => a.onSelect([r.name], on)} onView={() => a.onView(r)} onAdopt={() => a.onAdopt([r.name])} onTrashShadow={() => a.onTrashShadows([r.name])} onUninstall={() => a.onUninstall([r.name])} onUpdate={canUpdate && s.updater.kind !== 'plugin' ? () => a.onUpdate([r.name]) : undefined} />
          ))}
        </div>
      )}
    </section>
  );
}

/** One skill: checkbox · name + status · description · actions. Indented under the group, zebra striped. */
function Row({ r, odd, busy, selected, onSelect, onView, onAdopt, onTrashShadow, onUninstall, onUpdate }: { r: SkillSourceRow; odd: boolean; busy: boolean; selected: boolean; onSelect: (on: boolean) => void; onView: () => void; onAdopt: () => void; onTrashShadow: () => void; onUninstall: () => void; onUpdate?: () => void }) {
  const removable = r.actions.includes('uninstall');
  return (
    <div className={cn('pl-3 sm:pl-6 pr-3 sm:pr-4 py-2 grid grid-cols-[auto_minmax(0,1fr)] md:grid-cols-[auto_17rem_minmax(0,1fr)_12rem] gap-x-3 gap-y-1 items-start text-xs ml-2 sm:ml-4 border-l-2 border-zinc-800/60', odd ? 'bg-zinc-900/50' : 'bg-transparent', selected && 'bg-emerald-500/5')}>
      <div className="pt-0.5 w-4">{removable ? <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} /> : <span className="inline-block w-3" />}</div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={cn('inline-block h-1.5 w-1.5 rounded-full shrink-0', DOT[r.status])} title={STATUS_LABEL[r.status]} />
          <button className="mono text-zinc-100 truncate hover:underline text-left" title={`${r.invoke} — view`} onClick={onView}>
            {r.invoke}
          </button>
          <Badge state={r.status} className="ml-auto w-[5.5rem] justify-center shrink-0">
            {STATUS_LABEL[r.status]}
          </Badge>
        </div>
        <div className="text-[10px] text-zinc-500 mt-0.5 pl-3.5 flex flex-wrap gap-x-2">
          {r.local.installedAt && <span>installed {fmtDate(r.local.installedAt)}</span>}
          {r.upstream && (
            <span title={r.upstream.exact ? `upstream commit ${r.upstream.commit}` : 'history truncated — repo HEAD date'}>
              upstream {ago(r.upstream.committedAt)}
              {r.upstream.exact ? '' : '*'}
            </span>
          )}
          {r.match?.relation === 'older' && r.match.olderCommit && <span title="the installed copy equals upstream at this commit">installed = upstream @ {r.match.olderCommit.slice(0, 7)}</span>}
          {r.status === 'unreleased' && <span title="upstream changed this skill, but the plugin's version number did not go up, so the CLI will not install it yet">changed upstream, not released</span>}
          {r.match?.relation === 'differs' && <span>differs from upstream</span>}
          {r.shadowedBy && (
            <span className="text-amber-300" title={`${r.invoke} hides ${r.shadowedBy}; both load, prompts use the plugin one`}>
              shadows {r.shadowedBy}
            </span>
          )}
          {!r.shadowedBy && r.duplicateOf.length > 0 && <span>duplicate of {r.duplicateOf.join(', ')}</span>}
        </div>
      </div>
      <div className="col-start-2 md:col-start-3 text-zinc-400 line-clamp-2 min-w-0" title={r.description}>
        {r.description || <span className="text-zinc-600">no description</span>}
      </div>
      <div className="col-start-2 md:col-start-4 flex items-center gap-1 justify-start md:justify-end flex-wrap">
        <Button size="sm" variant="ghost" onClick={onView} title="open SKILL.md">
          <Eye size={12} /> view
        </Button>
        {onUpdate && r.status === 'outdated' && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onUpdate}>
            update
          </Button>
        )}
        {r.actions.includes('adopt') && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onAdopt} title="replace with the catalog version (managed by Foundry)">
            adopt
          </Button>
        )}
        {r.actions.includes('trash-shadow') && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onTrashShadow} title="move this copy to the trash; the plugin copy stays">
            trash copy
          </Button>
        )}
        {removable && (
          <Button size="sm" variant="ghost" className="text-rose-300" disabled={busy} onClick={onUninstall}>
            uninstall
          </Button>
        )}
      </div>
    </div>
  );
}
