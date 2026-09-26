import type { EngineEvent } from '@foundry/core/browser';
import type { CatalogEntryStatus, SessionView, SkillTier, TrashEntry } from '@foundry/engine/skills-types';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Badge, Button, Card, CopyButton, Tabs, ago, cn } from '../../ui.tsx';

const TIERS: SkillTier[] = ['required', 'recommended', 'optional'];
const TIER_LABEL: Record<SkillTier, string> = { required: 'Required — the engine is noticeably weaker without these', recommended: 'Recommended — improves worker / reviewer / clarifier quality', optional: 'Optional — situational' };

type SideTab = 'catalog' | 'trash' | 'history';

/** is something running on this key (catalog id, `tier`, `restore:<path>`)? */
type Busy = (key: string) => boolean;
/** the "running…" link to an operation's tab in the operations dock, or null */
type OpLink = (key: string) => ReactNode;

/** The side column as one card with tabs: the catalog leads, trash and update history sit behind their own tabs. */
export function SidePanelTabs({ catalog, trash, runs, busy, opLink, onInstall, onInstallTier, onInstallTool, onRestore }: { catalog: CatalogEntryStatus[]; trash: TrashEntry[]; runs: (EngineEvent & { seq: number })[]; busy: Busy; opLink: OpLink; onInstall: (id: string, force: boolean) => void; onInstallTier: (tiers: SkillTier[]) => void; onInstallTool: (id: string) => void; onRestore: (name: string, path: string) => void }) {
  const [tab, setTab] = useState<SideTab>('catalog');
  const tabs = [
    { id: 'catalog' as const, label: 'Catalog' },
    ...(trash.length ? [{ id: 'trash' as const, label: 'Trash', badge: <span className="text-[10px] text-zinc-500">{trash.length}</span> }] : []),
    ...(runs.length ? [{ id: 'history' as const, label: 'History', badge: <span className="text-[10px] text-zinc-500">{runs.length}</span> }] : []),
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
        <p className="text-[11px] text-zinc-500 min-w-0 flex-1 basis-40">Curated in catalog/skills.json. Installed entries tagged with a role are mentioned to that role in its prompt; pack options (design / image / video) are chosen in Settings.</p>
        <div className="flex gap-1 shrink-0">
          <Button size="sm" disabled={busy('tier') || !missing.some((c) => c.entry.tier === 'required')} onClick={() => onInstallTier(['required'])}>
            Install required
          </Button>
          <Button size="sm" disabled={busy('tier') || !missing.some((c) => c.entry.tier !== 'optional')} onClick={() => onInstallTier(['required', 'recommended'])}>
            + recommended
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
            <button type="button" className="flex items-center gap-2 mb-1.5 w-full text-left" onClick={() => setOpenTiers((s) => toggle(s, tier))}>
              {open ? <ChevronDown size={13} className="text-zinc-500 shrink-0" /> : <ChevronRight size={13} className="text-zinc-500 shrink-0" />}
              <Badge state={tier} />
              <span className="text-[11px] text-zinc-500 truncate">{open ? TIER_LABEL[tier] : `${list.length} skill${list.length === 1 ? '' : 's'}${miss.length ? ` · ${miss.length} missing` : ' · all installed'}`}</span>
            </button>
            {open && (
              <div className="space-y-1.5">
                {miss.map((c) => (
                  <CatalogRow key={c.entry.id} c={c} busy={busy(c.entry.id)} running={opLink(c.entry.id)} onInstall={(force) => onInstall(c.entry.id, force)} onInstallTool={() => onInstallTool(c.entry.id)} />
                ))}
                {inst.length > 0 && (
                  <button type="button" className="text-[11px] text-zinc-500 underline decoration-dotted pl-1" onClick={() => setShowInstalled((s) => toggle(s, tier))}>
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
    <div className="rounded-md border border-zinc-800 bg-zinc-950/50 p-2">
      <div className="flex items-center gap-2">
        <Badge state={c.status}>{c.status.replace(/-/g, ' ')}</Badge>
        <button className="mono text-sm text-zinc-100 text-left flex-1 truncate" onClick={() => setOpen(!open)} title={c.entry.summary}>
          {c.entry.name}
        </button>
        {c.entry.bundle && <span className="text-[9px] uppercase rounded bg-zinc-800 text-zinc-400 px-1">{c.entry.bundle}</span>}
        {(type === 'git' || type === 'plugin') &&
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
      {type === 'manual' && !satisfied && c.manual && <div className="text-[11px] text-amber-300/80 mt-1">manual install — copy the command/instructions and run them yourself</div>}
      {running && <div className="mt-1">{running}</div>}
      <div className="text-[11px] text-zinc-500 mt-1">{c.entry.summary}</div>
      {open && (
        <div className="text-[11px] text-zinc-400 mt-2 space-y-1">
          <div>
            <span className="text-zinc-500">why:</span> {c.entry.why}
          </div>
          <div>
            <span className="text-zinc-500">status:</span> {c.detail}
          </div>
          {c.entry.roles.length > 0 && (
            <div>
              <span className="text-zinc-500">used by:</span> {c.entry.roles.join(', ')}
            </div>
          )}
          {c.entry.workflow.length > 0 && (
            <div>
              <span className="text-zinc-500">workflow:</span> {c.entry.workflow.map((w) => `${w.role} ${w.mandate}${w.when !== 'any' ? ` (${w.when})` : ''}`).join(' · ')}
            </div>
          )}
          {c.manual && (
            <div className="mono text-zinc-300 break-all">
              {c.manual.command} <CopyButton text={c.manual.command} />
            </div>
          )}
          {c.entry.homepage && (
            <a className="underline" href={c.entry.homepage} target="_blank" rel="noreferrer">
              {c.entry.homepage}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function TrashBody({ trash, busy, onRestore }: { trash: TrashEntry[]; busy: Busy; onRestore: (name: string, path: string) => void }) {
  return (
    <div className="space-y-1 text-xs">
      <p className="text-[11px] text-zinc-500 mb-2">Uninstalled skills land here (data/skills-trash) and can be restored.</p>
      {trash.slice(0, 12).map((t) => (
        <div key={t.path} className="flex items-center gap-2">
          <span className="text-zinc-500 w-16 shrink-0">{ago(t.trashedAt)}</span>
          <span className="mono text-zinc-200 truncate flex-1" title={t.reason}>
            {t.name}
          </span>
          <Button size="sm" variant="ghost" disabled={busy(`restore:${t.path}`)} onClick={() => onRestore(t.name, t.path)}>
            restore
          </Button>
        </div>
      ))}
      {trash.length > 12 && <div className="text-zinc-600">… {trash.length - 12} more in data/skills-trash</div>}
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
              <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', ok ? 'bg-emerald-400' : 'bg-rose-400')} />
              <span className="text-zinc-500 w-16 shrink-0">{ago(e.ts)}</span>
              <span className="text-zinc-200 truncate flex-1">
                {p.sourceId} <span className="text-zinc-500">· {p.updater}</span>
              </span>
              <span className="text-zinc-500">{p.changed?.length ? `${p.changed.length} changed` : ok ? 'no change' : 'failed'}</span>
            </button>
            {openSeq === e.seq && (
              <pre className="mono text-[10px] text-zinc-400 bg-zinc-950 rounded p-2 mt-1 max-h-40 overflow-auto whitespace-pre-wrap">
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
    <div className="text-xs text-zinc-500">
      Last session loaded <span className="text-zinc-300">{view.skills.length} skills</span> · {view.slashCommands.length} slash commands <span className="text-zinc-600">({ago(view.at)})</span>{' '}
      <button className="underline decoration-dotted" onClick={() => setOpen(!open)}>
        {open ? 'hide' : 'show'}
      </button>
      {open && <div className="mono text-[10px] text-zinc-500 mt-1.5 break-words max-h-48 overflow-auto">{view.skills.join(' · ')}</div>}
    </div>
  );
}
