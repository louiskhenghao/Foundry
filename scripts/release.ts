/**
 * One-command release (ADR-0010): bump the product version, tag, publish the changelog to the
 * public releases repo, and push the multi-arch image to Docker Hub — which is the moment
 * deployed instances can see the new version.
 *
 *   bun run release patch|minor|major|x.y.z [--notes "..."] [--dry-run]
 *
 * Notes default to the commit subjects since the last release tag. The changelog lives in
 * github.com/louiskhenghao/foundry-releases (public; created on first release) because the main
 * repo is private and deployments read the notes unauthenticated.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const IMAGE = 'imlouiskhenghao/foundry';
const RELEASES_REPO = 'louiskhenghao/foundry-releases';
const RELEASES_DIR = join(ROOT, 'data', 'releases-repo');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const notesIdx = args.indexOf('--notes');
const notesArg = notesIdx !== -1 ? args[notesIdx + 1] : null;
const bumpArg = args.find((a) => !a.startsWith('--') && a !== notesArg);

function fail(msg: string): never {
  console.error(`✘ ${msg}`);
  process.exit(1);
}

async function run(cmd: string[], opts: { cwd?: string; canFail?: boolean } = {}): Promise<{ code: number; out: string }> {
  console.log(`$ ${cmd.join(' ')}`);
  const p = Bun.spawn(cmd, { cwd: opts.cwd ?? ROOT, stdout: 'pipe', stderr: 'pipe' });
  const [out, errTxt, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0 && !opts.canFail) fail(`${cmd.join(' ')} → ${code}\n${errTxt || out}`);
  return { code, out: (out + errTxt).trim() };
}
const git = (a: string[], cwd = ROOT) => run(['git', ...a], { cwd });

// ---------- preconditions ----------
if (!bumpArg) fail('usage: bun run release patch|minor|major|x.y.z [--notes "..."] [--dry-run]');
if ((await git(['status', '--porcelain'])).out) fail('working tree is not clean — commit or stash first');
if ((await git(['rev-parse', '--abbrev-ref', 'HEAD'])).out !== 'main') fail('release from main only');
if ((await run(['docker', 'buildx', 'version'], { canFail: true })).code !== 0) fail('docker buildx is required for the multi-arch image');

// ---------- version ----------
const pkgPath = join(ROOT, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const cur = String(pkg.version);
const m = cur.match(/^(\d+)\.(\d+)\.(\d+)$/);
if (!m) fail(`current version ${cur} is not stable semver`);
const next =
  bumpArg === 'major' ? `${+m[1]! + 1}.0.0`
  : bumpArg === 'minor' ? `${m[1]}.${+m[2]! + 1}.0`
  : bumpArg === 'patch' ? `${m[1]}.${m[2]}.${+m[3]! + 1}`
  : /^\d+\.\d+\.\d+$/.test(bumpArg) ? bumpArg
  : fail(`bad bump: ${bumpArg}`);

// ---------- resume: `bun run release <x.y.z>` where the bump + tag already happened (an earlier run failed at the image push) ----------
const tagExists = (await run(['git', 'rev-parse', '-q', '--verify', `refs/tags/v${next}`], { canFail: true })).code === 0;
const resume = next === cur && tagExists;
if (next === cur && !tagExists) fail(`already at ${cur} and no v${cur} tag — nothing to bump; pass patch|minor|major or a higher version`);

// ---------- notes: --notes, or the commit subjects since the last release tag ----------
const lastTag = await run(['git', 'describe', '--tags', '--abbrev=0', '--match', 'v*', ...(resume ? ['HEAD~1'] : [])], { canFail: true });
const range = lastTag.code === 0 && lastTag.out ? `${lastTag.out}..HEAD` : 'HEAD';
const notes = notesArg ?? (await git(['log', range, '--no-merges', '--pretty=- %s'])).out;
const today = new Date().toISOString().slice(0, 10);
const section = `## ${next} — ${today}\n\n${notes || '- (no notes)'}\n`;

console.log(resume ? `\nresuming release ${next} (bump + tag already in place)\n` : `\nreleasing ${cur} → ${next}\n\n${section}`);
if (dryRun) {
  console.log('(dry run — nothing written, tagged, or pushed)');
  process.exit(0);
}

// ---------- bump + tag ----------
if (!resume) {
  pkg.version = next;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  await git(['add', 'package.json']);
  await git(['commit', '-m', `release: v${next}`]);
  await git(['tag', `v${next}`]);
}

// ---------- changelog to the public releases repo (before the image: notes ready when the version appears) ----------
if (!existsSync(RELEASES_DIR)) {
  const exists = (await run(['gh', 'repo', 'view', RELEASES_REPO], { canFail: true })).code === 0;
  if (!exists) await run(['gh', 'repo', 'create', RELEASES_REPO, '--public', '--description', 'Foundry release notes — read by deployed instances']);
  const cloned = (await run(['gh', 'repo', 'clone', RELEASES_REPO, RELEASES_DIR], { canFail: true })).code === 0;
  if (!cloned) fail(`could not clone ${RELEASES_REPO}`);
} else {
  await git(['pull', '--ff-only'], RELEASES_DIR);
}
const clPath = join(RELEASES_DIR, 'CHANGELOG.md');
const existing = existsSync(clPath) ? readFileSync(clPath, 'utf8') : '# Foundry releases\n\n';
const headerEnd = existing.indexOf('\n## ');
const alreadyLogged = new RegExp(`^## ${next.replace(/\./g, '\\.')}\\b`, 'm').test(existing);
if (alreadyLogged) {
  console.log(`changelog already has a ${next} section — leaving it`);
} else {
  // exactly one blank line above and below the new section, whatever the file had
  const updated = headerEnd === -1 ? `${existing.trimEnd()}\n\n${section}` : `${existing.slice(0, headerEnd).trimEnd()}\n\n${section}\n${existing.slice(headerEnd + 1)}`;
  writeFileSync(clPath, updated);
  await git(['add', 'CHANGELOG.md'], RELEASES_DIR);
  await git(['commit', '-m', `release: v${next}`], RELEASES_DIR);
  await git(['push'], RELEASES_DIR);
}

// ---------- the release becomes real: versioned multi-arch image on Docker Hub ----------
await run(['docker', 'buildx', 'build', '--platform', 'linux/amd64,linux/arm64', '-t', `${IMAGE}:${next}`, '-t', `${IMAGE}:latest`, '--push', '.']);

// ---------- main repo last (a failed docker push must not leave a pushed tag with no image) ----------
await git(['push', 'origin', 'main', '--tags']);

console.log(`\n✔ released ${next} — instances will see it on their next check`);
