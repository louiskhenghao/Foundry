import type { SkillSource, SkillSourceRow, SkillUsage } from '@foundry/engine/skills-types';
import { ChevronDown, ChevronRight, ExternalLink, Eye, RefreshCw } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { BOARD_ROW, Badge, Button, CopyButton, ago, cn, useFolds } from '../../ui.tsx';
import { categoryPlate, stateDot, type Tone } from '../agents/marks.ts';

const MANAGER_LABEL: Record<SkillSource['manager'], string> = { 'foundry': 'Foundry', 'agents-cli': 'npx skills', plugin: 'Claude plugin', hand: 'hand-installed', project: 'project' };
/**
 * Each kind of source in a category colour of its own (code(i)), on its board's icon and its rows' plates: Foundry's
 * green, plugins violet, npx skills teal, what you put there by hand blue (as "yours" on the MCP tab), a project's fuchsia.
 */
export const MANAGER_CODE: Record<SkillSource['manager'], number> = { foundry: 1, plugin: 2, 'agents-cli': 5, hand: 0, project: 6 };
const STATUS_LABEL: Record<SkillSourceRow['status'], string> = { 'up-to-date': 'up to date', outdated: 'outdated', unreleased: 'unreleased', modified: 'modified', unknown: 'unknown', broken: 'broken' };
/**
 * A status's dot, in the signal of its badge (the kit's Badge draws the plates): up to date green, broken red, outdated
 * yellow because an update waits for you to press it, a copy that differs blue (information); changes not released yet
 * and what could not be checked ask nothing of you: hollow.
 */
const STATUS_TONE: Record<SkillSourceRow['status'], Tone> = { 'up-to-date': 'ok', outdated: 'you', unreleased: 'none', modified: 'work', unknown: 'none', broken: 'bad' };
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) : null);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** the usage window in words: the goals actually counted, not the limit asked for */
export const lastGoals = (k: number) => (k === 1 ? 'the last goal' : `the last ${k} goals`);

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
 * One source of skills, as a row of its kind's board with its skills listed under it once opened: every source starts
 * closed, so the page is a list of sources; a search or a filter (`expand`) opens every one with a match.
 * Desktop: one row — identity (label truncates) · state badge at a fixed x · actions column of fixed width.
 * Mobile: identity, then state + counts, then actions — all left-aligned, nothing floating.
 */
export function SourceGroup({ s, busy, updating, running, filter, expand = false, a, usage, windowGoals }: { s: SkillSource; busy: boolean; updating: boolean; /** "running…" link to the operation's tab in the operations dock */ running?: ReactNode; filter: (r: SkillSourceRow) => boolean; /** a search or a filter that picks skills is on */ expand?: boolean; a: SourceGroupActions; /** per skill dir: how many recent goals invoked it (null for project rows) */ usage?: Map<string, SkillUsage | null>; /** how many goals that usage was counted over */ windowGoals?: number }) {
  const folds = useFolds(expand);
  const open = folds.isOpen(s.id);
  const rows = s.skills.filter(filter);
  const counts = s.skills.reduce<Record<string, number>>((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {});
  const shadows = s.skills.filter((r) => r.actions.includes('trash-shadow')).map((r) => r.name);
  const adoptable = s.skills.filter((r) => r.actions.includes('adopt')).map((r) => r.name);
  const removable = s.skills.filter((r) => r.actions.includes('uninstall')).map((r) => r.name);
  // a plugin whose upstream changes are unreleased: Update would only confirm the same version
  const canUpdate = (s.updater.kind === 'foundry' || s.updater.kind === 'agents-cli' || s.updater.kind === 'plugin' || s.updater.kind === 'suite') && !(s.manager === 'plugin' && s.updateAvailable === false && s.skills.some((r) => r.status === 'unreleased'));
  const [confirmPlugin, setConfirmPlugin] = useState(false);
  const pluginRemovable = s.manager === 'plugin' && !!a.onUninstallPlugin;
  // nothing to install, but upstream moved on under the same version: not "up to date" either
  const unreleased = s.updateAvailable !== true && s.skills.some((r) => r.status === 'unreleased');
  const state = s.updateAvailable === true ? 'update-available' : unreleased ? 'unreleased' : s.updateAvailable === false ? 'up-to-date' : 'unknown';
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
      {state === 'update-available' ? 'update available' : state === 'unreleased' ? 'unreleased changes' : state === 'up-to-date' ? 'up to date' : 'unknown'}
    </Badge>
  );
  const countsEl = (
    <div className="flex items-center gap-3 text-[11px] text-ink-faint whitespace-nowrap">
      {(['outdated', 'unreleased', 'modified', 'up-to-date', 'unknown', 'broken'] as const)
        .filter((k) => counts[k])
        .map((k) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className={stateDot(STATUS_TONE[k])} />
            {counts[k]} {STATUS_LABEL[k]}
          </span>
        ))}
    </div>
  );
  const managerPlate = (
    <span className={categoryPlate(MANAGER_CODE[s.manager])} title={s.manager}>
      {MANAGER_LABEL[s.manager]}
    </span>
  );
  const actions = (
    <>
      {canUpdate && (
        <Button size="sm" variant={s.updateAvailable ? 'primary' : 'default'} disabled={busy || updating} onClick={() => a.onUpdate()} title={s.updater.command ? s.updater.command.join(' ') : 'update via Foundry'}>
          <RefreshCw size={12} className={cn(updating && 'animate-spin')} /> {updating ? 'Updating…' : s.updater.kind === 'plugin' ? 'Update plugin' : s.updater.kind === 'agents-cli' ? 'Update (npx)' : s.updater.kind === 'suite' ? 'Re-sync' : 'Update'}
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
        <Button size="sm" variant="danger" disabled={busy} onClick={() => a.onUninstall(removable)} title={`Uninstall all ${removable.length} user-level skills of this source (to the trash)`}>
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
          <Button size="sm" variant="danger" disabled={busy} onClick={() => setConfirmPlugin(true)} title="A plugin's skills cannot be removed one by one; this removes the whole plugin">
            Uninstall plugin
          </Button>
        ))}
    </>
  );
  const hasActions = canUpdate || adoptable.length > 0 || shadows.length > 0 || removable.length > 0 || pluginRemovable;

  return (
    <li>
      <header className={cn(BOARD_ROW, 'px-4 py-3 space-y-1.5')}>
        {/* row 1: identity gets the width — name truncates last; actions sit at the right edge */}
        <div className="flex items-center gap-2 min-w-0">
          {removable.length > 0 && <input type="checkbox" className="shrink-0" checked={allSelected} onChange={(e) => a.onSelect(removable, e.target.checked)} title="select all removable skills in this source" />}
          <button className="flex items-center gap-2 min-w-0 flex-1 text-left" onClick={() => folds.toggle(s.id)} aria-expanded={open} title={open ? 'collapse' : 'expand'}>
            {open ? <ChevronDown size={14} className="text-ink-faint shrink-0" /> : <ChevronRight size={14} className="text-ink-faint shrink-0" />}
            {/* a wrapper hides it on a phone (the plate's own inline-flex would win over hidden); the row under it shows it there */}
            <span className="hidden sm:inline-flex shrink-0">{managerPlate}</span>
            <span className="text-[15px] font-bold text-ink truncate">{s.label}</span>
          </button>
          {s.homepage && (
            <a href={s.homepage} target="_blank" rel="noreferrer" className="text-ink-faint hover:text-ink shrink-0" title={s.homepage}>
              <ExternalLink size={12} />
            </a>
          )}
          <div className="hidden sm:flex items-center gap-1.5 shrink-0">{hasActions ? actions : <span className="text-xs text-ink-faint max-w-[16rem] truncate text-right" title={s.updater.hint ?? ''}>{s.updater.hint ?? (s.manager === 'project' ? 'edit in the repository' : 'no updater')}</span>}</div>
        </div>
        {/* mobile: manager + state + counts, then actions */}
        <div className="sm:hidden flex items-center gap-2 flex-wrap">
          {managerPlate}
          {stateBadge}
          {countsEl}
          {running && <span className="text-[11px]">{running}</span>}
        </div>
        {(hasActions || s.updater.hint) && <div className="sm:hidden flex items-center gap-1.5 flex-wrap">{hasActions ? actions : <span className="text-xs text-ink-faint">{s.updater.hint}</span>}</div>}
        {/* row 2 (desktop): all the status — state badge, metadata, per-skill counts */}
        <div className="hidden sm:flex items-center gap-3 text-xs text-ink-faint min-w-0 pl-6">
          {stateBadge}
          <span className="truncate flex-1" title={meta.join(' · ')}>
            {meta.join(' · ')}
            {s.error && <span className="text-bad-ink"> · {s.error}</span>}
          </span>
          <div className="shrink-0">{countsEl}</div>
          {/* an operation in progress sits with the status, not on a line of its own */}
          {running && <div className="shrink-0 text-[11px]">{running}</div>}
        </div>
        {/* mobile keeps the metadata on its own line */}
        <div className="sm:hidden text-xs text-ink-faint min-w-0">
          <span className="block truncate" title={meta.join(' · ')}>
            {meta.join(' · ')}
            {s.error && <span className="text-bad-ink"> · {s.error}</span>}
          </span>
        </div>
      </header>
      {/* why the update waits (upstream changed, the version did not): nothing for you to do yet */}
      {unreleased && s.updater.hint && <div className="px-4 pb-2 sm:pl-10 text-xs text-ink-soft">{s.updater.hint}</div>}
      {s.updater.command && open && canUpdate && (
        <div className="px-4 pb-2 sm:pl-10 text-[11px] text-ink-faint mono truncate">
          {s.updater.command.join(' ')} <CopyButton text={s.updater.command.join(' ')} />
        </div>
      )}
      {/* the source's skills, a level down: indented on the inset colour, as a chain's goals are on the Goals page */}
      {open && (
        <ul className="border-t border-line divide-y divide-line bg-sunken/60">
          {rows.map((r) => (
            <Row key={r.invoke} r={r} usage={usage?.get(r.dir)} windowGoals={windowGoals ?? 0} busy={busy} selected={a.selected.has(r.name)} onSelect={(on) => a.onSelect([r.name], on)} onView={() => a.onView(r)} onAdopt={() => a.onAdopt([r.name])} onTrashShadow={() => a.onTrashShadows([r.name])} onUninstall={() => a.onUninstall([r.name])} onUpdate={canUpdate && s.updater.kind !== 'plugin' ? () => a.onUpdate([r.name]) : undefined} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * One skill, a row under its source: checkbox · name and status over its facts and its description · actions. The
 * description stays under the name from a tablet up too, where a column of its own beside the name was squeezed to a
 * few words; the actions keep a column of one width, so every status plate lines up.
 */
function Row({ r, usage, windowGoals, busy, selected, onSelect, onView, onAdopt, onTrashShadow, onUninstall, onUpdate }: { r: SkillSourceRow; usage?: SkillUsage | null; windowGoals: number; busy: boolean; selected: boolean; onSelect: (on: boolean) => void; onView: () => void; onAdopt: () => void; onTrashShadow: () => void; onUninstall: () => void; onUpdate?: () => void }) {
  const removable = r.actions.includes('uninstall');
  return (
    <li className={cn(BOARD_ROW, 'pl-5 sm:pl-10 pr-4 py-2.5 grid grid-cols-[auto_minmax(0,1fr)] md:grid-cols-[auto_minmax(0,1fr)_15rem] gap-x-3 gap-y-1 items-start text-xs', selected && 'bg-accent/[0.06]')}>
      <div className="pt-0.5 w-4">{removable ? <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} /> : <span className="inline-block w-3" />}</div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={stateDot(STATUS_TONE[r.status])} title={STATUS_LABEL[r.status]} />
          <button className="mono text-[13px] font-semibold text-ink truncate hover:underline text-left" title={`${r.invoke} — view`} onClick={onView}>
            {r.invoke}
          </button>
          <Badge state={r.status} className="ml-auto w-[6.5rem] justify-center shrink-0">
            {STATUS_LABEL[r.status]}
          </Badge>
        </div>
        <div className="text-[11px] text-ink-faint mt-0.5 pl-4 flex flex-wrap gap-x-2">
          {r.local.installedAt && <span>installed {fmtDate(r.local.installedAt)}</span>}
          {r.upstream && (
            <span title={r.upstream.exact ? `upstream commit ${r.upstream.commit}` : 'history truncated — repo HEAD date'}>
              upstream {ago(r.upstream.committedAt)}
              {r.upstream.exact ? '' : '*'}
            </span>
          )}
          {/* a fact, not a request: a quiet chip */}
          {usage?.unused && (
            <span className="rounded-sm px-1 font-semibold text-ink-soft inset-ring inset-ring-line-strong" title={`no session invoked it in ${lastGoals(windowGoals)}`}>
              unused
            </span>
          )}
          {usage?.lastUsedAt && <span title={`invoked in ${plural(usage.sessions, 'session')}`}>{`used in ${plural(usage.goals, 'goal')} · last ${ago(usage.lastUsedAt)}`}</span>}
          {r.match?.relation === 'older' && r.match.olderCommit && <span title="the installed copy equals upstream at this commit">installed = upstream @ {r.match.olderCommit.slice(0, 7)}</span>}
          {r.status === 'unreleased' && <span title="upstream changed this skill, but the plugin's version number did not go up, so the CLI will not install it yet">changed upstream, not released</span>}
          {r.match?.relation === 'differs' && <span>differs from upstream</span>}
          {r.shadowedBy && (
            <span className="text-you-ink" title={`${r.invoke} hides ${r.shadowedBy}; both load, prompts use the plugin one`}>
              shadows {r.shadowedBy}
            </span>
          )}
          {!r.shadowedBy && r.duplicateOf.length > 0 && <span>duplicate of {r.duplicateOf.join(', ')}</span>}
          {r.keptBecause && <span title={r.keptBecause}>can't uninstall here: {r.keptBecause}</span>}
        </div>
      </div>
      <div className="col-start-2 pl-4 text-ink-soft line-clamp-2 min-w-0" title={r.description}>
        {r.description || <span className="text-ink-faint">no description</span>}
      </div>
      <div className="col-start-2 md:col-start-3 md:row-start-1 md:row-span-2 flex items-center gap-1.5 justify-start md:justify-end flex-wrap">
        <Button size="sm" variant="info" onClick={onView} title="open SKILL.md">
          <Eye size={12} /> View
        </Button>
        {onUpdate && r.status === 'outdated' && (
          <Button size="sm" variant="primary" disabled={busy} onClick={onUpdate}>
            Update
          </Button>
        )}
        {r.actions.includes('adopt') && (
          <Button size="sm" variant="primary" disabled={busy} onClick={onAdopt} title="replace with the catalog version (managed by Foundry)">
            Adopt
          </Button>
        )}
        {r.actions.includes('trash-shadow') && (
          <Button size="sm" variant="danger" disabled={busy} onClick={onTrashShadow} title="move this copy to the trash; the plugin copy stays">
            Trash copy
          </Button>
        )}
        {removable && (
          <Button size="sm" variant="danger" disabled={busy} onClick={onUninstall}>
            Uninstall
          </Button>
        )}
      </div>
    </li>
  );
}
