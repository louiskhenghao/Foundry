import type { Brief, BriefApp, BriefRun } from '@foundry/core/browser';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api.ts';
import { Button, Card, Field, Input, Select } from '../../ui.tsx';
import { HelpLink } from '../HelpPage.tsx';

const EMPTY: BriefRun = { install: null, command: null, url: null, platform: 'none' };

/** an app's key from its name: lowercase letters, digits and dashes */
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** `base`, or `base-2`, `base-3`… when another app already has it */
const uniqueKey = (base: string, taken: string[]) => {
  let key = base;
  for (let n = 2; taken.includes(key); n++) key = `${base}-${n}`;
  return key;
};
const blankApp = (taken: string[]): BriefApp => ({ key: uniqueKey('app', taken), name: '', dir: '', install: null, command: null, url: 'http://localhost:{port}', platform: 'web' });

/**
 * How the engine starts the result for previews and the self-check: one start command, or a list of apps (a monorepo's
 * web app, admin, API…) each started in its own folder. Empty = read package.json (dev / start script, or its workspaces).
 */
export function RunCard({ brief, editable, edit, goalId, selfCheck }: { brief: Brief; editable: boolean; edit: (fn: (b: Brief) => Brief) => void; goalId: string; selfCheck: boolean }) {
  const [selfCheckErr, setSelfCheckErr] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const run = brief.run ?? null;
  const apps = brief.apps?.length ? brief.apps : null;
  const set = (patch: Partial<BriefRun>) => edit((b) => ({ ...b, run: { ...EMPTY, ...(b.run ?? {}), ...patch } }));
  const setApps = (fn: (apps: BriefApp[]) => BriefApp[]) =>
    edit((b) => {
      const next = fn(b.apps ?? []);
      return { ...b, apps: next.length ? next : null };
    });
  const setApp = (i: number, patch: Partial<BriefApp>) =>
    setApps((list) =>
      list.map((a, j) => {
        if (j !== i) return a;
        const next = { ...a, ...patch };
        // the key follows the name until it was set to something else
        if (patch.name !== undefined && (!a.key || a.key === slug(a.name) || /^app(-\d+)?$/.test(a.key))) {
          next.key = uniqueKey(slug(patch.name) || 'app', list.filter((_, k) => k !== i).map((x) => x.key));
        }
        return next;
      }),
    );
  /** turn the single command into a list: the apps detected from package.json, else the current command, plus room for one more */
  const toApps = async () => {
    setConverting(true);
    let list: BriefApp[] = [];
    try {
      const st = await api.preview(goalId);
      if (st.source === 'detected') list = st.apps.map((a) => a.run);
    } catch {
      /* no preview status: start from the command */
    }
    setConverting(false);
    if (!list.length && run) list = [{ key: 'app', name: 'App', dir: '', ...EMPTY, ...run }];
    if (list.length < 2) list = [...list, blankApp(list.map((a) => a.key))];
    edit((b) => ({ ...b, apps: list }));
  };
  return (
    <Card
      title={<>How to run it<HelpLink to="approving-the-brief#how-to-run-it" className="ml-1.5" /></>}
      actions={
        editable ? (
          <>
            {!apps && (
              <Button size="sm" variant="ghost" disabled={converting} onClick={() => void toApps()} title="Preview several apps side by side (web app, admin, API…), each in its own folder">
                Several apps…
              </Button>
            )}
            {(run || apps) && (
              <Button size="sm" variant="ghost" onClick={() => edit((b) => ({ ...b, run: null, apps: null }))} title="Forget these and let the engine read package.json">
                Use package.json
              </Button>
            )}
          </>
        ) : null
      }
    >
      <div className="text-xs text-zinc-400 space-y-2">
        {apps ? (
          <>
            <p>
              Used for the preview at milestones and for the self-check. Each app starts in its folder with its own port; the first one is the one milestones and the self-check open. <span className="mono">{'{port}'}</span> marks where the engine's port goes, and every app gets the others' addresses as <span className="mono">FOUNDRY_APP_&lt;KEY&gt;_URL</span>.
            </p>
            <ul className="space-y-2">
              {apps.map((a, i) => (
                <li key={i} className="rounded-md border border-zinc-800 p-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,1.4fr)_minmax(0,1fr)] gap-2">
                    <Field label="Name">
                      <Input className="text-xs" disabled={!editable} placeholder="Web app" value={a.name} onChange={(e) => setApp(i, { name: e.target.value })} />
                    </Field>
                    <Field label="Folder">
                      <Input className="mono text-xs" disabled={!editable} placeholder="apps/web (empty = root)" value={a.dir} onChange={(e) => setApp(i, { dir: e.target.value.trim().replace(/^\.?\/+|\/+$/g, '') })} />
                    </Field>
                    <Field label="Start command">
                      <Input className="mono text-xs" disabled={!editable} placeholder="npm run dev -- --port {port}" value={a.command ?? ''} onChange={(e) => setApp(i, { command: e.target.value || null })} />
                    </Field>
                    <Field label="URL">
                      <Input className="mono text-xs" disabled={!editable} placeholder="http://localhost:{port}" value={a.url ?? ''} onChange={(e) => setApp(i, { url: e.target.value || null })} />
                    </Field>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 text-[11px] text-zinc-500">
                    <span className="mono truncate" title="the app's key and the variable the other apps read its address from">
                      {a.key || 'app'} · FOUNDRY_APP_{(a.key || 'app').toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_URL
                    </span>
                    {i === 0 && <span className="text-zinc-400">· opened first</span>}
                    {!a.command && <span className="text-amber-300">· no start command: skipped</span>}
                    {editable && (
                      <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setApps((list) => list.filter((_, j) => j !== i))} title="Remove this app" aria-label={`Remove ${a.name || 'this app'}`}>
                        <X size={12} /> Remove
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {editable && (
              <Button size="sm" onClick={() => setApps((list) => [...list, blankApp(list.map((a) => a.key))])}>
                <Plus size={12} /> Add app
              </Button>
            )}
          </>
        ) : (
          <>
            <p>
              Used for the preview at milestones and for the self-check. {run ? 'The Brief names the command.' : 'Empty: the engine reads the dev or start script from package.json, or one per app of its workspaces (Vite, Next and Expo get their port flag; anything else gets PORT in the environment).'} <span className="mono">{'{port}'}</span> marks where the engine's port goes.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <Field label="Platform">
                <Select disabled={!editable} className="text-xs py-1" value={run?.platform ?? 'none'} onChange={(e) => set({ platform: e.target.value as BriefRun['platform'] })}>
                  <option value="none">nothing to start</option>
                  <option value="web">web (browser)</option>
                  <option value="expo">expo (React Native via Expo web)</option>
                </Select>
              </Field>
              <Field label="Install">
                <Input className="mono text-xs" disabled={!editable} placeholder="npm install" value={run?.install ?? ''} onChange={(e) => set({ install: e.target.value || null })} />
              </Field>
              <Field label="Start command">
                <Input className="mono text-xs" disabled={!editable} placeholder="npm run dev -- --port {port}" value={run?.command ?? ''} onChange={(e) => set({ command: e.target.value || null })} />
              </Field>
              <Field label="URL">
                <Input className="mono text-xs" disabled={!editable} placeholder="http://localhost:{port}" value={run?.url ?? ''} onChange={(e) => set({ url: e.target.value || null })} />
              </Field>
            </div>
          </>
        )}
        <label className="flex items-center gap-2 text-[11px] text-zinc-400 cursor-pointer pt-1" title="After every task lands, the engine opens the preview in headless Chromium, takes a screenshot and fails a must check on console or network errors. Needs Playwright's Chromium (Settings → Preview & self-check).">
          <input
            type="checkbox"
            className="accent-emerald-500"
            checked={selfCheck}
            onChange={(e) => {
              setSelfCheckErr(null);
              api.setSelfCheck(goalId, e.target.checked).catch((err) => setSelfCheckErr(err.message));
            }}
          />
          Self-check after each task (screenshot + console errors)
        </label>
        {selfCheckErr && <div className="text-rose-300">{selfCheckErr}</div>}
      </div>
    </Card>
  );
}
