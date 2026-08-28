/**
 * One-click updaters per source manager. Every run is reported as a SkillUpdateRun (the engine appends it
 * as a `skills.update_run` event). Third-party managers are driven through their own CLIs so their
 * bookkeeping (lock files, plugin registry) stays correct.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { findEntry } from './catalog.ts';
import { installEntry, updateEntry } from './installer.ts';
import type { SkillsPaths } from './paths.ts';
import { trashSkill } from './trash.ts';
import type { Catalog, SkillSource, SkillUpdateRun } from './types.ts';

export interface UpdaterContext {
  paths: SkillsPaths;
  catalog: Catalog;
  claudeBin?: string;
  npxBin?: string;
  onLine?: (line: string) => void;
  log?: (m: string) => void;
  /** injected for tests */
  spawn?: typeof spawnStreaming;
  timeoutMs?: number;
}

export interface SpawnResult {
  code: number | null;
  tail: string;
}

/** Run a command, streaming stdout+stderr line by line (ANSI stripped); returns exit code and the last ~60 lines. */
export async function spawnStreaming(argv: string[], cwd: string, onLine: (l: string) => void, opts: { timeoutMs?: number; env?: Record<string, string> } = {}): Promise<SpawnResult> {
  const env: Record<string, string | undefined> = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', CI: '1', ...(opts.env ?? {}) };
  delete env.ANTHROPIC_API_KEY;
  const proc = Bun.spawn(argv, { cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', env: env as Record<string, string> });
  const tail: string[] = [];
  const push = (l: string) => {
    const clean = l.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '').trimEnd();
    if (!clean) return;
    tail.push(clean);
    if (tail.length > 60) tail.shift();
    onLine(clean);
  };
  const pump = async (stream: ReadableStream<Uint8Array> | null) => {
    if (!stream) return;
    const dec = new TextDecoder();
    const reader = stream.getReader();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n');
      buf = parts.pop() ?? '';
      parts.forEach(push);
    }
    if (buf) push(buf);
  };
  const timer = setTimeout(() => proc.kill('SIGKILL'), opts.timeoutMs ?? 5 * 60_000);
  await Promise.all([pump(proc.stdout as ReadableStream<Uint8Array>), pump(proc.stderr as ReadableStream<Uint8Array>)]);
  const code = await proc.exited;
  clearTimeout(timer);
  return { code, tail: tail.join('\n') };
}

function pluginShas(paths: SkillsPaths): Record<string, string | null> {
  try {
    const j = JSON.parse(readFileSync(join(paths.pluginsDir, 'installed_plugins.json'), 'utf8'));
    const out: Record<string, string | null> = {};
    for (const [id, v] of Object.entries<any>(j.plugins ?? j)) {
      const rec = (Array.isArray(v) ? v : [v]).find((r: any) => r && (r.scope ?? 'user') === 'user') ?? (Array.isArray(v) ? v[0] : v);
      out[id] = rec?.gitCommitSha ?? rec?.version ?? null;
    }
    return out;
  } catch {
    return {};
  }
}

/** Execute the updater that fits the source. `names` restricts foundry / agents-cli / adopt runs to some skills. */
export async function runSourceUpdate(source: SkillSource, names: string[] | undefined, ctx: UpdaterContext): Promise<SkillUpdateRun> {
  const t0 = Date.now();
  const say = (l: string) => ctx.onLine?.(l);
  const spawn = ctx.spawn ?? spawnStreaming;
  const base = (partial: Partial<SkillUpdateRun>): SkillUpdateRun => ({ sourceId: source.id, updater: source.updater.kind, command: [], cwd: '', exitCode: null, durationMs: Date.now() - t0, outputTail: '', changed: [], error: null, at: new Date().toISOString(), ...partial });
  const pick = names?.length ? source.skills.filter((s) => names.includes(s.name)) : source.skills;
  const tailOf: string[] = [];
  const line = (raw: string) => {
    const l = raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '').trimEnd();
    if (!l) return;
    tailOf.push(l);
    if (tailOf.length > 60) tailOf.shift();
    say(l);
  };

  switch (source.updater.kind) {
    case 'foundry': {
      const changed: SkillUpdateRun['changed'] = [];
      let error: string | null = null;
      for (const s of pick) {
        const entry = s.catalogId ? findEntry(ctx.catalog, s.catalogId) : null;
        if (!entry) {
          line(`✗ ${s.name}: no catalog entry — cannot update`);
          continue;
        }
        try {
          line(`↻ ${s.name} ← ${entry.source.type === 'git' ? entry.source.repo : entry.id}`);
          const u = await updateEntry(entry, { paths: ctx.paths, log: ctx.log });
          line(u.changed ? `✓ ${s.name}: ${u.from?.slice(0, 7) ?? '?'} → ${u.to?.slice(0, 7) ?? '?'}` : `= ${s.name}: already at ${u.to?.slice(0, 7) ?? '?'}`);
          if (u.changed) changed.push({ name: u.name, from: u.from, to: u.to });
        } catch (e) {
          error = String((e as Error).message ?? e);
          line(`✗ ${s.name}: ${error}`);
        }
      }
      line(`■ done (${changed.length} updated)`);
      return base({ command: ['foundry', 'update', ...pick.map((s) => s.name)], cwd: ctx.paths.skillsDir, exitCode: error ? 1 : 0, outputTail: tailOf.join('\n'), changed, error });
    }
    case 'agents-cli': {
      const npx = ctx.npxBin ?? Bun.which('npx');
      if (!npx) return base({ error: 'npx not found on PATH (install Node.js to update npx-installed skills)', outputTail: '' });
      const argv = [npx, '-y', 'skills@latest', 'update', '-g', '-y', '-a', 'claude-code', ...(names?.length ? names : [])];
      line(`$ ${argv.join(' ')}`);
      const r = await spawn(argv, homedir(), line, { timeoutMs: ctx.timeoutMs });
      line(`■ exit ${r.code}`);
      return base({ command: argv, cwd: homedir(), exitCode: r.code, outputTail: tailOf.join('\n'), error: r.code === 0 ? null : `npx skills update exited ${r.code}` });
    }
    case 'plugin': {
      const claude = ctx.claudeBin ?? Bun.which('claude');
      if (!claude) return base({ error: 'claude not found on PATH' });
      const pluginId = source.id.slice('plugin:'.length);
      const mkt = pluginId.includes('@') ? pluginId.split('@').slice(1).join('@') : null;
      const before = pluginShas(ctx.paths)[pluginId] ?? null;
      const cmds = [...(mkt ? [[claude, 'plugin', 'marketplace', 'update', mkt]] : []), [claude, 'plugin', 'update', pluginId, '-y']];
      let code: number | null = 0;
      for (const argv of cmds) {
        line(`$ ${argv.join(' ')}`);
        const r = await spawn(argv, homedir(), line, { timeoutMs: ctx.timeoutMs });
        code = r.code;
        if (r.code !== 0) {
          line(`■ exit ${r.code}`);
          break;
        }
      }
      const after = pluginShas(ctx.paths)[pluginId] ?? null;
      const changed = before !== after ? [{ name: pluginId, from: before, to: after }] : [];
      line(code === 0 ? (changed.length ? `■ updated ${before?.slice(0, 7) ?? '?'} → ${after?.slice(0, 7) ?? '?'} — restart Claude sessions to apply` : '■ already up to date') : `■ failed (exit ${code})`);
      return base({ command: cmds.flat(), cwd: homedir(), exitCode: code, outputTail: tailOf.join('\n'), changed, error: code === 0 ? null : `claude plugin update exited ${code}` });
    }
    case 'adopt': {
      const changed: SkillUpdateRun['changed'] = [];
      let error: string | null = null;
      for (const s of pick) {
        const entry = s.catalogId ? findEntry(ctx.catalog, s.catalogId) : null;
        if (!entry) {
          line(`· ${s.name}: not in the catalog — left as is`);
          continue;
        }
        try {
          line(`↻ adopting ${s.name} → ${entry.name} from ${entry.source.type === 'git' ? entry.source.repo : entry.id}`);
          const r = await installEntry(entry, { paths: ctx.paths, log: ctx.log }, { force: true, refresh: true });
          if (entry.name !== s.name && existsSync(join(ctx.paths.skillsDir, s.name))) {
            trashSkill(s.name, ctx.paths, `superseded by ${entry.name} (renamed upstream)`);
            line(`  trashed old copy ${s.name}`);
          }
          line(`✓ ${entry.name} @ ${r.commit?.slice(0, 7) ?? '?'}`);
          changed.push({ name: entry.name, from: null, to: r.commit });
        } catch (e) {
          error = String((e as Error).message ?? e);
          line(`✗ ${s.name}: ${error}`);
        }
      }
      line(`■ done (${changed.length} adopted)`);
      return base({ command: ['foundry', 'adopt', ...pick.map((s) => s.name)], cwd: ctx.paths.skillsDir, exitCode: error ? 1 : 0, outputTail: tailOf.join('\n'), changed, error });
    }
    case 'hint':
      return base({ error: source.updater.hint ?? 'this source updates itself' });
    default:
      return base({ error: 'no updater for this source' });
  }
}
