import type { Brief } from '@ai-engine/core/browser';
import { Check, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import type { DraftProposal } from '../../api.ts';
import { Button, cn } from '../../ui.tsx';
import { fmtCost } from './shared.ts';

/** One acceptable piece of a proposal: applying it returns the next Brief. */
export interface ProposalItem {
  id: string;
  label: string;
  detail?: string;
  apply: (b: Brief) => Brief;
}

/** Split a proposal into items the human accepts one by one. Nothing touches the Brief until accepted. */
export function proposalItems(p: DraftProposal): ProposalItem[] {
  const items: ProposalItem[] = [];
  if (p.task && p.taskKey) {
    const fields = p.task;
    const keys = Object.keys(fields) as (keyof typeof fields)[];
    if (keys.length) {
      items.push({
        id: 'task',
        label: `Fill in ${keys.map((k) => (k === 'dependsOnKeys' ? 'runs after' : k === 'relevantFiles' ? 'start files' : k === 'areaKey' ? 'Area' : k)).join(', ')}`,
        detail: fields.spec ? fields.spec.slice(0, 400) + (fields.spec.length > 400 ? '…' : '') : undefined,
        apply: (b) => ({ ...b, tasks: b.tasks.map((t) => (t.key === p.taskKey ? { ...t, ...fields, ...(fields.spec && t.spec.trim() ? { spec: t.spec } : {}) } : t)) }),
      });
    }
  }
  for (const t of p.tasks) {
    const own = p.checks.filter((c) => c.taskKey === t.key);
    items.push({
      id: `task:${t.key}`,
      label: `New task ${t.key} — ${t.title}${own.length ? ` (+${own.length} check${own.length > 1 ? 's' : ''})` : ''}`,
      detail: t.spec.slice(0, 400) + (t.spec.length > 400 ? '…' : ''),
      apply: (b) => ({ ...b, tasks: b.tasks.some((x) => x.key === t.key) ? b.tasks : [...b.tasks, t], checks: [...b.checks, ...own.filter((c) => !b.checks.some((x) => x.key === c.key))] }),
    });
  }
  for (const c of p.checks.filter((c) => !p.tasks.some((t) => t.key === c.taskKey))) {
    items.push({
      id: `check:${c.key}`,
      label: `${c.tier} check — ${c.name}`,
      detail: c.spec.type === 'command' ? `$ ${c.spec.cmd}` : c.spec.type === 'reviewer' ? `reviewer: ${c.spec.rubric}` : undefined,
      apply: (b) => ({ ...b, checks: b.checks.some((x) => x.key === c.key) ? b.checks : [...b.checks, c] }),
    });
  }
  return items;
}

export function DraftPanel({ proposal, onApply, onClose }: { proposal: DraftProposal; onApply: (fn: (b: Brief) => Brief) => void; onClose: () => void }) {
  const [items, setItems] = useState(() => proposalItems(proposal));
  const accept = (it: ProposalItem) => {
    onApply(it.apply);
    setItems((xs) => xs.filter((x) => x.id !== it.id));
  };
  const acceptAll = () => {
    onApply((b) => items.reduce((acc, it) => it.apply(acc), b));
    setItems([]);
  };
  return (
    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <Sparkles size={13} className="text-emerald-300" />
        <span className="text-emerald-200 font-medium">Proposal</span>
        <span className="text-zinc-500">{fmtCost(proposal.costUsd)} · accept what you want; nothing is written until you do</span>
        <span className="ml-auto flex gap-1">
          {items.length > 1 && (
            <Button size="sm" onClick={acceptAll}>
              <Check size={12} /> Accept all
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClose} title="Discard what is left">
            <X size={12} />
          </Button>
        </span>
      </div>
      {proposal.rationale && <div className="text-xs text-zinc-400 italic">{proposal.rationale}</div>}
      {items.length === 0 && <div className="text-xs text-zinc-500">Everything accepted.</div>}
      <div className="space-y-1.5">
        {items.map((it) => (
          <div key={it.id} className={cn('rounded-md border border-zinc-800 bg-zinc-950/60 p-2 flex gap-2 items-start')}>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-zinc-200">{it.label}</div>
              {it.detail && <pre className="text-[11px] text-zinc-500 whitespace-pre-wrap mt-1 max-h-32 overflow-auto">{it.detail}</pre>}
            </div>
            <Button size="sm" variant="ghost" onClick={() => accept(it)} title="Accept">
              <Check size={13} className="text-emerald-300" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setItems((xs) => xs.filter((x) => x.id !== it.id))} title="Discard">
              <X size={13} />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
