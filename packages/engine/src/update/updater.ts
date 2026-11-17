/**
 * Version self-knowledge and the self-update pipeline (ADR-0010, ADR-0104).
 * The version source is the public releases repository's GitHub Releases, for every deployment mode (the main repo may be
 * private; the releases repo is not), and the changelog comes from the same repo. Docker self-update goes through the
 * watchtower sidecar; a git checkout pulls, installs and builds with automatic rollback; a release install — the macOS
 * app, a Linux or macOS tarball — downloads the release, checks its sha256 and swaps itself in. An instance that cannot
 * self-update degrades to guided commands — never an error.
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import type { Engine } from '../engine.ts';
import { exec, git } from '../git/git.ts';
import { installRoot, type InstallRoot } from '../install-root.ts';

export type DeploymentMode = 'docker' | 'local' | 'app' | 'binary' | 'unknown';

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
}

export interface UpdateReport {
  current: string;
  /** newest stable release; null while the source is unreachable */
  latest: string | null;
  updateAvailable: boolean;
  checkedAt: string | null;
  /** notes for every version newer than current, newest first (empty when the releases repo has none) */
  changelog: { version: string; notes: string }[];
  error: string | null;
  /** the newest release's files, what a release install downloads */
  assets: ReleaseAsset[];
}

export interface UpdateCapability {
  mode: DeploymentMode;
  canSelfUpdate: boolean;
  method: 'watchtower' | 'git' | 'release' | null;
  /** commands for a guided update in this mode, shown when canSelfUpdate is false */
  guided: string[];
}

export interface UpdaterOptions {
  /** GitHub Releases API of the public releases repository, the version source */
  releasesUrl?: string;
  /** raw URL of the public releases repo changelog */
  changelogUrl?: string;
  /** Docker Hub repository of the image, for the guided commands of a container */
  image?: string;
  /** test seams: how this Foundry is installed, and the computer it runs on */
  install?: InstallRoot;
  platform?: NodeJS.Platform;
  arch?: string;
  env?: NodeJS.ProcessEnv;
}

/** a GitHub release as its API lists it: only the fields the updater reads */
export interface GitHubRelease {
  tag_name: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: { name: string; browser_download_url: string; size?: number }[];
}

const STABLE = /^(\d+)\.(\d+)\.(\d+)$/;
const CHECK_EVERY_MS = 24 * 60 * 60_000;
const DRAIN_TIMEOUT_MS = 60 * 60_000;
const FETCH_TIMEOUT_MS = 10_000;
const DOWNLOAD_TIMEOUT_MS = 30 * 60_000;
const USER_AGENT = 'foundry-updater';
export const RELEASES_PAGE = 'https://github.com/louiskhenghao/foundry-releases/releases';
/** the engine's exit code when a downloaded release waits in updates/ready.json for the menu bar app to install (ADR-0104) */
export const UPDATE_READY_EXIT = 75;
export const SHA256SUMS = 'SHA256SUMS';

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

/** the newest stable, published release (`vX.Y.Z`): drafts, pre-releases and other tags are invisible */
export function pickLatestRelease(releases: GitHubRelease[]): { version: string; assets: ReleaseAsset[] } | null {
  let best: { version: string; assets: ReleaseAsset[] } | null = null;
  for (const r of releases) {
    if (r.draft || r.prerelease) continue;
    const version = String(r.tag_name ?? '').replace(/^v/, '');
    if (!STABLE.test(version)) continue;
    if (!best || compareVersions(version, best.version) > 0) best = { version, assets: (r.assets ?? []).map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size ?? 0 })) };
  }
  return best;
}

/** the release file for this install and computer; null for a combination no release carries */
export function releaseAssetName(mode: 'app' | 'binary', version: string, platform: NodeJS.Platform | string, arch: string): string | null {
  if (mode === 'app') return platform === 'darwin' ? `Foundry-${version}-mac-universal.zip` : null;
  if (platform === 'darwin') return `foundry-${version}-darwin-universal.tar.gz`;
  if (platform === 'linux') return arch === 'arm64' || arch === 'x64' ? `foundry-${version}-linux-${arch}.tar.gz` : null;
  return null;
}

/** `<hex>  <name>` lines, as sha256sum writes them */
export function parseSha256Sums(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
    if (m) out.set(m[2]!.trim(), m[1]!.toLowerCase());
  }
  return out;
}

/** a tarball install's layout: `<base>/<version>/foundry` with `<base>/current` a symlink to the version in use */
export interface ReleaseLayout {
  base: string;
  current: string;
}
export function releaseLayout(execDir: string | null, lstat: (p: string) => { isSymbolicLink(): boolean } = lstatSync): ReleaseLayout | null {
  if (!execDir) return null;
  const base = dirname(execDir);
  const current = join(base, 'current');
  try {
    return lstat(current).isSymbolicLink() ? { base, current } : null;
  } catch {
    return null;
  }
}

async function sha256File(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher('sha256');
  const reader = Bun.file(path).stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hasher.update(value);
  }
  return hasher.digest('hex');
}

const formatBytes = (n: number) => (n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(1)} GB` : n >= 1 << 20 ? `${Math.round(n / (1 << 20))} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export class UpdateManager {
  private cached: UpdateReport | null = null;
  private checking: Promise<UpdateReport> | null = null;
  private applying = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly image: string;
  private readonly changelogUrl: string;
  private readonly releasesUrl: string;
  private readonly install: InstallRoot;
  private readonly platform: NodeJS.Platform;
  private readonly arch: string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(
    private engine: Engine,
    opts: UpdaterOptions = {},
  ) {
    this.env = opts.env ?? process.env;
    this.image = opts.image ?? this.env.FOUNDRY_UPDATE_IMAGE ?? 'imlouiskhenghao/foundry';
    this.changelogUrl = opts.changelogUrl ?? this.env.FOUNDRY_CHANGELOG_URL ?? 'https://raw.githubusercontent.com/louiskhenghao/foundry-releases/main/CHANGELOG.md';
    this.releasesUrl = opts.releasesUrl ?? this.env.FOUNDRY_RELEASES_URL ?? 'https://api.github.com/repos/louiskhenghao/foundry-releases/releases?per_page=20';
    this.install = opts.install ?? installRoot();
    this.platform = opts.platform ?? process.platform;
    this.arch = opts.arch ?? process.arch;
  }

  /** the root package.json version — the one product version every package shares */
  current(): string {
    try {
      return String(JSON.parse(readFileSync(join(this.engine.config.rootDir, 'package.json'), 'utf8')).version ?? '0.0.0');
    } catch {
      return '0.0.0';
    }
  }

  /** detected, never configured: the image sets FOUNDRY_DOCKER; a compiled foundry knows its layout; a source install has .git */
  mode(): DeploymentMode {
    if (this.env.FOUNDRY_DOCKER || existsSync('/.dockerenv')) return 'docker';
    if (this.install.kind === 'app' || this.install.kind === 'binary') return this.install.kind;
    if (existsSync(join(this.engine.config.rootDir, '.git'))) return 'local';
    return 'unknown';
  }

  capability(): UpdateCapability {
    const mode = this.mode();
    if (mode === 'docker') {
      const can = !!(this.env.FOUNDRY_WATCHTOWER_URL && this.env.FOUNDRY_WATCHTOWER_TOKEN);
      return { mode, canSelfUpdate: can, method: can ? 'watchtower' : null, guided: ['docker compose pull foundry', 'docker compose up -d foundry'] };
    }
    if (mode === 'local') {
      const can = !!(Bun.which('git') && Bun.which('bun'));
      return { mode, canSelfUpdate: can, method: can ? 'git' : null, guided: ['git pull', 'bun install', 'bun run web:build', 'bun run serve'] };
    }
    const latest = this.cached?.latest ?? '<version>';
    if (mode === 'app') {
      // the menu bar app swaps the bundle once the engine has the release ready (exit 75); without it, nothing can
      const can = !!this.env.FOUNDRY_APP_SHELL;
      return { mode, canSelfUpdate: can, method: can ? 'release' : null, guided: [`open ${RELEASES_PAGE}`, `download ${releaseAssetName('app', latest, 'darwin', this.arch)} and replace /Applications/Foundry.app with the Foundry.app inside it`] };
    }
    if (mode === 'binary') {
      const layout = releaseLayout(this.install.execDir);
      const name = releaseAssetName('binary', latest, this.platform, this.arch) ?? `foundry-${latest}-<platform>.tar.gz`;
      return { mode, canSelfUpdate: !!layout, method: layout ? 'release' : null, guided: [`open ${RELEASES_PAGE}`, `tar -xzf ${name}`, `replace ${this.install.execDir ?? 'the install folder'} with the unpacked foundry-${latest} folder, then restart foundry`] };
    }
    return { mode, canSelfUpdate: false, method: null, guided: [`open ${RELEASES_PAGE}`] };
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
    return this.cached ?? { current: this.current(), latest: null, updateAvailable: false, checkedAt: null, changelog: [], error: null, assets: [] };
  }
  isChecking(): boolean {
    return !!this.checking;
  }

  /** ask GitHub for the newest stable release and the releases repo for its notes; announces once per version */
  check(): Promise<UpdateReport> {
    if (this.checking) return this.checking;
    this.checking = this.doCheck().finally(() => (this.checking = null));
    return this.checking;
  }

  private async doCheck(): Promise<UpdateReport> {
    const current = this.current();
    let latest: string | null = null;
    let assets: ReleaseAsset[] = [];
    let changelog: { version: string; notes: string }[] = [];
    let error: string | null = null;
    try {
      const res = await fetch(this.releasesUrl, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
      const body = (await res.json()) as GitHubRelease[];
      const picked = pickLatestRelease(Array.isArray(body) ? body : []);
      latest = picked?.version ?? null;
      assets = picked?.assets ?? [];
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
    this.cached = { current, latest, updateAvailable, checkedAt: new Date().toISOString(), changelog, error, assets };
    return this.cached;
  }

  /** daily background check; started by `serve`, never by tests. FOUNDRY_UPDATE_CHECK=off disables it. */
  startSchedule(): void {
    if (this.timer || /^(0|false|off|no)$/i.test(this.env.FOUNDRY_UPDATE_CHECK ?? '')) return;
    setTimeout(() => void this.check().catch((e) => this.engine.config.log(`[update] check failed: ${e}`)), 15_000);
    this.timer = setInterval(() => void this.check().catch((e) => this.engine.config.log(`[update] check failed: ${e}`)), CHECK_EVERY_MS);
  }
  stopSchedule(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * One-click update: drain (unless force), then hand over to watchtower (docker), run the git pipeline with rollback
   * (local), or download, verify and swap the release (app, binary). Runs in the background; progress goes to onLine.
   */
  async apply(opts: { force?: boolean; onLine?: (line: string) => void } = {}): Promise<void> {
    const line = opts.onLine ?? (() => {});
    const cap = this.capability();
    if (this.applying) throw new Error('an update is already running');
    if (!cap.canSelfUpdate) throw new Error(`this ${cap.mode} install cannot self-update — ${cap.guided.join('; ')}`);
    const report = this.cached ?? (await this.check());
    if (!report.updateAvailable || !report.latest) throw new Error('no newer version to update to');
    this.applying = true;
    const t0 = Date.now();
    const done = (ok: boolean, error: string | null) =>
      this.engine.store.append({ type: 'update.run', goalId: null, payload: { mode: cap.mode, from: report.current, to: report.latest!, ok, error, durationMs: Date.now() - t0 } });
    try {
      await this.drain(!!opts.force, line);
      if (cap.method === 'watchtower') await this.applyDocker(report.latest, line, done);
      else if (cap.method === 'release') await this.applyRelease(report.latest, report.assets, line, done);
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
    const res = await fetch(`${this.env.FOUNDRY_WATCHTOWER_URL!.replace(/\/+$/, '')}/v1/update`, {
      headers: { Authorization: `Bearer ${this.env.FOUNDRY_WATCHTOWER_TOKEN}` },
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
    this.restart(to, line, 'bun apps/cli/src/main.ts serve', root);
  }

  /**
   * A release install (ADR-0104): download this computer's file, check it against SHA256SUMS, unpack it under the data
   * folder's updates/. The app writes updates/ready.json and exits 75 so the menu bar app swaps the bundle and starts it
   * again; a tarball install moves the new version beside the old one, repoints `current` and restarts.
   */
  private async applyRelease(to: string, assets: ReleaseAsset[], line: (l: string) => void, done: (ok: boolean, err: string | null) => void): Promise<void> {
    const mode = this.mode();
    if (mode !== 'app' && mode !== 'binary') throw new Error(`not a release install (${mode})`);
    const name = releaseAssetName(mode, to, this.platform, this.arch);
    const asset = name ? assets.find((a) => a.name === name) : undefined;
    const sums = assets.find((a) => a.name === SHA256SUMS);
    if (!asset) throw new Error(`release ${to} has no file for this computer (${name ?? `${this.platform}/${this.arch}`})`);
    if (!sums) throw new Error(`release ${to} has no ${SHA256SUMS}`);
    const dir = join(this.engine.config.dataDir, 'updates', to);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, asset.name);
    line(`→ downloading ${asset.name}${asset.size ? ` (${formatBytes(asset.size)})` : ''}…`);
    const res = await fetch(asset.url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS), redirect: 'follow' });
    if (!res.ok) throw new Error(`download failed: GitHub answered ${res.status}`);
    await Bun.write(file, res);
    const sumsRes = await fetch(sums.url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' });
    if (!sumsRes.ok) throw new Error(`${SHA256SUMS} could not be read: GitHub answered ${sumsRes.status}`);
    const expected = parseSha256Sums(await sumsRes.text()).get(asset.name);
    if (!expected) throw new Error(`${SHA256SUMS} has no entry for ${asset.name}`);
    const actual = await sha256File(file);
    if (actual !== expected) {
      rmSync(file, { force: true });
      throw new Error(`${asset.name} does not match ${SHA256SUMS} (expected ${expected.slice(0, 12)}…, got ${actual.slice(0, 12)}…) — nothing changed`);
    }
    line('✔ checksum verified');
    const unpacked = join(dir, 'unpacked');
    rmSync(unpacked, { recursive: true, force: true });
    mkdirSync(unpacked, { recursive: true });
    line('→ unpacking…');
    const cmd = asset.name.endsWith('.zip') ? (this.platform === 'darwin' ? ['ditto', '-x', '-k', file, unpacked] : ['unzip', '-q', file, '-d', unpacked]) : ['tar', '-xzf', file, '-C', unpacked];
    const r = await exec(cmd, dir, { timeoutMs: 10 * 60_000 });
    if (r.code !== 0) throw new Error(`${cmd[0]} failed (${r.code}): ${(r.stderr || r.stdout).trim().slice(-400)}`);
    rmSync(file, { force: true });
    if (mode === 'app') {
      const bundle = join(unpacked, 'Foundry.app');
      if (!existsSync(join(bundle, 'Contents', 'MacOS', 'foundry'))) throw new Error(`${asset.name} holds no Foundry.app`);
      writeFileSync(join(this.engine.config.dataDir, 'updates', 'ready.json'), JSON.stringify({ version: to, bundle, at: new Date().toISOString() }, null, 2) + '\n');
      done(true, null);
      line(`✔ ${to} is ready — exiting so the menu bar app installs it and starts it again`);
      setTimeout(() => process.exit(UPDATE_READY_EXIT), 500);
      return;
    }
    const layout = releaseLayout(this.install.execDir);
    if (!layout) throw new Error('this install is not in a release folder with a `current` link');
    const top = readdirSync(unpacked).find((d) => d.startsWith('foundry-'));
    if (!top || !existsSync(join(unpacked, top, 'foundry'))) throw new Error(`${asset.name} holds no foundry-${to} folder`);
    const dest = join(layout.base, to);
    rmSync(dest, { recursive: true, force: true });
    renameSync(join(unpacked, top), dest);
    // repoint `current` in one step: a link to the new version, renamed over the old link
    const tmpLink = join(layout.base, `.current-${process.pid}`);
    rmSync(tmpLink, { force: true });
    symlinkSync(to, tmpLink);
    renameSync(tmpLink, layout.current);
    rmSync(dir, { recursive: true, force: true });
    done(true, null);
    this.restart(to, line, `${JSON.stringify(join(layout.current, 'foundry'))} serve`, layout.base);
  }

  /** under a supervisor just exit (it restarts the new version); otherwise hand the port to a detached successor */
  private restart(to: string, line: (l: string) => void, serveCommand: string, cwd: string): void {
    // under launchd/systemd (FOUNDRY_SUPERVISED=1, or systemd's own INVOCATION_ID) a detached successor would
    // fight the supervisor's restart for the port: just exit and let it bring the new version up
    if (this.env.FOUNDRY_SUPERVISED || this.env.INVOCATION_ID) {
      line(`✔ updated to ${to} — exiting so the service manager restarts it`);
      setTimeout(() => process.exit(0), 500);
      return;
    }
    line(`✔ updated to ${to} — restarting…`);
    const log = join(this.engine.config.dataDir, 'update-restart.log');
    const child = spawn('bash', ['-c', `sleep 1; exec ${serveCommand} >> ${JSON.stringify(log)} 2>&1`], { cwd, detached: true, stdio: 'ignore' });
    child.unref();
    setTimeout(() => process.exit(0), 500);
  }
}
