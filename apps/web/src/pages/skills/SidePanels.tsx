import type { EngineEvent } from '@foundry/core/browser';
import type { CatalogEntryStatus, SessionView, SkillTier, TrashEntry } from '@foundry/engine/skills-types';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { KeyMissing } from '../../components/KeyMissing.tsx';
import { Badge, Button, Card, CopyButton, Modal, Tabs, ago, cn } from '../../ui.tsx';

const TIERS: SkillTier[] = ['required', 'recommended', 'optional'];
const TIER_LABEL: Record<SkillTier, string> = { required: 'Required — the engine is noticeably weaker without these', recommended: 'Recommended — improves worker / reviewer / clarifier quality', optional: 'Optional — situational' };

type SideTab = 'catalog' | 'trash' | 'history';

/** a catalog entry's bundle (mattpocock, ponytail…): a quiet tag, not a signal */
const BUNDLE = 'shrink-0 rounded-sm px-1 text-[10px] font-bold uppercase tracking-[0.07em] text-ink-soft inset-ring inset-ring-line-strong';

/** is something running on this key (catalog id, `tier`, `restore:<path>`)? */
type Busy = (key: string) => boolean;
/** the "running…" link to an operation's tab in the operations dock, or null */
type OpLink = (key: string) => ReactNode;

/** The side column as one card with tabs: the catalog leads, trash and update history sit behind their own tabs. */
export function SidePanelTabs({ catalog, trash, runs, busy, opLink, onInstall, onInstallTier, onInstallTool, onRestore }: { catalog: CatalogEntryStatus[]; trash: TrashEntry[]; runs: (EngineEvent & { seq: number })[]; busy: Busy; opLink: OpLink; onInstall: (id: string, force: boolean) => void; onInstallTier: (tiers: SkillTier[]) => void; onInstallTool: (id: string) => void; onRestore: (name: string, path: string) => void }) {
  const [tab, setTab] = useState<SideTab>('catalog');
  const tabs = [
    { id: 'catalog' as const, label: 'Catalog' },
    ...(trash.length ? [{ id: 'trash' as const, label: 'Trash', badge: <span className="mono text-[11px] text-ink-faint">{trash.length}</span> }] : []),
    ...(runs.length ? [{ id: 'history' as const, label: 'History', badge: <span className="mono text-[11px] text-ink-faint">{runs.length}</span> }] : []),
  ];
  return (
    <Card>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <div className="pt-3">
        {tab === 'catalog' && <CatalogBody catalog={catalog} busy={busy} opLink={opLink} onInstall={onInstall} onInstallTier={onInstallTier} onInstallTool={onInstallTool} />}
        {tab === 'trash' && <TrashBody trash={trash} busy={busy} onRestore={onRestore} />}
        {tab === 'history' && <HistoryBody runs={runs} />}
      </div>
    </Card>
  );
}

/**
 * The catalog, kept short: what is still missing leads each tier, what is already installed folds
 * into one line, and the whole optional tier starts collapsed.
 */
function CatalogBody({ catalog, busy, opLink, onInstall, onInstallTier, onInstallTool }: { catalog: CatalogEntryStatus[]; busy: Busy; opLink: OpLink; onInstall: (id: string, force: boolean) => void; onInstallTier: (tiers: SkillTier[]) => void; onInstallTool: (id: string) => void }) {
  const missing = catalog.filter((c) => !c.status.startsWith('installed'));
  const [openTiers, setOpenTiers] = useState<Set<SkillTier>>(() => new Set(TIERS.filter((t) => t !== 'optional')));
  const [showInstalled, setShowInstalled] = useState<Set<SkillTier>>(new Set());
  const toggle = (set: Set<SkillTier>, tier: SkillTier) => {
    const n = new Set(set);
    n.has(tier) ? n.delete(tier) : n.add(tier);
    return n;
  };
  return (
    <div>
      <div className="flex items-start justify-between gap-2 mb-3 flex-wrap">
        <p className="text-xs text-ink-faint min-w-0 flex-1 basis-40">Curated in catalog/skills.json. Installed entries tagged with a role are mentioned to that role in its prompt; pack options (design / image / video) are chosen in Settings.</p>
        <div className="flex gap-1 shrink-0">
          <Button size="sm" disabled={busy('tier') || !missing.some((c) => c.entry.tier === 'required')} onClick={() => onInstallTier(['required'])}>
            Install required
          </Button>
          <Button size="sm" disabled={busy('tier') || !missing.some((c) => c.entry.tier !== 'optional')} onClick={() => onInstallTier(['required', 'recommended'])}>
            + recommended
          </Button>
          <Button size="sm" disabled={busy('tier') || !missing.length} onClick={() => onInstallTier(['required', 'recommended', 'optional'])} title="Install every skill of the catalog that is still missing">
            + optional
          </Button>
        </div>
        {opLink('tier') && <div className="basis-full">{opLink('tier')}</div>}
      </div>
      {TIERS.map((tier) => {
        const list = catalog.filter((c) => c.entry.tier === tier);
        if (!list.length) return null;
        const miss = list.filter((c) => !c.status.startsWith('installed'));
        const inst = list.filter((c) => c.status.startsWith('installed'));
        const open = openTiers.has(tier);
        return (
          <div key={tier} className="mb-3">
            <div className="flex items-center gap-2 mb-1.5">
              <button type="button" className="flex items-center gap-2 min-w-0 flex-1 text-left" onClick={() => setOpenTiers((s) => toggle(s, tier))}>
                {open ? <ChevronDown size={13} className="text-ink-faint shrink-0" /> : <ChevronRight size={13} className="text-ink-faint shrink-0" />}
                <Badge state={tier} />
                <span className="text-xs text-ink-faint truncate">{open ? TIER_LABEL[tier] : `${list.length} skill${list.length === 1 ? '' : 's'}${miss.length ? ` · ${miss.length} missing` : ' · all installed'}`}</span>
              </button>
              {/* one click for the whole tier, optional included: only what is still missing is installed */}
              {miss.length > 0 && (
                <Button size="sm" variant={tier === 'required' ? 'primary' : 'default'} className="shrink-0" disabled={busy('tier')} onClick={() => onInstallTier([tier])} title={`Install the ${miss.length} missing ${tier} skill${miss.length === 1 ? '' : 's'}`}>
                  Install {miss.length}
                </Button>
              )}
            </div>
            {open && (
              <div className="space-y-1.5">
                {miss.map((c) => (
                  <CatalogRow key={c.entry.id} c={c} busy={busy(c.entry.id)} running={opLink(c.entry.id)} onInstall={(force) => onInstall(c.entry.id, force)} onInstallTool={() => onInstallTool(c.entry.id)} />
                ))}
                {inst.length > 0 && (
                  <button type="button" className="text-xs text-ink-faint underline decoration-dotted hover:text-ink pl-1" onClick={() => setShowInstalled((s) => toggle(s, tier))}>
                    {showInstalled.has(tier) ? 'hide' : 'show'} {inst.length} installed
                  </button>
                )}
                {showInstalled.has(tier) && inst.map((c) => <CatalogRow key={c.entry.id} c={c} busy={busy(c.entry.id)} running={opLink(c.entry.id)} onInstall={(force) => onInstall(c.entry.id, force)} onInstallTool={() => onInstallTool(c.entry.id)} />)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** One catalog entry; while an operation on it runs, its buttons wait and a "running…" link leads to that operation's log. */
function CatalogRow({ c, busy, running, onInstall, onInstallTool }: { c: CatalogEntryStatus; busy: boolean; running: ReactNode; onInstall: (force: boolean) => void; onInstallTool: () => void }) {
  const [open, setOpen] = useState(false);
  const satisfied = c.status.startsWith('installed');
  const type = c.entry.source.type;
  return (
    <div className="rounded-md border border-line bg-sunken p-2.5">
      <div className="flex items-center gap-2">
        <Badge state={c.status}>{c.status.replace(/-/g, ' ')}</Badge>
        <button className="mono text-[13px] font-semibold text-ink text-left flex-1 truncate hover:underline" onClick={() => setOpen(!open)} title={c.entry.summary}>
          {c.entry.name}
        </button>
        {c.entry.bundle && <span className={BUNDLE}>{c.entry.bundle}</span>}
        {(type === 'git' || type === 'plugin' || type === 'suite') &&
          (satisfied ? (
            c.status === 'installed-unmanaged' && type === 'git' && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onInstall(true)} title="replace the unmanaged copy with the catalog version (old copy goes to trash)">
                Replace
              </Button>
            )
          ) : (
            <Button size="sm" variant={c.entry.tier === 'required' ? 'primary' : 'default'} disabled={busy} onClick={() => onInstall(false)} title={type === 'plugin' ? 'installed via the claude plugin CLI' : undefined}>
              {busy ? '…' : 'Install'}
            </Button>
          ))}
        {type === 'cli' && !satisfied && (
          <>
            <Button size="sm" disabled={busy} onClick={onInstallTool} title={c.manual ? `runs: ${c.manual.command}` : 'run the documented install command'}>
              {busy ? 'Installing…' : 'Install'}
            </Button>
            {c.manual && <CopyButton text={c.manual.command} />}
          </>
        )}
        {type === 'manual' && !satisfied && c.manual && <CopyButton text={c.manual.command} />}
      </div>
      {type === 'manual' && !satisfied && c.manual && <div className="text-xs text-you-ink mt-1">manual install — copy the command/instructions and run them yourself</div>}
      {running && <div className="mt-1">{running}</div>}
      <div className="text-xs text-ink-faint mt-1">{c.entry.summary}</div>
      {satisfied && <KeyMissing keys={c.missingEnv} envFor={c.entry.envFor} />}
      <CatalogEntryDialog c={c} open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

/** where a catalog entry comes from, in a line */
function sourceLine(c: CatalogEntryStatus): string {
  const s = c.entry.source;
  if (s.type === 'git') return `${s.repo}${s.ref ? ` @ ${s.ref}` : ''}${s.path ? ` · ${s.path}` : ''}`;
  if (s.type === 'plugin') return `plugin ${s.plugin} from the ${s.marketplaceId} marketplace (${s.marketplace}${s.ref ? ` @ ${s.ref}` : ''})`;
  if (s.type === 'cli') return `command-line tool \`${s.detect}\`${s.skill ? ' with a skill folder of the same name' : ''}`;
  if (s.type === 'suite') return `the ${s.suite} workflow suite — a Foundry-managed copy of its pinned plugin, without its hooks`;
  return `installed by hand (${s.detectDir}/)`;
}

/** the whole entry, in a window: why it is in the catalog, how it stands on this computer, which roles follow it and how */
function CatalogEntryDialog({ c, open, onClose }: { c: CatalogEntryStatus; open: boolean; onClose: () => void }) {
  const row = (k: string, v: ReactNode) => (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2">
      <span className="pt-px text-[11px] font-extrabold uppercase tracking-[0.1em] text-ink-faint">{k}</span>
      <span className="min-w-0 break-words">{v}</span>
    </div>
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <span className="mono">{c.entry.name}</span>
          <Badge state={c.status}>{c.status.replace(/-/g, ' ')}</Badge>
          <Badge state={c.entry.tier} />
          {c.entry.bundle && <span className={BUNDLE}>{c.entry.bundle}</span>}
        </span>
      }
    >
      <div className="text-[13px] text-ink-soft space-y-3">
        <p className="text-sm text-ink">{c.entry.summary}</p>
        {row('why', c.entry.why)}
        {row('status', c.detail)}
        {c.installedInvoke && row('invoke', <span className="mono">{c.installedInvoke}</span>)}
        {row('source', sourceLine(c))}
        {c.entry.roles.length > 0 && row('used by', c.entry.roles.join(', '))}
        {c.entry.scenarios.length > 0 && row('scenarios', c.entry.scenarios.join(', '))}
        {c.entry.requiresEnv.length > 0 && row('needs', `${c.entry.requiresEnv.join(', ')}${c.entry.envFor ? ` for ${c.entry.envFor}` : ''}`)}
        {c.entry.workflow.length > 0 && (
          <div>
            <div className="mb-1.5 text-[11px] font-extrabold uppercase tracking-[0.1em] text-ink-faint">workflow rules</div>
            <ul className="space-y-1.5">
              {c.entry.workflow.map((w, i) => (
                <li key={i} className="rounded-md border border-line bg-sunken px-2.5 py-1.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge state={w.mandate}>{w.mandate === 'must' ? 'MUST' : 'Prefer'}</Badge>
                    <span className="font-semibold text-ink">{w.role}</span>
                    {w.when !== 'any' && <span className="text-ink-faint">· {w.when} tasks</span>}
                    {w.scenarios.length > 0 && <span className="text-ink-faint">· {w.scenarios.join(', ')}</span>}
                    {w.whenFiles?.length ? <span className="text-ink-faint">· when the task touches {w.whenFiles.join(', ')}</span> : null}
                  </div>
                  <div className="text-ink-soft mt-1">{w.instruction}</div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {c.manual && (
          <div className="mono text-ink break-all rounded-md border border-line bg-sunken px-2.5 py-1.5">
            {c.manual.command} <CopyButton text={c.manual.command} />
          </div>
        )}
        {c.entry.homepage && (
          <a className="font-semibold underline underline-offset-2 text-work-ink" href={c.entry.homepage} target="_blank" rel="noreferrer">
            {c.entry.homepage}
          </a>
        )}
      </div>
    </Modal>
  );
}

function TrashBody({ trash, busy, onRestore }: { trash: TrashEntry[]; busy: Busy; onRestore: (name: string, path: string) => void }) {
  return (
    <div className="space-y-1 text-xs">
      <p className="text-xs text-ink-faint mb-2">Uninstalled skills land here (data/skills-trash) and can be restored.</p>
      {trash.slice(0, 12).map((t) => (
        <div key={t.path} className="flex items-center gap-2">
          <span className="mono text-ink-faint w-16 shrink-0">{ago(t.trashedAt)}</span>
          <span className="mono font-semibold text-ink truncate flex-1" title={t.reason}>
            {t.name}
          </span>
          <Button size="sm" variant="ghost" disabled={busy(`restore:${t.path}`)} onClick={() => onRestore(t.name, t.path)}>
            restore
          </Button>
        </div>
      ))}
      {trash.length > 12 && <div className="text-ink-faint">… {trash.length - 12} more in data/skills-trash</div>}
    </div>
  );
}

function HistoryBody({ runs }: { runs: (EngineEvent & { seq: number })[] }) {
  const [openSeq, setOpenSeq] = useState<number | null>(null);
  return (
    <div className="space-y-1 text-xs">
      {runs.map((e) => {
        const p = e.payload as any;
        const ok = p.exitCode === 0 && !p.error;
        return (
          <div key={e.seq}>
            <button className="w-full text-left flex items-center gap-2" onClick={() => setOpenSeq(openSeq === e.seq ? null : e.seq)}>
              <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', ok ? 'bg-ok' : 'bg-bad')} />
              <span className="mono text-ink-faint w-16 shrink-0">{ago(e.ts)}</span>
              <span className="font-semibold text-ink truncate flex-1">
                {p.sourceId} <span className="font-normal text-ink-faint">· {p.updater}</span>
              </span>
              <span className="text-ink-faint">{p.changed?.length ? `${p.changed.length} changed` : ok ? 'no change' : 'failed'}</span>
            </button>
            {openSeq === e.seq && (
              <pre className="mono text-[11px] text-ink-soft bg-sunken border border-line rounded-md p-2 mt-1 max-h-40 overflow-auto whitespace-pre-wrap">
                $ {p.command?.join(' ')}
                {'\n'}
                {p.outputTail}
                {p.error ? `\n✘ ${p.error}` : ''}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** One line under the page intro: what the last Claude session actually loaded. */
export function SessionLine({ view }: { view: SessionView | null }) {
  const [open, setOpen] = useState(false);
  if (!view) return null;
  return (
    <div className="text-xs text-ink-faint">
      Last session loaded <span className="font-semibold text-ink-soft">{view.skills.length} skills</span> · {view.slashCommands.length} slash commands <span className="text-ink-faint">({ago(view.at)})</span>{' '}
      <button className="underline decoration-dotted hover:text-ink" onClick={() => setOpen(!open)}>
        {open ? 'hide' : 'show'}
      </button>
      {open && <div className="mono text-[11px] text-ink-faint mt-1.5 break-words max-h-48 overflow-auto">{view.skills.join(' · ')}</div>}
    </div>
  );
}
