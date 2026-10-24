import { AGENT_PROVIDERS, PROVIDER_LABEL, reportsDollars } from '@foundry/core/browser';
import { ProviderSelector } from '../components/ProviderSelector.tsx';
import type { Attachment, WorkflowProfile } from '@foundry/core/browser';
import { ARTIFACT_NATURES, BUDGET_PRESETS, MEDIA_NATURES } from '@foundry/core/browser';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Bot, Box, Clapperboard, CodeXml, CornerDownRight, Eye, FastForward, FileText, FolderGit2, Github, Image as ImageIcon, Lamp, Send, Shapes, Target, Telescope, Wallet, WandSparkles, X, type LucideIcon } from 'lucide-react';
import { ACTION_INFO, CODEX_MODEL_ACTIONS, effectiveCodexPresets, effectivePresets, natureKey, type CodexModelPreset, type ModelNature, type ModelPreset } from '@foundry/core/browser';
import { api, apiForProvider, type AccountsInfo, type AgentProvider, type FollowUpDraft, type GoalRow, type ModelRecordView, type PacksView, type RepoInfo } from '../api.ts';
import { CompanionFolders } from '../components/CompanionFolders.tsx';
import { SectionChipNav, SectionSideNav, type NavSection } from '../components/SectionNav.tsx';
import { AttachmentInput } from '../components/Attachments.tsx';
import { BudgetPicker, type BudgetDraft } from '../components/BudgetPicker.tsx';
import { DeliveryPolicyForm, type PolicyDraft } from '../components/DeliveryPolicyForm.tsx';
import { RepoCard } from '../components/RepoCard.tsx';
import { useUnsaved } from '../unsaved.ts';
import { CodexModelSelect } from '../components/CodexModelSelect.tsx';
import { Button, ButtonGroup, Card, Input, PageHeader, Select, Textarea, choiceClass, cn, code } from '../ui.tsx';
import { INTERVIEW_DEPTHS } from '../interview-depth.ts';
import { HelpLink } from './HelpPage.tsx';
import { initialWorkflow, updateWorkflow } from './new-goal-workflow.ts';
import { applyIssueRead, clearIssue, keptOwnText, type IssueFormState } from './new-goal-issue.ts';
import { defaultCadence, recipeFromBody, scheduleNameFrom } from './new-goal-schedule.ts';
import { ScheduleDialog, type ScheduleMeta } from '../components/ScheduleDialog.tsx';
import type { ScheduleRow } from '../api.ts';

const DELIVERY_KEY = 'foundry.delivery';
const BUDGET_KEY = 'foundry.budget';
const NATURE_KEY = 'foundry.nature';

type Nature = 'auto' | 'code' | 'docs' | 'research' | 'image' | 'video' | 'figure' | 'cad';
/**
 * The kinds of goal, each with an icon in a category colour of its own (ADR-0067) so they tell apart at a glance. Auto is
 * no kind (the system decides), so its icon stays in ink.
 */
const NATURES: { id: Nature; label: string; text: string; Icon: LucideIcon; ink: string }[] = [
  { id: 'auto', label: 'Auto', text: 'The system reads your description and decides.', Icon: WandSparkles, ink: 'text-ink-soft' },
  { id: 'code', label: 'Code', text: 'Software: features, fixes, whole apps.', Icon: CodeXml, ink: code(0).ink },
  { id: 'docs', label: 'Documents', text: 'Proposals, contracts, tutorials, articles.', Icon: FileText, ink: code(1).ink },
  { id: 'research', label: 'Research', text: 'An investigation ending in a cited report.', Icon: Telescope, ink: code(2).ink },
  { id: 'image', label: 'Images', text: 'Posters, logos, illustrations.', Icon: ImageIcon, ink: code(6).ink },
  { id: 'video', label: 'Video', text: 'Generated video or narrated presentations.', Icon: Clapperboard, ink: code(4).ink },
  // beta (ADR-0076): shown only while Settings → Beta → Figure goals is on
  { id: 'figure', label: 'Figures', text: 'Interactive isometric figures of objects and machines, one web page each.', Icon: Lamp, ink: code(3).ink },
  { id: 'cad', label: 'CAD', text: '3D parts and assemblies (STEP), drawings, DXF profiles, robot files.', Icon: Box, ink: code(5).ink },
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

/**
 * The form's sections, each with its icon and a category colour of its own (ADR-0067), as the Brief's: the menu beside the
 * form (the chips above it on a narrower screen) shows the colour as a square, each card's title as its icon. Where a part
 * means what a Brief section means it takes that section's hue: the goal's text blue as Understanding, the budget green,
 * the delivery violet as Completion.
 */
type Section = 'agent' | 'kind' | 'view' | 'goal' | 'repo' | 'budget' | 'delivery' | 'advanced';
const hue = (i: number) => ({ ink: code(i).ink, dot: code(i).dot });
const SECTIONS: Record<Section, { id: string; Icon: LucideIcon; ink: string; dot: string }> = {
  agent: { id: 'new-agent', Icon: Bot, ...hue(5) },
  kind: { id: 'new-kind', Icon: Shapes, ...hue(6) },
  view: { id: 'new-view', Icon: Eye, ...hue(7) },
  goal: { id: 'new-goal', Icon: Target, ...hue(0) },
  repo: { id: 'new-repo', Icon: FolderGit2, ...hue(3) },
  budget: { id: 'new-budget', Icon: Wallet, ...hue(1) },
  delivery: { id: 'new-delivery', Icon: Send, ...hue(2) },
  advanced: { id: 'new-advanced', Icon: FastForward, ...hue(4) },
};
/** a section card's room above it when the menu takes it there: under the chips stuck to the top of a narrow screen */
const SEC = 'scroll-mt-14 lg:scroll-mt-4';
/** each delivery mode in a word, for the menu */
const DELIVERY_WORD: Record<PolicyDraft['mode'], string> = { local: 'local', push: 'push', pr: 'PR', 'pr-automerge': 'auto-merge' };

/** a section card's title: its icon in the section's colour, then the words (the Brief's SectionTitle) */
function SectionTitle({ section, children }: { section: Section; children: ReactNode }) {
  const { Icon, ink } = SECTIONS[section];
  return (
    <span className="inline-flex items-center gap-2">
      <Icon size={14} strokeWidth={2.25} className={cn('shrink-0', ink)} aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}

/** a section title with its "?" to the guide, which stays beside it however the title wraps */
const withHelp = (section: Section, title: ReactNode, to: string) => (
  <span className="flex items-start gap-1.5">
    <SectionTitle section={section}>{title}</SectionTitle>
    <HelpLink to={to} className="mt-0.5 shrink-0" />
  </span>
);

/** The Follow-up this goal is being created as: the earlier goal's draft plus the human's choices on it. */
interface FollowChoice {
  draft: FollowUpDraft;
  startFrom: 'base' | 'previous';
  attachments: boolean;
  style: boolean;
}

export function NewGoalPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const requestedProvider = params.get('provider');
  const initialProvider = AGENT_PROVIDERS.includes(requestedProvider as AgentProvider) ? (requestedProvider as AgentProvider) : null;
  // a follow-up started from a goal page (the audit's remaining findings) arrives with its text
  const [prompt, setPrompt] = useState(() => params.get('prompt') ?? '');
  useUnsaved('new-goal', !!prompt.trim());
  const [repoPath, setRepoPath] = useState('');
  // companion repositories (ADR-0063): other folders the goal changes too
  const [companions, setCompanions] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  // a goal from a GitHub issue (ADR-0052): read once, its title and body fill the form, its thread is attached
  const [issue, setIssue] = useState<IssueFormState['issue']>(null);
  const [issueRef, setIssueRef] = useState(() => params.get('issue') ?? '');
  const [issueOpen, setIssueOpen] = useState(() => !!params.get('issue'));
  const [issueBusy, setIssueBusy] = useState(false);
  const [issueErr, setIssueErr] = useState<string | null>(null);
  // a schedule (ADR-0054): the form is its editor; `?schedule=<id>` opens one, Schedule… saves the form as one
  const [schedule, setSchedule] = useState<ScheduleRow | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [scheduleErr, setScheduleErr] = useState<string | null>(null);
  /** shipped software the goal learns from: REA studies each before Clarify */
  const [references, setReferences] = useState<{ target: string; lookAt: string }[]>([]);
  const [delivery, setDelivery] = useState<PolicyDraft>(loadDraft());
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [budget, setBudget] = useState<BudgetDraft>(loadBudget());
  const [auto, setAuto] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [nature, setNature] = useState<Nature>(() => ((localStorage.getItem(NATURE_KEY) as Nature | null) ?? 'auto'));
  // figure goals are a beta feature (ADR-0076): the kind shows while the switch is on; a remembered figure kind falls back to auto when it is off
  const [betaFigure, setBetaFigure] = useState(false);
  /** the Figure pack this goal follows; '' = Settings' default (the Clarifier may pick the other installed style from the goal's words) */
  const [figurePack, setFigurePack] = useState<'' | 'colorfigures' | 'iso-glow'>('');
  const [figurePacks, setFigurePacks] = useState<PacksView['figure'] | null>(null);
  const [outputDir, setOutputDir] = useState('');
  // interview depth, '0'–'5'; starts from Settings
  const [interviewDepth, setInterviewDepth] = useState('3');
  const [effort, setEffort] = useState('');
  const [provider, setProvider] = useState<AgentProvider>(initialProvider ?? 'claude');
  // the Figure pack's install state for this coding agent, read when the Figure kind is picked (ADR-0076)
  useEffect(() => {
    if (nature !== 'figure') return;
    setFigurePacks(null);
    void apiForProvider(provider).packs().then((p) => setFigurePacks(p.figure)).catch(() => {});
  }, [nature, provider]);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AccountsInfo | null>(null);
  const [codexModel, setCodexModel] = useState('codex-default');
  const [codexOverride, setCodexOverride] = useState(false);
  const [codexKnown, setCodexKnown] = useState<ModelRecordView[] | null>(null);
  // Antigravity runs every role on one model: '' = the one Settings names
  const [agyModel, setAgyModel] = useState('');
  const [agyDefault, setAgyDefault] = useState('agy-default');
  const [agyKnown, setAgyKnown] = useState<ModelRecordView[] | null>(null);
  useEffect(() => { api.accounts().then(setAccounts).catch((e) => setAccountError(e.message)); }, []);
  useEffect(() => { if (provider === 'codex' && !codexKnown) void api.models('codex').then((r) => setCodexKnown(r.models)).catch(() => setCodexKnown([])); }, [provider]);
  useEffect(() => { if (provider === 'agy' && !agyKnown) void api.models('agy').then((r) => setAgyKnown(r.models)).catch(() => setAgyKnown([])); }, [provider]);
  const [modelPreset, setModelPreset] = useState('');
  const [codexPreset, setCodexPreset] = useState('');
  const [presetInfo, setPresetInfo] = useState<{ ids: { id: string; label: string }[]; picks: Record<ModelNature, string> } | null>(null);
  const [codexPresetInfo, setCodexPresetInfo] = useState<{ ids: { id: string; label: string }[]; picks: Record<ModelNature, string>; presets: Record<string, CodexModelPreset> } | null>(null);
  useEffect(() => localStorage.setItem(NATURE_KEY, nature), [nature]);
  // the cad tile says when text-to-cad is missing for this coding agent (a cad goal waits for it before Clarify)
  const [cad, setCad] = useState<{ installed: boolean; uv: boolean } | null>(null);
  useEffect(() => {
    setCad(null);
    void api.cad(provider).then(setCad).catch(() => setCad(null));
  }, [provider]);
  useEffect(() => {
    setPstackReady(null);
    void apiForProvider(provider)
      .skills()
      .then((o) => setPstackReady(o.catalog.some((c) => c.entry.bundle === 'pstack' && c.status === 'installed')))
      .catch(() => setPstackReady(false));
  }, [provider]);
  const [mode, setModeState] = useState<'simple' | 'expert'>('expert');
  const [workflow, setWorkflow] = useState(initialWorkflow);
  const { profile, tdd, ponytail } = workflow.values;
  const validationRequest = useRef(0);
  /** the pstack suite is a choice once its copy is installed (Setup page); null = not known yet */
  const [pstackReady, setPstackReady] = useState<boolean | null>(null);
  const [pace, setPace] = useState<'thorough' | 'fast'>('thorough');
  // delegated goals: off by default; the second switch only matters with the first
  const [delegate, setDelegate] = useState(false);
  const [delegateAuto, setDelegateAuto] = useState(false);
  const [defaultRemote, setDefaultRemote] = useState('origin');
  /** fields the human changed on this page: the Settings defaults arriving later never overwrite them */
  const changed = useRef(new Set<string>(initialProvider ? ['provider'] : []));
  const changeWorkflow = (event: Parameters<typeof updateWorkflow>[1]) => setWorkflow((s) => updateWorkflow(s, event, changed.current));
  const beginRepoValidation = () => {
    const request = ++validationRequest.current;
    const current = () => request === validationRequest.current;
    setRepoInfo(null);
    changeWorkflow({ type: 'pending', request });
    const finish = (info: RepoInfo | null) => {
      if (!current()) return false;
      setRepoInfo(info);
      changeWorkflow({ type: 'validated', request, ok: info?.ok ?? false, lastGoal: info?.lastGoal ?? null });
      return true;
    };
    return { current, finish };
  };
  const setMode = (v: 'simple' | 'expert') => {
    changed.current.add('mode');
    setModeState(v);
  };
  const setTdd = (v: 'required' | 'preferred' | 'off') => {
    changed.current.add('tdd');
    changeWorkflow({ type: 'edit', field: 'tdd', value: { tdd: v } });
  };
  const setProfile = (v: WorkflowProfile) => {
    changed.current.add('profile');
    changeWorkflow({ type: 'edit', field: 'profile', value: { profile: v } });
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
        if (!changed.current.has('codexModel')) setCodexModel(v.values.models.codexModel);
        setAgyDefault(v.values.models.agyModel);
        if (!changed.current.has('provider')) setProvider(v.values.engine.provider);
        const presets = effectivePresets((v.values.models.presets ?? {}) as Record<string, ModelPreset>);
        setPresetInfo({ ids: Object.entries(presets).map(([id, p]) => ({ id, label: p.label })), picks: { code: v.values.models.presetCode, docs: v.values.models.presetDocs, media: v.values.models.presetMedia } });
        const codexPresets = effectiveCodexPresets((v.values.models.codexPresets ?? {}) as Record<string, CodexModelPreset>);
        setCodexPresetInfo({ ids: Object.entries(codexPresets).map(([id, p]) => ({ id, label: p.label })), picks: { code: v.values.models.codexPresetCode, docs: v.values.models.codexPresetDocs, media: v.values.models.codexPresetMedia }, presets: codexPresets });
        const d = v.values;
        if (!changed.current.has('effort')) setEffort(d.workflow.effort ?? '');
        if (!changed.current.has('interviewDepth')) setInterviewDepth(String(d.workflow.interviewDepth ?? { never: 0, auto: 3, always: 4 }[d.workflow.interview]));
        if (!changed.current.has('mode')) setModeState(d.workflow.defaultMode);
        changeWorkflow({ type: 'settings', values: { profile: d.workflow.profile ?? 'mattpocock', tdd: d.workflow.tdd, ponytail: d.workflow.ponytail ?? 'on' } });
        basePace.current = d.workflow.defaultPace;
        setBetaFigure(!!d.beta?.figure);
        if (!d.beta?.figure && nature === 'figure') setNature('auto');
        // media goals default to fast on top of the Settings pace, as when the goal type is picked by hand
        if (!paceTouched.current) setPace(MEDIA_NATURES.includes(nature) ? 'fast' : d.workflow.defaultPace);
        setDefaultRemote(d.delivery.defaultRemote);
        setDelivery((cur) => ({ ...cur, ...(changed.current.has('deliveryMode') ? {} : { mode: d.delivery.defaultMode }), ...(changed.current.has('deliveryUnit') ? {} : { unit: d.delivery.defaultUnit }) }));
      })
      .catch(() => {});
  }, []);
  // Follow-up: /goals/new?follows=<id> prefills the form from the earlier goal; the Follows picker only links
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
      changed.current.add('provider');
      changed.current.add('codexModel');
      changed.current.add('effort');
      setProvider(p.provider);
      setCodexOverride(p.provider === 'codex' && !!p.codexModel);
      if (p.codexModel) setCodexModel(p.codexModel);
      setAgyModel(p.provider === 'agy' ? p.agyModel ?? '' : '');
      changeWorkflow({ type: 'follow-up', values: { profile: p.profile, tdd: p.tdd, ponytail: p.ponytail } });
      setRepoPath(p.repoPath);
      setRepoKey((k) => k + 1);
      const validation = beginRepoValidation();
      void api.validateRepo(p.repoPath).then(validation.finish).catch(() => validation.finish(null));
      setNature(p.nature);
      if (p.provider === 'codex') setCodexPreset(p.modelPreset ?? '');
      else setModelPreset(p.modelPreset ?? '');
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
  const readIssue = async (ref: string) => {
    if (!ref.trim()) return;
    setIssueBusy(true);
    setIssueErr(null);
    try {
      const read = await api.readIssue(ref.trim(), repoInfo?.ok ? repoPath.trim() : null);
      const next = applyIssueRead({ prompt, title, attachments, issue }, read);
      setPrompt(next.prompt);
      setTitle(next.title);
      setAttachments(next.attachments);
      setIssue(next.issue);
      setIssueOpen(false);
    } catch (e: any) {
      setIssueErr(e.message);
    } finally {
      setIssueBusy(false);
    }
  };
  const unlinkIssue = () => {
    const next = clearIssue({ prompt, title, attachments, issue });
    setAttachments(next.attachments);
    setIssue(null);
    setIssueRef('');
  };
  const saveSchedule = async (meta: ScheduleMeta) => {
    setScheduleBusy(true);
    setScheduleErr(null);
    try {
      await api.saveSchedule({ id: schedule?.id, name: meta.name, cadence: meta.cadence, autoApprove: meta.autoApprove, recipe: recipeFromBody(formBody() as never) });
      nav('/schedules');
    } catch (e: any) {
      setScheduleErr(e.message);
    } finally {
      setScheduleBusy(false);
    }
  };
  /** `?schedule=<id>`: the form filled with the schedule's recipe; Save schedule writes it back */
  const openSchedule = async (id: string) => {
    try {
      const row = (await api.schedules()).schedules.find((x) => x.id === id);
      if (!row) return setErr(`schedule ${id} not found`);
      const r = row.recipe;
      setSchedule(row);
      changed.current.add('provider');
      changed.current.add('codexModel');
      changed.current.add('effort');
      changed.current.add('interviewDepth');
      changed.current.add('mode');
      changed.current.add('deliveryMode');
      changed.current.add('deliveryUnit');
      setPrompt(r.prompt);
      setTitle(r.title ?? '');
      if (r.provider) setProvider(r.provider);
      setCodexOverride(r.provider === 'codex' && !!r.codexModel);
      if (r.codexModel) setCodexModel(r.codexModel);
      setAgyModel(r.provider === 'agy' ? r.agyModel ?? '' : '');
      setRepoPath(r.repoPath);
      setRepoKey((k) => k + 1);
      const validation = beginRepoValidation();
      void api.validateRepo(r.repoPath).then(validation.finish).catch(() => validation.finish(null));
      if (r.nature) setNature(r.nature as Nature);
      if (r.provider === 'codex') setCodexPreset(r.modelPreset ?? '');
      else setModelPreset(r.modelPreset ?? '');
      setEffort(r.effort ?? '');
      if (r.workflow?.pace) choosePace(r.workflow.pace);
      if (r.mode) setModeState(r.mode);
      changeWorkflow({ type: 'follow-up', values: { profile: r.workflow?.profile ?? profile, tdd: r.workflow?.tdd ?? tdd, ponytail: r.workflow?.ponytail ?? ponytail } });
      if (r.interviewDepth != null) setInterviewDepth(String(r.interviewDepth));
      if (r.delivery) setDelivery((cur) => ({ ...cur, ...r.delivery }));
      if (r.budgetPreset) setBudget((b) => ({ preset: r.budgetPreset!, budgets: { ...b.budgets, ...(r.budgets ?? {}) } }));
      setDelegate(!!r.delegation?.allow);
      setDelegateAuto(!!r.delegation?.autoApprove);
      if (r.autoBrief) {
        setAuto(true);
        setChecks(r.autoBrief.mustChecks.join('\n'));
        setStretch((r.autoBrief.stretchChecks ?? []).join('\n'));
      }
      if (r.outputDir) setOutputDir(r.outputDir);
      for (const l of r.links) void api.addLink(l.url, { name: l.name, note: l.note }).then((a) => setAttachments((cur) => [...cur, a])).catch(() => {});
    } catch (e: any) {
      setErr(e.message);
    }
  };
  useEffect(() => {
    const id = params.get('follows');
    if (id) void chooseFollow(id, true);
    if (params.get('issue')) void readIssue(params.get('issue')!);
    if (params.get('schedule')) void openSchedule(params.get('schedule')!);
    api
      .goals()
      .then((gs) => setFinishedGoals(gs.filter((g) => FINISHED.includes(g.state))))
      .catch(() => {});
  }, []);
  // the Follows picker lists finished goals of the chosen repository; another repository drops the link
  const followCandidates = finishedGoals.filter((g) => g.repoPath === repoPath.trim());
  // what earlier goals in this folder learned (ADR-0040): Clarify is given it
  const [learned, setLearned] = useState(0);
  useEffect(() => {
    const path = repoPath.trim();
    if (!repoInfo?.ok || !path) return setLearned(0);
    let alive = true;
    api
      .repoLearnings(path)
      .then((r) => alive && setLearned(r.learnings.length))
      .catch(() => alive && setLearned(0));
    return () => {
      alive = false;
    };
  }, [repoPath, repoInfo?.ok]);
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

  // Antigravity has no presets: one model for every role
  const activePresetInfo = provider === 'codex' ? codexPresetInfo : provider === 'agy' ? null : presetInfo;
  const selectedAccount = accounts?.accounts.find((account) => account.provider === provider);
  const selectedPreset = provider === 'codex' ? codexPreset : provider === 'agy' ? '' : modelPreset;
  const missingPreset = !!selectedPreset && !!activePresetInfo && !activePresetInfo.ids.some((p) => p.id === selectedPreset);
  const codexPreview = codexPresetInfo?.presets[codexPreset || codexPresetInfo.picks[natureKey(nature)]];
  const unsupportedCodexChoices = provider === 'codex' && codexPreview ? [...new Set(CODEX_MODEL_ACTIONS.flatMap((role) => {
    const choice = codexPreview.tables[natureKey(nature)][role];
    const model = codexOverride || choice.model === 'codex-default' ? codexModel : choice.model;
    const wantedEffort = effort || choice.effort;
    const metadata = codexKnown?.find((m) => m.name === model)?.codex;
    const advertised = metadata?.available ? metadata.reasoningEfforts : undefined;
    return wantedEffort && advertised?.length && !advertised.includes(wantedEffort) ? [`${model} does not advertise ${wantedEffort} reasoning`] : [];
  }))] : [];
  const agentName = PROVIDER_LABEL[provider];
  // the first thing still missing, said next to the button: a greyed-out button must never leave you guessing
  const notReady = !prompt.trim()
    ? 'Describe the goal'
    : !repoPath.trim()
      ? 'Select a repository folder'
      : !repoInfo?.ok
        ? 'Repository is not ready (see above)'
        : !selectedAccount
          ? `Checking the ${agentName} sign-in…`
          : !selectedAccount.installed
            ? `${agentName} is not installed: see Setup`
            : !selectedAccount.status.loggedIn
              ? `Sign in to ${agentName} first: see Accounts`
              : missingPreset
                ? 'Choose a model preset (see above)'
                : unsupportedCodexChoices.length
                  ? unsupportedCodexChoices[0]!
                  : provider === 'codex' && codexOverride && !codexModel.trim()
                    ? 'Pick the Codex model'
                    : null;
  const ready = notReady === null;
  /** how that first missing thing stands: still to fill in (ink), being checked (blue), a sign-in only you can do (yellow), broken (red) */
  const notReadyTone = !prompt.trim() || !repoPath.trim() ? 'text-ink-soft' : !repoInfo ? 'text-work-ink' : !repoInfo.ok ? 'text-bad-ink' : !selectedAccount ? 'text-work-ink' : !selectedAccount.installed ? 'text-bad-ink' : !selectedAccount.status.loggedIn ? 'text-you-ink' : missingPreset || unsupportedCodexChoices.length ? 'text-bad-ink' : 'text-ink-soft';
  // a schedule is saved without starting a session: the sign-in gates do not hold it back (a run refuses at its time instead)
  const scheduleReady = !!prompt.trim() && !!repoInfo?.ok && !missingPreset && !unsupportedCodexChoices.length && !(provider === 'codex' && codexOverride && !codexModel.trim());
  const done = [prompt.trim().length > 0, repoInfo?.ok ?? false, true, true];
  /** the step you are at: the first not done yet */
  const current = done.indexOf(false);

  /** what Create sends: the goal as the form stands (a schedule keeps it as its recipe) */
  const formBody = () => ({
        provider,
        codexModel: provider === 'codex' && codexOverride ? codexModel.trim() : undefined,
        agyModel: provider === 'agy' && agyModel ? agyModel : undefined,
        prompt,
        repoPath: repoPath.trim(),
        title: title.trim() || undefined,
        budgets: { ...budget.budgets, ...(!reportsDollars(provider) ? { maxCostUsd: null } : {}) },
        budgetPreset: budget.preset,
        autoBrief: auto ? { mustChecks: checks.split('\n').map((s) => s.trim()).filter(Boolean), stretchChecks: stretch.split('\n').map((s) => s.trim()).filter(Boolean) } : undefined,
        delivery,
        attachments,
        // a goal that skips Clarify has no investigation before it: its references would be refused
        references: auto ? [] : references.map((r) => ({ target: r.target.trim(), lookAt: r.lookAt.trim() })).filter((r) => r.target),
        mode,
        // fast: let the engine default the TDD mandate off instead of pinning it here
        workflow: pace === 'fast' ? { pace, ponytail, profile } : { pace, tdd: mode === 'simple' ? 'preferred' : tdd, ponytail, profile },
        nature,
        figurePack: nature === 'figure' && figurePack ? figurePack : undefined,
        outputDir: ARTIFACT_NATURES.includes(nature) && outputDir.trim() ? outputDir.trim() : undefined,
        interviewDepth: Number(interviewDepth),
        effort: effort || (provider === 'codex' ? null : undefined),
        modelPreset: (provider === 'codex' ? codexPreset : provider === 'agy' ? '' : modelPreset) || undefined,
        follows: follow ? { goalId: follow.draft.previous.id, startFrom: follow.startFrom, attachments: follow.attachments, style: follow.style } : undefined,
        delegation: { allow: delegate, autoApprove: delegate && delegateAuto },
        companions: companions.map((p) => p.trim()).filter(Boolean).map((p) => ({ repoPath: p })),
        issue: issue?.read.issue,
      });
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const goal = await api.createGoal(formBody());
      try {
        localStorage.setItem(DELIVERY_KEY, JSON.stringify({ remote: delivery.remote, mergeMethod: delivery.mergeMethod, requireChecks: delivery.requireChecks, autoResolveConflicts: delivery.autoResolveConflicts, fixCiCycles: delivery.fixCiCycles, fixReviewCycles: delivery.fixReviewCycles, deleteRemoteBranch: delivery.deleteRemoteBranch }));
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
  const defaultPick = activePresetInfo?.picks[natureKey(nature)];
  const defaultPreset = provider === 'codex' && nature === 'auto' ? 'By goal type' : defaultPick ? (activePresetInfo!.ids.find((p) => p.id === defaultPick)?.label ?? defaultPick) : null;
  /** a branch's name for the menu, cut short where it would not fit beside its section */
  const short = (s: string) => (s.length > 12 ? `${s.slice(0, 11)}…` : s);
  // the menu: each section in its colour, with what it is set to; what only you can still give (the goal's text, its
  // folder, a sign-in) on a yellow plate, a check under way in blue and one passed (the agent signed in, the folder
  // ready) in green
  const navItems: NavSection[] = [
    { id: SECTIONS.agent.id, label: 'Coding agent', dot: SECTIONS.agent.dot, ...(selectedAccount && !selectedAccount.installed ? { status: 'not installed', warn: true } : selectedAccount && !selectedAccount.status.loggedIn ? { status: 'sign in', warn: true } : { status: PROVIDER_LABEL[provider], ...(selectedAccount ? { tone: 'ok' as const } : {}) }) },
    { id: SECTIONS.kind.id, label: 'Kind of goal', dot: SECTIONS.kind.dot, status: NATURES.find((n) => n.id === nature)?.label },
    { id: SECTIONS.view.id, label: 'How much to see', dot: SECTIONS.view.dot, status: mode === 'simple' ? 'Simple' : 'Expert' },
    { id: SECTIONS.goal.id, label: `1 · ${STEPS[0]}`, dot: SECTIONS.goal.dot, ...(prompt.trim() ? {} : { status: 'missing', warn: true }) },
    { id: SECTIONS.repo.id, label: `2 · ${STEPS[1]}`, dot: SECTIONS.repo.dot, ...(!repoPath.trim() ? { status: 'missing', warn: true } : !repoInfo ? { status: 'checking…', tone: 'work' as const } : !repoInfo.ok ? { status: 'not ready', warn: true } : { status: short(repoInfo.branch), tone: 'ok' as const }) },
    { id: SECTIONS.budget.id, label: `3 · ${STEPS[2]}`, dot: SECTIONS.budget.dot, status: BUDGET_PRESETS[budget.preset].label },
    { id: SECTIONS.delivery.id, label: `4 · ${STEPS[3]}`, dot: SECTIONS.delivery.dot, status: DELIVERY_WORD[delivery.mode] },
    ...(advanced ? [{ id: SECTIONS.advanced.id, label: 'Skip Clarify', dot: SECTIONS.advanced.dot, status: auto ? 'on' : 'off' }] : []),
  ];
  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 pt-6 md:pt-9 pb-24 space-y-4">
      <PageHeader
        title="New goal"
        actions={
          // on a phone the steps keep their names and drop the dashes between them, wrapping only on the narrowest screens
          <ol className="flex flex-wrap items-center gap-1.5" aria-label="Steps">
            {STEPS.map((s, i) => (
              <li key={s} className="flex items-center gap-1.5" aria-current={i === current ? 'step' : undefined}>
                {/* a small leaning plate, as the goal page's stages: in ink once done, its number on a green tile; outlined
                    heavily where you are, hollow after */}
                <span className={cn('relative isolate inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-1 text-xs font-bold', done[i] ? 'text-on-ink' : i === current ? 'text-ink' : 'text-ink-faint')}>
                  {/* inset-ring, not ring-inset: the theme has a colour named inset, and ring-inset would paint the ring in it */}
                  <i aria-hidden="true" className={cn('absolute inset-0 -z-10 rounded-[4px] slant', done[i] ? 'bg-ink' : i === current ? 'bg-panel inset-ring-2 inset-ring-ink' : 'inset-ring-[1.5px] inset-ring-line-strong')} />
                  <span className={cn('mono', done[i] && 'grid h-4 min-w-4 place-items-center rounded-[3px] bg-ok px-1 text-on-ok')}>{i + 1}</span>
                  <span>{s}</span>
                </span>
                {i < STEPS.length - 1 && <span className="hidden sm:block h-0.5 w-3 rounded-full bg-line-strong" aria-hidden="true" />}
              </li>
            ))}
          </ol>
        }
      />
      {/* the form's sections as a menu beside it on a wide screen, in view while <main> scrolls the form; chips stuck to
          the top above it on a narrower one (the Brief's layout) */}
      <div className="grid lg:grid-cols-[13rem_minmax(0,1fr)] gap-x-8">
        <SectionSideNav items={navItems} label="New goal sections" />
        <div className="min-w-0 space-y-4">
          <SectionChipNav items={navItems} label="New goal sections" />
          {follow && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-panel text-ink text-[13px] font-semibold pl-2.5 pr-1 py-1 max-w-full ring-1 ring-inset ring-line-strong">
                <CornerDownRight size={13} className="shrink-0 text-work-ink" />
                <span className="truncate">Follows: {follow.draft.previous.title}</span>
                <button type="button" className="rounded p-0.5 text-ink-soft hover:bg-sunken hover:text-ink shrink-0" aria-label="Remove follows" title="This goal will not follow it" onClick={() => setFollow(null)}>
                  <X size={12} />
                </button>
              </span>
              <span className="text-xs text-ink-faint">Settings are prefilled from it; Clarify gets what it asked, decided and delivered as background.</span>
            </div>
          )}

          <Card id={SECTIONS.agent.id} className={SEC} title={<SectionTitle section="agent">Coding agent</SectionTitle>}>
            <ProviderSelector hideLabel value={provider} onChange={(id) => { changed.current.add('provider'); setProvider(id); if (id !== 'codex' && ['none', 'minimal', 'ultra'].includes(effort)) setEffort(''); }} />
            <p className="mt-2.5 text-xs text-ink-soft">
              {PROVIDER_LABEL[provider]} ·{' '}
              {/* being checked is at work; connected passed; a sign-in only you can do waits for you; a missing CLI failed */}
              <span className={cn('font-semibold', !selectedAccount ? 'text-work-ink' : selectedAccount.status.loggedIn ? 'text-ok-ink' : selectedAccount.installed ? 'text-you-ink' : 'text-bad-ink')}>{!selectedAccount ? 'Checking account…' : selectedAccount.status.loggedIn ? 'Connected' : selectedAccount.installed ? 'Sign in required' : 'CLI not installed'}</span>
            </p>
            {accountError && <p role="alert" className="mt-3 text-xs text-bad-ink">Unable to check accounts: {accountError}. Open Manage accounts to retry.</p>}
            <p className="text-xs text-ink-faint mt-3">This choice stays fixed for the goal, including retries and reviews. <a href="/accounts" className="font-semibold text-work-ink hover:underline">Manage accounts</a></p>
          </Card>
          <Card id={SECTIONS.kind.id} className={SEC} title={withHelp('kind', 'What kind of goal is this?', 'your-first-goal#what-kind-of-goal-is-this')}>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {NATURES.filter((n) => n.id !== 'figure' || betaFigure).map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => {
                    setNature(n.id);
                    // anyone-facing default: prose/media goals open in the plain-language view (cad is code work and keeps the default)
                    if (n.id !== 'code' && n.id !== 'auto' && n.id !== 'cad') setMode('simple');
                    // media deliverables are judged by eye — default to fast (no engine AI reviews) unless the human chose a pace
                    if (!paceTouched.current) setPace(MEDIA_NATURES.includes(n.id) ? 'fast' : basePace.current);
                  }}
                  // a stretched button centres its content; flex-col keeps short cards aligned with tall ones
                  className={cn('flex flex-col text-left rounded-lg border p-2.5', choiceClass(nature === n.id))}
                >
                  <div className="flex items-center gap-1.5 text-sm font-bold text-ink">
                    <n.Icon size={15} strokeWidth={2.25} className={cn('shrink-0', n.ink)} aria-hidden="true" />
                    {n.label}
                  </div>
                  <div className="text-xs text-ink-faint mt-1 leading-snug">{n.text}</div>
                </button>
              ))}
            </div>
            {nature === 'cad' && cad && !cad.installed && (
              // a tool the goal needs is missing: red, as a coding agent's missing CLI
              <p className="mt-2 text-xs text-bad-ink" role="status">
                {provider === 'agy' ? 'text-to-cad is not available for Antigravity: a CAD goal would wait for it before Clarify. Run CAD goals on Claude Code or Codex.' : <>text-to-cad is not installed for this coding agent: a CAD goal waits for it before Clarify. Install it on the <Link to={`/setup?provider=${provider}`} className="underline">Setup page</Link> (3D models){cad.uv ? '' : '; uv, which runs its CAD kernel, is missing too'}.</>}
              </p>
            )}
            {nature === 'figure' && (
              <div className="mt-3">
                <label className="text-xs text-ink-soft">Style — the figure skill that draws this goal's figures (Settings → Skills → Figure skills sets the default)</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-1">
                  {[
                    { id: '' as const, label: `Default${figurePacks ? ` · ${figurePacks.options.find((o) => o.id === figurePacks.chosen)?.label ?? figurePacks.chosen}` : ''}`, summary: "Settings' Figure pack. The Clarifier may pick the other installed style when your words clearly ask for its look.", ok: true },
                    ...(figurePacks?.options ?? [])
                      .filter((o) => o.id === 'colorfigures' || o.id === 'iso-glow')
                      .map((o) => ({ id: o.id as 'colorfigures' | 'iso-glow', label: o.label, summary: o.summary, ok: o.entries.length > 0 && o.entries.every((e) => e.status.startsWith('installed')) })),
                  ].map((o) => (
                    <button key={o.id} type="button" disabled={!o.ok} title={o.ok ? undefined : 'Not installed for this coding agent: Settings → Skills → Figure skills'} onClick={() => setFigurePack(o.id)} className={cn('flex flex-col text-left rounded-lg border p-2.5 disabled:opacity-50', choiceClass(figurePack === o.id))}>
                      <div className="text-sm font-bold text-ink">
                        {o.label}
                        {o.ok ? '' : <span className="ml-1.5 text-xs font-normal text-ink-faint">not installed</span>}
                      </div>
                      <div className="text-xs text-ink-faint mt-1 leading-snug line-clamp-3">{o.summary}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {ARTIFACT_NATURES.includes(nature) && (
              <div className="mt-3">
                <label className="text-xs text-ink-soft">Output folder — the finished files are copied here when the goal completes (optional; otherwise they stay in the goal's workspace)</label>
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

          <Card id={SECTIONS.view.id} className={SEC} title={withHelp('view', 'How much do you want to see?', 'your-first-goal#how-much-do-you-want-to-see')}>
            <div className="grid sm:grid-cols-2 gap-2">
              {(
                [
                  { id: 'simple', label: 'Simple', text: 'You read one plain-language Brief, answer its questions, approve — the engine does the rest and only shows a progress bar and what needs you. TDD is suggested, not enforced.' },
                  { id: 'expert', label: 'Expert', text: 'Every control: Areas, task graph, acceptance checks, attempt logs, merge resolution, engineering discipline.' },
                ] as const
              ).map((m) => (
                <button key={m.id} type="button" onClick={() => setMode(m.id)} className={cn('flex flex-col text-left rounded-lg border p-3', choiceClass(mode === m.id))}>
                  <div className="text-sm font-bold text-ink">{m.label}</div>
                  <div className="text-xs text-ink-faint mt-1 leading-snug">{m.text}</div>
                </button>
              ))}
            </div>
            <label className="mt-3 flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1 shrink-0" checked={pace === 'fast'} onChange={(e) => choosePace(e.target.checked ? 'fast' : 'thorough')} />
              <span>
                <span className="font-semibold text-ink">Fast mode</span><HelpLink to="your-first-goal#fast-mode" className="ml-1.5" />
                <span className="text-xs text-ink-faint block leading-snug">Once you approve the Brief, the engine skips its own extra AI reviews (and the TDD mandate). The acceptance checks you approved still run — good for media goals and quick jobs.</span>
              </span>
            </label>
            <div className="mt-3 space-y-1 text-xs">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="font-semibold text-ink-soft">Interview depth<HelpLink to="your-first-goal#interview-depth" className="ml-1.5" /></span>
                <ButtonGroup
                  label="Interview depth"
                  value={interviewDepth}
                  onChange={(value) => { changed.current.add('interviewDepth'); setInterviewDepth(value); }}
                  options={INTERVIEW_DEPTHS.map((d) => ({ id: d.id, label: d.short, title: d.label }))}
                />
              </div>
              <span className="text-xs text-ink-faint block leading-snug">{INTERVIEW_DEPTHS.find((d) => d.id === interviewDepth)?.label}. How deep the Clarifier questions you before writing the Brief (options with its recommendation first); it sets how thoroughly it probes, not a number of rounds.</span>
            </div>
            <label className="mt-3 flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1 shrink-0" checked={delegate} onChange={(e) => { setDelegate(e.target.checked); if (!e.target.checked) setDelegateAuto(false); }} />
              <span>
                <span className="font-semibold text-ink">Delegated goals</span><HelpLink to="your-first-goal#delegated-goals" className="ml-1.5" />
                <span className="text-xs text-ink-faint block leading-snug">The planner may hand a step that is a project of its own (research that comes first, a 3D model or a video next to the code, a part too large for one plan) to a goal of its own, with its own Clarify and plan. Its result lands on this goal's branch before the tasks that need it. They run side by side, as many as the goal's parallel limit allows, each with a share of the budget. Off: every step is one task.</span>
              </span>
            </label>
            {delegate && (
              <label className="mt-2 ml-6 flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 shrink-0" checked={delegateAuto} onChange={(e) => setDelegateAuto(e.target.checked)} />
                <span>
                  <span className="font-semibold text-ink">Approve delegated goals' Briefs for me</span>
                  <span className="text-xs text-ink-faint block leading-snug">Their Briefs are approved as soon as they are written, unless a question only you can answer is left. Off: this goal pauses until you approve each one.</span>
                </span>
              </label>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-3">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-xs font-semibold text-ink-soft">Effort<HelpLink to="your-first-goal#effort" className="ml-1.5" /></span>
                <ButtonGroup
                  label="Effort"
                  value={effort}
                  onChange={(value) => { changed.current.add('effort'); setEffort(value); }}
                  options={[
                    { id: '', label: 'Default', title: provider === 'codex' ? 'Use each role’s preset effort' : 'The effort level set in Settings' },
                    ...(provider === 'codex' ? [{ id: 'none', label: 'none' }, { id: 'minimal', label: 'minimal' }] : []),
                    { id: 'low', label: 'low', title: 'Less reasoning for simple, well-defined goals' },
                    { id: 'medium', label: 'medium' },
                    { id: 'high', label: 'high' },
                    { id: 'xhigh', label: 'xhigh', title: 'Hard, cross-cutting work' },
                    { id: 'max', label: 'max', title: 'More reasoning for the hardest problems' },
                    ...(provider === 'codex' ? [{ id: 'ultra', label: 'ultra' }] : []),
                  ]}
                />
              </div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-xs font-semibold text-ink-soft">Models<HelpLink to="your-first-goal#models" className="ml-1.5" /></span>
                {provider === 'agy' ? (
                  <div className="w-72 max-w-full">
                    <Select aria-label="Antigravity model" className="text-xs" value={agyModel} onChange={(e) => { changed.current.add('agyModel'); setAgyModel(e.target.value); }}>
                      <option value="">Default · {agyDefault}</option>
                      {(agyKnown ?? []).map((m) => <option key={m.name} value={m.name}>{m.label ? `${m.label} · ${m.name}` : m.name}</option>)}
                    </Select>
                  </div>
                ) : (
                <ButtonGroup
                  label={provider === 'codex' ? 'Codex preset' : 'Models'}
                  value={provider === 'codex' ? codexPreset : modelPreset}
                  onChange={provider === 'codex' ? setCodexPreset : setModelPreset}
                  options={[
                    {
                      id: '',
                      label: `Default${defaultPreset ? ` · ${defaultPreset}` : ''}`,
                      title: 'The preset Settings picks for this goal type (Settings → Models & limits)',
                    },
                    ...(activePresetInfo?.ids ?? []).map((p) => ({ id: p.id, label: p.label })),
                  ]}
                />
                )}
              </div>
            </div>
            {missingPreset && <p role="alert" className="mt-3 text-xs text-bad-ink">The earlier goal’s preset “{selectedPreset}” is no longer available. Choose a preset for this new goal.</p>}
            {provider === 'codex' && <div className="mt-4 space-y-3 rounded-lg border border-line bg-sunken p-3">
              <p className="text-xs text-ink-soft">This goal captures its Codex preset and fallback order when created. An explicit effort above overrides every role; Default uses each role’s preset.</p>
              {nature === 'auto' && !codexPreset && <p className="text-xs text-ink-soft">Auto captures the defaults for every goal type. The preview shows Code roles until classification; the inferred type uses its captured Code (software and CAD), Docs & research or Media table.</p>}
              <label className="flex items-start gap-2 text-xs font-semibold text-ink"><input type="checkbox" className="mt-0.5 shrink-0" checked={codexOverride} onChange={(e) => setCodexOverride(e.target.checked)} />Use one model for every role in this goal</label>
              {codexOverride && <div className="max-w-lg"><CodexModelSelect label="Codex goal model override" known={codexKnown} value={codexModel} defaultLabel="CLI default model" onChange={(value) => { changed.current.add('codexModel'); setCodexModel(value); }} /><p className="text-[11px] text-ink-faint mt-1">This replaces each role’s model while keeping its preset effort unless you choose a goal-wide effort. CLI default model follows your native Codex configuration.</p></div>}
              {codexPreview && <details className="text-xs"><summary className="cursor-pointer font-semibold text-ink-soft hover:text-ink">View {codexPreview.label} role assignments</summary><p className="text-ink-faint mt-2">{codexPreview.description}</p><div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 mt-3">{CODEX_MODEL_ACTIONS.map((role) => { const choice = codexPreview.tables[natureKey(nature)][role]; const model = codexOverride || choice.model === 'codex-default' ? codexModel : choice.model; return <div key={role} className="flex justify-between gap-3 border-b border-line py-1"><span className="text-ink-soft">{role === 'housekeeping' ? 'Housekeeping' : ACTION_INFO[role].label}</span><span className="text-right mono text-ink">{model === 'codex-default' ? 'CLI default model' : model} · {effort || choice.effort || 'CLI effort'}</span></div>; })}</div></details>}
              {unsupportedCodexChoices.length > 0 && <p role="alert" className="text-xs text-bad-ink">{unsupportedCodexChoices.join('; ')}. Choose a supported goal effort or update the preset in Settings.</p>}
              <p className="text-xs text-work-ink">Codex dollar costs are unavailable; dollar budgets do not stop runs. Use duration and attempt limits.</p>
            </div>}
            {provider === 'agy' && <div className="mt-4 space-y-2 rounded-lg border border-line bg-sunken p-3">
              <p className="text-xs text-ink-soft">Every role of this goal runs on the one model above, kept when the goal is created. Default is the model Settings names; Antigravity default follows the model agy itself is set to. An explicit effort applies to every role.</p>
              <p className="text-xs text-work-ink">Antigravity dollar costs are unavailable; dollar budgets do not stop runs. Use duration and attempt limits.</p>
            </div>}
            {mode === 'expert' && (
              <div className="mt-3 flex items-center gap-2.5 flex-wrap">
                <span className="text-xs font-semibold text-ink-soft">Powered by<HelpLink to="your-first-goal#workflow-suite" className="ml-1.5" /></span>
                <ButtonGroup
                  label="Workflow suite"
                  value={profile}
                  onChange={setProfile}
                  options={[
                    { id: 'mattpocock', label: 'mattpocock', title: "Matt Pocock's suite: tests first for features, diagnose first for bugs, code review at the end" },
                    { id: 'pstack', label: 'pstack', title: pstackReady === false ? 'Install the pstack suite on the Setup page first' : "pstack's suite, with Matt Pocock's skills where pstack has none", disabled: pstackReady === false },
                    { id: 'plain', label: 'plain', title: 'No workflow rules: sessions only hear which skills are installed' },
                  ]}
                />
                <span className="text-[11px] text-ink-faint">Whose skills the roles follow for this goal; fixed once the goal is created.{pstackReady === false && <> pstack is not installed: <Link to="/setup" className="underline">Setup page</Link>.</>}</span>
              </div>
            )}
            {mode === 'expert' && workflow.inherited.length > 0 && workflow.lastGoal && (
              <p className="mt-1 text-[11px] text-ink-faint">from the last goal in this folder: {workflow.lastGoal.title}</p>
            )}
            {mode === 'expert' && (
              <div className="mt-3 flex items-center gap-2.5 flex-wrap">
                <span className="text-xs font-semibold text-ink-soft">Engineering discipline — TDD<HelpLink to="your-first-goal#engineering-discipline-tdd" className="ml-1.5" /></span>
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
                <span className="text-[11px] text-ink-faint">docs, infra, research, image and video tasks never get a TDD mandate; a task can also switch it off in the Brief.</span>
              </div>
            )}
            {mode === 'expert' && (
              <label className="mt-3 flex items-start gap-2 text-xs text-ink cursor-pointer" title="Ponytail, the lazy senior dev: before writing, a worker checks whether the code needs to exist, whether the repository, the standard library or an installed dependency already has it, and only then writes the smallest complete change. The planner plans lean; ponytail-review reviews each task and the whole goal. TDD still decides how tests are written. Switchable later on the goal page.">
                <input type="checkbox" className="mt-0.5 shrink-0" checked={ponytail === 'on'} onChange={(e) => { changed.current.add('ponytail'); changeWorkflow({ type: 'edit', field: 'ponytail', value: { ponytail: e.target.checked ? 'on' : 'off' } }); }} />
                <span>
                  <span className="font-semibold">Ponytail — the smallest change that fully solves the task</span><HelpLink to="your-first-goal#ponytail-less-code" className="ml-1.5" />
                  <span className="block text-[11px] text-ink-faint">Workers reuse what exists before writing new code; ponytail-review reviews. Needs the Ponytail skills (Setup page).</span>
                </span>
              </label>
            )}
          </Card>

          <Card id={SECTIONS.goal.id} className={SEC} title={withHelp('goal', '1 · What do you want done?', 'your-first-goal#what-do-you-want-done')}>
            <div className="mb-2 flex items-center gap-2 flex-wrap text-xs">
              {issue ? (
                // the issue's address is a link, in the links' blue, wrapping on a phone rather than losing its number; its × keeps
                // a phone's 32px tap height, as the Follows chip's
                <span className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-panel pl-2 pr-1 py-0.5 font-semibold text-ink-soft ring-1 ring-inset ring-line-strong" title={issue.read.issue.title}>
                  <Github size={12} className="shrink-0" />
                  <a href={issue.read.issue.url} target="_blank" rel="noreferrer" className="mono min-w-0 break-all text-work-ink hover:underline">
                    {issue.read.issue.repo}#{issue.read.issue.number}
                  </a>
                  <span className="shrink-0 font-normal text-ink-faint">· {issue.read.issue.state}</span>
                  <button type="button" className="rounded p-0.5 hover:bg-sunken hover:text-ink shrink-0" aria-label="Unlink issue" title="This goal is not made from the issue after all: its thread leaves the attachments; your text stays" onClick={unlinkIssue}>
                    <X size={12} />
                  </button>
                </span>
              ) : (
                <Button size="sm" variant="ghost" type="button" onClick={() => setIssueOpen(!issueOpen)} title="Make this goal from a GitHub issue: its title and description fill the form, its thread is attached for every session, and the pull request closes it when it merges">
                  <Github size={12} /> From a GitHub issue<HelpLink to="your-first-goal#from-a-github-issue" className="ml-1.5" />
                </Button>
              )}
              {issue && keptOwnText({ prompt, title, attachments, issue }) && <span className="text-ink-faint">your description is kept; the issue's thread is attached</span>}
              {issueOpen && !issue && (
                <form
                  className="basis-full flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void readIssue(issueRef);
                  }}
                >
                  <Input className="text-xs" placeholder="https://github.com/owner/name/issues/12, owner/name#12, or #12 in the chosen repository" value={issueRef} onChange={(e) => setIssueRef(e.target.value)} />
                  <Button size="sm" type="submit" className="shrink-0 whitespace-nowrap" disabled={!issueRef.trim() || issueBusy}>
                    {issueBusy ? 'Reading…' : 'Read issue'}
                  </Button>
                </form>
              )}
              {issueErr && (
                <p className="basis-full text-[11px] text-bad-ink">
                  {issueErr}
                  {/not logged in|not installed/i.test(issueErr) && (
                    <>
                      {' '}
                      <Link to="/setup" className="underline">Open Setup</Link>
                    </>
                  )}
                </p>
              )}
            </div>
            <Textarea rows={6} placeholder="Describe the goal as you would to a senior engineer. The system clarifies, proposes Must / Stretch acceptance checks and a task plan for you to approve." value={prompt} onChange={(e) => setPrompt(e.target.value)} />
            <AttachmentInput className="mt-2" items={attachments} onChange={setAttachments} />
            <div className="mt-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-ink-soft">
                  Reference (optional)<HelpLink to="your-first-goal#reference" className="ml-1.5" />
                </span>
                <Button size="sm" variant="ghost" disabled={references.length >= 5} onClick={() => setReferences((r) => [...r, { target: '', lookAt: '' }])} title="A site, an app or a package whose feature this goal should learn from; REA studies it before Clarify">
                  + add a reference
                </Button>
              </div>
              {references.map((r, i) => (
                <div key={i} className="grid gap-1.5 sm:grid-cols-[1fr_1fr_auto]">
                  <Input placeholder="https://app.example.com, or /Applications/Notes.app" value={r.target} onChange={(e) => setReferences((rs) => rs.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))} />
                  <Input placeholder="which feature to look at, e.g. how search ranks results" value={r.lookAt} onChange={(e) => setReferences((rs) => rs.map((x, j) => (j === i ? { ...x, lookAt: e.target.value } : x)))} />
                  <Button size="sm" variant="ghost" onClick={() => setReferences((rs) => rs.filter((_, j) => j !== i))}>
                    remove
                  </Button>
                </div>
              ))}
              {references.length > 0 && auto && <p className="text-[11px] text-work-ink">Skip Clarify is on: the references are dropped (REA studies them before Clarify).</p>}
              {references.length > 0 && (
                <p className="text-[11px] text-ink-faint">
                  Before Clarify, REA studies each reference and writes a report with its evidence; every session reads it, and it is committed under docs/reference. Only software you are allowed to examine: the goal builds its own version, never a copy. Needs the REA server (Extensions → MCP servers); native apps and binaries also need Hopper, Ghidra or IDA on this computer (Setup page).
                </p>
              )}
            </div>
            <div className="mt-3">
              <label className="block mb-1 text-xs font-semibold text-ink-soft">Title (optional — defaults to the first line)</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
          </Card>

          <Card id={SECTIONS.repo.id} className={SEC} title={withHelp('repo', '2 · Repository', 'your-first-goal#repository')}>
            <RepoCard key={repoKey} path={repoPath} info={repoInfo} onPath={setRepoPath} onValidation={beginRepoValidation} />
            {repoInfo?.ok && learned > 0 && (
              <div className="mt-2 text-xs text-ink-faint">
                Foundry knows {learned} thing{learned === 1 ? '' : 's'} about this folder from earlier goals; the plan is written with them.{' '}
                <Link to={`/learnings?repo=${encodeURIComponent(repoPath.trim())}`} className="font-semibold text-work-ink hover:underline">
                  See the Learnings
                </Link>
              </div>
            )}
            {repoInfo?.ok && (followCandidates.length > 0 || follow) && <FollowsPicker follow={follow} candidates={followCandidates} onPick={(id) => void chooseFollow(id, false)} onChange={setFollow} />}
            {repoInfo?.ok && <CompanionFolders value={companions} onChange={setCompanions} main={repoPath.trim()} />}
          </Card>

          <Card id={SECTIONS.budget.id} className={SEC} title={withHelp('budget', '3 · Budget', 'your-first-goal#budget')}>
            <BudgetPicker costAvailable={reportsDollars(provider)} value={budget} onChange={setBudget} />
          </Card>

          <Card id={SECTIONS.delivery.id} className={SEC} title={withHelp('delivery', '4 · Delivery — what may the engine do with the result?', 'your-first-goal#delivery')}>
            {repoInfo?.ok && delivery.mode !== 'local' && (
              <div className="text-xs text-ink-faint mb-3">
                Prefilled from the repository: remote <span className="mono text-ink">{delivery.remote ?? 'origin'}</span>
                {repoInfo.remotes.find((r) => r.name === (delivery.remote ?? 'origin'))?.url ? <span className="mono text-ink-soft"> → {repoInfo.remotes.find((r) => r.name === (delivery.remote ?? 'origin'))!.url}</span> : ' (none yet)'} · base <span className="mono text-ink">{delivery.baseBranch ?? repoInfo.branch}</span>
              </div>
            )}
            <DeliveryPolicyForm value={delivery} onChange={onDelivery} repo={repoInfo} />
          </Card>

          <div>
            <button className="text-xs font-semibold text-ink-soft hover:text-ink underline decoration-dotted" onClick={() => setAdvanced(!advanced)}>
              {advanced ? 'Hide advanced' : 'Advanced: skip Clarify'}
            </button>
            {advanced && (
              <Card id={SECTIONS.advanced.id} className={cn('mt-2', SEC)} title={<SectionTitle section="advanced">Skip Clarify (advanced)</SectionTitle>}>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="shrink-0" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Run as one task with these command checks, no Brief
                </label>
                {auto && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                    <div>
                      <label className="block mb-1 text-xs font-semibold text-ink-soft">Must checks (one command per line)</label>
                      <Textarea rows={3} className="mono" placeholder={'bun test\nbun run typecheck'} value={checks} onChange={(e) => setChecks(e.target.value)} />
                    </div>
                    <div>
                      <label className="block mb-1 text-xs font-semibold text-ink-soft">Stretch checks</label>
                      <Textarea rows={3} className="mono" placeholder="bun run lint" value={stretch} onChange={(e) => setStretch(e.target.value)} />
                    </div>
                  </div>
                )}
                {auto && budget.preset === 'auto' && <p className="text-xs text-ink-faint mt-2">With Auto budget and no Brief, the engine applies the minimum proposal ({reportsDollars(provider) ? '$3 / 30 min' : '30 min'}) and pauses to ask if it is exceeded.</p>}
              </Card>
            )}
          </div>

          {/* what went wrong in red words on a red edge; a panel is never filled with a signal colour */}
          {err && <div className="rounded-md border border-bad/50 bg-panel px-3 py-2 text-sm text-bad-ink">{err}</div>}
          {/* on a phone the actions stay at the bottom of the screen, on the page's own grey: what is still missing on a line
              of its own above the buttons, so neither squeezes the other; beside them from sm */}
          <div className="fixed bottom-0 left-0 right-0 sm:static border-t sm:border-0 border-line bg-page sm:bg-transparent p-3 sm:p-0 flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
            {notReady && (
              <span role="status" className={cn('w-full sm:w-auto text-xs font-semibold', notReadyTone)}>
                {notReady}
              </span>
            )}
            <Button variant={schedule ? 'default' : 'ghost'} className="shrink-0 whitespace-nowrap" disabled={busy || !scheduleReady} onClick={() => setScheduleOpen(true)} title="Save this form as a schedule: it fires every day, week or month and makes a goal from it each time (ADR-0054)">
              {schedule ? 'Save schedule' : 'Schedule…'}
            </Button>
            <Button variant="primary" className="shrink-0 whitespace-nowrap" disabled={busy || !ready} onClick={submit}>
              {busy ? 'Creating…' : auto ? 'Create & run' : 'Create & clarify'}
            </Button>
            <ScheduleDialog open={scheduleOpen} editing={!!schedule} initial={{ name: schedule?.name ?? scheduleNameFrom(title, prompt), cadence: schedule?.cadence ?? defaultCadence(), autoApprove: schedule?.autoApprove ?? true }} busy={scheduleBusy} error={scheduleErr} onClose={() => setScheduleOpen(false)} onSave={saveSchedule} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Follows (optional): which finished goal of this repository the new goal continues, where it starts, and what it takes along. */
function FollowsPicker({ follow, candidates, onPick, onChange }: { follow: FollowChoice | null; candidates: GoalRow[]; onPick: (id: string) => void; onChange: (f: FollowChoice) => void }) {
  const d = follow?.draft;
  const options = d && !candidates.some((c) => c.id === d.previous.id) ? [{ id: d.previous.id, title: d.previous.title, state: d.previous.state }, ...candidates] : candidates;
  return (
    <div className="mt-4 border-t border-line pt-3 space-y-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-ink-soft">
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
        <div className="rounded-lg border border-line bg-sunken p-3 space-y-2 text-xs text-ink">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="font-semibold text-ink-soft">Start from</span>
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
          <p className="text-ink-soft leading-snug">
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
              <input type="checkbox" className="mt-0.5 shrink-0" checked={follow.attachments} onChange={(e) => onChange({ ...follow, attachments: e.target.checked })} />
              <span>
                Bring its attachments <span className="text-ink-faint">({d.attachments.map((a) => a.name).join(', ')})</span>
              </span>
            </label>
          )}
          {d.style && (
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-0.5 shrink-0" checked={follow.style} onChange={(e) => onChange({ ...follow, style: e.target.checked })} />
              <span className="flex items-center gap-1.5 flex-wrap">
                Keep its style direction <span className="font-semibold text-ink">{d.style.name}</span>
                {d.style.palette.slice(0, 6).map((c) => (
                  <span key={c} className="inline-block h-3 w-3 rounded-sm border border-line-strong" style={{ background: c }} title={c} />
                ))}
                <span className="text-ink-faint">and its reference sample</span>
              </span>
            </label>
          )}
        </div>
      )}
    </div>
  );
}
