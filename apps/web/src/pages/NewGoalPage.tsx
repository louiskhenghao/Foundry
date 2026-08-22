import type { Attachment } from '@ai-engine/core/browser';
import { BUDGET_PRESETS } from '@ai-engine/core/browser';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type RepoInfo } from '../api.ts';
import { AttachmentInput } from '../components/Attachments.tsx';
import { BudgetPicker, type BudgetDraft } from '../components/BudgetPicker.tsx';
import { DeliveryPolicyForm, type PolicyDraft } from '../components/DeliveryPolicyForm.tsx';
import { RepoCard } from '../components/RepoCard.tsx';
import { Button, Card, Input, Textarea, cn } from '../ui.tsx';

const DELIVERY_KEY = 'ai-engine.delivery';
const BUDGET_KEY = 'ai-engine.budget';
function loadDraft(): PolicyDraft {
  try {
    return { mode: 'local', unit: 'task', ...JSON.parse(localStorage.getItem(DELIVERY_KEY) ?? '{}') };
  } catch {
    return { mode: 'local', unit: 'task' };
  }
}
function loadBudget(): BudgetDraft {
  try {
    const saved = JSON.parse(localStorage.getItem(BUDGET_KEY) ?? 'null');
    if (saved?.preset && saved.budgets) return saved;
  } catch {}
  return { preset: 'auto', budgets: BUDGET_PRESETS.auto.budgets };
}

const STEPS = ['Goal', 'Repository', 'Budget', 'Delivery'] as const;

export function NewGoalPage() {
  const nav = useNavigate();
  const [prompt, setPrompt] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [title, setTitle] = useState('');
  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [delivery, setDelivery] = useState<PolicyDraft>(loadDraft());
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [budget, setBudget] = useState<BudgetDraft>(loadBudget());
  const [auto, setAuto] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [checks, setChecks] = useState('');
  const [stretch, setStretch] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Prefill Delivery from the repository: remote name (origin preferred) unless the user edited it.
  useEffect(() => {
    if (!repoInfo?.ok) return;
    if (!touched.has('remote') && repoInfo.remotes.length) {
      const name = repoInfo.remotes.some((r) => r.name === 'origin') ? 'origin' : repoInfo.remotes[0]!.name;
      if (delivery.remote !== name) setDelivery((d) => ({ ...d, remote: name, remoteUrl: null }));
    }
  }, [repoInfo]);

  const onDelivery = (next: PolicyDraft) => {
    const t = new Set(touched);
    if (next.remote !== delivery.remote) t.add('remote');
    setTouched(t);
    setDelivery(next);
  };

  const ready = prompt.trim().length > 0 && repoPath.trim().length > 0 && (repoInfo?.ok ?? false);
  const done = [prompt.trim().length > 0, repoInfo?.ok ?? false, true, true];

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const goal = await api.createGoal({
        prompt,
        repoPath: repoPath.trim(),
        title: title.trim() || undefined,
        budgets: budget.budgets,
        budgetPreset: budget.preset,
        autoBrief: auto ? { mustChecks: checks.split('\n').map((s) => s.trim()).filter(Boolean), stretchChecks: stretch.split('\n').map((s) => s.trim()).filter(Boolean) } : undefined,
        delivery,
        attachments,
      });
      try {
        localStorage.setItem(DELIVERY_KEY, JSON.stringify({ mode: delivery.mode, remote: delivery.remote, mergeMethod: delivery.mergeMethod, requireChecks: delivery.requireChecks, autoResolveConflicts: delivery.autoResolveConflicts, fixCiCycles: delivery.fixCiCycles, deleteRemoteBranch: delivery.deleteRemoteBranch }));
        localStorage.setItem(BUDGET_KEY, JSON.stringify(budget));
      } catch {}
      nav(auto ? `/goals/${goal.id}` : `/goals/${goal.id}/brief`);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-3 sm:p-4 md:p-6 space-y-4 pb-24">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-lg font-semibold">New goal</h1>
        <ol className="flex items-center gap-1 text-[11px] text-zinc-500">
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-1">
              <span className={cn('h-4 w-4 rounded-full text-[9px] flex items-center justify-center border', done[i] ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300' : 'border-zinc-700')}>{i + 1}</span>
              <span className="hidden sm:inline">{s}</span>
              {i < STEPS.length - 1 && <span className="w-3 h-px bg-zinc-800 mx-0.5" />}
            </li>
          ))}
        </ol>
      </div>

      <Card title="1 · What do you want done?">
        <Textarea rows={6} placeholder="Describe the goal as you would to a senior engineer. The system clarifies, proposes Must / Stretch acceptance checks and a task plan for you to approve." value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <AttachmentInput className="mt-2" items={attachments} onChange={setAttachments} />
        <div className="mt-3">
          <label className="text-xs text-zinc-400">Title (optional — defaults to the first line)</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
      </Card>

      <Card title="2 · Repository">
        <RepoCard path={repoPath} info={repoInfo} onPath={setRepoPath} onInfo={setRepoInfo} />
      </Card>

      <Card title="3 · Budget">
        <BudgetPicker value={budget} onChange={setBudget} />
      </Card>

      <Card title="4 · Delivery — what may the engine do with the result?">
        {repoInfo?.ok && delivery.mode !== 'local' && (
          <div className="text-[11px] text-zinc-500 mb-2">
            Prefilled from the repository: remote <span className="mono text-zinc-300">{delivery.remote ?? 'origin'}</span>
            {repoInfo.remotes.find((r) => r.name === (delivery.remote ?? 'origin'))?.url ? <span className="mono text-zinc-400"> → {repoInfo.remotes.find((r) => r.name === (delivery.remote ?? 'origin'))!.url}</span> : ' (none yet)'} · base <span className="mono text-zinc-300">{delivery.baseBranch ?? repoInfo.branch}</span>
          </div>
        )}
        <DeliveryPolicyForm value={delivery} onChange={onDelivery} repo={repoInfo} />
      </Card>

      <div>
        <button className="text-xs text-zinc-400 underline decoration-dotted" onClick={() => setAdvanced(!advanced)}>
          {advanced ? 'Hide advanced' : 'Advanced: skip Clarify'}
        </button>
        {advanced && (
          <Card className="mt-2" title="Skip Clarify (advanced)">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Run as one task with these command checks, no Brief
            </label>
            {auto && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="text-xs text-zinc-400">Must checks (one command per line)</label>
                  <Textarea rows={3} className="mono" placeholder={'bun test\nbun run typecheck'} value={checks} onChange={(e) => setChecks(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-zinc-400">Stretch checks</label>
                  <Textarea rows={3} className="mono" placeholder="bun run lint" value={stretch} onChange={(e) => setStretch(e.target.value)} />
                </div>
              </div>
            )}
            {auto && budget.preset === 'auto' && <p className="text-xs text-zinc-500 mt-2">With Auto budget and no Brief, the engine applies the minimum proposal ($3 / 30 min) and pauses to ask if it is exceeded.</p>}
          </Card>
        )}
      </div>

      {err && <div className="text-sm text-rose-400">{err}</div>}
      <div className="fixed bottom-0 left-0 right-0 sm:static border-t sm:border-0 border-zinc-800 bg-zinc-950/90 sm:bg-transparent backdrop-blur p-3 sm:p-0 flex items-center justify-end gap-3">
        {!ready && <span className="text-xs text-zinc-500 mr-auto sm:mr-0">{!prompt.trim() ? 'Describe the goal' : !repoPath ? 'Select a repository folder' : !repoInfo?.ok ? 'Repository is not ready (see above)' : ''}</span>}
        <Button variant="primary" disabled={busy || !ready} onClick={submit}>
          {busy ? 'Creating…' : auto ? 'Create & run' : 'Create & clarify'}
        </Button>
      </div>
    </div>
  );
}
