import type { AgentProvider } from '../api.ts';
import { KNOWN_EFFORTS } from '@foundry/core/browser';
import { ProviderSelector } from '../components/ProviderSelector.tsx';
import type { ConcurrencyView, Settings, SettingsView } from '@foundry/core/browser';
import { AGENT_PROVIDERS, PROVIDER_LABEL } from '@foundry/core/browser';
import { AudioLines, Check, CheckCircle2, CircleDashed, LoaderCircle, RotateCcw, Sparkles, XCircle } from 'lucide-react';
import { siAppstore, siCloudflarepages, siDiscord, siElevenlabs, siExpo, siFlydotio, siGooglegemini, siGoogleplay, siKimi, siMinimax, siNetlify, siRailway, siRender, siTailscale, siTelegram, siVercel } from 'simple-icons';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, type ModelRecordView, type UpdateStatusView } from '../api.ts';
import { LiveLog } from './LiveLog.tsx';
import { ModelPresetsSection } from './settings/ModelPresets.tsx';
import { CodexModelPresetsSection } from './settings/CodexModelPresets.tsx';
import { AgyModelsSection } from './settings/AgyModels.tsx';
import { SectionTitle } from './settings/PresetParts.tsx';
import { SECTIONS, SECTION_STYLE, SettingsTitle } from './settings/sections.tsx';
import { sectionOf } from './settings/section-of.ts';
import { Aside, RESTART_TAG, Setting, SettingsControlsProvider, TAG, Toggle, get } from './settings/controls.tsx';
import { SettingsSearch } from './settings/SettingsSearch.tsx';
import type { SettingHit } from './settings/search-index.ts';
import { wordsOf, type SettingKey } from './settings/texts.ts';
import { SectionChipNav, SectionSideNav, type NavSection } from '../components/SectionNav.tsx';
import { DesignPacks } from '../components/DesignPacks.tsx';
import { PROVIDER_STYLE } from '../components/ProviderMark.tsx';
import { UpdateDialog } from '../components/UpdateDialog.tsx';
import { AccessCard } from './settings/AccessCard.tsx';
import { DataDirNoticeBanner, DataFolder, RestartNowButton } from './settings/DataFolder.tsx';
import { MoveCard } from '../components/MoveCard.tsx';
import { DeployServers } from './settings/DeployServers.tsx';
import { PlaceCard, type PlaceStatus, TokenLinks, ToolNote } from './settings/PlaceCard.tsx';
import { FlyctlRow, SignInPanel } from './settings/SignIn.tsx';
import { Button, Card, CopyButton, Empty, Field, Input, Loading, PageHeader, Select, Textarea, cn } from '../ui.tsx';
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
/** the section a hash names, else the first */
const sectionFromHash = (hash: string): string => {
  let id = hash.replace(/^#/, '');
  try {
    id = decodeURIComponent(id);
  } catch {}
  return SECTIONS.some((s) => s.id === id) ? id : SECTIONS[0]!.id;
};

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


/** what Concurrency runs at now, in a line under the setting (ADR-0103) */
function concurrencyNote(c: ConcurrencyView): string {
  const now = `${c.limit} session${c.limit === 1 ? '' : 's'} at once now`;
  const why = c.auto ? ` — this computer has ${c.auto.cpus} cores and ${c.auto.memGB} GB${c.auto.busy ? `; halved while it is busy (load ${c.auto.load1})` : ''}` : '';
  const held = c.held.map((h) => `${PROVIDER_LABEL[h.provider as AgentProvider] ?? h.provider} runs one task at a time until its 5-hour window resets (${Math.round(h.utilization * 100)}% used)`);
  return [now + why, ...held].join('. ') + '.';
}

export function SettingsPage() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [known, setKnown] = useState<ModelRecordView[] | null>(null);
  const [effortLevels, setEffortLevels] = useState<string[]>([...KNOWN_EFFORTS]);
  const [probe, setProbe] = useState<Record<string, string>>({});
  const [notifMsg, setNotifMsg] = useState<string | null>(null);
  const [upd, setUpd] = useState<UpdateStatusView | null>(null);
  // which deploy place cards are open (Git & delivery)
  const [placeOpen, setPlaceOpen] = useState<Set<string>>(() => new Set());
  // whether flyctl is on this computer (the Fly.io card's first step)
  const [flyInstalled, setFlyInstalled] = useState<boolean | null>(null);
  const [updBusy, setUpdBusy] = useState(false);
  const [updOpen, setUpdOpen] = useState(false);
  // the setting the search chose: once its section is open, the page opens what hides it, scrolls to it and marks it
  const [wanted, setWanted] = useState<SettingHit | null>(null);
  const { hash, search } = useLocation();
  const navigate = useNavigate();
  const requestedProvider = new URLSearchParams(search).get('provider');
  const modelProvider = AGENT_PROVIDERS.find((p) => p === requestedProvider) ?? view?.values.engine.provider ?? 'claude';
  const setModelProvider = (provider: AgentProvider) => {
    const params = new URLSearchParams(search);
    params.set('provider', provider);
    navigate({ search: params.toString(), hash }, { replace: true });
  };
  // the open section is the URL's: opening another is a navigation (the back button returns), and a change of the
  // provider query alone leaves the section and the scroll where they are
  const open = sectionFromHash(hash);
  const select = (id: string) => {
    if (id !== open) navigate({ search, hash: `#${id}` });
  };
  useEffect(() => {
    document.querySelector('main')?.scrollTo({ top: 0 });
  }, [open]);
  const jumpTo = (hit: SettingHit) => {
    setWanted(hit);
    select(hit.section);
  };
  // the environment variable that seeds a setting is a word the search finds it by
  const envWords = useCallback((target: string) => view?.meta[target]?.env ?? '', [view]);
  useEffect(() => {
    if (!wanted || open !== wanted.section) return;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const look = () => {
      const el = document.querySelector<HTMLElement>(`[data-setting="${wanted.target}"]`) ?? document.getElementById(wanted.target);
      if (!el) {
        // a component still loading what it shows: ask again for a moment
        if (++tries < 20) timer = setTimeout(look, 100);
        else setWanted(null);
        return;
      }
      // what hides it opens first (the effect runs again once it has): its card, another coding agent's region, a details
      const place = el.closest<HTMLElement>('[data-place]')?.dataset.place;
      if (place && !placeOpen.has(place)) return setPlaceOpen((o) => new Set(o).add(place));
      const provider = el.closest<HTMLElement>('[data-provider]')?.dataset.provider;
      if (provider && provider !== modelProvider) return setModelProvider(provider as AgentProvider);
      for (let d = el.closest('details'); d; d = d.parentElement?.closest('details') ?? null) d.open = true;
      setWanted(null);
      // a section itself is open now, at the top; a setting is scrolled to and marked for a moment
      if (el.tagName === 'SECTION') return;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.remove('setting-flash');
      void el.offsetWidth;
      el.classList.add('setting-flash');
      el.addEventListener('animationend', () => el.classList.remove('setting-flash'), { once: true });
    };
    look();
    return () => clearTimeout(timer);
  }, [wanted, open, placeOpen, modelProvider]);
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
  const loadModels = () =>
    api
      .models()
      .then((m) => {
        setKnown(m.models);
        // the effort levels this Claude Code takes (ADR-0085): the select below offers these
        if (m.effortLevels?.length) setEffortLevels(m.effortLevels);
      })
      .catch(() => setKnown([]));
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
  // the menu's entries, each with its section's colour, and the count of its unsaved changes on a yellow plate: what
  // you changed stays while you switch sections, so the menu says where it is
  const nav = useMemo<NavSection[]>(() => {
    const unsaved = new Map<string, number>();
    for (const p of changed) {
      const id = sectionOf(p);
      if (id) unsaved.set(id, (unsaved.get(id) ?? 0) + 1);
    }
    return SECTIONS.map((s) => ({ ...s, dot: SECTION_STYLE[s.id]?.dot, status: unsaved.has(s.id) ? String(unsaved.get(s.id)) : null, warn: unsaved.has(s.id) }));
  }, [changed]);

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
  // the deploy places as cards (one per host, platform or store): which are open, and whether each has what it needs
  const togglePlace = (id: string) =>
    setPlaceOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const filled = (path: Leaf) => {
    const v = get(draft, path);
    return (typeof v === 'string' && v !== '') || !!view.secrets[path]?.set;
  };
  // a sign-in through a CLI saved a token: the view (the saved marks, the status pill) follows; the draft is left alone
  const refreshView = () => void api.settings().then(setView).catch(() => {});
  const placeStatus = (paths: Leaf[]): PlaceStatus => {
    const n = paths.filter(filled).length;
    return n === paths.length ? 'set' : n === 0 ? 'unset' : 'partial';
  };
  // a secret that is a file's contents (a .p8 key, a service account's JSON): several lines, never shown back once saved
  const secretText = (path: Leaf, placeholder: string) => {
    const saved = view.secrets[path];
    const from = view.meta[path]?.source === 'env' ? `from ${view.meta[path]?.env}` : 'saved';
    return <Textarea rows={3} className="mono text-[11px]" autoComplete="off" spellCheck={false} value={(get(draft, path) as string | null) ?? ''} placeholder={saved?.set ? `${from}: ${saved.hint} — paste to replace` : placeholder} onChange={(e) => set(path, e.target.value === '' ? null : e.target.value)} />;
  };
  const num = (path: Leaf, props: { min?: number; max?: number; step?: number } = {}) => <Input type="number" {...props} value={String(get(draft, path) ?? '')} onChange={(e) => set(path, e.target.value === '' ? get(view.values, path) : Number(e.target.value))} />;
  const text = (path: Leaf, placeholder?: string, nullable = false) => <Input value={(get(draft, path) as string | null) ?? ''} placeholder={placeholder} onChange={(e) => set(path, nullable && e.target.value === '' ? null : e.target.value)} />;
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
  // a skill pack's block: its heading with its plate, the packs to choose from, and what the pack is for, worded from the texts table
  const packBlock = (path: SettingKey, pack?: 'image' | 'video' | 'figure' | 'diagram' | 'deck', beta = false) => (
    <div data-setting={path}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-sm font-bold text-ink">{wordsOf(path).label}</span>
        {beta && <span className="rounded-sm bg-sunken px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-ink-soft ring-1 ring-inset ring-line">beta</span>}
        <span className="ml-auto flex items-center gap-1.5">
          <Aside path={path} />
        </span>
      </div>
      <DesignPacks key={`${modelProvider}:${pack ?? 'design'}`} provider={modelProvider} compact pack={pack} />
      <p className="text-[11px] text-ink-faint mt-1.5">{wordsOf(path).help}</p>
    </div>
  );
  const agent = PROVIDER_STYLE[draft.engine.provider];

  return (
    <SettingsControlsProvider value={{ view, draft, busy, set, reset }}>
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
        <SectionSideNav items={nav} label="Settings sections" choice={{ current: open, onSelect: select }} />
        {/* a section a link opens lands clear of the sticky bar above it, taller where the row of sections rides in it (the
            browser scrolls to the card's id on arrival; the parent's rule outranks each card's own scroll margin) */}
        <div className="min-w-0 space-y-4 [&>section]:scroll-mt-28 lg:[&>section]:scroll-mt-16">
          {/* the save bar stays at the top while a long section scrolls: the change you just made may be at its bottom, and
              Save saves every section's. The search at its left finds a setting in any section. On a phone or a tablet the
              sections ride in the bar too, as the side list's row of chips. From a tablet up its row is inset as the cards'
              insides are; on a phone the page's own padding is enough, and the row keeps to the column's edges */}
          <div className="sticky top-0 z-20 bg-page border-b border-line">
            <SectionChipNav items={nav} label="Settings sections" inBar choice={{ current: open, onSelect: select }} />
            <div className="flex items-center gap-2 py-2.5 sm:px-4">
              <SettingsSearch className="min-w-0 flex-1 sm:max-w-xs" onPick={jumpTo} extraWords={envWords} />
              <span className="ml-auto whitespace-nowrap text-[13px] text-ink-faint">{changed.length ? <><b className="mono font-bold text-ink">{changed.length}</b> unsaved</> : <span className="hidden sm:inline">no changes</span>}</span>
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
          <span className="min-w-0 break-words pt-1 space-y-1.5">
            <span className="block">
              <b className="font-bold">Restart the engine to apply:</b> <span className="mono">{view.restartNeeded.join(', ')}</span>
            </span>
            {/* in its own process (ADR-0082), once no goal is at work; by hand for a Foundry started another way */}
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <RestartNowButton />
              <span className="text-ink-faint">
                or stop it (Ctrl-C) and run <span className="mono">bun run serve</span> <CopyButton text="bun run serve" />
              </span>
            </span>
          </span>
        </div>
      )}
      <DataDirNoticeBanner />
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

      {open === 'goals' && (
        <Card id="goals" title={<SettingsTitle id="goals">New goal defaults<HelpLink to="settings#new-goal-defaults" className="ml-1.5" /></SettingsTitle>} className="scroll-mt-16">
          <div className="space-y-4">
            {grid(
              <>
                <Setting path="workflow.defaultMode">
                  <Select value={draft.workflow.defaultMode} onChange={(e) => set('workflow.defaultMode', e.target.value)}>
                    <option value="expert">expert</option>
                    <option value="simple">simple</option>
                  </Select>
                </Setting>
                <Setting path="workflow.defaultPace">
                  <Select value={draft.workflow.defaultPace} onChange={(e) => set('workflow.defaultPace', e.target.value)}>
                    <option value="thorough">thorough — engine reviews the work</option>
                    <option value="fast">fast — approved checks only</option>
                  </Select>
                </Setting>
                <Setting path="workflow.interviewDepth">
                  <Select value={String(draft.workflow.interviewDepth ?? { never: 0, auto: 3, always: 4 }[draft.workflow.interview])} onChange={(e) => set('workflow.interviewDepth', Number(e.target.value))}>
                    {INTERVIEW_DEPTHS.map((d) => (
                      <option key={d.id} value={d.id}>{d.label}</option>
                    ))}
                  </Select>
                </Setting>
                <Toggle path="workflow.milestonePause" />
                <Setting path="workflow.effort">
                  <Select value={(draft.workflow.effort as string | null) ?? ''} onChange={(e) => set('workflow.effort', e.target.value || null)}>
                    <option value="">Role preset / CLI default</option>
                    {/* the levels the Claude Code binary takes, read at the last model sync (ADR-0085); a saved level it no longer lists stays selectable */}
                    {[...new Set([...effortLevels, ...((draft.workflow.effort as string | null) ? [draft.workflow.effort as string] : [])])].map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </Setting>
                <Setting path="workflow.tdd">
                  <Select value={draft.workflow.tdd} onChange={(e) => set('workflow.tdd', e.target.value)}>
                    <option value="required">required</option>
                    <option value="preferred">preferred</option>
                    <option value="off">off</option>
                  </Select>
                </Setting>
                <Setting path="workflow.profile">
                  <Select value={draft.workflow.profile} onChange={(e) => set('workflow.profile', e.target.value)}>
                    <option value="mattpocock">mattpocock (Matt Pocock's suite)</option>
                    <option value="pstack">pstack</option>
                    <option value="plain">plain (hint only)</option>
                  </Select>
                </Setting>
                <Setting path="workflow.ponytail">
                  <Select value={draft.workflow.ponytail} onChange={(e) => set('workflow.ponytail', e.target.value)}>
                    <option value="on">on</option>
                    <option value="off">off</option>
                  </Select>
                </Setting>
                <Toggle path="workflow.audit" />
                <Toggle path="workflow.designCheck" />
                <Toggle path="workflow.qa" />
                <Toggle path="workflow.learnings" />
                <Toggle path="workflow.briefSecondOpinion" />
                <Toggle path="workflow.learningsSkill" />
                <Setting path="reviews.maxFixCycles">
                  {num('reviews.maxFixCycles', { min: 0, max: 5 })}
                </Setting>
                <Setting path="reviews.smallGoalLines">
                  {num('reviews.smallGoalLines', { min: 0, max: 5000 })}
                </Setting>
              </>,
            )}
            <Toggle path="reviews.alwaysReviewTasks" />
            <div className="border-t border-line pt-4">
              <div className="text-sm font-bold text-ink mb-3">Delivery — what happens to the branch when a goal finishes</div>
              {grid(
                <>
                  <Setting path="delivery.defaultMode">
                    <Select value={draft.delivery.defaultMode} onChange={(e) => set('delivery.defaultMode', e.target.value)}>
                      <option value="local">local only</option>
                      <option value="push">push branch</option>
                      <option value="pr">open a PR</option>
                      <option value="pr-automerge">PR + auto-merge</option>
                    </Select>
                  </Setting>
                  <Setting path="delivery.defaultUnit">
                    <Select value={draft.delivery.defaultUnit} onChange={(e) => set('delivery.defaultUnit', e.target.value)}>
                      <option value="task">one PR per task (stacked)</option>
                      <option value="goal">one PR per goal</option>
                    </Select>
                  </Setting>
                  <Setting path="delivery.defaultRemote">
                    {text('delivery.defaultRemote', 'origin')}
                  </Setting>
                </>,
              )}
            </div>
          </div>
        </Card>
      )}

      {open === 'models' && (
        <Card id="models" title={<SettingsTitle id="models">Models & limits<HelpLink to="settings#models--limits" className="ml-1.5" /></SettingsTitle>} className="scroll-mt-16">
          <ProviderSelector className="mb-5" value={modelProvider} onChange={setModelProvider} controls={{ claude: 'models-claude', codex: 'models-codex', agy: 'models-agy' }} />
          <div id="models-codex" data-provider="codex" role="region" aria-label="Codex models" hidden={modelProvider !== 'codex'}>
            <CodexModelPresetsSection draft={draft} setFields={(patch) => setDraft((previous) => previous ? { ...previous, models: { ...previous.models, ...patch } } : previous)} />
          </div>
          <div id="models-agy" data-provider="agy" role="region" aria-label="Antigravity models" hidden={modelProvider !== 'agy'}>
            <AgyModelsSection model={String(get(draft, 'models.agyModel') ?? 'agy-default')} effort={String(get(draft, 'models.agyEffort') ?? 'high')} onModel={(value) => set('models.agyModel', value)} onEffort={(value) => set('models.agyEffort', value)} />
            <p className="mt-2 text-[11px] text-ink-faint">Antigravity reports tokens, not dollars: goals on it keep time, attempt and concurrency limits, never a USD budget. No presets, no fallback order: an unknown model fails the session outright.</p>
          </div>
          <div id="models-claude" data-provider="claude" role="region" aria-label="Claude Code models" hidden={modelProvider !== 'claude'}>
          <ModelPresetsSection draft={draft} set={set as (p: `models.${string}`, v: unknown) => void} known={known} reloadModels={loadModels} />
          <div className="border-t border-line mt-5 pt-4 mb-3">
            <SectionTitle>Other models</SectionTitle>
          </div>
          {grid(
            <>
              <Setting path="models.cheap">
                {model('models.cheap')}
              </Setting>
              <Setting path="models.fallbacks">
                {list('models.fallbacks', 'opus, sonnet, haiku')}
              </Setting>
              <div className="sm:col-span-2">
                <Toggle path="models.escalateLastAttempt" />
              </div>
            </>,
          )}
          <p className="text-[11px] text-ink-faint mt-3">The list is what this machine has seen resolve (family aliases follow the latest release through Claude Code; a full model id pins a version). A new family is one custom entry away — after its first session it shows up here with its resolved id. Preset changes reach running goals too, at their next session.</p>
          </div>
          <div className="border-t border-line mt-4 pt-4">
            <div className="text-sm font-bold text-ink mb-3">Limits — what one session may spend before the engine stops it</div>
            {grid(
              <>
                <Setting path="sessions.attemptMaxCostUsd">
                  {num('sessions.attemptMaxCostUsd', { min: 0.5, max: 500, step: 0.5 })}
                </Setting>
                <Setting path="sessions.attemptTimeoutMin">
                  {num('sessions.attemptTimeoutMin', { min: 5, max: 240 })}
                </Setting>
                <Setting path="workflow.investigationMaxCostUsd">
                  {num('workflow.investigationMaxCostUsd', { min: 0.5, max: 50, step: 0.5 })}
                </Setting>
                <Setting path="workflow.investigationMaxMinutes">
                  {num('workflow.investigationMaxMinutes', { min: 5, max: 120 })}
                </Setting>
                <Setting path="sessions.maxContinuations">
                  {num('sessions.maxContinuations', { min: 0, max: 5 })}
                </Setting>
                <Setting path="sessions.attemptMaxTurns">
                  {num('sessions.attemptMaxTurns', { min: 10, max: 2000 })}
                </Setting>
                <Setting path="engine.concurrency">
                  <Select value={draft.engine.concurrency} onChange={(e) => set('engine.concurrency', e.target.value)}>
                    <option value="fixed">Fixed — the number below</option>
                    <option value="auto">Auto — from this computer</option>
                  </Select>
                  {view.concurrency && <p className="mt-1 text-[11px] text-ink-faint">{concurrencyNote(view.concurrency)}</p>}
                </Setting>
                <Setting path="engine.maxConcurrent">
                  {num('engine.maxConcurrent', { min: 1, max: 16 })}
                </Setting>
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
      )}

      {open === 'skills' && (
        <Card id="skills" title={<SettingsTitle id="skills">Skills<HelpLink to="settings#skills" className="ml-1.5" /></SettingsTitle>} className="scroll-mt-16">
          <div className="space-y-4">
            <div>
              <ProviderSelector value={modelProvider} onChange={setModelProvider} />
              <p className="mt-1 text-[11px] text-ink-faint">Installation status and actions target the selected agent. Workflow pack choices are shared by both agents.</p>
            </div>
            {grid(
              <>
                {modelProvider === 'claude' && <Setting path="workflow.settingSources">
                  {list('workflow.settingSources', 'user, project')}
                </Setting>}
              </>,
            )}
            <Toggle path="workflow.mcpDynamicTools" />
            {modelProvider === 'claude' && <Toggle path="workflow.leanSessions" />}
            <Toggle path="workflow.autoskills" />
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
            {packBlock('workflow.designPack')}
            {packBlock('workflow.imagePack', 'image')}
            {packBlock('workflow.videoPack', 'video')}
            {view?.values.beta.figure && packBlock('workflow.figurePack', 'figure', true)}
            {view?.values.beta.diagram && packBlock('workflow.diagramPack', 'diagram', true)}
            {view?.values.beta.deck && packBlock('workflow.deckPack', 'deck', true)}
          </div>
        </Card>
      )}

      {open === 'git' && (
        <Card id="git" title={<SettingsTitle id="git">Git &amp; delivery<HelpLink to="settings#git--delivery" className="ml-1.5" /></SettingsTitle>} className="scroll-mt-16">
          <div className="space-y-3">
            <Toggle path="sync.fetchBeforeGoal" />
            {grid(
              <>
              <Setting path="sync.startFrom">
                <Select value={draft.sync.startFrom} onChange={(e) => set('sync.startFrom', e.target.value)}>
                  <option value="auto">auto — remote tip when local is behind</option>
                  <option value="local">always the local branch</option>
                </Select>
              </Setting>
              <Setting path="delivery.commitAuthor">
                <Select value={draft.delivery.commitAuthor} onChange={(e) => set('delivery.commitAuthor', e.target.value)}>
                  <option value="you-coauthor">you, with Foundry as co-author</option>
                  <option value="you">you only</option>
                  <option value="foundry">Foundry only</option>
                </Select>
              </Setting>
              </>,
            )}
            <Toggle path="sync.refreshBetweenTasks" />
            <Toggle path="delivery.updateLocalBase" />
            <div id="deploy-places" className="pt-1 space-y-2">
              <div className="text-sm font-bold text-ink">Deploy — where a finished goal goes</div>
              <p className="text-[11px] text-ink-faint">Each place is a card: open it for its fields and where each value comes from. The tokens and keys are kept by the engine only and never handed to a coding session; a place with nothing filled in stays off the goal's Deploy card.</p>
              <div className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-faint pt-1">Web hosts — a web page or an all-in-one web app, a preview address unless you ask for production</div>
              <div className="space-y-2">
                <PlaceCard id="vercel" logo={siVercel} name="Vercel" tagline="Builds the source itself; takes a folder of pages, a built site or a full-stack web framework." status={placeStatus(['delivery.vercelToken'])} open={placeOpen.has('vercel')} onToggle={() => togglePlace('vercel')} tool={<ToolNote>Runs through npx — vercel is fetched on first use; nothing to install.</ToolNote>} toolDone={null} access={<TokenLinks where={[{ label: 'vercel.com → Account Settings → Tokens', href: 'https://vercel.com/account/tokens', note: 'make a token scoped to the team you deploy to' }]} />}>
                  <Setting path="delivery.vercelToken">
                    {secret('delivery.vercelToken', 'vcp_…')}
                  </Setting>
                  <Setting path="delivery.vercelScope">
                    {text('delivery.vercelScope', 'my-team', true)}
                  </Setting>
                </PlaceCard>
                <PlaceCard id="netlify" logo={siNetlify} name="Netlify" tagline="Builds here with Netlify's own build, then uploads; takes the same web apps as Vercel." status={placeStatus(['delivery.netlifyToken'])} open={placeOpen.has('netlify')} onToggle={() => togglePlace('netlify')} tool={<ToolNote>Runs through npx — netlify-cli is fetched on first use; nothing to install.</ToolNote>} toolDone={null} access={<SignInPanel place="netlify" label="Netlify" onSignedIn={refreshView} where={<TokenLinks lead="Or make a token on" where={[{ label: 'app.netlify.com → User settings → Applications', href: 'https://app.netlify.com/user/applications#personal-access-tokens', note: 'Personal access tokens → New access token' }]} />} />}>
                  <Setting path="delivery.netlifyToken">
                    {secret('delivery.netlifyToken', 'nfp_…')}
                  </Setting>
                  <Setting path="delivery.netlifyTeam">
                    {text('delivery.netlifyTeam', 'my-team', true)}
                  </Setting>
                </PlaceCard>
                <PlaceCard id="cloudflare" logo={siCloudflarepages} name="Cloudflare Pages" tagline="Gets the files built here, so static sites only; a server-rendered app goes to Vercel or Netlify." status={placeStatus(['delivery.cloudflareToken', 'delivery.cloudflareAccountId'])} open={placeOpen.has('cloudflare')} onToggle={() => togglePlace('cloudflare')} tool={<ToolNote>Runs through npx — wrangler is fetched on first use; nothing to install.</ToolNote>} toolDone={null} access={<TokenLinks where={[{ label: 'dash.cloudflare.com → My Profile → API Tokens', href: 'https://dash.cloudflare.com/profile/api-tokens', note: 'Create Token with the permission Cloudflare Pages: Edit' }, { label: 'dash.cloudflare.com → the account', href: 'https://dash.cloudflare.com/', note: 'the account id is on the overview page, under API' }]} />}>
                  <Setting path="delivery.cloudflareToken">
                    {secret('delivery.cloudflareToken', 'API token')}
                  </Setting>
                  <Setting path="delivery.cloudflareAccountId">
                    {text('delivery.cloudflareAccountId', '0123abcd…', true)}
                  </Setting>
                </PlaceCard>
              </div>
              <div className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-faint pt-2">Platforms — the whole project, backend and workers included, a preview beside production</div>
              <p className="text-[11px] text-ink-faint">A goal with a Dockerfile, or a stack the platform builds itself (Node.js, Python, Go, Ruby, Rust, Elixir). The runtime variables kept on the goal's card go to the platform's own store first.</p>
              <div className="space-y-2">
                <PlaceCard id="fly" logo={siFlydotio} name="Fly.io" tagline="Dockerfiles only, built remotely; a preview app beside the production app. flyctl must be installed on this computer." status={placeStatus(['delivery.flyToken'])} open={placeOpen.has('fly')} onToggle={() => togglePlace('fly')} tool={<FlyctlRow onState={setFlyInstalled} />} toolDone={flyInstalled} access={<SignInPanel place="fly" label="Fly.io" onSignedIn={refreshView} where={<TokenLinks lead="Or make a token on" where={[{ label: 'fly.io → the organization → Tokens', href: 'https://fly.io/dashboard', note: 'an org token; or run `fly tokens create deploy -x 9999h` for one app' }]} />} />}>
                  <Setting path="delivery.flyToken">
                    {secret('delivery.flyToken', 'FlyV1 …')}
                  </Setting>
                  <Setting path="delivery.flyOrg">
                    {text('delivery.flyOrg', 'personal', true)}
                  </Setting>
                  <Setting path="delivery.flyRegion">
                    {text('delivery.flyRegion', 'iad')}
                  </Setting>
                </PlaceCard>
                <PlaceCard id="railway" logo={siRailway} name="Railway" tagline="Builds from the stack itself or a Dockerfile; a preview environment of the same project beside production." status={placeStatus(['delivery.railwayToken'])} open={placeOpen.has('railway')} onToggle={() => togglePlace('railway')} tool={<ToolNote>Runs through npx — the Railway CLI is fetched on first use; nothing to install.</ToolNote>} toolDone={null} access={<TokenLinks where={[{ label: 'railway.com → Account settings → Tokens', href: 'https://railway.com/account/tokens', note: 'an account token or a workspace token, not a project token (it cannot make a project)' }]} />}>
                  <Setting path="delivery.railwayToken">
                    {secret('delivery.railwayToken', 'token')}
                  </Setting>
                  <Setting path="delivery.railwayWorkspace">
                    {text('delivery.railwayWorkspace', 'my-workspace', true)}
                  </Setting>
                </PlaceCard>
                <PlaceCard id="render" logo={siRender} name="Render" tagline="Deploys the repository's branch from GitHub (its GitHub app must be allowed on the repository); a preview service beside production." status={placeStatus(['delivery.renderApiKey'])} open={placeOpen.has('render')} onToggle={() => togglePlace('render')} tool={<ToolNote>Reached through Render’s API — nothing to install. Render’s GitHub app must be allowed on the repositories it deploys.</ToolNote>} toolDone={null} access={<TokenLinks where={[{ label: 'dashboard.render.com → Account Settings → API Keys', href: 'https://dashboard.render.com/u/settings#api-keys', note: 'Create API Key' }, { label: 'Render → connect GitHub', href: 'https://github.com/apps/render/installations/new', note: 'allow Render\'s GitHub app on the repositories it may deploy' }]} />}>
                  <Setting path="delivery.renderApiKey">
                    {secret('delivery.renderApiKey', 'rnd_…')}
                  </Setting>
                  <Setting path="delivery.renderOwner">
                    {text('delivery.renderOwner', 'tea-…', true)}
                  </Setting>
                  <Setting path="delivery.renderRegion">
                    <Select value={draft.delivery.renderRegion} onChange={(e) => set('delivery.renderRegion', e.target.value)}>
                      {['oregon', 'ohio', 'virginia', 'frankfurt', 'singapore'].map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </Select>
                  </Setting>
                  <Setting path="delivery.renderPlan">
                    <Select value={draft.delivery.renderPlan} onChange={(e) => set('delivery.renderPlan', e.target.value)}>
                      {['free', 'starter', 'standard', 'pro', 'pro plus', 'pro max', 'pro ultra'].map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </Select>
                  </Setting>
                </PlaceCard>
              </div>
              <div className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-faint pt-2">Stores — an Expo app, built in the cloud by EAS, to TestFlight and Google Play</div>
              <p className="text-[11px] text-ink-faint">EAS holds the signing; Foundry never sees a certificate or a keystore. iOS lands in TestFlight (Foundry never submits for review); Android is an APK to install for a preview, or Google Play's production track for production.</p>
              <div className="space-y-2">
                <PlaceCard id="expo" logo={siExpo} name="Expo EAS" tagline="The builds themselves, for both stores: every EAS command runs with this token." status={placeStatus(['delivery.expoToken'])} open={placeOpen.has('expo')} onToggle={() => togglePlace('expo')} tool={<ToolNote>Runs through npx — eas-cli is fetched on first use; nothing to install.</ToolNote>} toolDone={null} access={<TokenLinks where={[{ label: 'expo.dev → Account settings → Access tokens', href: 'https://expo.dev/settings/access-tokens', note: 'Create token' }]} />}>
                  <Setting path="delivery.expoToken">
                    {secret('delivery.expoToken', 'token')}
                  </Setting>
                </PlaceCard>
                <PlaceCard id="appstore" logo={siAppstore} name="App Store Connect" tagline="The upload to TestFlight and the watch on the review; needs the Expo EAS card too." status={placeStatus(['delivery.ascKeyId', 'delivery.ascIssuerId', 'delivery.ascKey'])} open={placeOpen.has('appstore')} onToggle={() => togglePlace('appstore')} tool={<ToolNote>Through Expo EAS (the card above) — nothing more to install.</ToolNote>} toolDone={null} access={<TokenLinks where={[{ label: 'App Store Connect → Users and Access → Integrations → App Store Connect API', href: 'https://appstoreconnect.apple.com/access/integrations/api', note: 'generate a key with the App Manager role; the issuer id is above the list, the key id in the row, the .p8 downloads once' }]} />}>
                  <Setting path="delivery.ascKeyId">
                    {text('delivery.ascKeyId', 'ABC123DEFG', true)}
                  </Setting>
                  <Setting path="delivery.ascIssuerId">
                    {text('delivery.ascIssuerId', '12345678-aaaa-bbbb-cccc-1234567890ab', true)}
                  </Setting>
                  <Setting path="delivery.ascKey" className="sm:col-span-2">
                    {secretText('delivery.ascKey', '-----BEGIN PRIVATE KEY-----\n…')}
                  </Setting>
                </PlaceCard>
                <PlaceCard id="play" logo={siGoogleplay} name="Google Play" tagline="The production submit only (a preview APK needs none); needs the Expo EAS card too." status={placeStatus(['delivery.playServiceAccount'])} open={placeOpen.has('play')} onToggle={() => togglePlace('play')} tool={<ToolNote>Through Expo EAS (the card above) — nothing more to install.</ToolNote>} toolDone={null} access={<TokenLinks where={[{ label: 'Google Cloud → IAM → Service accounts', href: 'https://console.cloud.google.com/iam-admin/serviceaccounts', note: 'a service account → Keys → Add key → JSON' }, { label: 'Play Console → Users and permissions', href: 'https://play.google.com/console/', note: 'invite the service account\'s email with release rights to the app' }]} />}>
                  <Setting path="delivery.playServiceAccount" className="sm:col-span-2">
                    {secretText('delivery.playServiceAccount', '{ "type": "service_account", … }')}
                  </Setting>
                </PlaceCard>
              </div>
            </div>
            <div className="pt-1 space-y-2" data-setting="delivery.servers">
              <div className="flex items-center gap-2">
                <div className="text-sm font-bold text-ink">{wordsOf('delivery.servers').label}</div>
                <span className="ml-auto flex items-center gap-1.5">
                  <Aside path="delivery.servers" />
                </span>
              </div>
              <p className="text-[11px] text-ink-faint">{wordsOf('delivery.servers').help}</p>
              <DeployServers servers={draft.delivery.servers} secrets={view.secrets} savedIds={view.values.delivery.servers.map((s) => s.id)} onChange={(next) => set('delivery.servers', next)} />
            </div>
            <details id="delivery-timings" className="pt-1">
              <summary className="text-xs font-semibold text-ink-soft hover:text-ink cursor-pointer">Delivery timings (advanced)</summary>
              <div className="mt-3">
                {grid(
                  <>
                    <Setting path="delivery.pollSec">
                      {num('delivery.pollSec', { min: 5, max: 600 })}
                    </Setting>
                    <Setting path="delivery.noChecksGraceSec">
                      {num('delivery.noChecksGraceSec', { min: 0, max: 3600 })}
                    </Setting>
                    <Setting path="delivery.checksTimeoutMin">
                      {num('delivery.checksTimeoutMin', { min: 1, max: 720 })}
                    </Setting>
                    <Setting path="delivery.automergeWaitMin">
                      {num('delivery.automergeWaitMin', { min: 1, max: 720 })}
                    </Setting>
                    <Setting path="delivery.storePollMin">
                      {num('delivery.storePollMin', { min: 1, max: 1440 })}
                    </Setting>
                  </>,
                )}
              </div>
            </details>
          </div>
        </Card>
      )}

      {open === 'tools' && (
        <Card id="tools" title={<SettingsTitle id="tools">Tools &amp; keys<HelpLink to="settings#tools--keys" className="ml-1.5" /></SettingsTitle>} className="scroll-mt-16">
          <div className="space-y-3">
            <Toggle path="tools.useGraphify" />
            <div className="pt-1 space-y-2">
              <div className="text-sm font-bold text-ink">Keys — the services a skill may call</div>
              <p className="text-[11px] text-ink-faint">Each service is a card: open it for its key and where to make one. A key is handed to the coding sessions that need it, as the environment variable its field names, and applies to the next session; a saved key is never shown again. None of them signs the coding agent in: Codex keeps running on ChatGPT, an image key does not move it to the API.</p>
              <div className="space-y-2">
                <PlaceCard id="openai" logo={{ Icon: Sparkles, hex: '10A37F', title: 'OpenAI' }} name="OpenAI-compatible" tagline="Real images from the image packs, and anything else that speaks the OpenAI API; a proxy or another provider through the base URL." status={placeStatus(['tools.openaiApiKey'])} open={placeOpen.has('openai')} onToggle={() => togglePlace('openai')} access={<TokenLinks where={[{ label: 'platform.openai.com → API keys', href: 'https://platform.openai.com/api-keys', note: 'Create new secret key' }]} />}>
                  <Setting path="tools.openaiApiKey">{secret('tools.openaiApiKey', 'sk-…')}</Setting>
                  <Setting path="tools.openaiBaseUrl">{text('tools.openaiBaseUrl', 'https://api.openai.com/v1', true)}</Setting>
                </PlaceCard>
                <PlaceCard id="gemini" logo={siGooglegemini} name="Gemini" tagline="Pictures through Gemini for the claude-image-gen pack, which uses it by default; its OpenAI mode uses the key above." status={placeStatus(['tools.geminiApiKey'])} open={placeOpen.has('gemini')} onToggle={() => togglePlace('gemini')} access={<TokenLinks where={[{ label: 'aistudio.google.com → Get API key', href: 'https://aistudio.google.com/app/apikey', note: 'Create API key' }]} />}>
                  <Setting path="tools.geminiApiKey">{secret('tools.geminiApiKey', 'AIza…')}</Setting>
                </PlaceCard>
                <PlaceCard id="kimi" logo={siKimi} name="Kimi (Moonshot)" tagline="Kimi's sponsored models, where a design skill calls them." status={placeStatus(['tools.kimiApiKey'])} open={placeOpen.has('kimi')} onToggle={() => togglePlace('kimi')} access={<TokenLinks where={[{ label: 'platform.moonshot.ai → API Keys', href: 'https://platform.moonshot.ai/console/api-keys', note: 'Create API key' }]} />}>
                  <Setting path="tools.kimiApiKey">{secret('tools.kimiApiKey', 'sk-…')}</Setting>
                </PlaceCard>
                <PlaceCard id="minimax" logo={siMinimax} name="MiniMax" tagline="Video and narration through mmx-cli; saved where mmx reads it too." status={placeStatus(['tools.minimaxApiKey'])} open={placeOpen.has('minimax')} onToggle={() => togglePlace('minimax')} access={<TokenLinks where={[{ label: 'platform.minimax.io → API keys', href: 'https://platform.minimax.io/user-center/basic-information/interface-key', note: 'Create new secret key — or sign in once with mmx auth login on this computer and leave the field empty' }]} />}>
                  <Setting path="tools.minimaxApiKey">{secret('tools.minimaxApiKey', 'sk-cp-… or sk-api-…')}</Setting>
                </PlaceCard>
                <PlaceCard id="elevenlabs" logo={siElevenlabs} name="ElevenLabs" tagline="Narration voices for web-video-presentation." status={placeStatus(['tools.elevenlabsApiKey'])} open={placeOpen.has('elevenlabs')} onToggle={() => togglePlace('elevenlabs')} access={<TokenLinks where={[{ label: 'elevenlabs.io → Developers → API keys', href: 'https://elevenlabs.io/app/settings/api-keys', note: 'Create API key' }]} />}>
                  <Setting path="tools.elevenlabsApiKey">{secret('tools.elevenlabsApiKey', 'sk_…')}</Setting>
                </PlaceCard>
                <PlaceCard id="groq" logo={{ Icon: AudioLines, hex: 'F55036', title: 'Groq' }} name="Groq" tagline="Captions: hyperframes transcribes locally and falls back to Groq (or the OpenAI key) when the audio is too noisy." status={placeStatus(['tools.groqApiKey'])} open={placeOpen.has('groq')} onToggle={() => togglePlace('groq')} access={<TokenLinks where={[{ label: 'console.groq.com → API Keys', href: 'https://console.groq.com/keys', note: 'Create API Key' }]} />}>
                  <Setting path="tools.groqApiKey">{secret('tools.groqApiKey', 'gsk_…')}</Setting>
                </PlaceCard>
              </div>
            </div>
            {grid(
              <Setting path="tools.markitdownBin">
                {text('tools.markitdownBin', 'markitdown', true)}
              </Setting>,
            )}
            <CodeServerInstall />
          </div>
        </Card>
      )}

      {open === 'preview' && (
        <Card id="preview" title={<SettingsTitle id="preview">Preview &amp; self-check<HelpLink to="settings#preview--self-check" className="ml-1.5" /></SettingsTitle>} className="scroll-mt-16">
          <div className="space-y-3">
            <p className="text-xs text-ink-faint">At a milestone, and on request from a goal's page, the engine starts the goal's dev server in its progress folder and links you to it. With the self-check on, it also opens that preview in headless Chromium after every task lands, takes a screenshot and fails the goal's must checks on console or network errors.</p>
            {grid(
              <>
                <Setting path="preview.portFrom">
                  {num('preview.portFrom', { min: 1024, max: 65535 })}
                </Setting>
                <Setting path="preview.portTo">
                  {num('preview.portTo', { min: 1024, max: 65535 })}
                </Setting>
                <Setting path="preview.idleMinutes">
                  {num('preview.idleMinutes', { min: 5, max: 1440 })}
                </Setting>
              </>,
            )}
            <Toggle path="checks.selfCheck" />
            <PlaywrightInstall />
          </div>
        </Card>
      )}

      {open === 'notifications' && (
        <Card id="notifications" title={<SettingsTitle id="notifications">Notifications<HelpLink to="settings#notifications" className="ml-1.5" /></SettingsTitle>} className="scroll-mt-16">
          <div className="space-y-4">
            <p className="text-xs text-ink-faint">Get pinged outside the app the moment a goal needs you or finishes. Each channel is a card: every enabled event goes to every channel that is set up, and a card with nothing filled in stays off.</p>
            <div className="space-y-2">
              <PlaceCard id="telegram" logo={siTelegram} name="Telegram" tagline="Messages from a bot of your own, with buttons that answer." status={placeStatus(['notifications.telegramBotToken', 'notifications.telegramChatId'])} open={placeOpen.has('telegram')} onToggle={() => togglePlace('telegram')} access={<TokenLinks lead="Make a bot with" where={[{ label: '@BotFather in Telegram', href: 'https://t.me/BotFather', note: '/newbot gives the token; then send your bot any message and press Detect below for the chat id' }]} />}>
                <Setting path="notifications.telegramBotToken">{secret('notifications.telegramBotToken', '123456:ABC-DEF…')}</Setting>
                <Setting path="notifications.telegramChatId">
                  <div className="flex gap-1">
                    <Input className="mono" value={(get(draft, 'notifications.telegramChatId') as string | null) ?? ''} placeholder="123456789" onChange={(e) => set('notifications.telegramChatId', e.target.value === '' ? null : e.target.value)} />
                    <Button size="sm" variant="ghost" className="shrink-0" disabled={busy || (!get(draft, 'notifications.telegramBotToken') && !view.secrets['notifications.telegramBotToken']?.set)} onClick={() => detectChatId(draft.notifications.telegramBotToken)} title="Asks Telegram which chat last messaged your bot and fills in its id">
                      Detect
                    </Button>
                  </div>
                </Setting>
                <Toggle path="notifications.telegramActions" className="sm:col-span-2" />
              </PlaceCard>
              <PlaceCard id="discord" logo={siDiscord} name="Discord" tagline="Messages into a channel through its webhook; a bot of yours adds the buttons." status={placeStatus(['notifications.discordWebhookUrl'])} open={placeOpen.has('discord')} onToggle={() => togglePlace('discord')} access={<ul className="space-y-0.5 text-ink-soft"><li>In your channel: Settings → Integrations → Webhooks → New Webhook, then copy its URL.</li><li>For the buttons, a bot token from <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer" className="font-semibold text-work-ink hover:underline">discord.com/developers</a> (your application → Bot); invite that bot to the channel.</li></ul>}>
                <Setting path="notifications.discordWebhookUrl">{secret('notifications.discordWebhookUrl', 'https://discord.com/api/webhooks/…')}</Setting>
                <Setting path="notifications.discordBotToken">{secret('notifications.discordBotToken', 'MTIz…')}</Setting>
              </PlaceCard>
              <PlaceCard id="tailscale" logo={siTailscale} name="Tailscale" tagline="Links on your tailnet in every message, so Foundry and the previews open on your phone." status={draft.notifications.tailscale === 'auto' ? 'set' : 'unset'} statusWord={draft.notifications.tailscale === 'auto' ? 'Auto' : 'Off'} open={placeOpen.has('tailscale')} onToggle={() => togglePlace('tailscale')}>
                <Setting path="notifications.tailscale">
                  <Select value={draft.notifications.tailscale} onChange={(e) => set('notifications.tailscale', e.target.value)}>
                    <option value="auto">auto — when Tailscale runs here</option>
                    <option value="off">off</option>
                  </Select>
                </Setting>
                <Setting path="notifications.tailscaleHost">{text('notifications.tailscaleHost', 'my-mac.tailnet-123.ts.net', true)}</Setting>
              </PlaceCard>
            </div>
            {grid(
              <Setting path="notifications.baseUrl">
                {text('notifications.baseUrl', 'http://192.168.1.20:4111', true)}
              </Setting>,
            )}
            <div className="space-y-2">
              <Toggle path="notifications.onEscalation" />
              <Toggle path="notifications.onInterview" />
              <Toggle path="notifications.onBriefReady" />
              <Toggle path="notifications.onSchedule" />
              <Toggle path="notifications.onGoalFinished" />
              <Toggle path="notifications.onDelivery" />
              <Toggle path="notifications.onRateLimit" />
              <Toggle path="notifications.onUpdateAvailable" />
            </div>
            <div id="notify-test" className="flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => sendTestNotification({ telegramBotToken: draft.notifications.telegramBotToken, telegramChatId: draft.notifications.telegramChatId, discordWebhookUrl: draft.notifications.discordWebhookUrl, discordBotToken: draft.notifications.discordBotToken })} title="Sends a test message with the values above (saved or not)">
                Send test message
              </Button>
              {notifMsg && <span className={cn('text-[11px] font-semibold', TONE_INK[toneOf(notifMsg)])}>{notifMsg}</span>}
            </div>
          </div>
        </Card>
      )}

      {open === 'access' && <AccessCard />}
      {open === 'safety' && (
        <Card id="safety" title={<SettingsTitle id="safety">Safety<HelpLink to="settings#safety" className="ml-1.5" /></SettingsTitle>} className="scroll-mt-16">
          {grid(
            <>
              <Setting path="safety.extraBoundaryPatterns">
                {text('safety.extraBoundaryPatterns', 'terraform apply|kubectl', true)}
              </Setting>
              <Setting path="safety.allowedRoots">
                {list('safety.allowedRoots', '/Users/you/Projects')}
              </Setting>
            </>,
          )}
          <div className="mt-3">
            <Toggle path="safety.desktopApps" />
          </div>
        </Card>
      )}

      {open === 'beta' && (
        <Card id="beta" title={<SettingsTitle id="beta">Beta<HelpLink to="settings#beta" className="ml-1.5" /></SettingsTitle>} className="scroll-mt-16">
          <p className="mb-3 text-xs text-ink-faint">Features on trial: each one stays off until you switch it on, while it settles.</p>
          <Toggle path="beta.conversation" />
          <Toggle path="beta.motionStudio" />
          <Toggle path="beta.deck" />
          <Toggle path="beta.diagram" />
          <Toggle path="beta.figure" />
          <Toggle path="beta.editor" />
          <Toggle path="beta.adjust" />
        </Card>
      )}

      {open === 'engine' && (
        <Card id="engine" title={<SettingsTitle id="engine">Engine (install)<HelpLink to="settings#engine-install" className="ml-1.5" /></SettingsTitle>} className="scroll-mt-16">
          {/* the data folder (ADR-0082) is not a Setting: Settings live inside it */}
          <div id="data-folder" className="mb-4">
            <DataFolder />
          </div>
          {/* an earlier Foundry on this computer, moved here (ADR-0107) */}
          <div id="move" className="mb-4">
            <MoveCard variant="settings" />
          </div>
          {grid(
            <>
              <Setting path="engine.port">
                {num('engine.port', { min: 1, max: 65535 })}
              </Setting>
              <Setting path="engine.host">
                {text('engine.host')}
              </Setting>
              <Field label="Default coding agent" help="Default for new goals in this data directory. Choose any coding agent on New goal; existing goals keep theirs.">
                {/* the coding agent in its own colour and icon, as everywhere it is named */}
                <div className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm font-semibold', agent.chip)}>
                  <agent.Icon size={14} strokeWidth={2} aria-hidden="true" />
                  {PROVIDER_LABEL[draft.engine.provider]}
                </div>
              </Field>
              {<>
                <Setting path="engine.codexBin">{text('engine.codexBin', 'codex', true)}</Setting>
                <Setting path="engine.codexHome">{text('engine.codexHome', '~/.codex', true)}</Setting>
                <Setting path="engine.agyBin">{text('engine.agyBin', 'agy', true)}</Setting>
              </>}<><Setting path="engine.claudeBin">
                {text('engine.claudeBin', 'claude', true)}
              </Setting>
              <Setting path="engine.claudeHome">
                {text('engine.claudeHome', '~/.claude', true)}
              </Setting></>
              <Setting path="engine.workspacesRoot">
                {text('engine.workspacesRoot', '/Users/you/Foundry', true)}
              </Setting>
            </>,
          )}
        </Card>
      )}

      {open === 'appearance' && <AppearanceCard />}

      {open === 'about' && (
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
      )}
      <UpdateDialog open={updOpen} onClose={() => setUpdOpen(false)} status={upd} />
        </div>
      </div>
    </div>
    </SettingsControlsProvider>
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
    <div id="code-server" className="text-xs text-ink-soft space-y-2 border-t border-line pt-3">
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
    <div id="playwright" className="text-xs text-ink-soft space-y-2">
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
