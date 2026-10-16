import type { Brief, DocType } from '@foundry/core/browser';
import { pendingDecisions } from '@foundry/core/browser';
import { useEffect, useState } from 'react';
import { api } from '../../api.ts';
import { Card, cn } from '../../ui.tsx';
import { HelpLink } from '../HelpPage.tsx';

export interface CompletionChoice {
  graphRefresh: boolean;
  docs: DocType[];
  /** ponytail-audit on the finished branch once every task is done, before the goal review */
  audit: boolean;
}

const CODE_SCENARIOS = new Set(['frontend', 'backend', 'fullstack', 'data', 'mobile', 'infra']);

const DOC_LABELS: { type: DocType; label: string; hint: string }[] = [
  { type: 'to-prd', label: 'PRD', hint: 'docs/prd/: objective, scope, acceptance, what was actually built' },
  { type: 'readme-update', label: 'README update', hint: 'update README/docs sections this goal affects' },
  { type: 'changelog', label: 'Changelog', hint: 'append a CHANGELOG entry from the task commits' },
  { type: 'to-questionnaire', label: 'Confirmation sheet', hint: 'stakeholder sheet: what was delivered, decisions needing their confirmation' },
];

/**
 * Mirrors the engine's inference (`inferCompletion` in the engine): coding goals get graph refresh + PRD +
 * README update, a questionnaire when decisions pend. Changelog is only inferred server-side (it needs the
 * repository), so an untouched card sends nothing and lets the engine decide.
 */
export function inferCompletionDefaults(brief: Brief, audit = false): CompletionChoice {
  const code = brief.tasks.some((t) => CODE_SCENARIOS.has(t.scenario ?? 'general'));
  const docs: DocType[] = code ? ['to-prd', 'readme-update'] : [];
  if (pendingDecisions(brief).length) docs.push('to-questionnaire');
  return { graphRefresh: code, docs, audit: code && audit };
}

/** Expert-mode card: what runs automatically when the goal finishes. Untouched = the engine infers the same defaults. */
export function CompletionCard({ brief, editable, value, onChange }: { brief: Brief; editable: boolean; value: CompletionChoice | null; onChange: (v: CompletionChoice) => void }) {
  // the Settings default for the audit, as the engine applies it when the card is left untouched
  const [auditDefault, setAuditDefault] = useState(false);
  useEffect(() => {
    void api.settings().then((s) => setAuditDefault(!!(s.values as { workflow?: { audit?: boolean } }).workflow?.audit)).catch(() => {});
  }, []);
  const v = value ?? inferCompletionDefaults(brief, auditDefault);
  const toggleDoc = (t: DocType) => onChange({ ...v, docs: v.docs.includes(t) ? v.docs.filter((x) => x !== t) : [...v.docs, t] });
  return (
    <Card title={<>Completion<HelpLink to="approving-the-brief#completion" className="ml-1.5" /></>}>
      <p className="text-[11px] text-zinc-500 mb-2">
        Runs automatically when the goal finishes: documents are generated after the review passes and committed to the goal branch (they ship with the code); the knowledge graph refreshes after delivery. Defaults follow the kind of work planned{value ? '' : ' — a changelog entry is added automatically when the repository keeps a CHANGELOG.md'}.
      </p>
      <label className="flex items-start gap-2 text-sm mb-2">
        <input type="checkbox" className="mt-1" disabled={!editable} checked={v.graphRefresh} onChange={(e) => onChange({ ...v, graphRefresh: e.target.checked })} />
        <span>
          Refresh the knowledge graph <span className="text-zinc-500">(graphify, and gitnexus when installed)</span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm mb-2" title="Once every task is done, ponytail-audit maps the finished branch and ranks what to fix. Must-fix findings in the code this goal touched become fix tasks before the final review; the rest is listed on the goal page for a follow-up. One pass, the same cost cap as the final review. Needs the ponytail-audit skill (Setup page).">
        <input type="checkbox" className="mt-1" disabled={!editable} checked={v.audit} onChange={(e) => onChange({ ...v, audit: e.target.checked })} />
        <span>
          Audit the repository at the end <span className="text-zinc-500">(ponytail-audit: must-fix findings in the code this goal touched become fix tasks)</span>
        </span>
      </label>
      <div className="flex flex-wrap gap-1.5">
        {DOC_LABELS.map((d) => (
          <button
            key={d.type}
            type="button"
            disabled={!editable}
            title={d.hint}
            className={cn('text-[11px] rounded-full border px-2 py-0.5', v.docs.includes(d.type) ? 'border-emerald-500 text-emerald-300 bg-emerald-500/10' : 'border-zinc-700 text-zinc-400 hover:border-zinc-500')}
            onClick={() => toggleDoc(d.type)}
          >
            {d.label}
          </button>
        ))}
      </div>
    </Card>
  );
}
