#!/usr/bin/env bun
/**
 * Build the release files (ADR-0104): one `foundry` executable per platform with its `resources/` folder beside it, packed
 * as a tarball, plus SHA256SUMS. The macOS executable is universal (arm64 + x86_64 through lipo); each thin slice is signed
 * ad-hoc first, because Bun's cross-compiled output carries the stale signature of the Bun it was made from, which the
 * kernel refuses to map. Run from the repository root; the macOS target needs a Mac with Xcode's command line tools
 * (lipo, codesign).
 *
 *   bun scripts/build-release.ts [--out dist/release] [--targets darwin-universal,linux-x64,linux-arm64] [--skip-web]
 *
 * Writes <out>/<version>/foundry-<version>-<target>.tar.gz for each target and SHA256SUMS beside them, and leaves each
 * target's unpacked folder at <out>/<version>/<target>/foundry-<version>/ (the macOS one is what the app bundle wraps).
 * The resources folder keeps the checkout's own layout — roles/, catalog/, templates/, packages/runner/hooks,
 * packages/engine/recipes, docs/guide, apps/web/dist, package.json — plus node_modules/playwright, which the engine
 * imports by path (packages/engine/src/playwright-load.ts).
 */
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const ALL_TARGETS = ['darwin-universal', 'linux-x64', 'linux-arm64'] as const;
type Target = (typeof ALL_TARGETS)[number];
/** what travels beside the executable, at the checkout's own relative paths */
const RESOURCES = ['apps/web/dist', 'roles', 'catalog', 'templates', 'packages/runner/hooks', 'packages/engine/recipes', 'docs/guide', 'THIRD-PARTY-NOTICES.txt'];

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? null);
};
const out = resolve(flag('--out') ?? join(ROOT, 'dist', 'release'));
const targets = ((flag('--targets') ?? ALL_TARGETS.join(',')).split(',').map((t) => t.trim()).filter(Boolean) as Target[]);
const skipWeb = args.includes('--skip-web');
for (const t of targets) if (!ALL_TARGETS.includes(t)) fail(`unknown target ${t} (one of ${ALL_TARGETS.join(', ')})`);

function fail(msg: string): never {
  console.error(`✘ ${msg}`);
  process.exit(1);
}
async function run(cmd: string[], opts: { cwd?: string; env?: Record<string, string>; quiet?: boolean } = {}): Promise<string> {
  if (!opts.quiet) console.log(`$ ${cmd.join(' ')}`);
  const p = Bun.spawn(cmd, { cwd: opts.cwd ?? ROOT, env: { ...process.env, ...opts.env }, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) fail(`${cmd.join(' ')} → ${code}\n${(stderr || stdout).trim().slice(-2000)}`);
  return stdout;
}
const mb = (n: number) => `${(n / (1 << 20)).toFixed(1)} MB`;
async function sha256(path: string): Promise<string> {
  const h = new Bun.CryptoHasher('sha256');
  const reader = Bun.file(path).stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    h.update(value);
  }
  return h.digest('hex');
}

const version = String(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version);
const dist = join(out, version);
mkdirSync(dist, { recursive: true });
console.log(`building foundry ${version} → ${dist} (${targets.join(', ')})\n`);

// ---------- the UI ----------
if (!skipWeb) await run(['bun', 'run', 'web:build']);
if (!existsSync(join(ROOT, 'apps/web/dist/index.html'))) fail('apps/web/dist/index.html is missing — run bun run web:build');

// ---------- resources: the checkout's layout, plus Playwright installed flat ----------
const stage = join(dist, 'resources');
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const rel of RESOURCES) {
  if (!existsSync(join(ROOT, rel))) fail(`${rel} is missing`);
  cpSync(join(ROOT, rel), join(stage, rel), { recursive: true });
}
writeFileSync(join(stage, 'package.json'), JSON.stringify({ name: 'foundry', version, private: true }, null, 2) + '\n');
const pwVersion = String(JSON.parse(readFileSync(Bun.resolveSync('playwright/package.json', join(ROOT, 'packages/engine/src')), 'utf8')).version);
const pwInstall = join(dist, 'playwright-install');
rmSync(pwInstall, { recursive: true, force: true });
mkdirSync(pwInstall, { recursive: true });
writeFileSync(join(pwInstall, 'package.json'), JSON.stringify({ name: 'foundry-resources', private: true, dependencies: { playwright: pwVersion } }, null, 2) + '\n');
// hoisted: real folders, no symlinks into a store, so the copy stands alone
await run(['bun', 'install', '--linker=hoisted', '--no-summary'], { cwd: pwInstall });
cpSync(join(pwInstall, 'node_modules'), join(stage, 'node_modules'), { recursive: true, dereference: true });
rmSync(pwInstall, { recursive: true, force: true });
if (!existsSync(join(stage, 'node_modules/playwright/cli.js'))) fail('playwright did not install into the resources');
console.log(`resources staged (playwright ${pwVersion})\n`);

// ---------- executables ----------
const bin = join(dist, 'bin');
mkdirSync(bin, { recursive: true });
async function compile(bunTarget: string): Promise<string> {
  const file = join(bin, `foundry-${bunTarget}`);
  await run(['bun', 'build', '--compile', `--target=bun-${bunTarget}`, 'apps/cli/src/main.ts', '--outfile', file]);
  return file;
}
const executables = new Map<Target, string>();
for (const t of targets) {
  if (t === 'darwin-universal') {
    if (process.platform !== 'darwin') fail('the macOS target needs a Mac (lipo, codesign)');
    const arm = await compile('darwin-arm64');
    const x64 = await compile('darwin-x64');
    for (const f of [arm, x64]) await run(['codesign', '--force', '-s', '-', f], { quiet: true });
    const fat = join(bin, 'foundry-darwin-universal');
    await run(['lipo', '-create', arm, x64, '-output', fat]);
    await run(['codesign', '--force', '-s', '-', fat], { quiet: true });
    executables.set(t, fat);
  } else {
    executables.set(t, await compile(t));
  }
}

// ---------- the folders and tarballs ----------
const sums: string[] = [];
for (const t of targets) {
  const dir = join(dist, t);
  const pkg = join(dir, `foundry-${version}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(pkg, { recursive: true });
  cpSync(executables.get(t)!, join(pkg, 'foundry'));
  chmodSync(join(pkg, 'foundry'), 0o755);
  cpSync(stage, join(pkg, 'resources'), { recursive: true });
  const tarball = join(dist, `foundry-${version}-${t}.tar.gz`);
  rmSync(tarball, { force: true });
  // COPYFILE_DISABLE: no ._ files for macOS extended attributes in the archive
  await run(['tar', '-czf', tarball, '-C', dir, `foundry-${version}`], { env: { COPYFILE_DISABLE: '1' } });
  sums.push(`${await sha256(tarball)}  foundry-${version}-${t}.tar.gz`);
  console.log(`✔ ${t}: ${mb(statSync(tarball).size)} tarball, executable ${mb(statSync(join(pkg, 'foundry')).size)}`);
}
writeFileSync(join(dist, 'SHA256SUMS'), sums.join('\n') + '\n');
rmSync(bin, { recursive: true, force: true });

// ---------- the host's own executable answers ----------
const host: Target | null = process.platform === 'darwin' && targets.includes('darwin-universal') ? 'darwin-universal' : process.platform === 'linux' ? ((`linux-${process.arch}` as Target) in executables ? (`linux-${process.arch}` as Target) : null) : null;
if (host) {
  const exe = join(dist, host, `foundry-${version}`, 'foundry');
  const got = JSON.parse(await run([exe, 'version', '--json'], { quiet: true }));
  if (got.version !== version || got.install !== 'binary') fail(`the built foundry says ${JSON.stringify(got)}, expected version ${version} as a binary install`);
  console.log(`✔ ${exe} runs: ${got.version}, ${got.install} install, ${got.runtime}`);
}
console.log(`\nbuilt ${version}: ${targets.map((t) => `foundry-${version}-${t}.tar.gz`).join(', ')} + SHA256SUMS in ${dist}`);
