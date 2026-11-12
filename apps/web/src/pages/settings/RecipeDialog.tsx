import type { RecipeRun, ServerRecipe } from '@foundry/core/browser';
import { Loader2, ShieldAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.ts';
import { Button, CopyButton, Field, Input, Modal, Select, Textarea, ago, cn } from '../../ui.tsx';

/** the server a recipe runs on, as the dialog needs it */
export interface RecipeServer {
  id: string;
  name: string;
  host: string;
  user: string;
}

/** a secret that spans lines (a certificate, a key) gets a box; a password a masked field */
const multiline = (name: string) => /PEM|CERT|KEY$/.test(name);

/** the inputs a recipe starts with: its defaults, then what the caller prefilled (the project's domain, port, name) */
export function initialParams(recipe: ServerRecipe | null, prefill: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of recipe?.params ?? []) out[p.name] = prefill[p.name] ?? p.default ?? '';
  return out;
}

/**
 * A server recipe (ADR-0091) before it runs: which script, what its header says it changes, its inputs, and the whole
 * text to read — then one confirmation, and it runs over ssh as root on the server, its output shown here and kept in
 * the activity. Foundry never runs one by itself.
 */
export function RecipeDialog({ open, server, recipe: wanted, params: prefill, onClose, onFinished }: { open: boolean; server: RecipeServer; recipe?: string | null; params?: Record<string, string>; onClose: () => void; onFinished?: (run: RecipeRun) => void }) {
  const [recipes, setRecipes] = useState<ServerRecipe[] | null>(null);
  const [id, setId] = useState<string | null>(wanted ?? null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [read, setRead] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [run, setRun] = useState<RecipeRun | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const recipe = useMemo(() => recipes?.find((r) => r.id === id) ?? null, [recipes, id]);
  useEffect(() => {
    if (!open) return;
    setErr(null);
    setRun(null);
    setRead(false);
    setStartedAt(null);
    setId(wanted ?? null);
    api
      .serverRecipes()
      .then((r) => {
        setRecipes(r.recipes);
        if (!wanted && r.recipes[0]) setId(r.recipes[0].id);
      })
      .catch((e) => setErr(e.message));
  }, [open, wanted]);
  useEffect(() => setValues(initialParams(recipe, prefill)), [recipe?.id, JSON.stringify(prefill ?? {})]);
  // once started, the run is watched until it ends: the newest run of this recipe that began after the click
  useEffect(() => {
    if (!startedAt || !recipe) return;
    let alive = true;
    const tick = async () => {
      try {
        const { runs } = await api.serverRecipeRuns(server.id);
        const mine = runs.find((r) => r.recipe === recipe.id && r.at >= startedAt) ?? runs.find((r) => r.recipe === recipe.id);
        if (!alive) return;
        if (mine) setRun(mine);
        if (mine && mine.status !== 'running') {
          setStartedAt(null);
          onFinished?.(mine);
          return;
        }
      } catch {}
      if (alive) timer = setTimeout(tick, 3_000);
    };
    let timer = setTimeout(tick, 1_500);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [startedAt, recipe?.id, server.id]);
  if (!open) return null;
  const start = async () => {
    if (!recipe) return;
    setBusy(true);
    setErr(null);
    try {
      const at = new Date(Date.now() - 1_000).toISOString();
      await api.runServerRecipe(server.id, recipe.id, values);
      setStartedAt(at);
      setRun({ serverId: server.id, recipe: recipe.id, title: recipe.title, status: 'running', exitCode: null, reason: null, outputTail: '', at, endedAt: null });
    } catch (e: any) {
      setErr(e.body?.error ?? e.message);
    } finally {
      setBusy(false);
    }
  };
  const running = run?.status === 'running';
  return (
    <Modal open={open} wide title={`Set ${server.name} up with a script`} onClose={onClose}>
      <div className="space-y-3 text-xs">
        {!recipes ? (
          err ? <div className="text-bad-ink">{err}</div> : <div className="text-ink-faint">Loading the scripts…</div>
        ) : (
          <>
            <Field label="Script" help="Foundry's own, or yours from the data folder's server-recipes/.">
              <Select value={id ?? ''} onChange={(e) => setId(e.target.value)} disabled={running}>
                {recipes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                    {r.source === 'own' ? ' (yours)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
            {recipe && (
              <>
                <div className="rounded-lg border border-you/40 bg-you/5 p-3 space-y-1">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-you-ink">
                    <ShieldAlert size={12} /> What it changes on {server.host}, as {recipe.root ? 'root' : server.user}:
                  </div>
                  {recipe.changes.length ? (
                    <ul className="list-disc pl-5 text-[11px] text-ink space-y-0.5">
                      {recipe.changes.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-[11px] text-ink-faint">The script's header says nothing about what it changes: read it below before you run it.</div>
                  )}
                  <div className="text-[11px] text-ink-faint">It runs once, over ssh, only when you confirm below; its whole output stays in the activity. Foundry runs nothing else on the server.</div>
                </div>
                {recipe.params.length > 0 && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {recipe.params.map((p) => (
                      <Field key={p.name} label={p.name} help={p.label} className={multiline(p.name) ? 'sm:col-span-2' : undefined}>
                        {p.secret ? (
                          multiline(p.name) ? (
                            <Textarea rows={3} className="mono text-[11px]" autoComplete="off" spellCheck={false} value={values[p.name] ?? ''} placeholder="-----BEGIN …" onChange={(e) => setValues({ ...values, [p.name]: e.target.value })} disabled={running} />
                          ) : (
                            <Input type="password" autoComplete="off" value={values[p.name] ?? ''} onChange={(e) => setValues({ ...values, [p.name]: e.target.value })} disabled={running} />
                          )
                        ) : (
                          <Input value={values[p.name] ?? ''} placeholder={p.default ?? ''} onChange={(e) => setValues({ ...values, [p.name]: e.target.value })} disabled={running} />
                        )}
                      </Field>
                    ))}
                  </div>
                )}
                <details className="rounded-lg border border-line bg-sunken" open>
                  <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold text-ink-soft hover:text-ink flex items-center gap-2">
                    The whole script ({recipe.file.split('/').pop()}) <span className="ml-auto font-normal"><CopyButton text={recipe.text} /></span>
                  </summary>
                  <pre className="mono max-h-72 overflow-auto whitespace-pre px-3 pb-3 text-[11px] text-ink">{recipe.text}</pre>
                </details>
                {!run && (
                  <label className="flex items-start gap-2 cursor-pointer text-ink">
                    <input type="checkbox" className="mt-0.5" checked={read} onChange={(e) => setRead(e.target.checked)} />
                    <span>
                      I read the script; run it as {recipe.root ? 'root' : server.user} on <span className="mono">{server.host}</span>.
                    </span>
                  </label>
                )}
                <div className="flex items-center gap-2">
                  {!run && (
                    <Button size="sm" variant="primary" disabled={!read || busy} onClick={() => void start()}>
                      {busy ? <Loader2 size={12} className="animate-spin" /> : null} Run the script
                    </Button>
                  )}
                  {run && (
                    <span className={cn('inline-flex items-center gap-1.5 rounded-sm px-1.5 py-px text-[10.5px] font-bold uppercase tracking-[0.08em] ring-1 ring-inset', running ? 'bg-work/10 text-work-ink ring-work/30' : run.status === 'ok' ? 'bg-ok/10 text-ok-ink ring-ok/30' : 'bg-bad/10 text-bad-ink ring-bad/40')}>
                      {running && <Loader2 size={10} className="animate-spin" />}
                      {running ? 'running' : run.status === 'ok' ? 'done' : 'failed'}
                    </span>
                  )}
                  {run && !running && <span className="text-ink-faint">{ago(run.endedAt ?? run.at)}</span>}
                  {err && <span className="text-bad-ink">{err}</span>}
                  <span className="ml-auto">
                    <Button size="sm" onClick={onClose}>
                      {run && !running ? 'Close' : 'Cancel'}
                    </Button>
                  </span>
                </div>
                {run && !running && run.reason && <div className="text-bad-ink">{run.reason}</div>}
                {run && !running && run.outputTail && <pre className="mono max-h-60 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-sunken p-2 text-[11px] text-ink-faint">{run.outputTail}</pre>}
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/** the runs a server had, newest first: for the Settings page's Scripts fold */
export function RecipeRuns({ runs }: { runs: RecipeRun[] }) {
  if (!runs.length) return <div className="text-[11px] text-ink-faint">No script has run on this server yet.</div>;
  return (
    <ul className="space-y-1">
      {runs.map((r) => (
        <li key={`${r.recipe}-${r.at}`} className="text-[11px]">
          <span className={cn('mr-1.5 rounded-sm px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.08em] ring-1 ring-inset', r.status === 'running' ? 'bg-work/10 text-work-ink ring-work/30' : r.status === 'ok' ? 'bg-ok/10 text-ok-ink ring-ok/30' : 'bg-bad/10 text-bad-ink ring-bad/40')}>{r.status}</span>
          <span className="font-semibold text-ink">{r.title}</span> <span className="text-ink-faint">{ago(r.endedAt ?? r.at)}</span>
          {r.reason && <span className="text-bad-ink"> — {r.reason}</span>}
        </li>
      ))}
    </ul>
  );
}
