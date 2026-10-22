import { AGENT_PROVIDERS } from '@foundry/core/browser';
import type { DoctorReport, SkillsOverview } from '@foundry/engine/skills-types';
import { Box, Check, CheckCircle2, CircleAlert, CircleDashed, Layers, ListChecks, Scissors, Workflow, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api as baseApi, apiForProvider, awaitSkillOp, type AgentProvider } from '../api.ts';
import { ProviderSelector } from '../components/ProviderSelector.tsx';
import { GitHubSignInDialog } from '../components/GitHubSignInDialog.tsx';
import { SignInDialog } from '../components/SignInDialog.tsx';
import { LiveLog } from './LiveLog.tsx';
import { IconTitle } from './settings/sections.tsx';
import { BOARD_ROW, Board, Button, CODES, Card, CopyButton, Empty, PageHeader, cn } from '../ui.tsx';

/** the required checks that fail when a sign-in is missing: signing in is yours to do, so they wait in yellow, not red */
const SIGN_IN_CHECKS = ['claude-auth', 'codex-auth', 'agy-auth'];

/** Per-entry status of a catalog bundle + one-click install/adopt. */
function BundleStatus({ provider, bundle, busy, onInstall }: { provider: AgentProvider; bundle: string; busy: string | null; onInstall: () => void }) {
  const api = apiForProvider(provider);
  const [entries, setEntries] = useState<SkillsOverview['catalog'] | null>(null);
  useEffect(() => {
    api
      .skills()
      .then((o) => setEntries(o.catalog.filter((c) => c.entry.bundle === bundle)))
      .catch(() => setEntries([]));
  }, [bundle, busy]);
  if (!entries) return <div className="text-xs text-work-ink">checking…</div>;
  const missing = entries.filter((c) => c.status === 'missing' || c.status === 'partial');
  const loose = entries.filter((c) => c.status === 'installed-unmanaged');
  const viaPlugin = entries.filter((c) => c.status === 'installed-via-plugin');
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {entries.map((c) => (
          <span key={c.entry.id} className="inline-flex max-w-full items-center gap-1 rounded-sm bg-sunken px-1.5 py-0.5 text-[11px] ring-1 ring-inset ring-line">
            {/* installed: solid green · a loose copy (installed, not by Foundry): hollow green · missing, not set: hollow grey */}
            <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', c.status === 'installed' || c.status === 'installed-via-plugin' ? 'bg-ok' : c.status === 'installed-unmanaged' ? 'ring-1 ring-inset ring-ok' : 'ring-1 ring-inset ring-ink-faint')} />
            <span className="mono min-w-0 truncate text-ink" title={c.entry.name}>{c.entry.name}</span>
            <span className="text-ink-faint">{c.status === 'installed-via-plugin' ? 'plugin' : c.status === 'installed' ? 'Foundry' : c.status === 'installed-unmanaged' ? 'loose copy' : 'missing'}</span>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {missing.length + loose.length > 0 ? (
          <Button size="sm" variant="primary" disabled={busy !== null} onClick={onInstall}>
            {busy === 'bundle' ? 'Working…' : `Install ${missing.length} missing${loose.length ? ` · adopt ${loose.length} loose` : ''}`}
          </Button>
        ) : (
          <span className="font-semibold text-ok-ink">bundle complete{viaPlugin.length ? ` · ${viaPlugin.length} via plugin` : ''}</span>
        )}
        <Link to={`/skills?provider=${provider}`} className="inline-flex items-center underline text-ink-soft hover:text-ink max-sm:min-h-8">
          details on Extensions →
        </Link>
      </div>
    </div>
  );
}

export function SetupPage() {
  const [params, setParams] = useSearchParams();
  const rawProvider = params.get('provider');
  const provider: AgentProvider | null = AGENT_PROVIDERS.find((p) => p === rawProvider) ?? null;
  useEffect(() => {
    if (provider) return;
    let alive = true;
    const select = (value: AgentProvider) => alive && setParams((current) => {
      if (AGENT_PROVIDERS.some((p) => p === current.get('provider'))) return current;
      const next = new URLSearchParams(current);
      next.set('provider', value);
      return next;
    }, { replace: true });
    void baseApi.settings().then((view) => select(view.values.engine.provider)).catch(() => select('claude'));
    return () => { alive = false; };
  }, [provider, setParams]);
  if (!provider) return <Empty>Loading setup…</Empty>;
  return <div className="max-w-6xl mx-auto px-3 sm:px-4 md:px-6 pt-6 md:pt-9 pb-16 space-y-4">
    <PageHeader title="Setup" summary="Check the selected backend, sign in and install its recommended skills. Your project code is not changed." />
    <ProviderSelector value={provider} onChange={(id) => setParams((current) => { const next = new URLSearchParams(current); next.set('provider', id); return next; }, { replace: true })} />
    <SetupChecks key={provider} provider={provider} />
  </div>;
}

function SetupChecks({ provider }: { provider: AgentProvider }) {
  const api = apiForProvider(provider);
  const [report, setReport] = useState<DoctorReport | null>(null);
  /** a bundle install streaming on its own channel (text-to-cad's warm-up takes minutes) */
  const [bundleLog, setBundleLog] = useState<{ title: string; channel: string; status: 'running' | 'ok' | 'failed' } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [signIn, setSignIn] = useState(false);
  const [ghSignIn, setGhSignIn] = useState(false);
  /** id of the tool whose install is streaming (shows the log card + polls the doctor) */
  const [installLog, setInstallLog] = useState<string | null>(null);
  const load = () => api.doctor().then(setReport).catch((e) => setMsg(e.message));
  // while a tool install streams, poll the doctor so the check flips when it finishes
  useEffect(() => {
    if (!installLog) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [installLog]);
  useEffect(() => {
    load();
  }, []);

  const runAction = async (label: string, fn: () => Promise<string>) => {
    setBusy(label);
    setMsg(null);
    try {
      setMsg(await fn());
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(null);
      load();
    }
  };
  const installOne = async (id: string) => {
    setBusy(id);
    try {
      const r = await api.installSkill(id);
      setMsg(r.manual ? `run yourself: ${r.manual.command}` : `${r.name} installed`);
    } catch (e: any) {
      setMsg(e.body?.manual ? `run yourself: ${e.body.manual.command}` : e.message);
    } finally {
      setBusy(null);
      load();
    }
  };

  if (!report) return <Empty>{msg ?? 'Checking your environment…'}</Empty>;
  const errors = report.checks.filter((c) => !c.ok && c.severity === 'error');
  const cadTools = report.checks.find((c) => c.id === 'cad-tools');

  return (
    <div className="space-y-4">
      {/* where setup stands, on a plain panel: its tile and thin left edge green when everything is in place, yellow while
          it is incomplete (fixing it is yours to do); the failing checks themselves say red or yellow below */}
      <div className={cn('rounded-lg bg-panel p-4 flex items-center gap-3 inset-ring inset-ring-line', report.ok ? 'shadow-[inset_4px_0_0_var(--color-ok)]' : 'shadow-[inset_4px_0_0_var(--color-you)]')}>
        <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', report.ok ? 'bg-ok text-on-ok' : 'bg-you text-on-you')} aria-hidden="true">
          {report.ok ? <Check size={18} strokeWidth={2.5} /> : <CircleAlert size={18} strokeWidth={2.5} />}
        </span>
        <div className="flex-1 text-[15px] font-bold text-ink">
          {report.ok ? 'Everything is in place. ' : `${errors.length} thing${errors.length === 1 ? '' : 's'} to fix before goals can run well. `}
          {report.ok && (
            <Link to={`/goals/new?provider=${provider}`} className="underline underline-offset-2">
              Create your first goal →
            </Link>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={load}>
          Re-run
        </Button>
      </div>

      {/* the checks as a checklist: passed in green, failing in red; a missing sign-in, and a warning that needs you, in
          yellow; an optional or recommended extra is only not set yet, so hollow and grey */}
      <Board id="checks" icon={<ListChecks size={14} aria-hidden="true" />} title="Checks" count={report.checks.length}>
          {report.checks.map((c) => (
            <li key={c.id} className={cn(BOARD_ROW, 'px-4 md:px-5 py-3 flex gap-3')}>
              <div className="mt-0.5">{c.ok ? <CheckCircle2 size={16} className="text-ok-ink" /> : c.severity === 'warn' ? (/\((optional|recommended)\)$/.test(c.label) ? <CircleDashed size={16} className="text-ink-faint" /> : <CircleAlert size={16} className="text-you-ink" />) : SIGN_IN_CHECKS.includes(c.id) ? <CircleAlert size={16} className="text-you-ink" /> : <XCircle size={16} className="text-bad-ink" />}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-ink">{c.label}</div>
                <div className="text-xs text-ink-faint mt-0.5 break-words">{c.detail}</div>
                {!c.ok && c.fix && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                    {['claude-auth', 'codex-auth'].includes(c.id) && (
                      <Button size="sm" variant="primary" onClick={() => setSignIn(true)}>
                        Sign in
                      </Button>
                    )}
                    {c.id === 'agy-auth' && <span className="text-ink-soft">Run it in a terminal and sign in with your Google account; this check turns green afterwards.</span>}
                    {c.id === 'gh-auth' && (
                      <Button size="sm" variant="primary" onClick={() => setGhSignIn(true)}>
                        Sign in
                      </Button>
                    )}
                    {c.fix.installId && c.fix.action === 'install-tool' && (
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={busy !== null}
                        onClick={() =>
                          runAction(c.fix!.installId!, async () => {
                            setInstallLog(c.fix!.installId!);
                            await api.installTool(c.fix!.installId!);
                            await new Promise((r) => setTimeout(r, 1000));
                            return `Installing ${c.fix!.installId} — output below; this check turns green when it finishes.`;
                          })
                        }
                      >
                        {busy === c.fix.installId ? 'Starting…' : installLog === c.fix.installId ? 'Running…' : 'Install'}
                      </Button>
                    )}
                    {c.fix.installId && c.fix.action !== 'install-tool' && (
                      <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => installOne(c.fix!.installId!)}>
                        {busy === c.fix.installId ? 'Installing…' : 'Install'}
                      </Button>
                    )}
                    {c.fix.action === 'trash-shadows' && c.fix.names && (
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={busy !== null}
                        onClick={() =>
                          runAction('shadows', async () => {
                            const r = await api.cleanupShadows(c.fix!.names!);
                            const skipped = r.skipped.map((s) => `${s.name} (${s.reason})`).join(', ');
                            return `${r.trashed.length} stale cop${r.trashed.length === 1 ? 'y' : 'ies'} moved to the trash${skipped ? `; skipped ${skipped}` : ''}`;
                          })
                        }
                      >
                        {busy === 'shadows' ? 'Cleaning…' : `Trash ${c.fix.names.length} stale copies`}
                      </Button>
                    )}
                    {c.fix.action === 'install-markitdown' && (
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={busy !== null}
                        onClick={() =>
                          runAction('markitdown', async () => {
                            setInstallLog('markitdown');
                            await api.installMarkitdown();
                            // the install streams to the live channel; re-run the doctor when it settles
                            await new Promise((r) => setTimeout(r, 1500));
                            return 'Installing markitdown — output below. The check turns green when it finishes.';
                          })
                        }
                      >
                        {busy === 'markitdown' ? 'Starting…' : 'Install markitdown'}
                      </Button>
                    )}
                    {c.fix.action === 'check-updates' && (
                      <Link to={`/skills?provider=${provider}`} className="inline-flex items-center underline text-ink max-sm:min-h-8">
                        open Skills
                      </Link>
                    )}
                    {c.fix.command && (
                      <span className="mono break-all bg-sunken ring-1 ring-inset ring-line rounded px-2 py-1 text-ink">
                        {c.fix.command} <CopyButton text={c.fix.command} />
                      </span>
                    )}
                    {c.fix.url && !c.fix.action && (
                      <a className="inline-flex items-center underline text-ink-soft hover:text-ink max-sm:min-h-8" href={c.fix.url} target="_blank" rel="noreferrer">
                        docs
                      </a>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
      </Board>

      {installLog && (
        <Card title={`Installing ${installLog}`} actions={<Button size="sm" variant="ghost" onClick={() => { setInstallLog(null); load(); }}>close</Button>}>
          <LiveLog attemptId="tool-install" className="max-h-64" />
          <p className="text-[11px] text-ink-faint mt-2">{installLog === 'markitdown' ? 'First install downloads Python 3.12 and the converters (1–3 min). Existing attachments can be converted afterwards with "retry" on the Goal page.' : 'Runs the documented install command on this machine; the check above re-runs every few seconds until it passes.'}</p>
        </Card>
      )}
      {msg && <div className="rounded-md border border-line bg-sunken px-3 py-2 text-xs text-ink whitespace-pre-wrap">{msg}</div>}

      <Card title={<IconTitle icon={Workflow} ink={CODES[0].ink}>Development workflow — Matt Pocock's engineering skills</IconTitle>}>
        <p className="text-xs text-ink-soft mb-3">
          Foundry's roles follow this workflow: workers use <span className="mono">tdd</span> for features and refactors and <span className="mono">diagnosing-bugs</span> for bugs, the merger follows built-in conflict-resolution instructions, and the goal reviewer applies <span className="mono">code-review</span>'s two axes. {provider === 'codex' ? 'Codex reads native SKILL.md instructions. Skill invocation telemetry is unavailable; reviews assess the work and tests instead of treating missing telemetry as a skipped skill.' : provider === 'agy' ? 'Antigravity reads skills only from a workspace: Foundry installs them in ~/.agents/skills (shared with Codex and the skills CLI) and links them into each goal\'s workspace. Skill invocation telemetry is unavailable; reviews assess the work and tests instead.' : <>The engine records which skills each session invoked. Skills provided by the <span className="mono">mattpocock-skills</span> plugin are used as-is; others are installed from the catalog.</>}
        </p>
        <BundleStatus provider={provider} bundle="mattpocock" busy={busy} onInstall={() => runAction('bundle', async () => {
          const op = await awaitSkillOp(api, (await api.installBundle('mattpocock')).op);
          return op.summary ?? op.status;
        })} />
      </Card>

      <Card title={<IconTitle icon={Layers} ink={CODES[2].ink}>Workflow suite — pstack</IconTitle>}>
        <p className="text-xs text-ink-soft mb-3">
          A second suite a goal can run on (<span className="mono">Powered by</span> on the New goal form): a bug fix that starts from the failing test, <span className="mono">deslop</span> before a task is handed back, <span className="mono">thermo-nuclear-review</span> for the final review, non-interactive conflict resolution and a technical-writing standard. Foundry keeps one pinned release as its own copy, without the plugin's hooks; Claude loads it per session, Codex and Antigravity get the skills linked into the goal's workspace. Roles pstack has no skill for keep Matt Pocock's.
        </p>
        <BundleStatus provider={provider} bundle="pstack" busy={busy} onInstall={() => runAction('bundle', async () => {
          const op = await awaitSkillOp(api, (await api.installBundle('pstack')).op);
          return op.summary ?? op.status;
        })} />
      </Card>

      <Card title={<IconTitle icon={Scissors} ink={CODES[3].ink}>Less code — Ponytail</IconTitle>}>
        <p className="text-xs text-ink-soft mb-3">
          The lazy senior dev: before writing, a worker checks whether the code needs to exist, whether the repository, the standard library or an installed dependency already has it, and only then writes the smallest complete change. The planner plans the same way, and <span className="mono">ponytail-review</span> reviews each task and the whole goal (the code a change touches, not only the diff). Every goal has a Ponytail switch, on by default; TDD still decides how tests are written. The optional audit at the end of a goal uses <span className="mono">ponytail-audit</span>.
        </p>
        <BundleStatus provider={provider} bundle="ponytail" busy={busy} onInstall={() => runAction('bundle', async () => {
          const op = await awaitSkillOp(api, (await api.installBundle('ponytail')).op);
          return op.summary ?? op.status;
        })} />
      </Card>

      {/* the bundles told apart by colour; text-to-cad in the teal of CAD goals on the New goal page */}
      <Card title={<IconTitle icon={Box} ink={CODES[5].ink}>3D models — text-to-cad (CAD)</IconTitle>}>
        <p className="text-xs text-ink-soft mb-2 max-w-3xl">
          Parts and assemblies as STEP (STL, 3MF and GLB on request), engineering drawings, DXF cut profiles, URDF/SRDF/SDF robot files, printability and manufacturability checks, headless slicing: skills and a <span className="mono">cad</span> viewer server from{' '}
          <a className="underline" href="https://github.com/earthtojake/text-to-cad" target="_blank" rel="noreferrer">earthtojake/text-to-cad</a> (MIT). Goals get the <span className="mono">cad</span> nature; code goals use the same skills in their CAD tasks.
        </p>
        {provider !== 'agy' && <ul className="text-xs text-ink-faint mb-3 max-w-3xl list-disc pl-4 space-y-0.5">
          <li>Needs uv: the CAD kernel (cadgen) runs through it. The line below says whether it is on this computer.</li>
          <li>Install adds the plugin for this coding agent, allows its <span className="mono">cad</span> server for sessions (its telemetry switch and page-only tools stay out of reach) and downloads the CAD runtime once (Python 3.13 and OpenCASCADE, a few hundred MB); the progress shows here and the page can be left meanwhile.</li>
          <li>Sessions run cadgen with usage statistics and update checks off; your own use of text-to-cad keeps its settings. Hand-offs to Bambu Connect, Bambu Studio or OrcaSlicer's window stay off until Settings → Safety → Desktop apps &amp; printers is on.</li>
        </ul>}
        {cadTools && provider !== 'agy' && (
          // the mark says how it stands: uv found, a green tick; not found is only not there yet (CAD is optional), hollow
          <p className="text-xs mb-3 text-ink-soft">
            {cadTools.ok ? <CheckCircle2 size={13} className="mr-1 inline align-[-2px] text-ok-ink" aria-hidden="true" /> : <CircleDashed size={13} className="mr-1 inline align-[-2px] text-ink-faint" aria-hidden="true" />}
            {cadTools.detail}
            {cadTools.fix?.command ? (
              <>
                {' '}— <span className="mono break-all bg-sunken ring-1 ring-inset ring-line rounded px-2 py-1 text-ink">{cadTools.fix.command} <CopyButton text={cadTools.fix.command} /></span>
              </>
            ) : null}
          </p>
        )}
        {provider === 'agy' ? (
          <p className="text-xs text-work-ink">Not available for Antigravity: text-to-cad comes as a plugin with its own server, and agy takes neither from Foundry. CAD goals run on Claude Code or Codex.</p>
        ) : (
        <BundleStatus provider={provider} bundle="text-to-cad" busy={busy} onInstall={() => runAction('bundle', async () => {
          const opId = `cad-${Date.now().toString(36)}`;
          setBundleLog({ title: 'text-to-cad', channel: `skills-op:${opId}`, status: 'running' });
          const op = await awaitSkillOp(api, (await api.installBundle('text-to-cad', opId)).op);
          setBundleLog({ title: 'text-to-cad', channel: op.channel, status: op.status });
          return op.summary ?? op.status;
        })} />
        )}
        {bundleLog && (
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <span className={cn('text-xs font-semibold', bundleLog.status === 'failed' ? 'text-bad-ink' : bundleLog.status === 'ok' ? 'text-ok-ink' : 'text-work-ink')} role="status">
                {bundleLog.status === 'running' ? `Installing ${bundleLog.title}…` : bundleLog.status === 'ok' ? `${bundleLog.title} installed` : `${bundleLog.title}: install failed`}
              </span>
              <Button size="sm" variant="ghost" onClick={() => { setBundleLog(null); load(); }}>close</Button>
            </div>
            <LiveLog attemptId={bundleLog.channel} className="max-h-64" />
          </div>
        )}
      </Card>

      <p className="text-xs text-ink-faint">
        Design / image / video skill packs are chosen in <Link to={`/settings?provider=${provider}#skills`} className="underline">Settings → Skills</Link>; the full catalog and installed skills for this backend are managed on the <Link to={`/skills?provider=${provider}`} className="underline">Skills page</Link> (missing required skills also show up in the Checks above).
      </p>
      {ghSignIn && (
        <GitHubSignInDialog
          onClose={() => {
            setGhSignIn(false);
            load();
          }}
        />
      )}
      {signIn && (
        <SignInDialog
          provider={provider}
          onClose={() => {
            setSignIn(false);
            load();
          }}
        />
      )}
    </div>
  );
}
