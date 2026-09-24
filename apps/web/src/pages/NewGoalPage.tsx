import type { Attachment } from '@foundry/core/browser';
import { BUDGET_PRESETS } from '@foundry/core/browser';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { effectivePresets, natureKey, type ModelNature, type ModelPreset } from '@foundry/core/browser';
import { api, type RepoInfo } from '../api.ts';
import { AttachmentInput } from '../components/Attachments.tsx';
import { BudgetPicker, type BudgetDraft } from '../components/BudgetPicker.tsx';
import { DeliveryPolicyForm, type PolicyDraft } from '../components/DeliveryPolicyForm.tsx';
import { RepoCard } from '../components/RepoCard.tsx';
import { Button, Card, Input, Textarea, cn, Select } from '../ui.tsx';

const DELIVERY_KEY = 'foundry.delivery';
const BUDGET_KEY = 'foundry.budget';
const NATURE_KEY = 'foundry.nature';

type Nature = 'auto' | 'code' | 'docs' | 'research' | 'image' | 'video';
const NATURES: { id: Nature; label: string; text: string }[] = [
  { id: 'auto', label: 'Auto', text: 'The system reads your description and decides.' },
  { id: 'code', label: 'Code', text: 'Software: features, fixes, whole apps.' },
  { id: 'docs', label: 'Documents', text: 'Proposals, contracts, tutorials, articles.' },
  { id: 'research', label: 'Research', text: 'An investigation ending in a cited report.' },
  { id: 'image', label: 'Images', text: 'Posters, logos, illustrations.' },
  { id: 'video', label: 'Video', text: 'Generated video or narrated presentations.' },
];
function loadDraft(): PolicyDraft {
  try {
    return { mode: 'local', unit: 'goal', ...JSON.parse(localStorage.getItem(DELIVERY_KEY) ?? '{}') };
  } catch {
    return { mode: 'local', unit: 'goal' };
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
  const [nature, setNature] = useState<Nature>(() => ((localStorage.getItem(NATURE_KEY) as Nature | null) ?? 'auto'));
  const [outputDir, setOutputDir] = useState('');
  const [interview, setInterview] = useState(false);
  const [effort, setEffort] = useState('');
  const [modelPreset, setModelPreset] = useState('');
  const [presetInfo, setPresetInfo] = useState<{ ids: { id: string; label: string }[]; picks: Record<ModelNature, string> } | null>(null);
  useEffect(() => {
    api
      .settings()
      .then((v) => {
        const presets = effectivePresets((v.values.models.presets ?? {}) as Record<string, ModelPreset>);
        setPresetInfo({ ids: Object.entries(presets).map(([id, p]) => ({ id, label: p.label })), picks: { code: v.values.models.presetCode, docs: v.values.models.presetDocs, media: v.values.models.presetMedia } });
      })
      .catch(() => {});
  }, []);
  useEffect(() => localStorage.setItem(NATURE_KEY, nature), [nature]);
  const [mode, setMode] = useState<'simple' | 'expert'>(() => ((localStorage.getItem('foundry.mode') as 'simple' | 'expert' | null) ?? 'expert'));
  const [tdd, setTdd] = useState<'required' | 'preferred' | 'off'>(() => ((localStorage.getItem('foundry.tdd') as 'required' | 'preferred' | 'off' | null) ?? 'required'));
  const [pace, setPace] = useState<'thorough' | 'fast'>(() => ((localStorage.getItem('foundry.pace') as 'thorough' | 'fast' | null) ?? 'thorough'));
  /** the remembered preference; media natures auto-tick fast on top of it unless the human touches the checkbox */
  const basePace = useRef(pace);
  const paceTouched = useRef(false);
  const choosePace = (v: 'thorough' | 'fast') => {
    paceTouched.current = true;
    basePace.current = v;
    setPace(v);
    localStorage.setItem('foundry.pace', v);
  };
  useEffect(() => localStorage.setItem('foundry.mode', mode), [mode]);
  useEffect(() => localStorage.setItem('foundry.tdd', tdd), [tdd]);
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
        mode,
        // fast: let the engine default the TDD mandate off instead of pinning it here
        workflow: pace === 'fast' ? { pace } : { pace, tdd: mode === 'simple' ? 'preferred' : tdd },
        nature,
        outputDir: (nature === 'image' || nature === 'video') && outputDir.trim() ? outputDir.trim() : undefined,
        interview: interview ? 'always' : undefined,
        effort: effort ? (effort as 'low' | 'medium' | 'high' | 'xhigh' | 'max') : undefined,
        modelPreset: modelPreset || undefined,
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
    <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6 space-y-4 pb-24">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-lg font-semibold">New goal</h1>
        <ol className="flex items-center gap-1 text-[11px] text-zinc-500">
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-1">
              <span className={cn('h-4 w-4 rounded-full text-[9px] flex items-center justify-center border', done[i] ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300' : 'border-zinc-600')}>{i + 1}</span>
              <span className="hidden sm:inline">{s}</span>
              {i < STEPS.length - 1 && <span className="w-3 h-px bg-zinc-800 mx-0.5" />}
            </li>
          ))}
        </ol>
      </div>

      <Card title="What kind of goal is this?">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {NATURES.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => {
                setNature(n.id);
                // anyone-facing default: prose/media goals open in the plain-language view
                if (n.id !== 'code' && n.id !== 'auto') setMode('simple');
                // media deliverables are judged by eye — default to fast (no engine AI reviews) unless the human chose a pace
                if (!paceTouched.current) setPace(n.id === 'image' || n.id === 'video' ? 'fast' : basePace.current);
              }}
              // a stretched button centres its content; flex-col keeps short cards aligned with tall ones
              className={cn('flex flex-col text-left rounded-lg border p-2.5', nature === n.id ? 'border-emerald-500 bg-emerald-500/10' : 'border-zinc-800 hover:border-zinc-600')}
            >
              <div className="text-sm font-medium text-zinc-100">{n.label}</div>
              <div className="text-[11px] text-zinc-400 mt-0.5 leading-snug">{n.text}</div>
            </button>
          ))}
        </div>
        {(nature === 'image' || nature === 'video') && (
          <div className="mt-3">
            <label className="text-xs text-zinc-400">Output folder — the finished files are copied here when the goal completes (optional; otherwise they stay in the goal's workspace)</label>
            <div className="flex gap-2 mt-1">
              <Input className="mono flex-1" placeholder="/Users/you/Desktop/output" value={outputDir} onChange={(e) => setOutputDir(e.target.value)} />
              <Button
                variant="ghost"
                onClick={async () => {
                  const r = await api.fsPick(outputDir || undefined).catch(() => null);
                  if (r?.path) setOutputDir(r.path);
                }}
              >
                Choose…
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card title="How much do you want to see?">
        <div className="grid sm:grid-cols-2 gap-2">
          {(
            [
              { id: 'simple', label: 'Simple', text: 'You read one plain-language Brief, answer its questions, approve — the engine does the rest and only shows a progress bar and what needs you. TDD is suggested, not enforced.' },
              { id: 'expert', label: 'Expert', text: 'Every control: Areas, task graph, acceptance checks, attempt logs, merge resolution, engineering discipline.' },
            ] as const
          ).map((m) => (
            <button key={m.id} type="button" onClick={() => setMode(m.id)} className={cn('flex flex-col text-left rounded-lg border p-3', mode === m.id ? 'border-emerald-500 bg-emerald-500/10' : 'border-zinc-800 hover:border-zinc-600')}>
              <div className="text-sm font-medium text-zinc-100">{m.label}</div>
              <div className="text-[11px] text-zinc-400 mt-1 leading-snug">{m.text}</div>
            </button>
          ))}
        </div>
        <label className="mt-3 flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={pace === 'fast'} onChange={(e) => choosePace(e.target.checked ? 'fast' : 'thorough')} />
          <span>
            <span className="text-zinc-100">Fast mode</span>
            <span className="text-[11px] text-zinc-400 block leading-snug">Once you approve the Brief, the engine skips its own extra AI reviews (and the TDD mandate). The acceptance checks you approved still run — good for media goals and quick jobs.</span>
          </span>
        </label>
        <label className="mt-3 flex items-start gap-2 cursor-pointer text-xs">
          <input type="checkbox" className="mt-1" checked={interview} onChange={(e) => setInterview(e.target.checked)} />
          <span>
            <span className="text-zinc-100">Interview me before planning</span>
            <span className="text-[11px] text-zinc-400 block leading-snug">The Clarifier asks at least one round of questions (options with its recommendation first) before writing the Brief. Unchecked: it asks only when the repository cannot settle something, and skips straight to the Brief for small goals.</span>
          </span>
        </label>
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <span className="text-xs text-zinc-300">Effort</span>
          <span className="w-56">
            <Select value={effort} onChange={(e) => setEffort(e.target.value)} title="Claude Code's effort level for every session of this goal — lower is faster and cheaper, xhigh / max for hard cross-cutting work; empty = the Settings default">
              <option value="">Settings default</option>
              <option value="low">low — fast, cheap</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="xhigh">xhigh</option>
              <option value="max">max — hardest problems</option>
            </Select>
          </span>
        </div>
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <span className="text-xs text-zinc-300">Models</span>
          <span className="w-56">
            <Select value={modelPreset} onChange={(e) => setModelPreset(e.target.value)} title="Which model preset this goal uses for every action (Settings → Models); default = the preset Settings picks for this goal type">
              <option value="">
                Default for this goal type{presetInfo ? ` (${presetInfo.ids.find((p) => p.id === presetInfo.picks[natureKey(nature)])?.label ?? presetInfo.picks[natureKey(nature)]})` : ''}
              </option>
              {(presetInfo?.ids ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </span>
        </div>
        {mode === 'expert' && (
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <span className="text-xs text-zinc-300">Engineering discipline — TDD</span>
            <span className="w-56">
              <Select value={tdd} onChange={(e) => setTdd(e.target.value as typeof tdd)} title="required: workers must invoke the tdd skill and the reviewer is told when they did not · preferred: suggested only · off: never mentioned">
                <option value="required">required (must, observed)</option>
                <option value="preferred">preferred (suggested)</option>
                <option value="off">off</option>
              </Select>
            </span>
            <span className="text-[11px] text-zinc-500">docs / infra / chore / research tasks never get a TDD mandate; a task can also switch it off in the Brief.</span>
          </div>
        )}
      </Card>

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
