import type { Attachment } from '@foundry/core/browser';
import { BUDGET_PRESETS } from '@foundry/core/browser';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CornerDownRight, X } from 'lucide-react';
import { effectivePresets, natureKey, type ModelNature, type ModelPreset } from '@foundry/core/browser';
import { api, type FollowUpDraft, type GoalRow, type RepoInfo } from '../api.ts';
import { AttachmentInput } from '../components/Attachments.tsx';
import { BudgetPicker, type BudgetDraft } from '../components/BudgetPicker.tsx';
import { DeliveryPolicyForm, type PolicyDraft } from '../components/DeliveryPolicyForm.tsx';
import { RepoCard } from '../components/RepoCard.tsx';
import { Button, ButtonGroup, Card, Input, Select, Textarea, cn } from '../ui.tsx';
import { HelpLink } from './HelpPage.tsx';

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
/** the browser remembers the finer delivery options; mode and unit always start from Settings → New goal defaults */
function loadDraft(): PolicyDraft {
  try {
    const { mode: _m, unit: _u, ...rest } = JSON.parse(localStorage.getItem(DELIVERY_KEY) ?? '{}');
    return { ...rest, mode: 'local', unit: 'goal' };
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
const FINISHED = ['done', 'over_delivered', 'failed', 'cancelled'];

/** The Follow-up this goal is being created as: the earlier goal's draft plus the human's choices on it. */
interface FollowChoice {
  draft: FollowUpDraft;
  startFrom: 'base' | 'previous';
  attachments: boolean;
  style: boolean;
}

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
  useEffect(() => localStorage.setItem(NATURE_KEY, nature), [nature]);
  const [mode, setModeState] = useState<'simple' | 'expert'>('expert');
  const [tdd, setTddState] = useState<'required' | 'preferred' | 'off'>('required');
  const [pace, setPace] = useState<'thorough' | 'fast'>('thorough');
  const [defaultRemote, setDefaultRemote] = useState('origin');
  /** fields the human changed on this page: the Settings defaults arriving later never overwrite them */
  const changed = useRef(new Set<string>());
  const setMode = (v: 'simple' | 'expert') => {
    changed.current.add('mode');
    setModeState(v);
  };
  const setTdd = (v: 'required' | 'preferred' | 'off') => {
    changed.current.add('tdd');
    setTddState(v);
  };
  /** the Settings default; media natures auto-tick fast on top of it unless the human touches the checkbox */
  const basePace = useRef(pace);
  const paceTouched = useRef(false);
  const choosePace = (v: 'thorough' | 'fast') => {
    paceTouched.current = true;
    basePace.current = v;
    setPace(v);
  };
  // the form starts from Settings → New goal defaults (view, pace, TDD, delivery) and the goal-type model presets
  useEffect(() => {
    api
      .settings()
      .then((v) => {
        const presets = effectivePresets((v.values.models.presets ?? {}) as Record<string, ModelPreset>);
        setPresetInfo({ ids: Object.entries(presets).map(([id, p]) => ({ id, label: p.label })), picks: { code: v.values.models.presetCode, docs: v.values.models.presetDocs, media: v.values.models.presetMedia } });
        const d = v.values;
        if (!changed.current.has('mode')) setModeState(d.workflow.defaultMode);
        if (!changed.current.has('tdd')) setTddState(d.workflow.tdd);
        basePace.current = d.workflow.defaultPace;
        // media goals default to fast on top of the Settings pace, as when the goal type is picked by hand
        if (!paceTouched.current) setPace(nature === 'image' || nature === 'video' ? 'fast' : d.workflow.defaultPace);
        setDefaultRemote(d.delivery.defaultRemote);
        setDelivery((cur) => ({ ...cur, ...(changed.current.has('deliveryMode') ? {} : { mode: d.delivery.defaultMode }), ...(changed.current.has('deliveryUnit') ? {} : { unit: d.delivery.defaultUnit }) }));
      })
      .catch(() => {});
  }, []);
  // Follow-up: /goals/new?follows=<id> prefills the form from the earlier goal; the Follows picker only links
  const [params] = useSearchParams();
  const [follow, setFollow] = useState<FollowChoice | null>(null);
  const [finishedGoals, setFinishedGoals] = useState<GoalRow[]>([]);
  const [repoKey, setRepoKey] = useState(0);
  const chooseFollow = async (goalId: string, prefill: boolean) => {
    if (!goalId) return setFollow(null);
    try {
      const dr = await api.followUpDraft(goalId);
      setFollow({ draft: dr, startFrom: dr.start.recommended, attachments: true, style: true });
      if (!prefill) return;
      const p = dr.prefill;
      setRepoPath(p.repoPath);
      setRepoKey((k) => k + 1);
      api.validateRepo(p.repoPath).then(setRepoInfo).catch(() => {});
      setNature(p.nature);
      setModelPreset(p.modelPreset ?? '');
      setEffort(p.effort ?? '');
      choosePace(p.pace);
      setMode(p.mode);
      changed.current.add('deliveryMode');
      changed.current.add('deliveryUnit');
      setTouched((t) => new Set([...t, 'remote']));
      setDelivery({ ...p.delivery, createRepo: null, remoteUrl: null });
    } catch (e: any) {
      setErr(e.message);
    }
  };
  useEffect(() => {
    const id = params.get('follows');
    if (id) void chooseFollow(id, true);
    api
      .goals()
      .then((gs) => setFinishedGoals(gs.filter((g) => FINISHED.includes(g.state))))
      .catch(() => {});
  }, []);
  // the Follows picker lists finished goals of the chosen repository; another repository drops the link
  const followCandidates = finishedGoals.filter((g) => g.repoPath === repoPath.trim());
  useEffect(() => {
    if (follow && follow.draft.previous.repoPath !== repoPath.trim()) setFollow(null);
  }, [repoPath]);
  const [checks, setChecks] = useState('');
  const [stretch, setStretch] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Prefill Delivery from the repository: remote name (origin preferred) unless the user edited it.
  useEffect(() => {
    if (!repoInfo?.ok) return;
    if (!touched.has('remote') && repoInfo.remotes.length) {
      const name = repoInfo.remotes.some((r) => r.name === defaultRemote) ? defaultRemote : repoInfo.remotes.some((r) => r.name === 'origin') ? 'origin' : repoInfo.remotes[0]!.name;
      if (delivery.remote !== name) setDelivery((d) => ({ ...d, remote: name, remoteUrl: null }));
    }
  }, [repoInfo, defaultRemote]);

  const onDelivery = (next: PolicyDraft) => {
    const t = new Set(touched);
    if (next.remote !== delivery.remote) t.add('remote');
    if (next.mode !== delivery.mode) changed.current.add('deliveryMode');
    if (next.unit !== delivery.unit) changed.current.add('deliveryUnit');
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
        follows: follow ? { goalId: follow.draft.previous.id, startFrom: follow.startFrom, attachments: follow.attachments, style: follow.style } : undefined,
      });
      try {
        localStorage.setItem(DELIVERY_KEY, JSON.stringify({ remote: delivery.remote, mergeMethod: delivery.mergeMethod, requireChecks: delivery.requireChecks, autoResolveConflicts: delivery.autoResolveConflicts, fixCiCycles: delivery.fixCiCycles, deleteRemoteBranch: delivery.deleteRemoteBranch }));
        localStorage.setItem(BUDGET_KEY, JSON.stringify(budget));
      } catch {}
      nav(auto ? `/goals/${goal.id}` : `/goals/${goal.id}/brief`);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  // the preset Settings picks for this goal type, named on the Default button
  const defaultPick = presetInfo?.picks[natureKey(nature)];
  const defaultPreset = defaultPick ? (presetInfo!.ids.find((p) => p.id === defaultPick)?.label ?? defaultPick) : null;
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
      {follow && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-800 bg-sky-950/40 text-sky-200 text-xs pl-2.5 pr-1 py-1 max-w-full">
            <CornerDownRight size={12} className="shrink-0" />
            <span className="truncate">Follows: {follow.draft.previous.title}</span>
            <button type="button" className="rounded-full p-0.5 hover:bg-sky-900 shrink-0" aria-label="Remove follows" title="This goal will not follow it" onClick={() => setFollow(null)}>
              <X size={12} />
            </button>
          </span>
          <span className="text-[11px] text-zinc-500">Settings are prefilled from it; Clarify gets what it asked, decided and delivered as background.</span>
        </div>
      )}

      <Card title={<>What kind of goal is this?<HelpLink to="your-first-goal#what-kind-of-goal-is-this" className="ml-1.5" /></>}>
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

      <Card title={<>How much do you want to see?<HelpLink to="your-first-goal#how-much-do-you-want-to-see" className="ml-1.5" /></>}>
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
            <span className="text-zinc-100">Fast mode</span><HelpLink to="your-first-goal#fast-mode" className="ml-1.5" />
            <span className="text-[11px] text-zinc-400 block leading-snug">Once you approve the Brief, the engine skips its own extra AI reviews (and the TDD mandate). The acceptance checks you approved still run — good for media goals and quick jobs.</span>
          </span>
        </label>
        <label className="mt-3 flex items-start gap-2 cursor-pointer text-xs">
          <input type="checkbox" className="mt-1" checked={interview} onChange={(e) => setInterview(e.target.checked)} />
          <span>
            <span className="text-zinc-100">Interview me before planning</span><HelpLink to="your-first-goal#interview-me-before-planning" className="ml-1.5" />
            <span className="text-[11px] text-zinc-400 block leading-snug">The Clarifier asks at least one round of questions (options with its recommendation first) before writing the Brief. Unchecked: it asks only when the repository cannot settle something, and skips straight to the Brief for small goals.</span>
          </span>
        </label>
        <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-3">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-xs text-zinc-300">Effort<HelpLink to="your-first-goal#effort" className="ml-1.5" /></span>
            <ButtonGroup
              label="Effort"
              value={effort}
              onChange={setEffort}
              options={[
                { id: '', label: 'Default', title: 'The effort level set in Settings' },
                { id: 'low', label: 'low', title: 'Fast and cheap: simple, well-defined goals' },
                { id: 'medium', label: 'medium' },
                { id: 'high', label: 'high' },
                { id: 'xhigh', label: 'xhigh', title: 'Hard, cross-cutting work' },
                { id: 'max', label: 'max', title: 'The hardest problems; slowest and most expensive' },
              ]}
            />
          </div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-xs text-zinc-300">Models<HelpLink to="your-first-goal#models" className="ml-1.5" /></span>
            <ButtonGroup
              label="Models"
              value={modelPreset}
              onChange={setModelPreset}
              options={[
                {
                  id: '',
                  label: `Default${defaultPreset ? ` · ${defaultPreset}` : ''}`,
                  title: 'The preset Settings picks for this goal type (Settings → Models & limits)',
                },
                ...(presetInfo?.ids ?? []).map((p) => ({ id: p.id, label: p.label })),
              ]}
            />
          </div>
        </div>
        {mode === 'expert' && (
          <div className="mt-3 flex items-center gap-2.5 flex-wrap">
            <span className="text-xs text-zinc-300">Engineering discipline — TDD<HelpLink to="your-first-goal#engineering-discipline-tdd" className="ml-1.5" /></span>
            <ButtonGroup
              label="Engineering discipline — TDD"
              value={tdd}
              onChange={setTdd}
              options={[
                { id: 'required', label: 'required', title: 'Workers must write the test first; the reviewer is told when they did not' },
                { id: 'preferred', label: 'preferred', title: 'Suggested to workers, not checked' },
                { id: 'off', label: 'off', title: 'Never mentioned' },
              ]}
            />
            <span className="text-[11px] text-zinc-500">docs, infra, research, image and video tasks never get a TDD mandate; a task can also switch it off in the Brief.</span>
          </div>
        )}
      </Card>

      <Card title={<>1 · What do you want done?<HelpLink to="your-first-goal#what-do-you-want-done" className="ml-1.5" /></>}>
        <Textarea rows={6} placeholder="Describe the goal as you would to a senior engineer. The system clarifies, proposes Must / Stretch acceptance checks and a task plan for you to approve." value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <AttachmentInput className="mt-2" items={attachments} onChange={setAttachments} />
        <div className="mt-3">
          <label className="text-xs text-zinc-400">Title (optional — defaults to the first line)</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
      </Card>

      <Card title={<>2 · Repository<HelpLink to="your-first-goal#repository" className="ml-1.5" /></>}>
        <RepoCard key={repoKey} path={repoPath} info={repoInfo} onPath={setRepoPath} onInfo={setRepoInfo} />
        {repoInfo?.ok && (followCandidates.length > 0 || follow) && <FollowsPicker follow={follow} candidates={followCandidates} onPick={(id) => void chooseFollow(id, false)} onChange={setFollow} />}
      </Card>

      <Card title={<>3 · Budget<HelpLink to="your-first-goal#budget" className="ml-1.5" /></>}>
        <BudgetPicker value={budget} onChange={setBudget} />
      </Card>

      <Card title={<>4 · Delivery — what may the engine do with the result?<HelpLink to="your-first-goal#delivery" className="ml-1.5" /></>}>
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

/** Follows (optional): which finished goal of this repository the new goal continues, where it starts, and what it takes along. */
function FollowsPicker({ follow, candidates, onPick, onChange }: { follow: FollowChoice | null; candidates: GoalRow[]; onPick: (id: string) => void; onChange: (f: FollowChoice) => void }) {
  const d = follow?.draft;
  const options = d && !candidates.some((c) => c.id === d.previous.id) ? [{ id: d.previous.id, title: d.previous.title, state: d.previous.state }, ...candidates] : candidates;
  return (
    <div className="mt-4 border-t border-zinc-800 pt-3 space-y-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-zinc-300">
          Follows<HelpLink to="your-first-goal#follows" className="ml-1.5" />
        </span>
        <Select aria-label="Follows" className="flex-1 min-w-0 max-w-md" value={d?.previous.id ?? ''} onChange={(e) => onPick(e.target.value)}>
          <option value="">Nothing — a new line of work</option>
          {options.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title} ({g.state.replace('_', ' ')})
            </option>
          ))}
        </Select>
      </div>
      {follow && d && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 space-y-2 text-xs">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-zinc-300">Start from</span>
            <ButtonGroup
              label="Start from"
              value={follow.startFrom}
              onChange={(v) => onChange({ ...follow, startFrom: v })}
              options={[
                { id: 'base' as const, label: <span className="mono">{d.start.baseBranch}</span>, title: 'The base branch' },
                ...(d.start.previousBranch ? [{ id: 'previous' as const, label: "its goal branch", title: d.start.previousBranch }] : []),
              ]}
            />
          </div>
          <p className="text-zinc-400 leading-snug">
            {follow.startFrom === 'previous' ? (
              <>
                Its work is not on <span className="mono">{d.start.baseBranch}</span> yet, so this goal starts from its goal branch <span className="mono">{d.start.previousBranch}</span>. Its changes go along in this goal's delivery (and pull request); the delivery still targets <span className="mono">{d.start.baseBranch}</span>.
              </>
            ) : d.start.onBase ? (
              <>
                Its work is already on <span className="mono">{d.start.baseBranch}</span> ({d.start.detail}); this goal starts from there.
              </>
            ) : (
              <>
                This goal starts from <span className="mono">{d.start.baseBranch}</span> without its changes — they are not on <span className="mono">{d.start.baseBranch}</span> yet.
              </>
            )}
          </p>
          {d.attachments.length > 0 && (
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-0.5" checked={follow.attachments} onChange={(e) => onChange({ ...follow, attachments: e.target.checked })} />
              <span>
                Bring its attachments <span className="text-zinc-500">({d.attachments.map((a) => a.name).join(', ')})</span>
              </span>
            </label>
          )}
          {d.style && (
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-0.5" checked={follow.style} onChange={(e) => onChange({ ...follow, style: e.target.checked })} />
              <span className="flex items-center gap-1.5 flex-wrap">
                Keep its style direction <span className="text-zinc-200">{d.style.name}</span>
                {d.style.palette.slice(0, 6).map((c) => (
                  <span key={c} className="inline-block h-3 w-3 rounded-sm border border-zinc-700" style={{ background: c }} title={c} />
                ))}
                <span className="text-zinc-500">and its reference sample</span>
              </span>
            </label>
          )}
        </div>
      )}
    </div>
  );
}
