import { codexProcess, type CodexProcessOptions } from '../mcp/codex-process.ts';
import type { CodexPlugin, CodexPluginsView } from './types.ts';

const SELECTOR = /^[A-Za-z0-9][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9._-]*$/;
const selector = (value: unknown): value is string => typeof value === 'string' && value.length <= 200 && SELECTOR.test(value);
const text = (value: unknown, fallback: string) => typeof value === 'string' ? value.slice(0, 500) : fallback;

export function parsePlugins(value: unknown): CodexPlugin[] {
  const data = value as any;
  if (!data || !Array.isArray(data.installed) || !Array.isArray(data.available) || data.installed.length + data.available.length > 2000) {
    throw new Error('Codex returned an invalid plugin list.');
  }
  const rows = new Map<string, CodexPlugin>();
  // Native list can report a package in both sections; installed state takes precedence.
  for (const [items, installed] of [[data.available, false], [data.installed, true]] as const) {
    for (const row of items) {
      if (!row || !selector(row.pluginId) || row.installed !== installed || typeof row.enabled !== 'boolean') {
        throw new Error('Codex returned invalid plugin metadata.');
      }
      rows.set(row.pluginId, {
        id: row.pluginId,
        name: text(row.name, row.pluginId.split('@')[0]!),
        marketplace: text(row.marketplaceName, row.pluginId.split('@')[1]!),
        version: typeof row.version === 'string' ? row.version.slice(0, 100) : null,
        installed,
        enabled: row.enabled,
        installPolicy: text(row.installPolicy, 'UNKNOWN'),
        authPolicy: text(row.authPolicy, 'UNKNOWN'),
      });
    }
  }
  return [...rows.values()].sort((a, b) => Number(b.installed) - Number(a.installed) || a.id.localeCompare(b.id));
}

/** Native CLI owns installation and policy enforcement. Foundry never edits its config or cache. */
export class CodexPlugins {
  private queue: Promise<unknown> = Promise.resolve();
  private active = new Set<ReturnType<typeof codexProcess>>();
  private stopped = false;
  private pending: Promise<CodexPluginsView> | null = null;
  private cached: { at: number; view: CodexPluginsView } | null = null;
  private generation = 0;

  constructor(private options: CodexProcessOptions) {}

  async stop(): Promise<void> {
    this.stopped = true;
    this.invalidate();
    const active = [...this.active];
    for (const process of active) process.kill();
    await Promise.allSettled(active.map(process => process.result));
  }

  invalidate(): void {
    this.generation++;
    this.cached = null;
    this.pending = null;
  }

  private async run(args: string[]) {
    if (this.stopped) throw new Error('Plugin manager is shutting down.');
    const process = codexProcess({ ...this.options, timeoutMs: this.options.timeoutMs ?? 60_000 }, args);
    this.active.add(process);
    process.end();
    try {
      const result = await process.result;
      if (result.code !== 0 || result.failure) {
        throw new Error(`Codex plugin command ${result.failure ?? 'failed'}. Check the native CLI, marketplace policy and sign-in.`);
      }
      try { return JSON.parse(result.stdout); }
      catch { throw new Error('Codex returned invalid plugin JSON.'); }
    } finally { this.active.delete(process); }
  }

  view(force = false): Promise<CodexPluginsView> {
    if (this.pending) return this.pending;
    if (!force && this.cached && Date.now() - this.cached.at < 30_000) return Promise.resolve(this.cached.view);
    const generation = this.generation;
    const read = this.queue.then(async (): Promise<CodexPluginsView> => {
      const checkedAt = new Date().toISOString();
      try {
        return { state: 'available', plugins: parsePlugins(await this.run(['plugin', 'list', '--json', '--available'])), checkedAt };
      } catch (error) {
        return { state: 'unavailable', message: error instanceof Error ? error.message : 'Plugin list unavailable.', checkedAt };
      }
    });
    this.pending = read.then(view => {
      if (generation !== this.generation) return { state: 'unavailable' as const, checkedAt: view.checkedAt, message: 'Plugin configuration changed. Refresh the list.' };
      this.cached = { at: Date.now(), view };
      return view;
    }).finally(() => { if (generation === this.generation) this.pending = null; });
    return this.pending;
  }

  change(id: string, action: 'install' | 'remove', say: (line: string) => void = () => {}): Promise<{ ok: true; id: string }> {
    if (!selector(id)) return Promise.reject(new Error('Use an exact plugin-name@marketplace identifier.'));
    const work = this.queue.then(async () => {
      const plugins = parsePlugins(await this.run(['plugin', 'list', '--json', '--available']));
      const plugin = plugins.find(row => row.id === id);
      if (!plugin || (action === 'remove' && !plugin.installed)) throw new Error('Plugin is no longer present. Refresh the list.');
      if (plugin.installPolicy !== 'AVAILABLE') throw new Error('This plugin must be managed through its native marketplace policy.');
      if (action === 'install' && plugin.installed) throw new Error('Plugin is already installed.');
      say(`${action === 'install' ? 'Installing' : 'Removing'} ${id} through the native CLI…`);
      const result = await this.run(['plugin', action === 'install' ? 'add' : 'remove', id, '--json']);
      if (result?.pluginId !== id) throw new Error('Codex did not confirm the requested plugin. Refresh the list.');
      const after = parsePlugins(await this.run(['plugin', 'list', '--json', '--available']));
      if (after.some(row => row.id === id && row.installed) !== (action === 'install')) {
        throw new Error('Codex did not confirm the new installation state. Refresh the list.');
      }
      say(action === 'install'
        ? 'Installed. New sessions load this plugin; any connected service still needs native authorization.'
        : 'Removed from native user configuration. Running sessions may retain already loaded components.');
      return { ok: true as const, id };
    }).finally(() => this.invalidate());
    this.queue = work.catch(() => {});
    return work;
  }
}
