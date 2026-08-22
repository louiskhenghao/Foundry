import type { EngineEvent } from '@ai-engine/core/browser';
import type { CatalogEntryStatus, SessionView, SkillTier, TrashEntry } from '@ai-engine/engine/skills-types';
import { useState } from 'react';
import { Badge, Button, Card, CopyButton, ago, cn } from '../../ui.tsx';

const TIERS: SkillTier[] = ['required', 'recommended', 'optional'];
const TIER_LABEL: Record<SkillTier, string> = { required: 'Required — the engine is noticeably weaker without these', recommended: 'Recommended — improves worker / reviewer / clarifier quality', optional: 'Optional — situational' };

export function CatalogPanel({ catalog, busy, onInstall, onInstallTier }: { catalog: CatalogEntryStatus[]; busy: string | null; onInstall: (id: string, force: boolean) => void; onInstallTier: (tiers: SkillTier[]) => void }) {
  const missing = catalog.filter((c) => !c.status.startsWith('installed'));
  return (
    <Card
      title="Catalog"
      actions={
        <div className="flex gap-1 flex-wrap">
          <Button size="sm" disabled={busy !== null || !missing.some((c) => c.entry.tier === 'required')} onClick={() => onInstallTier(['required'])}>
            Install required
          </Button>
          <Button size="sm" disabled={busy !== null || !missing.some((c) => c.entry.tier !== 'optional')} onClick={() => onInstallTier(['required', 'recommended'])}>
            + recommended
          </Button>
        </div>
      }
    >
      <p className="text-[11px] text-zinc-500 mb-3">Curated in catalog/skills.json. Installed entries tagged with a role are mentioned to that role in its prompt; bundles (e.g. mattpocock) are wired into the workflow — see Setup.</p>
      {TIERS.map((tier) => {
        const list = catalog.filter((c) => c.entry.tier === tier);
        if (!list.length) return null;
        return (
          <div key={tier} className="mb-3">
            <div className="flex items-center gap-2 mb-1.5">
              <Badge state={tier} />
              <span className="text-[11px] text-zinc-500">{TIER_LABEL[tier]}</span>
            </div>
            <div className="space-y-1.5">
              {list.map((c) => (
                <CatalogRow key={c.entry.id} c={c} busy={busy} onInstall={(force) => onInstall(c.entry.id, force)} />
              ))}
            </div>
          </div>
        );
      })}
    </Card>
  );
}

function CatalogRow({ c, busy, onInstall }: { c: CatalogEntryStatus; busy: string | null; onInstall: (force: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const satisfied = c.status.startsWith('installed');
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/50 p-2">
      <div className="flex items-center gap-2">
        <Badge state={c.status}>{c.status.replace(/-/g, ' ')}</Badge>
        <button className="mono text-sm text-zinc-100 text-left flex-1 truncate" onClick={() => setOpen(!open)} title={c.entry.summary}>
          {c.entry.name}
        </button>
        {c.entry.bundle && <span className="text-[9px] uppercase rounded bg-zinc-800 text-zinc-400 px-1">{c.entry.bundle}</span>}
        {c.entry.source.type === 'git' ? (
          satisfied ? (
            c.status === 'installed-unmanaged' && (
              <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => onInstall(true)} title="replace the unmanaged copy with the catalog version (old copy goes to trash)">
                Replace
              </Button>
            )
          ) : (
            <Button size="sm" variant={c.entry.tier === 'required' ? 'primary' : 'default'} disabled={busy !== null} onClick={() => onInstall(false)}>
              {busy === c.entry.id ? '…' : 'Install'}
            </Button>
          )
        ) : (
          !satisfied && c.manual && <CopyButton text={c.manual.command} />
        )}
      </div>
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

export function TrashPanel({ trash, busy, onRestore }: { trash: TrashEntry[]; busy: string | null; onRestore: (name: string, path: string) => void }) {
  if (!trash.length) return null;
  return (
    <Card title={`Trash (${trash.length})`}>
      <div className="space-y-1 text-xs">
        {trash.slice(0, 12).map((t) => (
          <div key={t.path} className="flex items-center gap-2">
            <span className="text-zinc-500 w-16 shrink-0">{ago(t.trashedAt)}</span>
            <span className="mono text-zinc-200 truncate flex-1" title={t.reason}>
              {t.name}
            </span>
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => onRestore(t.name, t.path)}>
              restore
            </Button>
          </div>
        ))}
        {trash.length > 12 && <div className="text-zinc-600">… {trash.length - 12} more in data/skills-trash</div>}
      </div>
    </Card>
  );
}

export function HistoryPanel({ runs }: { runs: (EngineEvent & { seq: number })[] }) {
  const [openSeq, setOpenSeq] = useState<number | null>(null);
  if (!runs.length) return null;
  return (
    <Card title="Update history">
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
    </Card>
  );
}

export function SessionPanel({ view }: { view: SessionView | null }) {
  const [open, setOpen] = useState(false);
  if (!view) return null;
  return (
    <Card title="What Claude loaded last session" actions={<span className="text-[11px] text-zinc-500">{ago(view.at)}</span>}>
      <div className="text-xs text-zinc-400">
        {view.skills.length} skills · {view.slashCommands.length} slash commands{' '}
        <button className="underline" onClick={() => setOpen(!open)}>
          {open ? 'hide' : 'show'}
        </button>
      </div>
      {open && <div className="mono text-[10px] text-zinc-500 mt-2 break-words max-h-48 overflow-auto">{view.skills.join(' · ')}</div>}
    </Card>
  );
}
