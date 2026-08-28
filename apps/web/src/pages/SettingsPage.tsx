import type { Settings, SettingsView } from '@foundry/core/browser';
import { RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type ModelRecordView, type UpdateStatusView } from '../api.ts';
import { DesignPacks } from '../components/DesignPacks.tsx';
import { UpdateDialog } from '../components/UpdateDialog.tsx';
import { Button, Card, CopyButton, Empty, Field, Input, Select, cn } from '../ui.tsx';

type Section = keyof Settings;
type Leaf = `${Section}.${string}`;

/** fallback list until /api/models answers: aliases Claude Code resolves to the latest model of each family */
const SEED_MODELS: { id: string; label: string }[] = [
  { id: 'fable', label: 'Fable 5 — most capable (Mythos-class)' },
  { id: 'opus', label: 'Opus — strong, default' },
  { id: 'sonnet', label: 'Sonnet — fast, good for routine tasks' },
  { id: 'haiku', label: 'Haiku — cheapest' },
];
const get = (o: any, path: string) => path.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);

/** left-hand index; the ids are the Card ids further down */
const SECTIONS: { id: string; label: string }[] = [
  { id: 'goals', label: 'New goal defaults' },
  { id: 'models', label: 'Models & limits' },
  { id: 'skills', label: 'Skills' },
  { id: 'git', label: 'Git & delivery' },
  { id: 'tools', label: 'Tools & keys' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'safety', label: 'Safety' },
  { id: 'engine', label: 'Engine (install)' },
  { id: 'about', label: 'About & updates' },
];

function SourceBadge({ view, path }: { view: SettingsView; path: string }) {
  const m = view.meta[path];
  if (!m) return null;
  const label = m.source === 'file' ? 'saved' : m.source === 'env' ? 'env' : 'default';
  const title = m.source === 'env' ? `from ${m.env}` : m.env ? `set ${m.env} to seed this value (default ${JSON.stringify(m.default)})` : `default ${JSON.stringify(m.default)}`;
  return (
    <span className={cn('text-[10px] uppercase tracking-wide rounded px-1 py-px border', m.source === 'file' ? 'text-emerald-300 border-emerald-500/40' : m.source === 'env' ? 'text-sky-300 border-sky-500/40' : 'text-zinc-500 border-zinc-800')} title={title}>
      {label}
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
  const [active, setActive] = useState(SECTIONS[0]!.id);
  const [upd, setUpd] = useState<UpdateStatusView | null>(null);
  const [updBusy, setUpdBusy] = useState(false);
  const [updOpen, setUpdOpen] = useState(false);
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
  // highlight the section the page is on; the scroller is <main>, not the window
  useEffect(() => {
    if (!draft) return;
    const root = document.querySelector('main');
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top?.target.id) setActive(top.target.id);
      },
      { root, rootMargin: '-20% 0px -70% 0px' },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [draft]);
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
  const sendTestNotification = async (o: { telegramBotToken: string | null; telegramChatId: string | null; discordWebhookUrl: string | null }) => {
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
  if (!view || !draft) return <Empty>Loading settings…</Empty>;

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
      setMsg(`Saved ${changed.length} setting${changed.length === 1 ? '' : 's'}${v.restartNeeded.length ? ` — restart the engine to apply ${v.restartNeeded.join(', ')}` : ' — applied immediately'}.`);
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
  const aside = (path: Leaf) => (
    <>
      <SourceBadge view={view} path={path} />
      {view.meta[path]?.restart && (
        <span className="text-[10px] uppercase tracking-wide rounded px-1 py-px border text-amber-300 border-amber-500/40" title="takes effect after the engine restarts">
          restart
        </span>
      )}
      {view.meta[path]?.source === 'file' && (
        <button type="button" className="text-zinc-500 hover:text-zinc-200" title="forget the saved value (back to env / default)" disabled={busy} onClick={() => reset(path)}>
          <RotateCcw size={11} />
        </button>
      )}
    </>
  );
  const num = (path: Leaf, props: { min?: number; max?: number; step?: number } = {}) => <Input type="number" {...props} value={String(get(draft, path) ?? '')} onChange={(e) => set(path, e.target.value === '' ? get(view.values, path) : Number(e.target.value))} />;
  const text = (path: Leaf, placeholder?: string, nullable = false) => <Input value={(get(draft, path) as string | null) ?? ''} placeholder={placeholder} onChange={(e) => set(path, nullable && e.target.value === '' ? null : e.target.value)} />;
  const bool = (path: Leaf, label: string, help: string) => (
    <label className="flex items-start gap-2 cursor-pointer">
      <input type="checkbox" className="mt-0.5 accent-emerald-500" checked={!!get(draft, path)} onChange={(e) => set(path, e.target.checked)} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-xs text-zinc-200">{label}</span>
          <span className="ml-auto flex items-center gap-1.5">{aside(path)}</span>
        </span>
        <span className="block text-[11px] text-zinc-500">{help}</span>
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
        {(probe[v] || warn) && <div className={cn('text-[11px]', probe[v]?.startsWith('✘') || (!probe[v] && warn) ? 'text-amber-300' : 'text-zinc-400')}>{probe[v] ?? warn}</div>}
      </div>
    );
  };
  const list = (path: Leaf, placeholder: string) => <Input className="mono" value={((get(draft, path) as string[] | null) ?? []).join(', ')} placeholder={placeholder} onChange={(e) => set(path, e.target.value.trim() ? e.target.value.split(',').map((s) => s.trim()).filter(Boolean) : null)} />;

  const grid = (children: ReactNode) => <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">{children}</div>;

  return (
    <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6">
      <div className="min-w-0 mb-4">
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Saved to <span className="mono">{view.file}</span>. Precedence: saved value › environment variable › default. Most settings apply immediately; the ones marked <span className="text-amber-300">restart</span> after the engine restarts.
        </p>
      </div>
      <div className="grid lg:grid-cols-[11rem_minmax(0,1fr)] gap-x-6">
        <nav className="hidden lg:block sticky top-0 self-start max-h-screen overflow-auto py-1 space-y-0.5">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className={cn('block w-full text-left rounded px-2 py-1 text-xs', active === s.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900')}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 space-y-4">
          {/* the save bar follows you down the page: settings are long and the change you just made is at the bottom */}
          <div className="sticky top-0 z-20 -mx-3 sm:-mx-4 md:-mx-6 px-3 sm:px-4 md:px-6 py-2 bg-zinc-950/95 backdrop-blur flex items-center gap-2">
            <span className="text-xs text-zinc-400 mr-auto">{changed.length ? `${changed.length} unsaved` : 'no changes'}</span>
            <Button size="sm" variant="ghost" disabled={!changed.length || busy} onClick={() => setDraft(structuredClone(view.values))}>
              Discard
            </Button>
            <Button size="sm" variant="primary" disabled={!changed.length || busy} onClick={save}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
      {view.restartNeeded.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
          Restart the engine to apply: <span className="mono">{view.restartNeeded.join(', ')}</span> — stop it (Ctrl-C) and run <span className="mono">bun run serve</span> <CopyButton text="bun run serve" />
        </div>
      )}
      {msg && <div className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-200">{msg}</div>}
      {err && <div className="rounded-md border border-rose-500/40 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">{err}</div>}

      <Card id="goals" title="New goal defaults" className="scroll-mt-16">
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
              <Field label="TDD for new Expert goals" aside={aside('workflow.tdd')} help="required: workers must invoke tdd and the reviewer is told when they skipped it · preferred: suggested only · off: never mentioned. Simple goals start with preferred; each goal and task can override.">
                <Select value={draft.workflow.tdd} onChange={(e) => set('workflow.tdd', e.target.value)}>
                  <option value="required">required</option>
                  <option value="preferred">preferred</option>
                  <option value="off">off</option>
                </Select>
              </Field>
              <Field label="Goal-level fix cycles" aside={aside('reviews.maxFixCycles')} help="How many review → fix-task rounds before the goal escalates to you (thorough pace only).">
                {num('reviews.maxFixCycles', { min: 0, max: 5 })}
              </Field>
            </>,
          )}
          {bool('reviews.alwaysReviewTasks', 'Review every task', 'Run the lightweight task reviewer even when the Brief defined no reviewer check for the task (thorough pace only).')}
          <div className="border-t border-zinc-800 pt-4">
            <div className="text-xs text-zinc-300 mb-2">Delivery — what happens to the branch when a goal finishes</div>
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

      <Card id="models" title="Models & limits" className="scroll-mt-16">
        {grid(
          <>
            <Field label="Strong" aside={aside('models.strong')} help="Drives Clarify (understanding the goal, writing the Brief), the Planner (task DAG), the Goal reviewer and Merge Attempts — the stages where judgement matters most and tokens are few. Fable pays off here first.">
              {model('models.strong')}
            </Field>
            <Field label="Worker" aside={aside('models.worker')} help="Drives every task attempt — the bulk of the tokens. Opus for most work; Fable for hard, cross-cutting tasks; Sonnet when tasks are routine and budget matters.">
              {model('models.worker')}
            </Field>
            <Field label="Cheap" aside={aside('models.cheap')} help="Drives the per-task reviewer and the engine's probes (rate-limit checks). Haiku is fine; Sonnet if task reviews feel shallow.">
              {model('models.cheap')}
            </Field>
            <Field label="Fallbacks (in order)" aside={aside('models.fallbacks')} help="When a session's model is unavailable (deprecated alias, retired id, typo) the engine re-runs it with the next of these and updates the goal's model; only when all fail does it ask you.">
              {list('models.fallbacks', 'opus, sonnet, haiku')}
            </Field>
          </>,
        )}
        <p className="text-[11px] text-zinc-500 mt-3">The list is what this machine has seen resolve (family aliases follow the latest release through Claude Code; a full model id pins a version). A new family is one custom entry away — after its first session it shows up here with its resolved id. Changes apply to goals created from now on; running goals keep the models they started with unless a fallback kicks in.</p>
        <div className="border-t border-zinc-800 mt-4 pt-4">
          <div className="text-xs text-zinc-300 mb-2">Limits — what one session may spend before the engine stops it</div>
          {grid(
            <>
              <Field label="Cost cap per session (USD)" aside={aside('sessions.attemptMaxCostUsd')} help="The real guard: a worker session stops at this spend (also bounded by the goal's remaining budget).">
                {num('sessions.attemptMaxCostUsd', { min: 0.5, max: 500, step: 0.5 })}
              </Field>
              <Field label="Attempt timeout (minutes)" aside={aside('sessions.attemptTimeoutMin')} help="A session killed at this mark keeps what it committed; the attempt then continues or restarts.">
                {num('sessions.attemptTimeoutMin', { min: 5, max: 240 })}
              </Field>
              <Field label="Continuations per attempt" aside={aside('sessions.maxContinuations')} help="How often one attempt may resume its own Claude session (after a restart, a turn/cost cap, a timeout, or failing checks with progress) before a fresh attempt is started. Resuming keeps the session's context — far cheaper than starting over. 0 = always start fresh.">
                {num('sessions.maxContinuations', { min: 0, max: 5 })}
              </Field>
              <Field label="Turn cap per session" aside={aside('sessions.attemptMaxTurns')} help="Only stops runaway loops; keep it generous so a session is not cut mid-work.">
                {num('sessions.attemptMaxTurns', { min: 10, max: 2000 })}
              </Field>
              <Field label="Concurrent Claude sessions" aside={aside('engine.maxConcurrent')} help="Global cap across all goals (workers, reviewers, clarify) — the throughput knob, and the one that decides how fast the bill grows. Applies immediately.">
                {num('engine.maxConcurrent', { min: 1, max: 16 })}
              </Field>
            </>,
          )}
        </div>
      </Card>

      <Card id="skills" title="Skills" className="scroll-mt-16">
        <div className="space-y-4">
          {grid(
            <>
              <Field label="Profile" aside={aside('workflow.profile')} help="mattpocock: roles are told which workflow skills to invoke (tdd, diagnosing-bugs, code-review…) and the engine records what they used. plain: a one-line hint only.">
                <Select value={draft.workflow.profile} onChange={(e) => set('workflow.profile', e.target.value)}>
                  <option value="mattpocock">mattpocock (mandated + observed)</option>
                  <option value="plain">plain (hint only)</option>
                </Select>
              </Field>
              <Field label="Setting sources" aside={aside('workflow.settingSources')} help="`--setting-sources` for sessions, comma-separated (user, project, local); empty = inherit everything. Without `user`, your own skills never load.">
                {list('workflow.settingSources', 'user, project')}
              </Field>
            </>,
          )}
          {bool('workflow.autoskills', 'autoskills per goal', 'After the Brief is approved, run `npx autoskills` in the goal workspace to install skills matching the repository’s stack (needs Node ≥ 22). The generated CLAUDE.md is restored and the skills are git-excluded.')}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs text-zinc-300">Design skills</span>
              <span className="ml-auto flex items-center gap-1.5">{aside('workflow.designPack')}</span>
            </div>
            <DesignPacks compact />
            <p className="text-[11px] text-zinc-500 mt-1.5">Choosing a pack saves immediately; only that pack is shown to sessions working on frontend / fullstack tasks.</p>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs text-zinc-300">Image skills</span>
              <span className="ml-auto flex items-center gap-1.5">{aside('workflow.imagePack')}</span>
            </div>
            <DesignPacks compact pack="image" />
            <p className="text-[11px] text-zinc-500 mt-1.5">Mandated to workers on image tasks (scenario `image`). The pack only generates when a key is set under Tools &amp; keys.</p>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs text-zinc-300">Video skills</span>
              <span className="ml-auto flex items-center gap-1.5">{aside('workflow.videoPack')}</span>
            </div>
            <DesignPacks compact pack="video" />
            <p className="text-[11px] text-zinc-500 mt-1.5">Mandated to workers on video tasks (scenario `video`).</p>
          </div>
        </div>
      </Card>

      <Card id="git" title="Git &amp; delivery timing" className="scroll-mt-16">
        <div className="space-y-3">
          {bool('sync.fetchBeforeGoal', 'Fetch the base branch before a goal starts', 'Only remote-tracking refs are updated — your checkout is never touched. The Clarifier explores, and the goal branch starts from, the freshest tip.')}
          {grid(
            <Field label="Where the goal branch starts" aside={aside('sync.startFrom')} help="auto: from <remote>/<base> when your local base is behind it (and not ahead); local: always from your local branch.">
              <Select value={draft.sync.startFrom} onChange={(e) => set('sync.startFrom', e.target.value)}>
                <option value="auto">auto — remote tip when local is behind</option>
                <option value="local">always the local branch</option>
              </Select>
            </Field>,
          )}
          {bool('sync.refreshBetweenTasks', 'Refresh between tasks', 'When nothing is running, fetch again and merge a moved base branch into the goal branch (conflicts go to a Merge Attempt). Useful for long goals on busy repositories; off by default because mid-goal merges can surprise workers.')}
          <details className="pt-1">
            <summary className="text-xs text-zinc-400 cursor-pointer">Delivery timings (advanced)</summary>
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

      <Card id="tools" title="Tools &amp; keys" className="scroll-mt-16">
        <div className="space-y-3">
          {bool('tools.useGraphify', 'Use graphify for relevant-file discovery', 'When the graphify CLI is installed, sessions get a code-graph based context instead of grep.')}
          {grid(
            <>
              <Field label="OpenAI-compatible API key" aside={aside('tools.openaiApiKey')} help="Handed to every session as OPENAI_API_KEY — the image pack needs it to actually generate images (without it, image tasks fall back to hand-authored SVG renders). Empty = whatever the engine's own environment has.">
                <Input type="password" autoComplete="off" value={(get(draft, 'tools.openaiApiKey') as string | null) ?? ''} placeholder="sk-…" onChange={(e) => set('tools.openaiApiKey', e.target.value === '' ? null : e.target.value)} />
              </Field>
              <Field label="OpenAI-compatible base URL" aside={aside('tools.openaiBaseUrl')} help="Handed to sessions as OPENAI_BASE_URL for proxies / compatible providers; empty = the provider's default endpoint.">
                {text('tools.openaiBaseUrl', 'https://api.openai.com/v1', true)}
              </Field>
              <Field label="Gemini API key" aside={aside('tools.geminiApiKey')} help="Handed to sessions as GEMINI_API_KEY — the claude-image-gen image pack option uses Gemini by default (its OpenAI mode uses the key above). Empty = whatever the engine's own environment has.">
                <Input type="password" autoComplete="off" value={(get(draft, 'tools.geminiApiKey') as string | null) ?? ''} placeholder="AIza…" onChange={(e) => set('tools.geminiApiKey', e.target.value === '' ? null : e.target.value)} />
              </Field>
              <Field label="Kimi (Moonshot) API key" aside={aside('tools.kimiApiKey')} help="Handed to sessions as MOONSHOT_API_KEY and KIMI_API_KEY — used by taste-skill's sponsored Kimi models where a skill calls them. Empty = whatever the engine's own environment has.">
                <Input type="password" autoComplete="off" value={(get(draft, 'tools.kimiApiKey') as string | null) ?? ''} placeholder="sk-…" onChange={(e) => set('tools.kimiApiKey', e.target.value === '' ? null : e.target.value)} />
              </Field>
              <Field label="markitdown binary" aside={aside('tools.markitdownBin')} help="Converts attachments and repository documents to markdown before sessions read them. Empty = auto-detect on PATH and ~/.local/bin.">
                {text('tools.markitdownBin', 'markitdown', true)}
              </Field>
            </>,
          )}
        </div>
      </Card>

      <Card id="notifications" title="Notifications" className="scroll-mt-16">
        <div className="space-y-4">
          <p className="text-[11px] text-zinc-500">Get pinged outside the app the moment a goal needs you or finishes. Every enabled event goes to every configured channel; leave a channel's fields empty to keep it off.</p>
          {grid(
            <>
              <Field label="Telegram bot token" aside={aside('notifications.telegramBotToken')} help="Create a bot with @BotFather in Telegram and paste its token here.">
                <Input type="password" autoComplete="off" value={(get(draft, 'notifications.telegramBotToken') as string | null) ?? ''} placeholder="123456:ABC-DEF…" onChange={(e) => set('notifications.telegramBotToken', e.target.value === '' ? null : e.target.value)} />
              </Field>
              <Field label="Telegram chat id" aside={aside('notifications.telegramChatId')} help="Open your bot in Telegram and send it any message, then Detect fills this in.">
                <div className="flex gap-1">
                  <Input className="mono" value={(get(draft, 'notifications.telegramChatId') as string | null) ?? ''} placeholder="123456789" onChange={(e) => set('notifications.telegramChatId', e.target.value === '' ? null : e.target.value)} />
                  <Button size="sm" variant="ghost" className="shrink-0" disabled={busy || !get(draft, 'notifications.telegramBotToken')} onClick={() => detectChatId(draft.notifications.telegramBotToken)} title="Asks Telegram which chat last messaged your bot and fills in its id">
                    Detect
                  </Button>
                </div>
              </Field>
              <Field label="Discord webhook URL" aside={aside('notifications.discordWebhookUrl')} help="In your Discord channel: Settings → Integrations → Webhooks → New Webhook, then copy its URL.">
                <Input type="password" autoComplete="off" value={(get(draft, 'notifications.discordWebhookUrl') as string | null) ?? ''} placeholder="https://discord.com/api/webhooks/…" onChange={(e) => set('notifications.discordWebhookUrl', e.target.value === '' ? null : e.target.value)} />
              </Field>
              <Field label="Link base URL" aside={aside('notifications.baseUrl')} help="Where this UI is reachable from your phone (a Tailscale or LAN address). Empty = messages carry no links, since 127.0.0.1 would not open elsewhere.">
                {text('notifications.baseUrl', 'http://my-mac.tailnet:4111', true)}
              </Field>
            </>,
          )}
          <div className="space-y-2">
            {bool('notifications.onEscalation', 'Needs you', 'An escalation was raised — a task or goal is blocked until you answer it on the Inbox page.')}
            {bool('notifications.onGoalFinished', 'Goal finished', 'A goal ended done, over-delivered, or failed. Cancelling a goal yourself never notifies.')}
            {bool('notifications.onDelivery', 'Delivery', 'A pull request was opened or merged, or the delivery failed.')}
            {bool('notifications.onRateLimit', 'Usage pause', 'A Claude usage limit paused the engine, and when the pause lifts.')}
            {bool('notifications.onUpdateAvailable', 'New version', 'A Foundry release newer than this instance exists — once per version. Update from the header pill or Settings → About.')}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => sendTestNotification({ telegramBotToken: draft.notifications.telegramBotToken, telegramChatId: draft.notifications.telegramChatId, discordWebhookUrl: draft.notifications.discordWebhookUrl })} title="Sends a test message with the values above (saved or not)">
              Send test message
            </Button>
            {notifMsg && <span className={cn('text-[11px]', notifMsg.includes('✘') ? 'text-amber-300' : 'text-zinc-400')}>{notifMsg}</span>}
          </div>
        </div>
      </Card>

      <Card id="safety" title="Safety" className="scroll-mt-16">
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
      </Card>

      <Card id="engine" title="Engine (install)" className="scroll-mt-16">
        {grid(
          <>
            <Field label="Port" aside={aside('engine.port')} help="HTTP port of the local server and of the boundary hook callback.">
              {num('engine.port', { min: 1, max: 65535 })}
            </Field>
            <Field label="Host" aside={aside('engine.host')} help="Bind address; keep 127.0.0.1 unless you know why.">
              {text('engine.host')}
            </Field>
            <Field label="claude binary" aside={aside('engine.claudeBin')} help="Path to the Claude Code CLI; empty = first `claude` on PATH.">
              {text('engine.claudeBin', 'claude', true)}
            </Field>
            <Field label="Claude Code home" aside={aside('engine.claudeHome')} help="Where skills, plugins and settings.json live; empty = ~/.claude (or CLAUDE_CONFIG_DIR).">
              {text('engine.claudeHome', '~/.claude', true)}
            </Field>
          </>,
        )}
      </Card>

      <Card id="about" title="About & updates" className="scroll-mt-16">
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap text-sm">
            <span className="text-zinc-200">
              Foundry <span className="mono">{upd?.current ?? '…'}</span>
            </span>
            {upd && <span className="text-[10px] uppercase tracking-wide rounded px-1 py-px border text-zinc-500 border-zinc-800">{upd.capability.mode} install</span>}
            {upd?.updateAvailable ? (
              <Button size="sm" variant="primary" onClick={() => setUpdOpen(true)}>
                Update to {upd.latest}
              </Button>
            ) : (
              upd?.checkedAt && <span className="text-[11px] text-zinc-500">up to date · checked {new Date(upd.checkedAt).toLocaleString()}</span>
            )}
            <Button size="sm" variant="ghost" disabled={updBusy} onClick={checkUpdate} title="Asks the release registry for the newest version right now (the engine also checks once a day)">
              {updBusy ? 'Checking…' : 'Check now'}
            </Button>
          </div>
          {upd?.error && <p className="text-[11px] text-amber-300">✘ {upd.error}</p>}
          {upd?.updateAvailable && upd.changelog.length > 0 && (
            <div className="max-h-40 overflow-auto rounded-md border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
              {upd.changelog.map((c) => (
                <div key={c.version}>
                  <div className="text-xs font-semibold text-zinc-200 mono">{c.version}</div>
                  <div className="text-[11px] text-zinc-400 whitespace-pre-wrap mt-0.5">{c.notes || '(no notes)'}</div>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-zinc-500">Updates never interrupt running agents: new sessions stop first and active ones finish before the restart (unless you force it in the update dialog).</p>
        </div>
      </Card>
      <UpdateDialog open={updOpen} onClose={() => setUpdOpen(false)} status={upd} />
        </div>
      </div>
    </div>
  );
}
