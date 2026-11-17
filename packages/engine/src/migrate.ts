/**
 * `foundry migrate` (ADR-0105): what a source install keeps in its checkout — the data folders with every goal, setting,
 * transcript and attachment — copied to where a compiled install keeps it, so the app or the binary opens the same
 * goals. The checkout's service is stopped first (a SQLite file is never copied while an engine writes it), each folder
 * is copied with ADR-0082's copy-and-rewrite (the paths the folder wrote about itself point into the copy), and the
 * original stays as it was, with a note saying where its data went: it is the backup until the person deletes the
 * checkout. A folder chosen in Settings (kept in ~/.foundry/config.json) is not moved: the new install opens it.
 */
import type { AgentProvider } from '@foundry/core';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { type HomeConfig, prepareDataDir, testDataDir } from './data-dir.ts';

export const SOURCE_SERVICE_LABEL = 'dev.foundry.server';
const PROVIDERS: AgentProvider[] = ['claude', 'codex', 'agy'];
/** what a checkout's service runs: its entry point, never a compiled foundry's */
const CHECKOUT_ENTRY = 'apps/cli/src/main.ts';

/** ~/.config/foundry/install.env: what the installer chose last time */
export const installEnvFile = (env: NodeJS.ProcessEnv, home: string) => join(env.XDG_CONFIG_HOME || join(home, '.config'), 'foundry', 'install.env');

/** the installer's `KEY=value` lines, each value as bash's `printf %q` wrote it */
export function parseInstallEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2]!;
    if (v === "''") v = '';
    else if (v.startsWith("$'") && v.endsWith("'")) v = v.slice(2, -1).replace(/\\(n|t|\\|')/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));
    else if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) v = v.slice(1, -1);
    else v = v.replace(/\\(.)/g, '$1');
    out[m[1]!] = v;
  }
  return out;
}

export function readInstallEnv(env: NodeJS.ProcessEnv, home: string): Record<string, string> | null {
  const file = installEnvFile(env, home);
  if (!existsSync(file)) return null;
  try {
    return parseInstallEnv(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** a folder Foundry made: what testDataDir calls one */
export const isFoundryFolder = (p: string) => existsSync(join(p, 'engine.db')) || existsSync(join(p, 'provider'));
export const isCheckout = (dir: string) => existsSync(join(dir, CHECKOUT_ENTRY));
const within = (child: string, parent: string) => {
  const r = relative(resolve(parent), resolve(child));
  return !!r && !r.startsWith('..') && !r.startsWith('/');
};

export interface MigrateItem {
  provider: AgentProvider;
  from: string;
  to: string;
  /** copy: moved now · keep: a folder chosen in Settings, opened where it is · done: the target already holds data · none: nothing here */
  action: 'copy' | 'keep' | 'done' | 'none';
  why: string;
}

/** the provider a data folder was made for: its `provider` file, as data-dir.ts writes it */
export function folderProvider(dir: string): AgentProvider | null {
  try {
    const p = readFileSync(join(dir, 'provider'), 'utf8').trim();
    return p === 'claude' || p === 'codex' || p === 'agy' ? p : null;
  } catch {
    return null;
  }
}

export function planMigration(opts: {
  checkout: string;
  config: HomeConfig;
  targetFor: (p: AgentProvider) => string;
  isFoundry?: (p: string) => boolean;
  /** the folder the engine that asked for the switch runs on (FOUNDRY_DATA_DIR, say), copied in place of its default (ADR-0106) */
  current?: { provider: AgentProvider; dataDir: string };
}): MigrateItem[] {
  const isFoundry = opts.isFoundry ?? isFoundryFolder;
  return PROVIDERS.map((provider): MigrateItem => {
    const chosen = opts.config.dataDirs[provider];
    if (opts.current?.provider === provider && resolve(opts.current.dataDir) !== resolve(chosen ?? '')) {
      const from = resolve(opts.current.dataDir);
      if (!isFoundry(from)) return { provider, from, to: '', action: 'none', why: 'no data folder here' };
      const to = opts.targetFor(provider);
      if (isFoundry(to)) return { provider, from, to, action: 'done', why: `${to} already holds a data folder; left as it is` };
      return { provider, from, to, action: 'copy', why: '' };
    }
    if (chosen) {
      const inside = within(chosen, opts.checkout);
      return { provider, from: chosen, to: chosen, action: 'keep', why: inside ? `chosen in Settings and inside the checkout: keep ${opts.checkout} until you move it (Settings → Engine (install) → Data folder)` : 'chosen in Settings: the new install opens it where it is' };
    }
    const from = join(opts.checkout, provider === 'claude' ? 'data' : `data-${provider}`);
    if (!isFoundry(from)) return { provider, from, to: '', action: 'none', why: 'no data folder here' };
    const to = opts.targetFor(provider);
    if (isFoundry(to)) return { provider, from, to, action: 'done', why: `${to} already holds a data folder; left as it is` };
    return { provider, from, to, action: 'copy', why: '' };
  });
}

type Run = (argv: string[]) => Promise<{ code: number; stdout: string }>;
const defaultRun: Run = async (argv) => {
  try {
    const p = Bun.spawn(argv, { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' });
    const [stdout, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
    return { code, stdout };
  } catch {
    return { code: 127, stdout: '' };
  }
};

export interface StoppedService {
  kind: 'launchd' | 'systemd' | 'process' | 'none';
  /** start it again: the copy failed and the old Foundry comes back as it was */
  restore(): Promise<void>;
  /** the copy is made: the service never starts again (the new install's own replaces it) */
  forget(): Promise<void>;
}

/**
 * Stop the checkout's service as the installer set it up: the launchd agent or the systemd unit, only when it runs this
 * checkout's entry point (a compiled install's own service has the same name), or the background process it recorded.
 * Its file stays until `forget`, so `restore` can start it again.
 */
export async function stopSourceService(opts: { checkout: string; home: string; env?: NodeJS.ProcessEnv; run?: Run; log: (m: string) => void; platform?: NodeJS.Platform; uid?: number }): Promise<StoppedService> {
  const run = opts.run ?? defaultRun;
  const env = opts.env ?? process.env;
  const ours = (file: string) => {
    try {
      const text = readFileSync(file, 'utf8');
      return text.includes(CHECKOUT_ENTRY) && text.includes(opts.checkout);
    } catch {
      return false;
    }
  };
  const none: StoppedService = { kind: 'none', restore: async () => {}, forget: async () => {} };
  const domain = `gui/${opts.uid ?? process.getuid?.() ?? 501}`;
  const plist = join(opts.home, 'Library', 'LaunchAgents', `${SOURCE_SERVICE_LABEL}.plist`);
  if ((opts.platform ?? process.platform) === 'darwin' && ours(plist)) {
    opts.log(`stopping the checkout's launchd agent (${SOURCE_SERVICE_LABEL})`);
    await run(['launchctl', 'bootout', `${domain}/${SOURCE_SERVICE_LABEL}`]);
    return {
      kind: 'launchd',
      restore: async () => void (await run(['launchctl', 'bootstrap', domain, plist])),
      forget: async () => rmSync(plist, { force: true }),
    };
  }
  const unit = join(env.XDG_CONFIG_HOME || join(opts.home, '.config'), 'systemd', 'user', 'foundry.service');
  if (ours(unit)) {
    opts.log("stopping the checkout's systemd unit (foundry.service)");
    await run(['systemctl', '--user', 'stop', 'foundry.service']);
    return {
      kind: 'systemd',
      restore: async () => void (await run(['systemctl', '--user', 'start', 'foundry.service'])),
      forget: async () => {
        await run(['systemctl', '--user', 'disable', 'foundry.service']);
        rmSync(unit, { force: true });
        await run(['systemctl', '--user', 'daemon-reload']);
      },
    };
  }
  const pidFile = join(env.XDG_DATA_HOME || join(opts.home, '.local', 'share'), 'foundry', 'foundry.pid');
  if (existsSync(pidFile)) {
    const pid = Number(readFileSync(pidFile, 'utf8').trim());
    const cmd = pid > 0 ? (await run(['ps', '-o', 'command=', '-p', String(pid)])).stdout : '';
    if (cmd.includes(CHECKOUT_ENTRY)) {
      opts.log(`stopping the checkout's background process (pid ${pid})`);
      try {
        process.kill(pid, 'SIGTERM');
      } catch {}
      rmSync(pidFile, { force: true });
      // a background process was started by hand or by the installer's foundry start: it is started the same way again
      return { kind: 'process', restore: async () => opts.log(`start the checkout again with: foundry start`), forget: async () => {} };
    }
  }
  return none;
}

/** stop one process and wait for it: SIGTERM (Foundry shuts down cleanly), SIGKILL after the wait */
export async function stopProcess(pid: number, opts: { timeoutMs?: number; sleep?: (ms: number) => Promise<void>; alive?: (pid: number) => boolean } = {}): Promise<'gone' | 'stopped' | 'killed'> {
  const alive = opts.alive ?? ((p: number) => {
    try {
      process.kill(p, 0);
      return true;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === 'EPERM';
    }
  });
  const sleep = opts.sleep ?? ((ms: number) => Bun.sleep(ms));
  if (!alive(pid)) return 'gone';
  try {
    process.kill(pid, 'SIGTERM');
  } catch {}
  const t0 = Date.now();
  while (alive(pid)) {
    if (Date.now() - t0 > (opts.timeoutMs ?? 60_000)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
      return 'killed';
    }
    await sleep(250);
  }
  return 'stopped';
}

/** wait until no process has these files open; the holder's pid and command when one still does after the wait */
export async function waitUntilClosed(files: string[], opts: { run?: Run; timeoutMs?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<string | null> {
  const run = opts.run ?? defaultRun;
  const sleep = opts.sleep ?? ((ms: number) => Bun.sleep(ms));
  const present = files.filter((f) => existsSync(f));
  if (!present.length) return null;
  const t0 = Date.now();
  for (;;) {
    const r = await run(['lsof', '-t', '--', ...present]);
    // lsof: 1 and nothing printed = no process has them open; 127 = no lsof here, so nothing to wait on
    const pids = r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
    if (r.code === 127 || !pids.length) return null;
    if (Date.now() - t0 > (opts.timeoutMs ?? 60_000)) {
      const cmd = (await run(['ps', '-o', 'command=', '-p', pids[0]!])).stdout.trim();
      return `pid ${pids[0]}${cmd ? ` (${cmd.slice(0, 160)})` : ''}`;
    }
    await sleep(1000);
  }
}

/** the note left in the folder a copy was made of */
export function movedNote(from: string, to: string, at = new Date()): string {
  return `# This data folder was moved\n\n\`foundry migrate\` copied it to\n\n    ${to}\n\non ${at.toISOString().slice(0, 10)}. The Foundry app (or the foundry binary) opens that copy; this folder is the\nbackup of the day it moved. Once the app shows your goals, delete the checkout around it, and this with it.\n\nStarting the checkout again opens this old copy, not the one the app uses.\n`;
}

export async function runMigration(items: MigrateItem[], opts: { log: (m: string) => void; prepare?: typeof prepareDataDir }): Promise<MigrateItem[]> {
  const prepare = opts.prepare ?? prepareDataDir;
  const copied: MigrateItem[] = [];
  for (const it of items.filter((i) => i.action === 'copy')) {
    const t = testDataDir(it.to, { current: it.from, provider: it.provider });
    const bad = t.checks.filter((c) => !c.ok);
    if (!t.ok || !t.modes.includes('clone')) throw new Error(`${it.to} cannot take the ${it.provider} data: ${bad.map((c) => `${c.label}: ${c.detail}`).join('; ') || 'not enough room for a copy'}`);
    await prepare(it.from, it.to, 'clone', opts.log);
    writeFileSync(join(it.from, 'MOVED.md'), movedNote(it.from, it.to));
    copied.push(it);
  }
  return copied;
}
