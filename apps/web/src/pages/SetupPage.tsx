import type { DoctorReport, SkillsOverview } from '@foundry/engine/skills-types';
import { CheckCircle2, CircleAlert, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.ts';
import { SignInDialog } from '../components/SignInDialog.tsx';
import { DesignPacks } from '../components/DesignPacks.tsx';
import { LiveLog } from './LiveLog.tsx';
import { Button, Card, CopyButton, Empty, cn } from '../ui.tsx';

/** Per-entry status of a catalog bundle + one-click install/adopt. */
function BundleStatus({ bundle, busy, onInstall }: { bundle: string; busy: string | null; onInstall: () => void }) {
  const [entries, setEntries] = useState<SkillsOverview['catalog'] | null>(null);
  useEffect(() => {
    api
      .skills()
      .then((o) => setEntries(o.catalog.filter((c) => c.entry.bundle === bundle)))
      .catch(() => setEntries([]));
  }, [bundle, busy]);
  if (!entries) return <div className="text-xs text-zinc-500">checking…</div>;
  const missing = entries.filter((c) => c.status === 'missing' || c.status === 'partial');
  const loose = entries.filter((c) => c.status === 'installed-unmanaged');
  const viaPlugin = entries.filter((c) => c.status === 'installed-via-plugin');
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {entries.map((c) => (
          <span key={c.entry.id} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950/50 px-1.5 py-0.5 text-[11px]">
            <span className={cn('h-1.5 w-1.5 rounded-full', c.status === 'installed' || c.status === 'installed-via-plugin' ? 'bg-emerald-400' : c.status === 'installed-unmanaged' ? 'bg-amber-400' : 'bg-zinc-600')} />
            <span className="mono text-zinc-200">{c.entry.name}</span>
            <span className="text-zinc-500">{c.status === 'installed-via-plugin' ? 'plugin' : c.status === 'installed' ? 'Foundry' : c.status === 'installed-unmanaged' ? 'loose copy' : 'missing'}</span>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {missing.length + loose.length > 0 ? (
          <Button size="sm" variant="primary" disabled={busy !== null} onClick={onInstall}>
            {busy === 'bundle' ? 'Working…' : `Install ${missing.length} missing${loose.length ? ` · adopt ${loose.length} loose` : ''}`}
          </Button>
        ) : (
          <span className="text-emerald-300">bundle complete{viaPlugin.length ? ` · ${viaPlugin.length} via plugin` : ''}</span>
        )}
        <Link to="/skills" className="underline text-zinc-400">
          details on Skills →
        </Link>
      </div>
    </div>
  );
}

export function SetupPage() {
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [signIn, setSignIn] = useState(false);
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

  const installAll = async (tiers: ('required' | 'recommended')[]) => {
    setBusy(tiers.join('+'));
    setMsg(null);
    try {
      const r = await api.installTier(tiers);
      const manual = r.results.filter((x) => x.manual);
      setMsg(`${r.results.filter((x) => x.ok).length}/${r.results.length} satisfied${manual.length ? ` — run yourself: ${manual.map((m) => m.manual!.command).join(' ; ')}` : ''}`);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(null);
      load();
    }
  };
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

  return (
    <div className="max-w-6xl mx-auto p-3 sm:p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Setup</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Foundry drives the Claude Code already installed on this machine. This page checks everything it needs and installs the recommended skills for you. Nothing here touches your code.
        </p>
      </div>
      <div className={cn('rounded-lg border p-4 flex items-center gap-3', report.ok ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-rose-500/40 bg-rose-500/5')}>
        {report.ok ? <CheckCircle2 className="text-emerald-400" /> : <XCircle className="text-rose-400" />}
        <div className="flex-1 text-sm">
          {report.ok ? 'Everything is in place. ' : `${errors.length} thing${errors.length === 1 ? '' : 's'} to fix before goals can run well. `}
          {report.ok && (
            <Link to="/goals/new" className="underline text-emerald-300">
              Create your first goal →
            </Link>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={load}>
          Re-run
        </Button>
      </div>

      <Card title="Checks">
        <div className="divide-y divide-zinc-800">
          {report.checks.map((c) => (
            <div key={c.id} className="py-2.5 flex gap-3">
              <div className="mt-0.5">{c.ok ? <CheckCircle2 size={16} className="text-emerald-400" /> : c.severity === 'warn' ? <CircleAlert size={16} className="text-amber-400" /> : <XCircle size={16} className="text-rose-400" />}</div>
              <div className="flex-1">
                <div className="text-sm text-zinc-100">{c.label}</div>
                <div className="text-xs text-zinc-400 mt-0.5">{c.detail}</div>
                {!c.ok && c.fix && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                    {c.id === 'claude-auth' && (
                      <Button size="sm" variant="primary" onClick={() => setSignIn(true)}>
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
                            return `${r.trashed.length} stale cop${r.trashed.length === 1 ? 'y' : 'ies'} moved to the trash`;
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
                      <Link to="/skills" className="underline text-zinc-300">
                        open Skills
                      </Link>
                    )}
                    {c.fix.command && (
                      <span className="mono bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-zinc-200">
                        {c.fix.command} <CopyButton text={c.fix.command} />
                      </span>
                    )}
                    {c.fix.url && !c.fix.action && (
                      <a className="underline text-zinc-400" href={c.fix.url} target="_blank" rel="noreferrer">
                        docs
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {installLog && (
        <Card title={`Installing ${installLog}`} actions={<Button size="sm" variant="ghost" onClick={() => { setInstallLog(null); load(); }}>close</Button>}>
          <LiveLog attemptId="tool-install" className="max-h-64" />
          <p className="text-[11px] text-zinc-500 mt-2">{installLog === 'markitdown' ? 'First install downloads Python 3.12 and the converters (1–3 min). Existing attachments can be converted afterwards with "retry" on the Goal page.' : 'Runs the documented install command on this machine; the check above re-runs every few seconds until it passes.'}</p>
        </Card>
      )}
      {msg && <div className="rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-200 whitespace-pre-wrap">{msg}</div>}

      <Card title="Development workflow — Matt Pocock's engineering skills">
        <p className="text-xs text-zinc-400 mb-3">
          Foundry's roles follow this workflow: workers invoke <span className="mono">tdd</span> for features and refactors and <span className="mono">diagnosing-bugs</span> for bugs, the merger uses <span className="mono">resolving-merge-conflicts</span>, the goal reviewer applies <span className="mono">code-review</span>'s two axes. The engine records which skills each session invoked. Skills provided by the <span className="mono">mattpocock-skills</span> plugin are used as-is; others are installed from the catalog.
        </p>
        <BundleStatus bundle="mattpocock" busy={busy} onInstall={() => runAction('bundle', async () => {
          const r = await api.installBundle('mattpocock');
          return r.results.map((x) => `${x.action}: ${x.name} — ${x.detail}`).join('\n');
        })} />
      </Card>

      <Card title="Design skills — for UI tasks">
        <p className="text-xs text-zinc-400 mb-3">
          Tasks the Brief labels <span className="mono">frontend</span> or <span className="mono">fullstack</span> hand the worker one design skill set as a MUST (and the goal reviewer its review counterpart). Pick the set here; only the chosen one is ever shown to sessions. Project skills for the repository's stack are installed separately by <span className="mono">autoskills</span> when a goal starts (toggle in Settings).
        </p>
        <DesignPacks onInstallStarted={(id) => setInstallLog(`design pack ${id}`)} />
      </Card>

      <Card title="Skills">
        <p className="text-xs text-zinc-400 mb-3">The catalog marks a few skills as required or recommended for Foundry's roles. Install them in one click; manage everything else on the Skills page.</p>
        <div className="flex gap-2 items-center">
          <Button variant="primary" disabled={busy !== null} onClick={() => installAll(['required'])}>
            {busy === 'required' ? 'Installing…' : 'Install all required'}
          </Button>
          <Button disabled={busy !== null} onClick={() => installAll(['required', 'recommended'])}>
            {busy === 'required+recommended' ? 'Installing…' : 'Install required + recommended'}
          </Button>
          <Link to="/skills" className="text-xs underline text-zinc-400 ml-auto">
            Open Skills →
          </Link>
        </div>

      </Card>
      {signIn && (
        <SignInDialog
          onClose={() => {
            setSignIn(false);
            load();
          }}
        />
      )}
    </div>
  );
}
