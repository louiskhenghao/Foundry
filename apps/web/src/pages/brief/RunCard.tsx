import type { Brief, BriefRun } from '@foundry/core/browser';
import { Button, Card, Field, Input, Select } from '../../ui.tsx';
import { HelpLink } from '../HelpPage.tsx';

const EMPTY: BriefRun = { install: null, command: null, url: null, platform: 'none' };

/** How the engine starts the result for previews and the self-check; empty = read package.json (dev / start script). */
export function RunCard({ brief, editable, edit }: { brief: Brief; editable: boolean; edit: (fn: (b: Brief) => Brief) => void }) {
  const run = brief.run ?? null;
  const set = (patch: Partial<BriefRun>) => edit((b) => ({ ...b, run: { ...EMPTY, ...(b.run ?? {}), ...patch } }));
  return (
    <Card
      title={<>How to run it<HelpLink to="approving-the-brief#how-to-run-it" className="ml-1.5" /></>}
      actions={
        run && editable ? (
          <Button size="sm" variant="ghost" onClick={() => edit((b) => ({ ...b, run: null }))} title="Forget these and let the engine read package.json">
            Use package.json
          </Button>
        ) : null
      }
    >
      <div className="text-xs text-zinc-400 space-y-2">
        <p>
          Used for the preview at milestones and for the self-check. {run ? 'The Brief names the command.' : 'Empty: the engine reads the dev or start script from package.json (Vite, Next and Expo get their port flag; anything else gets PORT in the environment).'} <span className="mono">{'{port}'}</span> marks where the engine's port goes.
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
      </div>
    </Card>
  );
}
