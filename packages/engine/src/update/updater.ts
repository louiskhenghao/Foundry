/**
 * Version self-knowledge and the self-update pipeline (ADR-0010).
 * The version source is the public Docker Hub tag list for BOTH deployment modes (the GitHub repo
 * is private; the image is not), and the changelog comes from the public releases repo. Docker
 * self-update goes through the watchtower sidecar; local self-update is git-based with automatic
 * rollback. An instance that cannot self-update degrades to guided commands — never an error.
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { Engine } from '../engine.ts';
import { exec, git } from '../git/git.ts';

export type DeploymentMode = 'docker' | 'local' | 'unknown';

export interface UpdateReport {
  current: string;
  /** newest stable tag on the registry; null while the source is unreachable */
  latest: string | null;
  updateAvailable: boolean;
  checkedAt: string | null;
  /** notes for every version newer than current, newest first (empty when the releases repo has none) */
  changelog: { version: string; notes: string }[];
  error: string | null;
}

export interface UpdateCapability {
  mode: DeploymentMode;
  canSelfUpdate: boolean;
  method: 'watchtower' | 'git' | null;
  /** commands for a guided update in this mode, shown when canSelfUpdate is false */
  guided: string[];
}

export interface UpdaterOptions {
  /** Docker Hub repository whose tags are the version source */
  image?: string;
  /** raw URL of the public releases repo changelog */
  changelogUrl?: string;
  /** test seam: overrides both fetch targets */
  tagsUrl?: string;
}

const STABLE = /^(\d+)\.(\d+)\.(\d+)$/;
const CHECK_EVERY_MS = 24 * 60 * 60_000;
const DRAIN_TIMEOUT_MS = 60 * 60_000;
const FETCH_TIMEOUT_MS = 10_000;

/** numeric semver compare over stable x.y.z; anything else was filtered out before */
export function compareVersions(a: string, b: string): number {
  const pa = a.match(STABLE)!.slice(1).map(Number);
  const pb = b.match(STABLE)!.slice(1).map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! - pb[i]!;
  return 0;
}

/** `## 0.2.0 — date` sections of the releases repo CHANGELOG, newest first as written */
export function parseChangelog(md: string): { version: string; notes: string }[] {
  const out: { version: string; notes: string }[] = [];
  const parts = md.split(/^## +/m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const heading = (nl === -1 ? part : part.slice(0, nl)).trim();
    const version = heading.split(/\s+/).find((w) => STABLE.test(w));
    if (version) out.push({ version, notes: (nl === -1 ? '' : part.slice(nl + 1)).trim() });
  }
  return out;
}

export class UpdateManager {
  private cached: UpdateReport | null = null;
  private checking: Promise<UpdateReport> | null = null;
  private applying = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly image: string;
  private readonly changelogUrl: string;
  private readonly tagsUrl: string;

  constructor(
    private engine: Engine,
    opts: UpdaterOptions = {},
  ) {
    this.image = opts.image ?? process.env.FOUNDRY_UPDATE_IMAGE ?? 'imlouiskhenghao/foundry';
    this.changelogUrl = opts.changelogUrl ?? process.env.FOUNDRY_CHANGELOG_URL ?? 'https://raw.githubusercontent.com/louiskhenghao/foundry-releases/main/CHANGELOG.md';
    this.tagsUrl = opts.tagsUrl ?? `https://hub.docker.com/v2/repositories/${this.image}/tags?page_size=100`;
  }

  /** the root package.json version — the one product version every package shares */
  current(): string {
    try {
      return String(JSON.parse(readFileSync(join(this.engine.config.rootDir, 'package.json'), 'utf8')).version ?? '0.0.0');
    } catch {
      return '0.0.0';
    }
  }

  /** detected, never configured: the image sets FOUNDRY_DOCKER; a source install has .git */
  mode(): DeploymentMode {
    if (process.env.FOUNDRY_DOCKER || existsSync('/.dockerenv')) return 'docker';
    if (existsSync(join(this.engine.config.rootDir, '.git'))) return 'local';
    return 'unknown';
  }

  capability(): UpdateCapability {
    const mode = this.mode();
    if (mode === 'docker') {
      const can = !!(process.env.FOUNDRY_WATCHTOWER_URL && process.env.FOUNDRY_WATCHTOWER_TOKEN);
      return { mode, canSelfUpdate: can, method: can ? 'watchtower' : null, guided: ['docker compose pull foundry', 'docker compose up -d foundry'] };
    }
    if (mode === 'local') {
      const can = !!(Bun.which('git') && Bun.which('bun'));
      return { mode, canSelfUpdate: can, method: can ? 'git' : null, guided: ['git pull', 'bun install', 'bun run web:build', 'bun run serve'] };
    }
    return { mode, canSelfUpdate: false, method: null, guided: [`docker pull ${this.image}:latest`] };
  }

  cachedReport(): UpdateReport | null {
    return this.cached;
  }
  isApplying(): boolean {
    return this.applying;
  }

  /** cached report, kicking off a background check when there has never been one (skills-updates pattern) */
  reportOrKick(): UpdateReport {
    if (!this.cached && !this.checking) void this.check().catch((e) => this.engine.config.log(`[update] check failed: ${e}`));
    return this.cached ?? { current: this.current(), latest: null, updateAvailable: false, checkedAt: null, changelog: [], error: null };
  }
  isChecking(): boolean {
    return !!this.checking;
  }

  /** ask Docker Hub for the newest stable tag and the releases repo for its notes; announces once per version */
  check(): Promise<UpdateReport> {
    if (this.checking) return this.checking;
    this.checking = this.doCheck().finally(() => (this.checking = null));
    return this.checking;
  }

  private async doCheck(): Promise<UpdateReport> {
    const current = this.current();
    let latest: string | null = null;
    let changelog: { version: string; notes: string }[] = [];
    let error: string | null = null;
    try {
      const res = await fetch(this.tagsUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`Docker Hub answered ${res.status}`);
      const body = (await res.json()) as { results?: { name: string }[] };
      const stable = (body.results ?? []).map((r) => r.name).filter((n) => STABLE.test(n));
      latest = stable.sort(compareVersions).at(-1) ?? null;
    } catch (e) {
      error = `version source unreachable: ${String((e as Error).message ?? e)}`;
    }
    const updateAvailable = !!latest && STABLE.test(current) && compareVersions(latest, current) > 0;
    if (updateAvailable) {
      try {
        const res = await fetch(this.changelogUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (res.ok) changelog = parseChangelog(await res.text()).filter((s) => STABLE.test(s.version) && compareVersions(s.version, current) > 0);
      } catch {} // notes are a nice-to-have; the version number alone is the feature
      const last = this.engine.store.listByType('update.available', 1)[0];
      if (!last || (last.payload as { latest: string }).latest !== latest) {
        this.engine.store.append({ type: 'update.available', goalId: null, payload: { current, latest: latest!, mode: this.mode() } });
      }
    }
    this.cached = { current, latest, updateAvailable, checkedAt: new Date().toISOString(), changelog, error };
    return this.cached;
  }

  /** daily background check; started by `serve`, never by tests. FOUNDRY_UPDATE_CHECK=off disables it. */
  startSchedule(): void {
    if (this.timer || /^(0|false|off|no)$/i.test(process.env.FOUNDRY_UPDATE_CHECK ?? '')) return;
    setTimeout(() => void this.check().catch((e) => this.engine.config.log(`[update] check failed: ${e}`)), 15_000);
    this.timer = setInterval(() => void this.check().catch((e) => this.engine.config.log(`[update] check failed: ${e}`)), CHECK_EVERY_MS);
  }
  stopSchedule(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * One-click update: drain (unless force), then hand over to watchtower (docker) or run the
   * git pipeline with rollback (local). Runs in the background; progress goes to onLine.
   */
  async apply(opts: { force?: boolean; onLine?: (line: string) => void } = {}): Promise<void> {
    const line = opts.onLine ?? (() => {});
    const cap = this.capability();
    if (this.applying) throw new Error('an update is already running');
    if (!cap.canSelfUpdate) throw new Error(`this ${cap.mode} install cannot self-update — run: ${cap.guided.join(' && ')}`);
    const report = this.cached ?? (await this.check());
    if (!report.updateAvailable || !report.latest) throw new Error('no newer version to update to');
    this.applying = true;
    const t0 = Date.now();
    const done = (ok: boolean, error: string | null) =>
      this.engine.store.append({ type: 'update.run', goalId: null, payload: { mode: cap.mode, from: report.current, to: report.latest!, ok, error, durationMs: Date.now() - t0 } });
    try {
      await this.drain(!!opts.force, line);
      if (cap.method === 'watchtower') await this.applyDocker(report.latest, line, done);
      else await this.applyLocal(report.latest, line, done);
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      line(`✘ ${msg}`);
      done(false, msg);
      this.engine.endUpdateDrain();
      this.applying = false;
      throw e;
    }
  }

  /** no new sessions start (engine gate), then wait for in-flight work — the human can force past the wait */
  private async drain(force: boolean, line: (l: string) => void): Promise<void> {
    this.engine.beginUpdateDrain();
    if (force) {
      const n = this.engine.busy().total;
      if (n) line(`⚠ forcing update with ${n} active session(s) — they will be interrupted`);
      return;
    }
    const t0 = Date.now();
    let lastSaid = 0;
    while (this.engine.busy().total > 0) {
      if (Date.now() - t0 > DRAIN_TIMEOUT_MS) throw new Error(`drain timed out after 60min with ${this.engine.busy().total} session(s) still active`);
      if (Date.now() - lastSaid > 10_000) {
        line(`⏳ waiting for ${this.engine.busy().total} active session(s) to finish…`);
        lastSaid = Date.now();
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    line('✔ drained — no active sessions');
  }

  /** watchtower pulls the new image and recreates this container; success means we die shortly */
  private async applyDocker(to: string, line: (l: string) => void, done: (ok: boolean, err: string | null) => void): Promise<void> {
    line(`→ asking watchtower to update to ${to}…`);
    const res = await fetch(`${process.env.FOUNDRY_WATCHTOWER_URL!.replace(/\/+$/, '')}/v1/update`, {
      headers: { Authorization: `Bearer ${process.env.FOUNDRY_WATCHTOWER_TOKEN}` },
      signal: AbortSignal.timeout(10 * 60_000), // watchtower answers after the pull; images are large
    });
    if (!res.ok) throw new Error(`watchtower answered ${res.status} — is the sidecar running?`);
    done(true, null);
    line('✔ new image pulled — watchtower is restarting this container now');
    // if we are still alive in 5 minutes the recreate never happened; reopen for business
    setTimeout(() => {
      if (!this.applying) return;
      this.applying = false;
      this.engine.endUpdateDrain();
      this.engine.config.log('[update] watchtower accepted the trigger but this container was never replaced');
    }, 5 * 60_000);
  }

  /** git pull → install → build; any failure restores the recorded commit and does NOT restart */
  private async applyLocal(to: string, line: (l: string) => void, done: (ok: boolean, err: string | null) => void): Promise<void> {
    const root = this.engine.config.rootDir;
    const rev = (await git(['rev-parse', 'HEAD'], root)).stdout.trim();
    const steps: string[][] = [
      ['git', 'pull', '--ff-only'],
      ['bun', 'install'],
      ['bun', 'run', 'web:build'],
    ];
    for (const cmd of steps) {
      line(`→ ${cmd.join(' ')}`);
      const r = await exec(cmd, root, { timeoutMs: 15 * 60_000 });
      if (r.code !== 0) {
        line(`✘ ${cmd.join(' ')} failed (${r.code}): ${(r.stderr || r.stdout).trim().slice(-800)}`);
        line(`↩ rolling back to ${rev.slice(0, 10)}…`);
        await git(['reset', '--hard', rev], root);
        await exec(['bun', 'install'], root, { timeoutMs: 15 * 60_000 });
        throw new Error(`${cmd.join(' ')} failed — rolled back, nothing restarted`);
      }
    }
    done(true, null);
    line(`✔ updated to ${to} — restarting…`);
    // hand the port over: spawn a detached successor that waits for this process to exit, then die
    const log = join(this.engine.config.dataDir, 'update-restart.log');
    const child = spawn('bash', ['-c', `sleep 1; exec bun apps/cli/src/main.ts serve >> ${JSON.stringify(log)} 2>&1`], { cwd: root, detached: true, stdio: 'ignore' });
    child.unref();
    setTimeout(() => process.exit(0), 500);
  }
}
