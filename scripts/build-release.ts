#!/usr/bin/env bun
/**
 * Build the release files (ADR-0101): one `foundry` executable per platform with its `resources/` folder beside it, packed
 * as a tarball, plus SHA256SUMS. The macOS executable is universal (arm64 + x86_64 through lipo); each thin slice is signed
 * ad-hoc first, because Bun's cross-compiled output carries the stale signature of the Bun it was made from, which the
 * kernel refuses to map. Run from the repository root; the macOS target needs a Mac with Xcode's command line tools
 * (lipo, codesign).
 *
 *   bun scripts/build-release.ts [--out dist/release] [--targets darwin-universal,linux-x64,linux-arm64] [--skip-web]
 *
 * Writes <out>/<version>/foundry-<version>-<target>.tar.gz for each target and SHA256SUMS beside them, and leaves each
 * target's unpacked folder at <out>/<version>/<target>/foundry-<version>/. With the macOS target it also builds the app
 * (ADR-0102): the Swift menu bar shell (apps/mac/Foundry/main.swift, universal through swiftc and lipo) as
 * Foundry.app/Contents/MacOS/Foundry, the universal foundry beside it as foundry-engine, the resources in
 * Contents/Resources, signed ad-hoc, packed as Foundry-<version>-mac-universal.zip (what an installed app updates from)
 * and Foundry-<version>-mac-universal.dmg (what a person downloads), both in SHA256SUMS.
 * The resources folder keeps the checkout's own layout — roles/, catalog/, templates/, packages/runner/hooks,
 * packages/engine/recipes, docs/guide, apps/web/dist, package.json — plus node_modules/playwright, which the engine
 * imports by path (packages/engine/src/playwright-load.ts).
 */
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const ALL_TARGETS = ['darwin-universal', 'linux-x64', 'linux-arm64'] as const;
type Target = (typeof ALL_TARGETS)[number];
/** what travels beside the executable, at the checkout's own relative paths; install.sh is what a checkout switches with (ADR-0103) */
const RESOURCES = ['apps/web/dist', 'roles', 'catalog', 'templates', 'packages/runner/hooks', 'packages/engine/recipes', 'docs/guide', 'THIRD-PARTY-NOTICES.txt', 'install.sh'];

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
// ---------- the macOS app (ADR-0102): the menu bar shell around the universal foundry, as a zip and a .dmg ----------
const appFiles: string[] = [];
if (targets.includes('darwin-universal')) {
  const appDir = join(dist, 'app');
  rmSync(appDir, { recursive: true, force: true });
  const app = join(appDir, 'Foundry.app');
  const macos = join(app, 'Contents', 'MacOS');
  mkdirSync(macos, { recursive: true });
  for (const [arch, triple] of [['arm64', 'arm64-apple-macos13.0'], ['x64', 'x86_64-apple-macos13.0']] as const) {
    await run(['swiftc', '-O', '-swift-version', '5', '-target', triple, join(ROOT, 'apps/mac/Foundry/main.swift'), '-o', join(appDir, `Foundry-${arch}`), '-framework', 'AppKit', '-framework', 'ServiceManagement']);
  }
  await run(['lipo', '-create', join(appDir, 'Foundry-arm64'), join(appDir, 'Foundry-x64'), '-output', join(macos, 'Foundry')]);
  for (const arch of ['arm64', 'x64']) rmSync(join(appDir, `Foundry-${arch}`), { force: true });
  // the compiled foundry cannot be `foundry` beside `Foundry` on a case-insensitive disk
  cpSync(executables.get('darwin-universal')!, join(macos, 'foundry-engine'));
  chmodSync(join(macos, 'foundry-engine'), 0o755);
  cpSync(stage, join(app, 'Contents', 'Resources'), { recursive: true });
  cpSync(join(ROOT, 'apps/mac/Foundry.icns'), join(app, 'Contents', 'Resources', 'Foundry.icns'));
  writeFileSync(join(app, 'Contents', 'Info.plist'), infoPlist(version));
  // ad-hoc: Apple Silicon runs nothing unsigned. The two executables first, then the bundle seals its resources
  for (const f of [join(macos, 'foundry-engine'), join(macos, 'Foundry')]) await run(['codesign', '--force', '-s', '-', f], { quiet: true });
  await run(['codesign', '--force', '-s', '-', app], { quiet: true });
  await run(['codesign', '--verify', '--strict', app], { quiet: true });
  const zip = `Foundry-${version}-mac-universal.zip`;
  rmSync(join(dist, zip), { force: true });
  await run(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', app, join(dist, zip)]);
  // the .dmg: the app beside a link to /Applications, to drag onto
  const dmgSrc = join(appDir, 'dmg');
  mkdirSync(dmgSrc, { recursive: true });
  await run(['ditto', app, join(dmgSrc, 'Foundry.app')], { quiet: true });
  symlinkSync('/Applications', join(dmgSrc, 'Applications'));
  const dmg = `Foundry-${version}-mac-universal.dmg`;
  rmSync(join(dist, dmg), { force: true });
  await run(['hdiutil', 'create', '-volname', `Foundry ${version}`, '-srcfolder', dmgSrc, '-ov', '-format', 'UDZO', join(dist, dmg)]);
  rmSync(dmgSrc, { recursive: true, force: true });
  for (const f of [zip, dmg]) {
    sums.push(`${await sha256(join(dist, f))}  ${f}`);
    appFiles.push(f);
  }
  const got = JSON.parse(await run([join(macos, 'foundry-engine'), 'version', '--json'], { quiet: true }));
  if (got.version !== version || got.install !== 'app') fail(`the app's foundry says ${JSON.stringify(got)}, expected version ${version} as an app install`);
  console.log(`✔ Foundry.app: ${mb(statSync(join(dist, zip)).size)} zip, ${mb(statSync(join(dist, dmg)).size)} dmg; its foundry-engine answers as an app install`);
}

writeFileSync(join(dist, 'SHA256SUMS'), sums.join('\n') + '\n');
rmSync(bin, { recursive: true, force: true });

// ---------- the host's own executable answers ----------
const host: Target | null = process.platform === 'darwin' && targets.includes('darwin-universal') ? 'darwin-universal' : process.platform === 'linux' && executables.has(`linux-${process.arch}` as Target) ? (`linux-${process.arch}` as Target) : null;
if (host) {
  const exe = join(dist, host, `foundry-${version}`, 'foundry');
  const got = JSON.parse(await run([exe, 'version', '--json'], { quiet: true }));
  if (got.version !== version || got.install !== 'binary') fail(`the built foundry says ${JSON.stringify(got)}, expected version ${version} as a binary install`);
  console.log(`✔ ${exe} runs: ${got.version}, ${got.install} install, ${got.runtime}`);
}
console.log(`\nbuilt ${version}: ${[...targets.map((t) => `foundry-${version}-${t}.tar.gz`), ...appFiles].join(', ')} + SHA256SUMS in ${dist}`);

/** the app's Info.plist: a menu bar app (no Dock icon) for macOS 13 and later, which SMAppService needs */
function infoPlist(v: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.louiskhenghao.foundry</string>
  <key>CFBundleName</key><string>Foundry</string>
  <key>CFBundleDisplayName</key><string>Foundry</string>
  <key>CFBundleExecutable</key><string>Foundry</string>
  <key>CFBundleIconFile</key><string>Foundry</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleShortVersionString</key><string>${v}</string>
  <key>CFBundleVersion</key><string>${v}</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
`;
}
