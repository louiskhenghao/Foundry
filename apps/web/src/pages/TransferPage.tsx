import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownToLine, ArrowUpFromLine, FolderOpen } from 'lucide-react';
import { api, transferDownloadUrl, type GoalRow, type ImportReport, type IncomingGoal, type IncomingReport, type SecretsPreview, type TransferCategories } from '../api.ts';
import { FolderPicker } from '../components/FolderPicker.tsx';
import { Badge, Button, ButtonGroup, CODES, Card, Input, PageHeader, buttonClass, cn } from '../ui.tsx';
import { HelpLink } from './HelpPage.tsx';
import { IconTitle } from './settings/sections.tsx';

const fmtBytes = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function Check({ checked, onChange, disabled, children }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; children: ReactNode }) {
  return (
    <label className={cn('flex items-start gap-2 text-sm', disabled ? 'text-ink-faint opacity-60' : 'text-ink cursor-pointer')}>
      <input type="checkbox" className="mt-1" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

/** Transfer (ADR-0030): carry settings, keys and goals to another Foundry, or bring them in from one */
export function TransferPage() {
  return (
    <div className="max-w-4xl mx-auto px-3 sm:px-4 md:px-6 pt-6 md:pt-9 pb-16 space-y-4">
      <PageHeader title="Transfer" help={<HelpLink to="moving-to-a-new-computer" label="Moving to a new computer (new tab)" />} summary="Carry your settings, keys and goals to another Foundry — typically on a new computer — or bring them in from one." />
      {/* the two ways, out of this Foundry and into it, each an arrow in a category colour of its own */}
      <Card title={<IconTitle icon={ArrowUpFromLine} ink={CODES[0].ink}>Export</IconTitle>}>
        <ExportPanel />
      </Card>
      <Card title={<IconTitle icon={ArrowDownToLine} ink={CODES[5].ink}>Import</IconTitle>}>
        <ImportPanel />
      </Card>
    </div>
  );
}

/** "follows X": shown when the goal it follows would not come along */
function followNote(follows: { goalId: string; title: string } | null, chosen: Set<string>, known: Set<string>, onAdd?: (id: string) => void) {
  if (!follows || chosen.has(follows.goalId)) return null;
  return (
    <span className="text-[11px] text-work-ink">
      follows “{follows.title}”{known.has(follows.goalId) ? ', not selected' : ', not in this file'}
      {known.has(follows.goalId) && onAdd && (
        <button className="ml-1 font-semibold underline" onClick={() => onAdd(follows.goalId)}>
          add it
        </button>
      )}
    </span>
  );
}

export function ExportPanel({ initialGoals }: { initialGoals?: GoalRow[] }) {
  const [cats, setCats] = useState<Required<TransferCategories>>({ settings: true, secrets: false, goals: true, transcripts: false, templates: false });
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
  const problem = !cats.settings && !cats.secrets && !cats.goals && !cats.templates ? 'Tick at least one of Settings, Keys & secrets, Goals or Templates & themes.' : cats.goals && which === 'pick' && !picked.size ? 'Choose at least one goal.' : cats.secrets && !pw ? 'Keys & secrets need a password.' : cats.secrets && pw !== pw2 ? 'The two passwords differ.' : null;
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
      <p className="text-xs text-ink-faint">Write a Transfer file to import on another computer. Nothing here changes: your goals carry on as they are.</p>
      <div className="space-y-1.5">
        <Check checked={cats.settings} onChange={(v) => set('settings', v)}>
          Settings <span className="text-ink-faint text-xs">— everything in Settings except Engine (install), link addresses, tool paths, allowed folders and preview ports, which belong to this computer</span>
        </Check>
        <Check checked={cats.secrets} onChange={(v) => set('secrets', v)}>
          Keys & secrets <span className="text-ink-faint text-xs">— API keys, notification tokens and preview variables, sealed with a password</span>
        </Check>
        <Check checked={cats.goals} onChange={(v) => set('goals', v)}>
          Goals <span className="text-ink-faint text-xs">— with their attachments, and the branch of any goal whose work is not in its base branch yet</span>
        </Check>
        <div className="pl-6">
          <Check checked={cats.transcripts} disabled={!cats.goals} onChange={(v) => set('transcripts', v)}>
            Session transcripts <span className="text-ink-faint text-xs">— the full logs; they can be large</span>
          </Check>
        </div>
        <Check checked={cats.templates} onChange={(v) => set('templates', v)}>
          Templates & themes <span className="text-ink-faint text-xs">— the template files and theme files of your own; a file from Foundry itself travels with Foundry</span>
        </Check>
      </div>
      {cats.goals && (
        <div className="pl-6 space-y-2">
          <ButtonGroup label="Which goals" value={which} onChange={setWhich} options={[{ id: 'all', label: `All goals${goals ? ` (${goals.length})` : ''}` }, { id: 'pick', label: 'Choose goals' }]} />
          {which === 'pick' && (
            <div className="max-h-64 overflow-auto rounded-md border border-line bg-sunken divide-y divide-line">
              {(goals ?? []).map((g) => (
                <div key={g.id} className="px-2.5 py-1.5 flex items-center gap-2 flex-wrap">
                  <Check checked={picked.has(g.id)} onChange={(v) => toggle(g.id, v)}>
                    {g.title}
                  </Check>
                  <Badge state={g.state} />
                  {g.follows && followNote({ goalId: g.follows.goalId, title: g.follows.title }, picked, ids, (id) => toggle(id, true))}
                </div>
              ))}
              {goals && !goals.length && <div className="px-2.5 py-2 text-xs text-ink-faint">No goals yet.</div>}
            </div>
          )}
        </div>
      )}
      {cats.secrets && (
        <div className="pl-6 grid gap-2 sm:grid-cols-2 max-w-lg">
          <Input type="password" placeholder="Password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <Input type="password" placeholder="Repeat password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          <p className="text-[11px] text-ink-faint sm:col-span-2">You need it to import the Keys & secrets; Foundry cannot recover it.</p>
        </div>
      )}
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="primary" size="sm" disabled={busy || !!problem} onClick={run} title={problem ?? undefined}>
          {busy ? 'Writing…' : 'Export'}
        </Button>
        {problem && <span className="text-[11px] text-ink-faint">{problem}</span>}
        {done && (
          <span className="text-xs font-semibold text-ok-ink">
            ✔ {fmtBytes(done.bytes)}
            {cats.goals ? ` · ${done.goals} goal${done.goals === 1 ? '' : 's'}` : ''} ·{' '}
            <a className="underline" href={transferDownloadUrl(done.downloadId)}>
              download again
            </a>
          </span>
        )}
      </div>
      {err && <p className="text-xs text-bad-ink">✘ {err}</p>}
      <p className="text-[11px] text-ink-faint">
        Very large files (many transcripts) are easier from a terminal: <span className="mono">foundry export --transcripts</span>.
      </p>
    </div>
  );
}

const STATUS: Record<IncomingGoal['status'], string> = { new: '', here: 'already here', 'deleted-here': 'deleted here' };
/** a part of the import, labelled in small capitals */
const LABEL = 'text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-faint';
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
  const [bringTemplates, setBringTemplates] = useState(true);
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
        templates: bringTemplates,
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
      <p className="text-xs text-ink-faint">Bring in a Transfer file from another Foundry. It merges: goals already here are skipped, never replaced, and you choose which settings win.</p>
      {!report && (
        // a file field drawn as a button
        <label className={buttonClass('default', 'md', busy ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer')}>
          <input type="file" accept=".tgz,.gz,application/gzip" className="hidden" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          {busy ? 'Reading the file…' : 'Choose a Transfer file…'}
        </label>
      )}
      {report && (
        <div className="space-y-4">
          <p className="text-xs text-ink-soft">
            From <b className="text-ink">{report.hostname}</b>, Foundry <span className="mono">{report.release}</span>, written {new Date(report.exportedAt).toLocaleString()}.
          </p>

          {report.goals.length > 0 && (
            <div className="space-y-1.5">
              <div className={LABEL}>Goals</div>
              <div className="max-h-64 overflow-auto rounded-md border border-line bg-sunken divide-y divide-line">
                {report.goals.map((g) => (
                  <div key={g.id} className="px-2.5 py-1.5 flex items-center gap-2 flex-wrap">
                    <Check checked={goals.has(g.id)} disabled={g.status !== 'new'} onChange={(v) => toggle(g.id, v)}>
                      {g.title}
                    </Check>
                    <Badge state={g.state} />
                    {g.unfinished && g.status === 'new' && <span className="text-[11px] text-work-ink">unfinished — can be Reattached here</span>}
                    {g.status !== 'new' && <span className="text-[11px] text-ink-faint">{STATUS[g.status]}</span>}
                    {g.follows && !g.follows.here && followNote(g.follows, goals, inFile, (id) => toggle(id, true))}
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-ink-faint">Goals arrive as history: readable, and a base for Follow-ups. An unfinished one carries on once you Reattach it on its page.</p>
            </div>
          )}

          {report.repos.some((r) => r.goals.some((g) => goals.has(g))) && (
            <div className="space-y-1.5">
              <div className={LABEL}>Repositories</div>
              {report.repos
                .filter((r) => r.goals.some((g) => goals.has(g)))
                .map((r) => (
                  <div key={r.original} className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] sm:items-center text-xs">
                    <span className="mono text-ink-soft truncate" title={r.original}>
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
              <p className="text-[11px] text-ink-faint">The checkout of each repository on this computer. A path that already is the same repository is filled in.</p>
            </div>
          )}

          {report.settings.length > 0 && (
            <div className="space-y-1.5">
              <div className={LABEL}>Settings that differ</div>
              {report.settings.map((s) => (
                <div key={s.section} className="flex items-center gap-3 flex-wrap text-xs">
                  <span className="w-28 font-semibold text-ink">{s.section}</span>
                  <ButtonGroup label={`${s.section} settings`} value={sections[s.section] ?? 'imported'} onChange={(v) => setSections((m) => ({ ...m, [s.section]: v }))} options={[{ id: 'imported', label: 'Use imported' }, { id: 'mine', label: 'Keep mine' }]} />
                  <span className="mono text-ink-faint truncate">{s.keys.map((k) => k.slice(s.section.length + 1)).join(', ')}</span>
                </div>
              ))}
            </div>
          )}

          {((report.templates?.length ?? 0) > 0 || (report.themes?.length ?? 0) > 0) && (
            <div className="space-y-1.5">
              <div className={LABEL}>Templates & themes</div>
              <Check checked={bringTemplates} onChange={setBringTemplates}>
                Bring them in{' '}
                <span className="text-ink-faint text-xs">
                  — {[report.templates.length ? `${report.templates.length} template file${report.templates.length === 1 ? '' : 's'}` : '', report.themes.length ? `${report.themes.length} theme${report.themes.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ')}: {[...report.templates, ...report.themes].map((f) => f.name).join(', ')}
                </span>
              </Check>
              <p className="text-[11px] text-ink-faint">A file already here as written is skipped; one that clashes with a file here or with one of Foundry's gets a numbered name.</p>
            </div>
          )}

          {report.secrets && (
            <div className="space-y-1.5">
              <div className={LABEL}>Keys & secrets</div>
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
                          <span className="mono text-ink w-56 truncate">{k.key}</span>
                          <span className="mono text-ink-soft">{k.imported}</span>
                          {k.same ? (
                            <span className="text-ink-faint">same as here</span>
                          ) : k.mine ? (
                            <Check checked={keepMine.has(k.key)} onChange={(v) => setKeepMine((s) => (v ? new Set(s).add(k.key) : new Set([...s].filter((x) => x !== k.key))))}>
                              keep mine <span className="mono text-ink-faint">{k.mine}</span>
                            </Check>
                          ) : (
                            <span className="text-ink-faint">not set here</span>
                          )}
                        </div>
                      ))}
                      {secrets.previewEnv.map((e) => (
                        <div key={e.repo} className="text-ink-soft">
                          preview variables for <span className="mono">{e.repo}</span>: <span className="mono text-ink-faint">{e.keys.join(', ')}</span> <span className="text-ink-faint">(added beside the ones set here)</span>
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
      {err && <p className="text-xs text-bad-ink">✘ {err}</p>}
      {picking && <FolderPicker initial={repos[picking] || undefined} onPick={(p) => (setRepos((m) => ({ ...m, [picking]: p })), setPicking(null))} onClose={() => setPicking(null)} />}
    </div>
  );
}

export function ImportResult({ r }: { r: ImportReport }) {
  return (
    // done, on a plain box: the green words and a thin green edge, never a green panel
    <div className="rounded-md border border-line bg-sunken p-3 pl-4 text-xs space-y-1 break-words shadow-[inset_4px_0_0_var(--color-ok)]">
      <div className="font-bold text-ok-ink">✔ Imported {r.imported.length} goal{r.imported.length === 1 ? '' : 's'}</div>
      {r.imported.map((g) => (
        <div key={g.id}>
          <Link className="inline-flex items-center underline text-ink max-sm:min-h-8" to={`/goals/${g.id}`}>
            {g.title}
          </Link>
        </div>
      ))}
      {r.skipped.map((g) => (
        <div key={g.id} className="text-ink-faint">
          skipped “{g.title}” — {g.reason}
        </div>
      ))}
      {r.repos.map((m) => (
        <div key={m.original} className={m.error ? 'text-bad-ink' : 'text-ink-soft'}>
          {m.error ? `${m.original} not mapped: ${m.error}` : `${m.original} → ${m.to}`}
        </div>
      ))}
      {r.settings.length > 0 && <div className="text-ink-soft">settings changed: {r.settings.join(', ')}</div>}
      {r.secrets.length > 0 && <div className="text-ink-soft">keys brought in: {r.secrets.join(', ')}</div>}
      {(r.templates?.imported.length ?? 0) > 0 && <div className="text-ink-soft">templates brought in: {r.templates.imported.join(', ')}</div>}
      {(r.templates?.skipped.length ?? 0) > 0 && <div className="text-ink-faint">templates skipped: {r.templates.skipped.join(', ')}</div>}
      {(r.themes?.imported.length ?? 0) > 0 && <div className="text-ink-soft">themes brought in: {r.themes.imported.join(', ')}</div>}
      {(r.themes?.skipped.length ?? 0) > 0 && <div className="text-ink-faint">themes skipped: {r.themes.skipped.join(', ')}</div>}
      {r.previewEnv.waiting.length > 0 && <div className="text-ink-soft">preview variables wait until their repository is mapped: {r.previewEnv.waiting.join(', ')}</div>}
    </div>
  );
}
