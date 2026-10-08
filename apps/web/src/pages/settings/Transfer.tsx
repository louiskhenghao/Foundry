import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FolderOpen } from 'lucide-react';
import { api, transferDownloadUrl, type GoalRow, type ImportReport, type IncomingGoal, type IncomingReport, type SecretsPreview, type TransferCategories } from '../../api.ts';
import { FolderPicker } from '../../components/FolderPicker.tsx';
import { Badge, Button, ButtonGroup, Input, cn } from '../../ui.tsx';

const fmtBytes = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function Check({ checked, onChange, disabled, children }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; children: ReactNode }) {
  return (
    <label className={cn('flex items-start gap-2 text-sm', disabled ? 'text-zinc-600' : 'text-zinc-300 cursor-pointer')}>
      <input type="checkbox" className="mt-1 accent-emerald-500" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

/** Settings → Transfer (ADR-0030): carry settings, keys and goals to another Foundry, or bring them in from one */
export function TransferPanel() {
  return (
    <div className="space-y-6">
      <ExportPanel />
      <div className="border-t border-zinc-800" />
      <ImportPanel />
    </div>
  );
}

/** "follows X": shown when the goal it follows would not come along */
function followNote(follows: { goalId: string; title: string } | null, chosen: Set<string>, known: Set<string>, onAdd?: (id: string) => void) {
  if (!follows || chosen.has(follows.goalId)) return null;
  return (
    <span className="text-[11px] text-amber-300/90">
      follows “{follows.title}”{known.has(follows.goalId) ? ', not selected' : ', not in this file'}
      {known.has(follows.goalId) && onAdd && (
        <button className="ml-1 underline text-amber-200" onClick={() => onAdd(follows.goalId)}>
          add it
        </button>
      )}
    </span>
  );
}

export function ExportPanel({ initialGoals }: { initialGoals?: GoalRow[] }) {
  const [cats, setCats] = useState<Required<TransferCategories>>({ settings: true, secrets: false, goals: true, transcripts: false });
  const [goals, setGoals] = useState<GoalRow[] | null>(initialGoals ?? null);
  const [which, setWhich] = useState<'all' | 'pick'>('all');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ downloadId: string; bytes: number; goals: number } | null>(null);
  useEffect(() => {
    if (!initialGoals) api.goals().then(setGoals).catch(() => setGoals([]));
  }, []);
  const set = (k: keyof TransferCategories, v: boolean) => setCats((c) => ({ ...c, [k]: v, ...(k === 'goals' && !v ? { transcripts: false } : {}) }));
  const toggle = (id: string, on: boolean) => setPicked((p) => (on ? new Set(p).add(id) : new Set([...p].filter((x) => x !== id))));
  const ids = new Set((goals ?? []).map((g) => g.id));
  const problem = !cats.settings && !cats.secrets && !cats.goals ? 'Tick at least one of Settings, Keys & secrets or Goals.' : cats.goals && which === 'pick' && !picked.size ? 'Choose at least one goal.' : cats.secrets && !pw ? 'Keys & secrets need a password.' : cats.secrets && pw !== pw2 ? 'The two passwords differ.' : null;
  const run = async () => {
    setBusy(true);
    setErr(null);
    setDone(null);
    try {
      const r = await api.transferExport({ categories: cats, goalIds: which === 'all' ? 'all' : [...picked], ...(cats.secrets ? { password: pw } : {}) });
      setDone(r);
      const a = document.createElement('a');
      a.href = transferDownloadUrl(r.downloadId);
      a.click();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <div className="text-sm text-zinc-200 font-medium">Export</div>
      <p className="text-xs text-zinc-500">Write a Transfer file to import on another computer. Nothing here changes: your goals carry on as they are.</p>
      <div className="space-y-1.5">
        <Check checked={cats.settings} onChange={(v) => set('settings', v)}>
          Settings <span className="text-zinc-500 text-xs">— everything on this page except Engine (install), link addresses, tool paths, allowed folders and preview ports, which belong to this computer</span>
        </Check>
        <Check checked={cats.secrets} onChange={(v) => set('secrets', v)}>
          Keys & secrets <span className="text-zinc-500 text-xs">— API keys, notification tokens and preview variables, sealed with a password</span>
        </Check>
        <Check checked={cats.goals} onChange={(v) => set('goals', v)}>
          Goals <span className="text-zinc-500 text-xs">— with their attachments, and the branch of any goal whose work is not in its base branch yet</span>
        </Check>
        <div className="pl-6">
          <Check checked={cats.transcripts} disabled={!cats.goals} onChange={(v) => set('transcripts', v)}>
            Session transcripts <span className="text-zinc-500 text-xs">— the full logs; they can be large</span>
          </Check>
        </div>
      </div>
      {cats.goals && (
        <div className="pl-6 space-y-2">
          <ButtonGroup label="Which goals" value={which} onChange={setWhich} options={[{ id: 'all', label: `All goals${goals ? ` (${goals.length})` : ''}` }, { id: 'pick', label: 'Choose goals' }]} />
          {which === 'pick' && (
            <div className="max-h-64 overflow-auto rounded-md border border-zinc-800 divide-y divide-zinc-800/70">
              {(goals ?? []).map((g) => (
                <div key={g.id} className="px-2.5 py-1.5 flex items-center gap-2 flex-wrap">
                  <Check checked={picked.has(g.id)} onChange={(v) => toggle(g.id, v)}>
                    {g.title}
                  </Check>
                  <Badge state={g.state} />
                  {g.follows && followNote({ goalId: g.follows.goalId, title: g.follows.title }, picked, ids, (id) => toggle(id, true))}
                </div>
              ))}
              {goals && !goals.length && <div className="px-2.5 py-2 text-xs text-zinc-500">No goals yet.</div>}
            </div>
          )}
        </div>
      )}
      {cats.secrets && (
        <div className="pl-6 grid gap-2 sm:grid-cols-2 max-w-lg">
          <Input type="password" placeholder="Password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <Input type="password" placeholder="Repeat password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          <p className="text-[11px] text-zinc-500 sm:col-span-2">You need it to import the Keys & secrets; Foundry cannot recover it.</p>
        </div>
      )}
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="primary" size="sm" disabled={busy || !!problem} onClick={run} title={problem ?? undefined}>
          {busy ? 'Writing…' : 'Export'}
        </Button>
        {problem && <span className="text-[11px] text-zinc-500">{problem}</span>}
        {done && (
          <span className="text-xs text-emerald-300">
            ✔ {fmtBytes(done.bytes)}
            {cats.goals ? ` · ${done.goals} goal${done.goals === 1 ? '' : 's'}` : ''} ·{' '}
            <a className="underline" href={transferDownloadUrl(done.downloadId)}>
              download again
            </a>
          </span>
        )}
      </div>
      {err && <p className="text-xs text-rose-300">✘ {err}</p>}
      <p className="text-[11px] text-zinc-500">
        Very large files (many transcripts) are easier from a terminal: <span className="mono">foundry export --transcripts</span>.
      </p>
    </div>
  );
}

const STATUS: Record<IncomingGoal['status'], string> = { new: '', here: 'already here', 'deleted-here': 'deleted here' };
/** what an import starts from: every goal that is new here, each repository's matching checkout, the imported settings */
const newGoals = (r: IncomingReport | null) => new Set((r?.goals ?? []).filter((g) => g.status === 'new').map((g) => g.id));
const matchedRepos = (r: IncomingReport | null) => Object.fromEntries((r?.repos ?? []).map((x) => [x.original, x.match ?? '']));
const importedSections = (r: IncomingReport | null) => Object.fromEntries((r?.settings ?? []).map((s) => [s.section, 'imported' as const]));

export function ImportPanel({ initial }: { initial?: IncomingReport }) {
  const [report, setReport] = useState<IncomingReport | null>(initial ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<ImportReport | null>(null);
  const [goals, setGoals] = useState<Set<string>>(() => newGoals(initial ?? null));
  const [repos, setRepos] = useState<Record<string, string>>(() => matchedRepos(initial ?? null));
  const [picking, setPicking] = useState<string | null>(null);
  const [sections, setSections] = useState<Record<string, 'imported' | 'mine'>>(() => importedSections(initial ?? null));
  const [bring, setBring] = useState(true);
  const [pw, setPw] = useState('');
  const [secrets, setSecrets] = useState<SecretsPreview | null>(null);
  const [keepMine, setKeepMine] = useState<Set<string>>(new Set());
  const reset = (r: IncomingReport | null) => {
    setReport(r);
    setGoals(newGoals(r));
    setRepos(matchedRepos(r));
    setSections(importedSections(r));
    setSecrets(null);
    setPw('');
    setKeepMine(new Set());
  };
  const upload = async (file: File) => {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      reset(await api.transferUpload(file));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const unlock = async () => {
    if (!report) return;
    setErr(null);
    try {
      const s = await api.transferSecrets(report.uploadId, pw);
      setSecrets(s);
      setKeepMine(new Set());
    } catch (e: any) {
      setErr(e.message);
    }
  };
  const apply = async () => {
    if (!report) return;
    setBusy(true);
    setErr(null);
    try {
      const chosen = report.repos.filter((r) => r.goals.some((g) => goals.has(g)));
      const r = await api.transferApply(report.uploadId, {
        goals: [...goals],
        settings: sections,
        secrets: report.secrets && bring ? { password: pw, keepMine: [...keepMine] } : null,
        repos: Object.fromEntries(chosen.map((x) => [x.original, repos[x.original]?.trim() || null])),
      });
      setResult(r);
      setReport(null);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const discard = async () => {
    if (report) await api.transferDiscard(report.uploadId).catch(() => {});
    reset(null);
  };
  const inFile = useMemo(() => new Set((report?.goals ?? []).map((g) => g.id)), [report]);
  const toggle = (id: string, on: boolean) => setGoals((p) => (on ? new Set(p).add(id) : new Set([...p].filter((x) => x !== id))));
  const needsPassword = !!report?.secrets && bring && !secrets;

  return (
    <div className="space-y-3">
      <div className="text-sm text-zinc-200 font-medium">Import</div>
      <p className="text-xs text-zinc-500">Bring in a Transfer file from another Foundry. It merges: goals already here are skipped, never replaced, and you choose which settings win.</p>
      {!report && (
        <label className={cn('inline-flex items-center gap-2 rounded-md border border-zinc-700 px-3 py-1.5 text-sm', busy ? 'text-zinc-500' : 'text-zinc-200 cursor-pointer hover:border-zinc-500')}>
          <input type="file" accept=".tgz,.gz,application/gzip" className="hidden" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          {busy ? 'Reading the file…' : 'Choose a Transfer file…'}
        </label>
      )}
      {report && (
        <div className="space-y-4">
          <p className="text-xs text-zinc-400">
            From <b className="text-zinc-200">{report.hostname}</b>, Foundry <span className="mono">{report.release}</span>, written {new Date(report.exportedAt).toLocaleString()}.
          </p>

          {report.goals.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs uppercase tracking-wide text-zinc-500">Goals</div>
              <div className="max-h-64 overflow-auto rounded-md border border-zinc-800 divide-y divide-zinc-800/70">
                {report.goals.map((g) => (
                  <div key={g.id} className="px-2.5 py-1.5 flex items-center gap-2 flex-wrap">
                    <Check checked={goals.has(g.id)} disabled={g.status !== 'new'} onChange={(v) => toggle(g.id, v)}>
                      {g.title}
                    </Check>
                    <Badge state={g.state} />
                    {g.unfinished && g.status === 'new' && <span className="text-[11px] text-sky-300/90">unfinished — can be Reattached here</span>}
                    {g.status !== 'new' && <span className="text-[11px] text-zinc-500">{STATUS[g.status]}</span>}
                    {g.follows && !g.follows.here && followNote(g.follows, goals, inFile, (id) => toggle(id, true))}
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-zinc-500">Goals arrive as history: readable, and a base for Follow-ups. An unfinished one carries on once you Reattach it on its page.</p>
            </div>
          )}

          {report.repos.some((r) => r.goals.some((g) => goals.has(g))) && (
            <div className="space-y-1.5">
              <div className="text-xs uppercase tracking-wide text-zinc-500">Repositories</div>
              {report.repos
                .filter((r) => r.goals.some((g) => goals.has(g)))
                .map((r) => (
                  <div key={r.original} className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] sm:items-center text-xs">
                    <span className="mono text-zinc-400 truncate" title={r.original}>
                      {r.original}
                    </span>
                    <div className="flex gap-1.5 items-center min-w-0">
                      <Input className="mono text-xs" placeholder="leave unmapped (map it later on the goal's page)" value={repos[r.original] ?? ''} onChange={(e) => setRepos((m) => ({ ...m, [r.original]: e.target.value }))} />
                      <Button size="sm" variant="ghost" onClick={() => setPicking(r.original)} title="Choose the checkout of this repository on this computer">
                        <FolderOpen size={13} />
                      </Button>
                    </div>
                  </div>
                ))}
              <p className="text-[11px] text-zinc-500">The checkout of each repository on this computer. A path that already is the same repository is filled in.</p>
            </div>
          )}

          {report.settings.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs uppercase tracking-wide text-zinc-500">Settings that differ</div>
              {report.settings.map((s) => (
                <div key={s.section} className="flex items-center gap-3 flex-wrap text-xs">
                  <span className="w-28 text-zinc-300">{s.section}</span>
                  <ButtonGroup label={`${s.section} settings`} value={sections[s.section] ?? 'imported'} onChange={(v) => setSections((m) => ({ ...m, [s.section]: v }))} options={[{ id: 'imported', label: 'Use imported' }, { id: 'mine', label: 'Keep mine' }]} />
                  <span className="mono text-zinc-500 truncate">{s.keys.map((k) => k.slice(s.section.length + 1)).join(', ')}</span>
                </div>
              ))}
            </div>
          )}

          {report.secrets && (
            <div className="space-y-1.5">
              <div className="text-xs uppercase tracking-wide text-zinc-500">Keys & secrets</div>
              <Check checked={bring} onChange={setBring}>
                Bring Keys & secrets in
              </Check>
              {bring && (
                <div className="pl-6 space-y-2">
                  <div className="flex gap-2 max-w-md">
                    <Input type="password" placeholder="Password" autoComplete="off" value={pw} onChange={(e) => (setPw(e.target.value), setSecrets(null))} />
                    <Button size="sm" disabled={!pw} onClick={unlock}>
                      Unlock
                    </Button>
                  </div>
                  {secrets && (
                    <div className="space-y-1 text-xs">
                      {secrets.settings.map((k) => (
                        <div key={k.key} className="flex items-center gap-2 flex-wrap">
                          <span className="mono text-zinc-300 w-56 truncate">{k.key}</span>
                          <span className="mono text-zinc-400">{k.imported}</span>
                          {k.same ? (
                            <span className="text-zinc-500">same as here</span>
                          ) : k.mine ? (
                            <Check checked={keepMine.has(k.key)} onChange={(v) => setKeepMine((s) => (v ? new Set(s).add(k.key) : new Set([...s].filter((x) => x !== k.key))))}>
                              keep mine <span className="mono text-zinc-500">{k.mine}</span>
                            </Check>
                          ) : (
                            <span className="text-zinc-500">not set here</span>
                          )}
                        </div>
                      ))}
                      {secrets.previewEnv.map((e) => (
                        <div key={e.repo} className="text-zinc-400">
                          preview variables for <span className="mono">{e.repo}</span>: <span className="mono text-zinc-500">{e.keys.join(', ')}</span> <span className="text-zinc-500">(added beside the ones set here)</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="primary" size="sm" disabled={busy || needsPassword} onClick={apply} title={needsPassword ? 'Unlock the Keys & secrets first, or untick them' : undefined}>
              {busy ? 'Importing…' : 'Import'}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={discard}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {result && <ImportResult r={result} />}
      {err && <p className="text-xs text-rose-300">✘ {err}</p>}
      {picking && <FolderPicker initial={repos[picking] || undefined} onPick={(p) => (setRepos((m) => ({ ...m, [picking]: p })), setPicking(null))} onClose={() => setPicking(null)} />}
    </div>
  );
}

export function ImportResult({ r }: { r: ImportReport }) {
  return (
    <div className="rounded-md border border-emerald-900/60 bg-emerald-950/20 p-3 text-xs space-y-1">
      <div className="text-emerald-300">✔ Imported {r.imported.length} goal{r.imported.length === 1 ? '' : 's'}</div>
      {r.imported.map((g) => (
        <div key={g.id}>
          <Link className="underline text-zinc-200" to={`/goals/${g.id}`}>
            {g.title}
          </Link>
        </div>
      ))}
      {r.skipped.map((g) => (
        <div key={g.id} className="text-zinc-500">
          skipped “{g.title}” — {g.reason}
        </div>
      ))}
      {r.repos.map((m) => (
        <div key={m.original} className={m.error ? 'text-amber-300' : 'text-zinc-400'}>
          {m.error ? `${m.original} not mapped: ${m.error}` : `${m.original} → ${m.to}`}
        </div>
      ))}
      {r.settings.length > 0 && <div className="text-zinc-400">settings changed: {r.settings.join(', ')}</div>}
      {r.secrets.length > 0 && <div className="text-zinc-400">keys brought in: {r.secrets.join(', ')}</div>}
      {r.previewEnv.waiting.length > 0 && <div className="text-zinc-400">preview variables wait until their repository is mapped: {r.previewEnv.waiting.join(', ')}</div>}
    </div>
  );
}
