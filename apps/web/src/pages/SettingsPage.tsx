import type { AgentProvider } from '../api.ts';
import { ProviderSelector } from '../components/ProviderSelector.tsx';
import type { Settings, SettingsView } from '@foundry/core/browser';
import { AGENT_PROVIDERS, PROVIDER_LABEL } from '@foundry/core/browser';
import { Check, CheckCircle2, CircleDashed, LoaderCircle, RotateCcw, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, type ModelRecordView, type UpdateStatusView } from '../api.ts';
import { LiveLog } from './LiveLog.tsx';
import { ModelPresetsSection } from './settings/ModelPresets.tsx';
import { CodexModelPresetsSection } from './settings/CodexModelPresets.tsx';
import { AgyModelsSection } from './settings/AgyModels.tsx';
import { SectionTitle } from './settings/PresetParts.tsx';
import { SECTION_STYLE, SettingsTitle } from './settings/sections.tsx';
import { SectionChipNav, SectionSideNav, type NavSection } from '../components/SectionNav.tsx';
import { DesignPacks } from '../components/DesignPacks.tsx';
import { PROVIDER_STYLE } from '../components/ProviderMark.tsx';
import { UpdateDialog } from '../components/UpdateDialog.tsx';
import { AccessCard } from './settings/AccessCard.tsx';
import { Button, Card, CopyButton, Empty, Field, Input, Loading, PageHeader, Select, cn } from '../ui.tsx';
import { HelpLink } from './HelpPage.tsx';
import { AppearanceCard } from './settings/AppearanceCard.tsx';
import { INTERVIEW_DEPTHS } from '../interview-depth.ts';

type Section = keyof Settings;
type Leaf = `${Section}.${string}`;

/** fallback list until /api/models answers: aliases Claude Code resolves to the latest model of each family */
const SEED_MODELS: { id: string; label: string }[] = [
  { id: 'fable', label: 'Fable — most capable (Mythos-class), the release your Claude Code knows' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1 — pinned id, works on any recent Claude Code' },
  { id: 'opus', label: 'Opus — strong, default' },
  { id: 'sonnet', label: 'Sonnet — fast, good for routine tasks' },
  { id: 'haiku', label: 'Haiku — cheapest' },
];
const get = (o: any, path: string) => path.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);

/**
 * left-hand index (a row of chips on a phone or a tablet); the ids are the Card ids further down, and each section's
 * colour and icon are in settings/sections.tsx
 */
const SECTIONS: { id: string; label: string }[] = [
  { id: 'goals', label: 'New goal defaults' },
  { id: 'models', label: 'Models & limits' },
  { id: 'skills', label: 'Skills' },
  { id: 'git', label: 'Git & delivery' },
  { id: 'tools', label: 'Tools & keys' },
  { id: 'preview', label: 'Preview & self-check' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'access', label: 'Access' },
  { id: 'safety', label: 'Safety' },
  { id: 'beta', label: 'Beta' },
  { id: 'engine', label: 'Engine (install)' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'about', label: 'About & updates' },
];
/** the menu's entries, each with its section's colour */
const NAV: NavSection[] = SECTIONS.map((s) => ({ ...s, dot: SECTION_STYLE[s.id]?.dot }));

/**
 * a small fact beside a setting (where its value comes from, a restart it needs) as a plate. Its outline is an
 * inset-ring: with ring-inset the theme's colour named inset would win over the ring's own colour.
 */
const TAG = 'inline-flex items-center whitespace-nowrap rounded-sm px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.08em] inset-ring';
/** a setting that applies only after a restart, told apart from the rest in orange (a kind of setting, not a state) */
const RESTART_TAG = 'bg-code-4/12 text-code-4-ink inset-ring-code-4/45';

/** where a setting's value comes from, told apart by colour as before themes: saved green, the environment blue, the default hollow */
function SourceBadge({ view, path }: { view: SettingsView; path: string }) {
  const m = view.meta[path];
  if (!m) return null;
  const label = m.source === 'file' ? 'saved' : m.source === 'env' ? 'env' : 'default';
  const title = m.source === 'env' ? `from ${m.env}` : m.env ? `set ${m.env} to seed this value (default ${JSON.stringify(m.default)})` : `default ${JSON.stringify(m.default)}`;
  return (
    <span className={cn(TAG, m.source === 'file' ? 'bg-code-2/12 text-code-2-ink inset-ring-code-2/45' : m.source === 'env' ? 'bg-code-1/12 text-code-1-ink inset-ring-code-1/45' : 'text-ink-faint inset-ring-line')} title={title}>
      {label}
    </span>
  );
}

type Tone = 'ok' | 'work' | 'bad' | 'none';
const TONE_INK: Record<Tone, string> = { ok: 'text-ok-ink', work: 'text-work-ink', bad: 'text-bad-ink', none: 'text-ink-soft' };
/** a line that reports how something went: ✘ failed (red), still going… (blue), ✓ done (green), anything else plain */
const toneOf = (line: string): Tone => (line.includes('✘') ? 'bad' : line.endsWith('…') ? 'work' : line.includes('✓') || line.startsWith('→') ? 'ok' : 'none');

/** how an install stands, in its signal colour: in place (green), being read (blue), broken (red), not there yet (hollow) */
function InstallState({ tone, children }: { tone: Tone; children: ReactNode }) {
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'work' ? LoaderCircle : tone === 'bad' ? XCircle : CircleDashed;
  return (
    <span className={cn('inline-flex items-center gap-1.5 font-semibold', TONE_INK[tone])}>
      <Icon size={13} strokeWidth={2.25} aria-hidden="true" className={cn('shrink-0', tone === 'work' && 'animate-spin')} />
      {children}
    </span>
  );
}


export function SettingsPage() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [known, setKnown] = useState<ModelRecordView[] | null>(null);
  const [probe, setProbe] = useState<Record<string, string>>({});
  const [notifMsg, setNotifMsg] = useState<string | null>(null);
  const [upd, setUpd] = useState<UpdateStatusView | null>(null);
  const [updBusy, setUpdBusy] = useState(false);
  const [updOpen, setUpdOpen] = useState(false);
  const { hash, search } = useLocation();
  const navigate = useNavigate();
  const requestedProvider = new URLSearchParams(search).get('provider');
  const modelProvider = AGENT_PROVIDERS.find((p) => p === requestedProvider) ?? view?.values.engine.provider ?? 'claude';
  const setModelProvider = (provider: AgentProvider) => {
    const params = new URLSearchParams(search);
    params.set('provider', provider);
    navigate({ search: params.toString(), hash }, { replace: true });
  };
  // Section links land once content is ready; a backend query change must not reset the scroll.
  const loaded = !!draft;
  useEffect(() => {
    if (!loaded || !hash) return;
    let id = hash.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {}
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, [loaded, hash]);
  const loadUpdate = () => api.updateStatus().then(setUpd).catch(() => {});
  const checkUpdate = async () => {
    setUpdBusy(true);
    try {
      await api.updateCheck();
      await loadUpdate();
    } finally {
      setUpdBusy(false);
    }
  };
  const load = () =>
    api
      .settings()
      .then((v) => {
        setView(v);
        setDraft(structuredClone(v.values));
      })
      .catch((e) => setErr(e.message));
  const loadModels = () => api.models().then((m) => setKnown(m.models)).catch(() => setKnown([]));
  useEffect(() => {
    load();
    loadModels();
    loadUpdate();
  }, []);
  const testModel = async (name: string) => {
    setProbe((p) => ({ ...p, [name]: 'testing…' }));
    try {
      const r = await api.probeModel(name);
      setProbe((p) => ({ ...p, [name]: r.ok ? `→ ${r.resolvedId ?? 'ok'} · $${r.costUsd.toFixed(2)}` : `✘ ${r.error ?? 'failed'}` }));
      loadModels();
    } catch (e: any) {
      setProbe((p) => ({ ...p, [name]: `✘ ${e.message}` }));
    }
  };

  const detectChatId = async (token: string | null) => {
    setNotifMsg('detecting…');
    try {
      const r = await api.telegramChatId(token);
      set('notifications.telegramChatId', r.chatId);
      setNotifMsg(`✓ found chat ${r.chatId} (${r.who}) — remember to Save`);
    } catch (e: any) {
      setNotifMsg(`✘ ${e.message}`);
    }
  };
  const sendTestNotification = async (o: { telegramBotToken: string | null; telegramChatId: string | null; discordWebhookUrl: string | null; discordBotToken: string | null }) => {
    setNotifMsg('sending…');
    try {
      const { results } = await api.notifyTest(o);
      setNotifMsg(results.length ? results.map((r) => `${r.channel}: ${r.ok ? '✓ sent' : `✘ ${r.error}`}`).join(' · ') : 'no channel configured — fill in a token + chat id or a webhook URL first');
    } catch (e: any) {
      setNotifMsg(`✘ ${e.message}`);
    }
  };

  const changed = useMemo(() => {
    if (!view || !draft) return [] as Leaf[];
    return (Object.keys(view.meta) as Leaf[]).filter((p) => JSON.stringify(get(draft, p)) !== JSON.stringify(get(view.values, p)));
  }, [view, draft]);

  if (err && !view) return <Empty>{err}</Empty>;
  if (!view || !draft) return <Loading size="page" label="Loading settings…" />;

  const set = (path: Leaf, value: unknown) => {
    const next = structuredClone(draft);
    const [s, k] = path.split('.') as [Section, string];
    (next[s] as any)[k] = value;
    setDraft(next);
  };
  const save = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const patch: any = {};
      for (const p of changed) {
        const [s, k] = p.split('.') as [Section, string];
        (patch[s] ??= {})[k] = get(draft, p);
      }
      const v = await api.updateSettings(patch);
      setView(v);
      setDraft(structuredClone(v.values));
      setMsg(`Saved ${changed.length} setting${changed.length === 1 ? '' : 's'}${v.restartNeeded.length ? ` — restart the engine to apply ${v.restartNeeded.join(', ')}` : ' — applied immediately'}.${changed.some((p) => p.startsWith('models.codex')) ? ' Codex model changes apply to new goals; existing goals keep their settings.' : ''}`);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const reset = async (path: Leaf) => {
    setBusy(true);
    setErr(null);
    try {
      const v = await api.resetSetting(path);
      setView(v);
      setDraft(structuredClone(v.values));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  // a saved credential never comes back from the server: the field starts empty, shows a masked hint, and only what you
  // type is saved; ↺ forgets the saved one
  const secret = (path: Leaf, placeholder: string) => {
    const saved = view.secrets[path];
    // a value from the environment is not "saved": say where it comes from, like the badge beside it
    const from = view.meta[path]?.source === 'env' ? `from ${view.meta[path]?.env}` : 'saved';
    return <Input type="password" autoComplete="off" value={(get(draft, path) as string | null) ?? ''} placeholder={saved?.set ? `${from}: ${saved.hint} — type to replace` : placeholder} onChange={(e) => set(path, e.target.value === '' ? null : e.target.value)} />;
  };
  const aside = (path: Leaf) => (
    <>
      <SourceBadge view={view} path={path} />
      {view.meta[path]?.restart && (
        <span className={cn(TAG, RESTART_TAG)} title="takes effect after the engine restarts">
          restart
        </span>
      )}
      {view.meta[path]?.source === 'file' && (
        <button type="button" className="text-ink-faint hover:text-ink" title="forget the saved value (back to env / default)" disabled={busy} onClick={() => reset(path)}>
          <RotateCcw size={11} />
        </button>
      )}
    </>
  );
  const num = (path: Leaf, props: { min?: number; max?: number; step?: number } = {}) => <Input type="number" {...props} value={String(get(draft, path) ?? '')} onChange={(e) => set(path, e.target.value === '' ? get(view.values, path) : Number(e.target.value))} />;
  const text = (path: Leaf, placeholder?: string, nullable = false) => <Input value={(get(draft, path) as string | null) ?? ''} placeholder={placeholder} onChange={(e) => set(path, nullable && e.target.value === '' ? null : e.target.value)} />;
  const bool = (path: Leaf, label: string, help: string) => (
    <label className="flex items-start gap-2 cursor-pointer">
      <input type="checkbox" className="mt-0.5" checked={!!get(draft, path)} onChange={(e) => set(path, e.target.checked)} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-xs font-semibold text-ink">{label}</span>
          <span className="ml-auto flex items-center gap-1.5">{aside(path)}</span>
        </span>
        <span className="block mt-0.5 text-[11px] leading-snug text-ink-faint">{help}</span>
      </span>
    </label>
  );
  const model = (path: Leaf) => {
    const v = get(draft, path) as string;
    const options: { id: string; label: string }[] = known?.length
      ? known.map((m) => ({ id: m.name, label: `${m.label ?? m.name}${m.note ? ` — ${m.note}` : ''}${m.resolvedId ? ` (→ ${m.resolvedId})` : ''}${m.lastFailAt && (!m.lastOkAt || m.lastFailAt > m.lastOkAt) ? ' ⚠ last failed' : ''}` }))
      : SEED_MODELS;
    const custom = !options.some((m) => m.id === v);
    const rec = known?.find((m) => m.name === v);
    const warn = rec?.lastFailAt && (!rec.lastOkAt || rec.lastFailAt > rec.lastOkAt) ? `last failed: ${rec.lastError ?? 'model unavailable'}` : rec && !rec.seed && !rec.resolvedId && !rec.lastOkAt ? 'never seen resolving on this machine — Test it' : null;
    return (
      <div className="space-y-1">
        <div className="flex gap-1">
          <Select value={custom ? 'custom' : v} onChange={(e) => set(path, e.target.value === 'custom' ? '' : e.target.value)}>
            {options.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            <option value="custom">custom alias / full id…</option>
          </Select>
          {custom && <Input className="mono" value={v} placeholder="claude-… or a new alias" onChange={(e) => set(path, e.target.value)} />}
          <Button size="sm" variant="ghost" className="shrink-0" disabled={!v || probe[v] === 'testing…'} onClick={() => testModel(v)} title="One short session with this model: learns what it resolves to (costs one tiny call)">
            Test
          </Button>
        </div>
        {/* a test in its signal colour (testing… blue, resolved green, failed red), a model that last failed in red;
            "never seen resolving" is unknown, so plain */}
        {(probe[v] || warn) && <div className={cn('text-[11px]', probe[v] ? TONE_INK[toneOf(probe[v]!)] : warn!.startsWith('last failed') ? 'text-bad-ink' : 'text-ink-soft')}>{probe[v] ?? warn}</div>}
      </div>
    );
  };
  const list = (path: Leaf, placeholder: string) => <Input className="mono" value={((get(draft, path) as string[] | null) ?? []).join(', ')} placeholder={placeholder} onChange={(e) => set(path, e.target.value.trim() ? e.target.value.split(',').map((s) => s.trim()).filter(Boolean) : null)} />;

  const grid = (children: ReactNode) => <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">{children}</div>;
  const agent = PROVIDER_STYLE[draft.engine.provider];

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 pt-6 md:pt-9 pb-16">
      <PageHeader
        title="Settings"
        summary={
          <>
            Saved to <span className="mono break-all text-ink-soft">{view.file}</span>. Precedence: saved value › environment variable › default. Most settings apply immediately; the ones marked <span className={cn(TAG, 'align-[2px]', RESTART_TAG)}>restart</span> after the engine restarts.
          </>
        }
      />
      <div className="grid lg:grid-cols-[11rem_minmax(0,1fr)] gap-x-8">
        <SectionSideNav items={NAV} label="Settings sections" />
        {/* a section jumped to stops clear of the sticky bar above it, taller where the row of sections rides in it (the
            parent's rule outranks each card's own scroll margin) */}
        <div className="min-w-0 space-y-4 [&>section]:scroll-mt-28 lg:[&>section]:scroll-mt-16">
          {/* the save bar follows you down the page: settings are long and the change you just made is at the bottom. On a
              phone or a tablet the sections ride in it too, as the side list's row of chips */}
          <div className="sticky top-0 z-20 bg-page border-b border-line">
            <SectionChipNav items={NAV} label="Settings sections" inBar />
            <div className="py-2.5 flex items-center gap-2">
              <span className="text-[13px] text-ink-faint mr-auto">{changed.length ? <><b className="mono font-bold text-ink">{changed.length}</b> unsaved</> : 'no changes'}</span>
              <Button size="sm" variant="ghost" disabled={!changed.length || busy} onClick={() => setDraft(structuredClone(view.values))}>
                Discard
              </Button>
              <Button size="sm" variant="primary" disabled={!changed.length || busy} onClick={save}>
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
      {view.restartNeeded.length > 0 && (
        // the engine waits for you to restart it: on a plain panel, its sign square yellow with a thin yellow edge
        <div className="flex items-start gap-2.5 rounded-lg bg-panel py-2.5 pl-4 pr-3 text-xs text-ink inset-ring inset-ring-line shadow-[inset_4px_0_0_var(--color-you)]">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-you text-on-you" aria-hidden="true">
            <RotateCcw size={13} strokeWidth={2.5} />
          </span>
          <span className="min-w-0 break-words pt-1">
            <b className="font-bold">Restart the engine to apply:</b> <span className="mono">{view.restartNeeded.join(', ')}</span> — stop it (Ctrl-C) and run <span className="mono">bun run serve</span> <CopyButton text="bun run serve" />
          </span>
        </div>
      )}
      {msg && (
        <div className="flex items-start gap-2 rounded-md border border-line bg-sunken px-3 py-2 text-xs text-ink">
          <Check size={13} className="mt-px shrink-0 text-ok-ink" aria-hidden="true" />
          {msg}
        </div>
      )}
      {/* a failure in red words with its mark, on a plain box: no red panel */}
      {err && (
        <div className="flex items-start gap-2 rounded-md border border-line bg-sunken px-3 py-2 text-xs text-bad-ink">
          <XCircle size={13} className="mt-px shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">{err}</span>
        </div>
      )}

      <Card id="goals" title={<SettingsTitle id="goals">New goal defaults<HelpLink to="settings#new-goal-defaults" className="ml-1.5" /></SettingsTitle>} className="scroll-mt-16">
        <div className="space-y-4">
          {grid(
            <>
              <Field label="Default goal view" aside={aside('workflow.defaultMode')} help="What a new goal opens in. Simple: one plain-language Brief and a progress view; Expert: every control. Switchable per goal.">
                <Select value={draft.workflow.defaultMode} onChange={(e) => set('workflow.defaultMode', e.target.value)}>
                  <option value="expert">expert</option>
                  <option value="simple">simple</option>
                </Select>
              </Field>
              <Field label="Pace for new goals" aside={aside('workflow.defaultPace')} help="thorough: the engine runs its own task and goal reviews and can spawn fix tasks · fast: it skips them, so a goal ends as soon as your approved checks pass. Image and video goals start fast whatever this says. Switchable per goal.">
                <Select value={draft.workflow.defaultPace} onChange={(e) => set('workflow.defaultPace', e.target.value)}>
                  <option value="thorough">thorough — engine reviews the work</option>
                  <option value="fast">fast — approved checks only</option>
                </Select>
              </Field>
              <Field label="Interview depth" aside={aside('workflow.interviewDepth')} help="How deep the Clarifier questions you before writing the Brief. It sets how thoroughly it probes, not a number of rounds: from 1, only what a wrong guess would waste, to 5, every detail until nothing is left to decide. Switchable per goal when creating it.">
                <Select value={String(draft.workflow.interviewDepth ?? { never: 0, auto: 3, always: 4 }[draft.workflow.interview])} onChange={(e) => set('workflow.interviewDepth', Number(e.target.value))}>
                  {INTERVIEW_DEPTHS.map((d) => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                  ))}
                </Select>
              </Field>
              {bool('workflow.milestonePause', 'Have a look: pause new goals at milestones', 'On: a goal pauses for the final walkthrough once every task is done, and when a milestone without a script lands, so you can look before it goes on. Off: it goes on, and what each milestone shows is sent to your notification channels. Each goal has its own switch on its Brief and its page.')}
              <Field label="Effort for new goals" aside={aside('workflow.effort')} help="An explicit level overrides every role's effort. Default uses each Codex role's preset effort, the Antigravity effort under Models & limits, or the Claude CLI default. Switchable per goal when creating it.">
                <Select value={(draft.workflow.effort as string | null) ?? ''} onChange={(e) => set('workflow.effort', e.target.value || null)}>
                  <option value="">Role preset / CLI default</option>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="xhigh">xhigh</option>
                  <option value="max">max</option>
                </Select>
              </Field>
              <Field label="TDD for new Expert goals" aside={aside('workflow.tdd')} help="required: workers must invoke tdd and the reviewer is told when they skipped it · preferred: suggested only · off: never mentioned. Simple goals start with preferred; each goal and task can override.">
                <Select value={draft.workflow.tdd} onChange={(e) => set('workflow.tdd', e.target.value)}>
                  <option value="required">required</option>
                  <option value="preferred">preferred</option>
                  <option value="off">off</option>
                </Select>
              </Field>
              <Field label="Workflow suite for new goals" aside={aside('workflow.profile')} help="Whose skills the roles follow; each goal fixes its own on the New goal form. mattpocock: Matt Pocock's suite (tests first for features, diagnose first for bugs, code review at the end), and Claude sessions report which skills they used. pstack: pstack's suite, with Matt Pocock's skills where pstack has none. plain: sessions only hear which skills are installed.">
                <Select value={draft.workflow.profile} onChange={(e) => set('workflow.profile', e.target.value)}>
                  <option value="mattpocock">mattpocock (Matt Pocock's suite)</option>
                  <option value="pstack">pstack</option>
                  <option value="plain">plain (hint only)</option>
                </Select>
              </Field>
              <Field label="Ponytail for new goals" aside={aside('workflow.ponytail')} help="on: workers write the smallest change that fully solves the task and reuse what the repository already has, the planner plans lean, and ponytail-review reviews tasks and the goal (TDD still decides how tests are written) · off: the Ponytail skills are never mentioned. Each goal has its own switch.">
                <Select value={draft.workflow.ponytail} onChange={(e) => set('workflow.ponytail', e.target.value)}>
                  <option value="on">on</option>
                  <option value="off">off</option>
                </Select>
              </Field>
              {bool('workflow.audit', 'Audit at the end of new goals', 'Once every task is done, ponytail-audit maps the finished branch and ranks what to fix; must-fix findings in the code the goal touched become fix tasks before the final review, the rest is listed for a follow-up. Chosen per goal at Brief approval.')}
              {bool('workflow.qa', 'Browser QA at the end of new goals', 'New goals with a web app: once every task is done, one session opens the finished app in Chromium and tries each acceptance check with Playwright; a must check that fails becomes a fix task before the final review. Chosen per goal at Brief approval; needs Chromium for Playwright.')}
              {bool('workflow.learnings', 'Learn from finished goals', "When a goal ends, a short session on the housekeeping model adds what it taught about the project to that folder's Learnings, which later goals there are given. Off: nothing is learned automatically; the Learnings you keep are still used.")}
              {bool('workflow.briefSecondOpinion', 'Second opinion on every Brief', "Once a goal's Brief is ready for your approval, a reviewer that did not write it reads it against the repository and proposes what to change, on the goal reviewer's model — a checklist on the Brief page you apply or not. Off: the Brief page still has the button.")}
              {bool('workflow.learningsSkill', 'Share Learnings with your own sessions', "Writes each folder's Learnings into the repository as a project skill (foundry-learnings, kept out of git) that your own coding-agent sessions there read; rewritten whenever the Learnings change. Off: the file is removed.")}
              <Field label="Goal-level fix cycles" aside={aside('reviews.maxFixCycles')} help="How many review → fix-task rounds before the goal escalates to you (thorough pace only).">
                {num('reviews.maxFixCycles', { min: 0, max: 5 })}
              </Field>
              <Field label="Small goal (diff lines)" aside={aside('reviews.smallGoalLines')} help="A goal whose whole diff is this many lines or fewer is reviewed by the Task reviewer model, without review skills or sub-agents. 0 = never.">
                {num('reviews.smallGoalLines', { min: 0, max: 5000 })}
              </Field>
            </>,
          )}
          {bool('reviews.alwaysReviewTasks', 'Review every task', 'Run the lightweight task reviewer even when the Brief defined no reviewer check for the task (thorough pace only).')}
          <div className="border-t border-line pt-4">
            <div className="text-sm font-bold text-ink mb-3">Delivery — what happens to the branch when a goal finishes</div>
            {grid(
              <>
                <Field label="Mode for new goals" aside={aside('delivery.defaultMode')}>
                  <Select value={draft.delivery.defaultMode} onChange={(e) => set('delivery.defaultMode', e.target.value)}>
                    <option value="local">local only</option>
                    <option value="push">push branch</option>
                    <option value="pr">open a PR</option>
                    <option value="pr-automerge">PR + auto-merge</option>
                  </Select>
                </Field>
                <Field label="Granularity" aside={aside('delivery.defaultUnit')}>
                  <Select value={draft.delivery.defaultUnit} onChange={(e) => set('delivery.defaultUnit', e.target.value)}>
                    <option value="task">one PR per task (stacked)</option>
                    <option value="goal">one PR per goal</option>
                  </Select>
                </Field>
                <Field label="Remote" aside={aside('delivery.defaultRemote')}>
                  {text('delivery.defaultRemote', 'origin')}
                </Field>
              </>,
            )}
          </div>
        </div>
      </Card>

      <Card id="models" title={<SettingsTitle id="models">Models & limits<HelpLink to="settings#models--limits" className="ml-1.5" /></SettingsTitle>} className="scroll-mt-16">
        <ProviderSelector className="mb-5" value={modelProvider} onChange={setModelProvider} controls={{ claude: 'models-claude', codex: 'models-codex', agy: 'models-agy' }} />
        <div id="models-codex" role="region" aria-label="Codex models" hidden={modelProvider !== 'codex'}>
          <CodexModelPresetsSection draft={draft} setFields={(patch) => setDraft((previous) => previous ? { ...previous, models: { ...previous.models, ...patch } } : previous)} />
        </div>
        <div id="models-agy" role="region" aria-label="Antigravity models" hidden={modelProvider !== 'agy'}>
          <AgyModelsSection model={String(get(draft, 'models.agyModel') ?? 'agy-default')} effort={String(get(draft, 'models.agyEffort') ?? 'high')} onModel={(value) => set('models.agyModel', value)} onEffort={(value) => set('models.agyEffort', value)} />
          <p className="mt-2 text-[11px] text-ink-faint">Antigravity reports tokens, not dollars: goals on it keep time, attempt and concurrency limits, never a USD budget. No presets, no fallback order: an unknown model fails the session outright.</p>
        </div>
        <div id="models-claude" role="region" aria-label="Claude Code models" hidden={modelProvider !== 'claude'}>
        <ModelPresetsSection draft={draft} set={set as (p: `models.${string}`, v: unknown) => void} known={known} reloadModels={loadModels} />
        <div className="border-t border-line mt-5 pt-4 mb-3">
          <SectionTitle>Other models</SectionTitle>
        </div>
        {grid(
          <>
            <Field label="Housekeeping model" aside={aside('models.cheap')} help="One-turn engine chores: classifying a goal, summarising logs, the rate-limit probe. Cents per goal.">
              {model('models.cheap')}
            </Field>
            <Field label="Fallbacks (in order)" aside={aside('models.fallbacks')} help="When a session's model is unavailable (deprecated alias, retired id, typo) the engine re-runs it with the next of these and remembers the replacement for that goal; only when all fail does it ask you.">
              {list('models.fallbacks', 'opus, sonnet, haiku')}
            </Field>
            <div className="sm:col-span-2">
              {bool('models.escalateLastAttempt', 'Last attempt on the Complex-task model', 'When a task has 2 or more attempts, its last one — and every retry you grant from the Inbox — runs on the Complex-task model of its preset before the task comes back to you. The timeline says when it happens.')}
            </div>
          </>,
        )}
        <p className="text-[11px] text-ink-faint mt-3">The list is what this machine has seen resolve (family aliases follow the latest release through Claude Code; a full model id pins a version). A new family is one custom entry away — after its first session it shows up here with its resolved id. Preset changes reach running goals too, at their next session.</p>
        </div>
        <div className="border-t border-line mt-4 pt-4">
          <div className="text-sm font-bold text-ink mb-3">Limits — what one session may spend before the engine stops it</div>
          {grid(
            <>
              {<Field label="Claude cost cap per session (USD)" aside={aside('sessions.attemptMaxCostUsd')} help="The real guard: a worker session stops at this spend (also bounded by the goal's remaining budget).">
                {num('sessions.attemptMaxCostUsd', { min: 0.5, max: 500, step: 0.5 })}
              </Field>}
              <Field label="Attempt timeout (minutes)" aside={aside('sessions.attemptTimeoutMin')} help="A session killed at this mark keeps what it committed; the attempt then continues or restarts.">
                {num('sessions.attemptTimeoutMin', { min: 5, max: 240 })}
              </Field>
              <Field label="Reference investigation: cost cap" aside={aside('workflow.investigationMaxCostUsd')} help="The session that studies a goal's reference app or site with REA before Clarify stops at this cost and writes up what it found so far.">
                {num('workflow.investigationMaxCostUsd', { min: 0.5, max: 50, step: 0.5 })}
              </Field>
              <Field label="Reference investigation: minutes" aside={aside('workflow.investigationMaxMinutes')} help="Its time cap.">
                {num('workflow.investigationMaxMinutes', { min: 5, max: 120 })}
              </Field>
              <Field label="Continuations per attempt" aside={aside('sessions.maxContinuations')} help="How often one attempt may resume its own session (after a restart, a turn/cost cap, a timeout, or failing checks with progress) before a fresh attempt is started. Resuming keeps the session's context — far cheaper than starting over. 0 = always start fresh.">
                {num('sessions.maxContinuations', { min: 0, max: 5 })}
              </Field>
              <Field label="Turn cap per session" aside={aside('sessions.attemptMaxTurns')} help="Claude: model turns. Codex: tool calls. Antigravity: three tool calls per turn. Keep it generous; wall-clock timeout remains the hard stop.">
                {num('sessions.attemptMaxTurns', { min: 10, max: 2000 })}
              </Field>
              <Field label="Concurrent agent sessions" aside={aside('engine.maxConcurrent')} help="Global cap across all goals (workers, reviewers, clarify) — the throughput knob, and the one that decides how fast the bill grows. Applies immediately.">
                {num('engine.maxConcurrent', { min: 1, max: 16 })}
              </Field>
              <Field label="Account switch on a usage limit" help="With several accounts of a coding agent, new sessions can move to the next one when the current one's usage limit stops a session. It is turned on per coding agent on the Accounts page, which says first what the provider's terms say about it.">
                {/* each switch's state in its colour: on green, off plain */}
                <p className="text-xs text-ink-soft">
                  Claude Code <b className={get(draft, 'accounts.autoSwitchClaude') ? 'text-ok-ink' : 'font-semibold text-ink-faint'}>{get(draft, 'accounts.autoSwitchClaude') ? 'on' : 'off'}</b> · Codex <b className={get(draft, 'accounts.autoSwitchCodex') ? 'text-ok-ink' : 'font-semibold text-ink-faint'}>{get(draft, 'accounts.autoSwitchCodex') ? 'on' : 'off'}</b> — <Link className="underline text-work-ink" to="/accounts">change on Accounts</Link>
                </p>
              </Field>
            </>,
          )}
        </div>
      </Card>

      <Card id="skills" title={<SettingsTitle id="skills">Skills<HelpLink to="settings#skills" className="ml-1.5" /></SettingsTitle>} className="scroll-mt-16">
        <div className="space-y-4">
          <div>
            <ProviderSelector value={modelProvider} onChange={setModelProvider} />
            <p className="mt-1 text-[11px] text-ink-faint">Installation status and actions target the selected agent. Workflow pack choices are shared by both agents.</p>
          </div>
          {grid(
            <>
              {modelProvider === 'claude' && <Field label="Setting sources" aside={aside('workflow.settingSources')} help="`--setting-sources` for sessions, comma-separated (user, project, local); empty = inherit everything. Without `user`, your own skills never load.">
                {list('workflow.settingSources', 'user, project')}
              </Field>}
            </>,
          )}
          {bool('workflow.mcpDynamicTools', 'MCP tools that run or change things', 'Let sessions use the tools of allowed MCP servers that run or change things — for REA: launching the target app, attaching a debugger, touching a connected Android device. Off: static analysis only (binaries, apps, packages, websites, captures).')}
          {bool('workflow.autoskills', 'autoskills per goal', 'After the Brief is approved, run `npx autoskills` in the goal workspace to install skills matching the repository’s stack (needs Node ≥ 22). Uses .claude/skills for Claude and .agents/skills for Codex and Antigravity. The generated CLAUDE.md is restored and the skills are git-excluded.')}
          <p className="text-[11px] text-ink-faint">
            Memory — a Hindsight server that remembers what each folder’s goals did and taught — is set up on the{' '}
            <Link to="/skills?provider=claude#mcp" className="underline hover:text-ink">
              Extensions page, MCP servers tab
            </Link>
            ; each folder’s switch is on the{' '}
            <Link to="/learnings" className="underline hover:text-ink">
              Learnings page
            </Link>
            .
          </p>
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-sm font-bold text-ink">Design skills</span>
              <span className="ml-auto flex items-center gap-1.5">{aside('workflow.designPack')}</span>
            </div>
            <DesignPacks key={`${modelProvider}:design`} provider={modelProvider} compact />
            <p className="text-[11px] text-ink-faint mt-1.5">Choosing a pack saves immediately; only that pack is shown to sessions working on frontend / fullstack tasks.</p>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-sm font-bold text-ink">Image skills</span>
              <span className="ml-auto flex items-center gap-1.5">{aside('workflow.imagePack')}</span>
            </div>
            <DesignPacks key={`${modelProvider}:image`} provider={modelProvider} compact pack="image" />
            <p className="text-[11px] text-ink-faint mt-1.5">Mandated to workers on image tasks (scenario `image`). The pack only generates when a key is set under Tools &amp; keys.</p>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-sm font-bold text-ink">Video skills</span>
              <span className="ml-auto flex items-center gap-1.5">{aside('workflow.videoPack')}</span>
            </div>
            <DesignPacks key={`${modelProvider}:video`} provider={modelProvider} compact pack="video" />
            <p className="text-[11px] text-ink-faint mt-1.5">Mandated to workers on video tasks (scenario `video`).</p>
          </div>
          {view?.values.beta.figure && (
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-sm font-bold text-ink">Figure skills</span>
                <span className="rounded-sm bg-sunken px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-ink-soft ring-1 ring-inset ring-line">beta</span>
                <span className="ml-auto flex items-center gap-1.5">{aside('workflow.figurePack')}</span>
              </div>
              <DesignPacks key={`${modelProvider}:figure`} provider={modelProvider} compact pack="figure" />
              <p className="text-[11px] text-ink-faint mt-1.5">Mandated to workers on figure tasks (scenario `figure`); a goal may pick the other installed style on the New goal form. Both skills are bundled with Foundry: installing copies the snapshot, nothing is downloaded. Colorfigures builds its page with python3 and checks its own shots in a Chrome on this computer; Foundry's own render check needs Playwright's Chromium (Preview &amp; self-check).</p>
            </div>
          )}
        </div>
      </Card>

      <Card id="git" title={<SettingsTitle id="git">Git &amp; delivery<HelpLink to="settings#git--delivery" className="ml-1.5" /></SettingsTitle>} className="scroll-mt-16">
        <div className="space-y-3">
          {bool('sync.fetchBeforeGoal', 'Fetch the base branch before a goal starts', 'Only remote-tracking refs are updated — your checkout is never touched. The Clarifier explores, and the goal branch starts from, the freshest tip.')}
          {grid(
            <>
            <Field label="Where the goal branch starts" aside={aside('sync.startFrom')} help="auto: from <remote>/<base> when your local base is behind it (and not ahead); local: always from your local branch.">
              <Select value={draft.sync.startFrom} onChange={(e) => set('sync.startFrom', e.target.value)}>
                <option value="auto">auto — remote tip when local is behind</option>
                <option value="local">always the local branch</option>
              </Select>
            </Field>
            <Field label="Commit author" aside={aside('delivery.commitAuthor')} help="Who Foundry's commits are written by. Your identity comes from the repository's git config, else the global one, else your GitHub account (gh). Deploy integrations such as Vercel teams refuse commits by an unknown author. Applies to commits made from now on.">
              <Select value={draft.delivery.commitAuthor} onChange={(e) => set('delivery.commitAuthor', e.target.value)}>
                <option value="you-coauthor">you, with Foundry as co-author</option>
                <option value="you">you only</option>
                <option value="foundry">Foundry only</option>
              </Select>
            </Field>
            </>,
          )}
          {bool('sync.refreshBetweenTasks', 'Refresh between tasks', 'When nothing is running, fetch again and merge a moved base branch into the goal branch (conflicts go to a Merge Attempt). Useful for long goals on busy repositories; off by default because mid-goal merges can surprise workers.')}
          {bool('delivery.updateLocalBase', 'Update my local base branch after a merge', 'When a pull request merges, Foundry fetches and fast-forwards your local base branch (only when that is safe: no uncommitted changes, no commits of your own on it), then removes the goal\'s progress folder, worktrees and local branches. Screenshots and the goal itself stay.')}
          <div className="pt-1 space-y-2">
            <div className="text-sm font-bold text-ink">Deploy — a finished web app to a host</div>
            <p className="text-[11px] text-ink-faint">For a goal's web page or all-in-one web app (never a worker or a separate backend): its Delivery tab deploys it on your click, a preview unless you ask for production. The tokens are kept by the engine only and never handed to a coding session.</p>
            {grid(
              <>
                <Field label="Vercel token" aside={aside('delivery.vercelToken')} help="vercel.com → Account Settings → Tokens. Scope it to the team you deploy to.">
                  {secret('delivery.vercelToken', 'vcp_…')}
                </Field>
                <Field label="Vercel team" aside={aside('delivery.vercelScope')} help="The team's slug: the part after vercel.com/. Empty = the token's own account.">
                  {text('delivery.vercelScope', 'my-team', true)}
                </Field>
                <Field label="Netlify token" aside={aside('delivery.netlifyToken')} help="app.netlify.com → User settings → Applications → Personal access tokens.">
                  {secret('delivery.netlifyToken', 'nfp_…')}
                </Field>
                <Field label="Netlify team" aside={aside('delivery.netlifyTeam')} help="The slug of the team a new site is made in: the part after app.netlify.com/teams/, not the team's name. Empty = your default team.">
                  {text('delivery.netlifyTeam', 'my-team', true)}
                </Field>
                <Field label="Cloudflare API token" aside={aside('delivery.cloudflareToken')} help="dash.cloudflare.com → My Profile → API Tokens, with the permission Cloudflare Pages: Edit. Static sites only.">
                  {secret('delivery.cloudflareToken', 'API token')}
                </Field>
                <Field label="Cloudflare account id" aside={aside('delivery.cloudflareAccountId')} help="On the account's overview page, under API.">
                  {text('delivery.cloudflareAccountId', '0123abcd…', true)}
                </Field>
              </>,
            )}
          </div>
          <details className="pt-1">
            <summary className="text-xs font-semibold text-ink-soft hover:text-ink cursor-pointer">Delivery timings (advanced)</summary>
            <div className="mt-3">
              {grid(
                <>
                  <Field label="Poll interval (s)" aside={aside('delivery.pollSec')}>
                    {num('delivery.pollSec', { min: 5, max: 600 })}
                  </Field>
                  <Field label="Grace before “no checks” (s)" aside={aside('delivery.noChecksGraceSec')}>
                    {num('delivery.noChecksGraceSec', { min: 0, max: 3600 })}
                  </Field>
                  <Field label="Checks timeout (min)" aside={aside('delivery.checksTimeoutMin')}>
                    {num('delivery.checksTimeoutMin', { min: 1, max: 720 })}
                  </Field>
                  <Field label="Auto-merge wait under branch protection (min)" aside={aside('delivery.automergeWaitMin')}>
                    {num('delivery.automergeWaitMin', { min: 1, max: 720 })}
                  </Field>
                </>,
              )}
            </div>
          </details>
        </div>
      </Card>

      <Card id="tools" title={<SettingsTitle id="tools">Tools &amp; keys<HelpLink to="settings#tools--keys" className="ml-1.5" /></SettingsTitle>} className="scroll-mt-16">
        <div className="space-y-3">
          {bool('tools.useGraphify', 'Use graphify for relevant-file discovery', 'When the graphify CLI is installed, sessions get a code-graph based context instead of grep.')}
          {grid(
            <>
              <Field label="OpenAI-compatible API key" aside={aside('tools.openaiApiKey')} help="Handed to every session as OPENAI_API_KEY — the image pack needs it to actually generate images (without it, image tasks fall back to hand-authored SVG renders). Empty = whatever the engine's own environment has.">
                {secret('tools.openaiApiKey', 'sk-…')}
              </Field>
              <Field label="OpenAI-compatible base URL" aside={aside('tools.openaiBaseUrl')} help="Handed to sessions as OPENAI_BASE_URL for proxies / compatible providers; empty = the provider's default endpoint.">
                {text('tools.openaiBaseUrl', 'https://api.openai.com/v1', true)}
              </Field>
              <Field label="Gemini API key" aside={aside('tools.geminiApiKey')} help="Handed to sessions as GEMINI_API_KEY — the claude-image-gen image pack option uses Gemini by default (its OpenAI mode uses the key above). Empty = whatever the engine's own environment has.">
                {secret('tools.geminiApiKey', 'AIza…')}
              </Field>
              <Field label="Kimi (Moonshot) API key" aside={aside('tools.kimiApiKey')} help="Handed to sessions as MOONSHOT_API_KEY and KIMI_API_KEY — used by taste-skill's sponsored Kimi models where a skill calls them. Empty = whatever the engine's own environment has.">
                {secret('tools.kimiApiKey', 'sk-…')}
              </Field>
              <Field label="MiniMax API key" aside={aside('tools.minimaxApiKey')} help="For mmx-cli (video and narration). Foundry saves it where mmx reads it and hands it to sessions as MINIMAX_API_KEY. Empty = the engine's own environment, or your own `mmx auth login`.">
                {secret('tools.minimaxApiKey', 'sk-cp-… or sk-api-…')}
              </Field>
              <Field label="ElevenLabs API key" aside={aside('tools.elevenlabsApiKey')} help="Handed to sessions as ELEVENLABS_API_KEY — narration voices for web-video-presentation. Empty = whatever the engine's own environment has.">
                {secret('tools.elevenlabsApiKey', 'sk_…')}
              </Field>
              <Field label="Groq API key" aside={aside('tools.groqApiKey')} help="Handed to sessions as GROQ_API_KEY — hyperframes transcribes captions locally and falls back to Groq (or the OpenAI key) when the audio is too noisy. Empty = whatever the engine's own environment has.">
                {secret('tools.groqApiKey', 'gsk_…')}
              </Field>
              <Field label="markitdown binary" aside={aside('tools.markitdownBin')} help="Converts attachments and repository documents to markdown before sessions read them. Empty = auto-detect on PATH and ~/.local/bin.">
                {text('tools.markitdownBin', 'markitdown', true)}
              </Field>
            </>,
          )}
          <CodeServerInstall />
        </div>
      </Card>

      <Card id="preview" title={<SettingsTitle id="preview">Preview &amp; self-check<HelpLink to="settings#preview--self-check" className="ml-1.5" /></SettingsTitle>} className="scroll-mt-16">
        <div className="space-y-3">
          <p className="text-xs text-ink-faint">At a milestone, and on request from a goal's page, the engine starts the goal's dev server in its progress folder and links you to it. With the self-check on, it also opens that preview in headless Chromium after every task lands, takes a screenshot and fails the goal's must checks on console or network errors.</p>
          {grid(
            <>
              <Field label="First port" aside={aside('preview.portFrom')} help="Previews take the first free port in this range.">
                {num('preview.portFrom', { min: 1024, max: 65535 })}
              </Field>
              <Field label="Last port" aside={aside('preview.portTo')} help="Docker: publish this range in docker-compose.yml so the preview is reachable from the host.">
                {num('preview.portTo', { min: 1024, max: 65535 })}
              </Field>
              <Field label="Idle minutes" aside={aside('preview.idleMinutes')} help="A preview nobody opened for this long is stopped (never while the goal waits for your look).">
                {num('preview.idleMinutes', { min: 5, max: 1440 })}
              </Field>
            </>,
          )}
          {bool('checks.selfCheck', 'Self-check new goals by default', "Off by default: it needs Playwright's Chromium (below) and only helps goals whose result runs in a browser. Each goal's page has its own switch.")}
          <PlaywrightInstall />
        </div>
      </Card>

      <Card id="notifications" title={<SettingsTitle id="notifications">Notifications<HelpLink to="settings#notifications" className="ml-1.5" /></SettingsTitle>} className="scroll-mt-16">
        <div className="space-y-4">
          <p className="text-xs text-ink-faint">Get pinged outside the app the moment a goal needs you or finishes. Every enabled event goes to every configured channel; leave a channel's fields empty to keep it off.</p>
          {grid(
            <>
              <Field label="Telegram bot token" aside={aside('notifications.telegramBotToken')} help="Create a bot with @BotFather in Telegram and paste its token here.">
                {secret('notifications.telegramBotToken', '123456:ABC-DEF…')}
              </Field>
              <Field label="Telegram chat id" aside={aside('notifications.telegramChatId')} help="Open your bot in Telegram and send it any message, then Detect fills this in.">
                <div className="flex gap-1">
                  <Input className="mono" value={(get(draft, 'notifications.telegramChatId') as string | null) ?? ''} placeholder="123456789" onChange={(e) => set('notifications.telegramChatId', e.target.value === '' ? null : e.target.value)} />
                  <Button size="sm" variant="ghost" className="shrink-0" disabled={busy || (!get(draft, 'notifications.telegramBotToken') && !view.secrets['notifications.telegramBotToken']?.set)} onClick={() => detectChatId(draft.notifications.telegramBotToken)} title="Asks Telegram which chat last messaged your bot and fills in its id">
                    Detect
                  </Button>
                </div>
              </Field>
              <Field label="Discord webhook URL" aside={aside('notifications.discordWebhookUrl')} help="In your Discord channel: Settings → Integrations → Webhooks → New Webhook, then copy its URL.">
                {secret('notifications.discordWebhookUrl', 'https://discord.com/api/webhooks/…')}
              </Field>
              <Field label="Discord bot token (buttons)" aside={aside('notifications.discordBotToken')} help="Optional, beside the webhook: a bot of yours posts the messages that wait for you in the webhook's channel, with buttons that answer. Empty = Discord messages without buttons.">
                {secret('notifications.discordBotToken', 'MTIz…')}
              </Field>
              <Field label="Link base URL" aside={aside('notifications.baseUrl')} help="Where this UI is reachable from elsewhere (a LAN address, a domain). Empty = links point at this computer (http://localhost); tailnet links are added below.">
                {text('notifications.baseUrl', 'http://192.168.1.20:4111', true)}
              </Field>
              <Field label="Tailscale links" aside={aside('notifications.tailscale')} help="auto: when Tailscale runs on this computer, messages also link to Foundry and the previews on your tailnet, so they open on your phone; Foundry serves those ports with `tailscale serve` (reusing what you already serve) and takes the previews' down when they stop. off: never.">
                <Select value={draft.notifications.tailscale} onChange={(e) => set('notifications.tailscale', e.target.value)}>
                  <option value="auto">auto — when Tailscale runs here</option>
                  <option value="off">off</option>
                </Select>
              </Field>
              <Field label="Tailscale name" aside={aside('notifications.tailscaleHost')} help="This computer's tailnet name. Empty = read from `tailscale status`.">
                {text('notifications.tailscaleHost', 'my-mac.tailnet-123.ts.net', true)}
              </Field>
            </>,
          )}
          <div className="space-y-2">
            {bool('notifications.telegramActions', 'Answer from Telegram', "Messages about something that waits for you carry buttons (Retry, Skip, Continue, Approve…), and a reply answers in words. Foundry reads the bot's messages while this is on, so give each Foundry its own bot. Commands outside the workspace are approved in the Inbox only.")}
            {bool('notifications.onEscalation', 'Needs you', 'An escalation was raised — a task or goal is blocked until you answer it on the Inbox page.')}
            {bool('notifications.onInterview', 'Interview round', 'The Clarifier asked a round of questions before writing the Brief; the goal waits for your answers.')}
            {bool('notifications.onBriefReady', 'Brief ready', 'A Brief waits for your approval. A Brief the engine approves itself (an automatic one, a delegated goal its main goal approves, a scheduled run that approves its own) never notifies.')}
            {bool('notifications.onSchedule', 'Schedule fired', 'A schedule fired: the goal it made, or why none was made (its previous run still going).')}
            {bool('notifications.onGoalFinished', 'Goal finished', 'A goal ended done, over-delivered, or failed. Cancelling a goal yourself never notifies.')}
            {bool('notifications.onDelivery', 'Delivery', 'A pull request was opened or merged, or the delivery failed.')}
            {bool('notifications.onRateLimit', 'Usage pause', 'A provider usage limit paused its goals, and when the retry pause lifts.')}
            {bool('notifications.onUpdateAvailable', 'New version', 'A Foundry release newer than this instance exists — once per version. Update from the header pill or Settings → About & updates.')}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => sendTestNotification({ telegramBotToken: draft.notifications.telegramBotToken, telegramChatId: draft.notifications.telegramChatId, discordWebhookUrl: draft.notifications.discordWebhookUrl, discordBotToken: draft.notifications.discordBotToken })} title="Sends a test message with the values above (saved or not)">
              Send test message
            </Button>
            {notifMsg && <span className={cn('text-[11px] font-semibold', TONE_INK[toneOf(notifMsg)])}>{notifMsg}</span>}
          </div>
        </div>
      </Card>

      <AccessCard />
      <Card id="safety" title={<SettingsTitle id="safety">Safety<HelpLink to="settings#safety" className="ml-1.5" /></SettingsTitle>} className="scroll-mt-16">
        {grid(
          <>
            <Field label="Extra boundary patterns" aside={aside('safety.extraBoundaryPatterns')} help="Additional ERE patterns the boundary hook blocks, '|'-separated (e.g. `terraform apply|kubectl`).">
              {text('safety.extraBoundaryPatterns', 'terraform apply|kubectl', true)}
            </Field>
            <Field label="Folder browser roots" aside={aside('safety.allowedRoots')} help="Directories the repository picker may enter, comma-separated; empty = your home and /Volumes.">
              {list('safety.allowedRoots', '/Users/you/Projects')}
            </Field>
          </>,
        )}
        <div className="mt-3">
          {bool('safety.desktopApps', 'Desktop apps & printers', "Let sessions open desktop apps and hand files to printers on this computer — text-to-cad's Bambu hand-off (Bambu Connect / Bambu Studio), `open …`, `xdg-open`, the slicers' windows. Off: the boundary guard refuses those commands and the hand-off skill (sessions are not pointed at it either); a refused command comes to your Inbox. Headless slicing and preflight reports stay available.")}
        </div>
      </Card>

      <Card id="beta" title={<SettingsTitle id="beta">Beta<HelpLink to="settings#beta" className="ml-1.5" /></SettingsTitle>} className="scroll-mt-16">
        <p className="mb-3 text-xs text-ink-faint">Features on trial: each one stays off until you switch it on, while it settles.</p>
        {bool('beta.conversation', 'Conversation on the goal page', "A bubble at the bottom right of a goal's page (and of its Brief page) opens a Conversation: a read-only Explainer, on the preset's Conversation model, answers your questions about the goal's code and Foundry's records of it, and never changes anything. Its answers cost the goal, outside its budget. Off: no bubble and no Conversation tab.")}
        {bool('beta.motionStudio', 'Motion studio video engine', 'Video goals get an Engine picker on the New goal form: the motion-studio engine (a deterministic seek(t) renderer with a critique loop) beside the Video skills pack, with its bundled skill in the catalog and its doctor checks for ffmpeg and Chromium. Off: the Video skills pack alone, as before.')}
        {bool('beta.figure', 'Figure goals', "A kind of goal of its own: interactive isometric figures of everyday objects and machines, one web page each, drawn by the Figure pack (Colorfigures or iso-glow, bundled with Foundry) and opened headless by Foundry when a task lands. On: Figures is among the kinds of goal, Figure skills sits under Skills, the CLI takes --nature figure and the doctor checks the tools. Off: none of that shows; figure goals made before still open.")}
        {bool('beta.adjust', 'Adjust the result', "A box on a finished goal's page takes your words on its result — what should change, with pictures or files — and the goal carries them out itself: the finished task's session resumes with them, or a task is appended, or a failed goal's failed tasks run again with them. The checks and reviews run again; the output folder and an open pull request get the new result; the earlier result is kept. It costs the goal, inside its budget. Off: no box; adjustments already made stay on the goal.")}
      </Card>

      <Card id="engine" title={<SettingsTitle id="engine">Engine (install)<HelpLink to="settings#engine-install" className="ml-1.5" /></SettingsTitle>} className="scroll-mt-16">
        {grid(
          <>
            <Field label="Port" aside={aside('engine.port')} help="HTTP port of the local server and of the boundary hook callback.">
              {num('engine.port', { min: 1, max: 65535 })}
            </Field>
            <Field label="Host" aside={aside('engine.host')} help="Bind address; keep 127.0.0.1 unless you know why.">
              {text('engine.host')}
            </Field>
            <Field label="Default coding agent" help="Default for new goals in this data directory. Choose any coding agent on New goal; existing goals keep theirs.">
              {/* the coding agent in its own colour and icon, as everywhere it is named */}
              <div className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm font-semibold', agent.chip)}>
                <agent.Icon size={14} strokeWidth={2} aria-hidden="true" />
                {PROVIDER_LABEL[draft.engine.provider]}
              </div>
            </Field>
            {<>
              <Field label="Codex binary" aside={aside('engine.codexBin')} help="Empty = codex on PATH.">{text('engine.codexBin', 'codex', true)}</Field>
              <Field label="Codex home" aside={aside('engine.codexHome')} help="Empty = CODEX_HOME or ~/.codex.">{text('engine.codexHome', '~/.codex', true)}</Field>
              <Field label="Antigravity binary" aside={aside('engine.agyBin')} help="Empty = agy on PATH. Needs agy 1.1.15 or newer.">{text('engine.agyBin', 'agy', true)}</Field>
            </>}<><Field label="Claude binary" aside={aside('engine.claudeBin')} help="Path to the Claude Code CLI; empty = first `claude` on PATH.">
              {text('engine.claudeBin', 'claude', true)}
            </Field>
            <Field label="Claude Code home" aside={aside('engine.claudeHome')} help="Where skills, plugins and settings.json live; empty = ~/.claude (or CLAUDE_CONFIG_DIR).">
              {text('engine.claudeHome', '~/.claude', true)}
            </Field></>
            <Field label="Progress folders" aside={aside('engine.workspacesRoot')} help="Where each goal's working folder is created. Empty = next to the repository, as <repo>-foundry/<goal>. A folder here = <folder>/<repo>/<goal>. Applies to goals created from now on.">
              {text('engine.workspacesRoot', '/Users/you/Foundry', true)}
            </Field>
          </>,
        )}
      </Card>

      <AppearanceCard />

      <Card id="about" title={<SettingsTitle id="about">About & updates<HelpLink to="settings#about--updates" className="ml-1.5" /></SettingsTitle>} className="scroll-mt-16">
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap text-sm">
            <span className="font-bold text-ink">
              Foundry <span className="mono">{upd?.current ?? '…'}</span>
            </span>
            {upd && <span className={cn(TAG, 'text-ink-faint inset-ring-line')}>{upd.capability.mode} install</span>}
            {upd?.updateAvailable ? (
              <Button size="sm" variant="primary" onClick={() => setUpdOpen(true)}>
                Update to {upd.latest}
              </Button>
            ) : (
              upd?.checkedAt && (
                <span className="text-[11px] text-ink-faint">
                  <InstallState tone="ok">up to date</InstallState> · checked <span className="mono">{new Date(upd.checkedAt).toLocaleString()}</span>
                </span>
              )
            )}
            <Button size="sm" variant="ghost" disabled={updBusy} onClick={checkUpdate} title="Asks the release registry for the newest version right now (the engine also checks once a day)">
              {updBusy ? 'Checking…' : 'Check now'}
            </Button>
          </div>
          {upd?.error && <p className="text-[11px] text-bad-ink">✘ {upd.error}</p>}
          {upd?.updateAvailable && upd.changelog.length > 0 && (
            <div className="max-h-40 overflow-auto rounded-md border border-line bg-sunken p-3 space-y-2">
              {upd.changelog.map((c) => (
                <div key={c.version}>
                  <div className="text-xs font-bold text-ink mono">{c.version}</div>
                  <div className="text-[11px] text-ink-soft whitespace-pre-wrap mt-0.5">{c.notes || '(no notes)'}</div>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-ink-faint">Updates never interrupt running agents: new sessions stop first and active ones finish before the restart (unless you force it in the update dialog).</p>
          <p className="text-[11px] text-ink-faint">
            Foundry is built on open-source software:{' '}
            <Link to="/credits" className="underline hover:text-ink">
              Open source credits
            </Link>
            , with the license notices of everything the Docker image ships.
          </p>
        </div>
      </Card>
      <UpdateDialog open={updOpen} onClose={() => setUpdOpen(false)} status={upd} />
        </div>
      </div>
    </div>
  );
}

/** VS Code in the browser (code-server): what Open ▾ → VS Code (web) starts, installed once into ~/.local */
function CodeServerInstall() {
  const [st, setSt] = useState<{ installed: boolean; running: boolean } | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = () => api.editorStatus().then((s) => (setSt(s), s)).catch(() => null);
  useEffect(() => {
    void load();
  }, []);
  // the install runs on the server; its log streams below, and the status is asked again until it says installed
  useEffect(() => {
    if (!running) return;
    const t0 = Date.now();
    const poll = setInterval(async () => {
      const s = await load();
      if (s?.installed || Date.now() - t0 > 6 * 60_000) setRunning(false);
    }, 3000);
    return () => clearInterval(poll);
  }, [running]);
  return (
    <div className="text-xs text-ink-soft space-y-2 border-t border-line pt-3">
      <div className="text-sm font-bold text-ink">VS Code in the browser (code-server)</div>
      <p className="text-[11px] text-ink-faint">Open ▾ → <b>VS Code (web)</b> opens a repository or a goal's folder in VS Code in a browser tab, also on your phone over Tailscale. It starts when first used, listens on this computer only behind a password the menu shows, and stops after two idle hours.</p>
      <div className="flex items-center gap-2 flex-wrap">
        <InstallState tone={!st ? 'work' : st.installed ? 'ok' : 'none'}>{st ? (st.installed ? `installed${st.running ? ' · running' : ''}` : 'not installed') : '…'}</InstallState>
        {st && !st.installed && (
          <Button
            size="sm"
            variant="primary"
            disabled={running}
            onClick={async () => {
              setError(null);
              try {
                await api.installCodeServer();
                setRunning(true);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
            title="code-server's standalone install into ~/.local (no root), about 150 MB"
          >
            Install code-server
          </Button>
        )}
      </div>
      {error && <div className="text-[11px] text-bad-ink">Could not start the install: {error}</div>}
      {running && <LiveLog attemptId="tool-install" className="max-h-40" />}
    </div>
  );
}

/** Playwright's Chromium for the self-check: the package ships with Foundry, the browser is downloaded once. */
function PlaywrightInstall() {
  const [st, setSt] = useState<{ installed: boolean; browser: boolean; detail: string } | null>(null);
  const [running, setRunning] = useState(false);
  const load = () => api.playwright().then(setSt).catch(() => {});
  useEffect(() => {
    void load();
  }, []);
  return (
    <div className="text-xs text-ink-soft space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {/* Playwright ships with Foundry, so its absence is a fault; a browser not downloaded yet is only not there yet */}
        <InstallState tone={!st ? 'work' : st.browser ? 'ok' : st.installed ? 'none' : 'bad'}>{st ? (st.browser ? 'Chromium installed' : st.installed ? 'Chromium not downloaded yet' : 'Playwright unavailable') : '…'}</InstallState>
        {st && <span className="text-ink-faint">{st.detail}</span>}
        {st && !st.browser && (
          <Button
            size="sm"
            variant="primary"
            disabled={running}
            onClick={async () => {
              setRunning(true);
              try {
                await api.installPlaywright();
              } finally {
                setTimeout(() => {
                  setRunning(false);
                  void load();
                }, 60_000);
              }
            }}
            title="playwright install chromium, with the Playwright version Foundry ships (a few hundred MB, once)"
          >
            Install Chromium
          </Button>
        )}
      </div>
      {running && <LiveLog attemptId="tool-install" className="max-h-40" />}
    </div>
  );
}
