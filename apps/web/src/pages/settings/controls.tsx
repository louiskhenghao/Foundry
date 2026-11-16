import type { Settings, SettingsView } from '@foundry/core/browser';
import { RotateCcw } from 'lucide-react';
import { createContext, useContext, type ReactNode } from 'react';
import { CheckRow, Field, cn } from '../../ui.tsx';
import { wordsOf, type SettingKey } from './texts.ts';

/** the value at a dotted path (`workflow.tdd`) of a settings object */
export const get = (o: any, path: string) => path.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);

/**
 * a small fact beside a setting (where its value comes from, a restart it needs) as a plate. Its outline is an
 * inset-ring: with ring-inset the theme's colour named inset would win over the ring's own colour.
 */
export const TAG = 'inline-flex items-center whitespace-nowrap rounded-sm px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.08em] inset-ring';
/** a setting that applies only after a restart, told apart from the rest in orange (a kind of setting, not a state) */
export const RESTART_TAG = 'bg-code-4/12 text-code-4-ink inset-ring-code-4/45';

/** where a setting's value comes from, told apart by colour as before themes: saved green, the environment blue, the default hollow */
export function SourceBadge({ view, path }: { view: SettingsView; path: string }) {
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

/**
 * What every control of the Settings page shares: the saved settings as the server shows them, the draft being edited,
 * whether a save or a reset is under way, and how to change a value in the draft or forget a saved one.
 */
export interface SettingsControls {
  view: SettingsView;
  draft: Settings;
  busy: boolean;
  set: (path: SettingKey, value: unknown) => void;
  reset: (path: SettingKey) => void;
}
const Controls = createContext<SettingsControls | null>(null);
export const SettingsControlsProvider = Controls.Provider;
function useControls(): SettingsControls {
  const c = useContext(Controls);
  if (!c) throw new Error('a Settings control rendered outside the Settings page');
  return c;
}

/** beside a setting: where its value comes from, restart when it needs one, and ↺ to forget a saved value */
export function Aside({ path }: { path: SettingKey }) {
  const { view, busy, reset } = useControls();
  return (
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
}

/**
 * One setting of the page as a labelled field: its words from the texts table (the words the page's search reads too),
 * the plates beside it, and its control inside. The field carries the setting's path, so the search can scroll to it.
 */
export function Setting({ path, className, children }: { path: SettingKey; className?: string; children: ReactNode }) {
  const t = wordsOf(path);
  return (
    <Field label={t.label} help={t.help} aside={<Aside path={path} />} setting={path} className={className}>
      {children}
    </Field>
  );
}

/** a yes/no setting as a checkbox row, worded from the texts table like a Setting */
export function Toggle({ path, className }: { path: SettingKey; className?: string }) {
  const { draft, set } = useControls();
  const t = wordsOf(path);
  return <CheckRow label={t.label} help={t.help} aside={<Aside path={path} />} setting={path} className={className} checked={!!get(draft, path)} onChange={(on) => set(path, on)} />;
}
