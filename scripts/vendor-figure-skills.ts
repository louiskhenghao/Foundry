/**
 * Refresh Foundry's bundled copies of the Figure pack's skills (ADR-0076). Each skill is published by its author as a
 * tarball with no git repository and no version, so Foundry keeps a snapshot of it in the repository: this downloads the
 * archive, checks it is the small set of plain-text files the author describes, replaces catalog/bundled/<name>/ with it
 * and writes SOURCE.json next to SKILL.md — where it came from, when, and the snapshot's sha256 (the same hash the
 * installer reads, so a refreshed snapshot reaches installed copies with the next install or update).
 *
 *   bun scripts/vendor-figure-skills.ts            # both skills
 *   bun scripts/vendor-figure-skills.ts iso-glow   # one of them
 *
 * Then: bun scripts/gen-credits.ts (the notices), and review the diff of catalog/bundled/ before committing.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, cpSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { hashSkillFolder } from '../packages/engine/src/skills/installer.ts';

const ROOT = join(import.meta.dir, '..');
const BUNDLED = join(ROOT, 'catalog', 'bundled');

/** the skills and where their authors publish them */
export const FIGURE_SKILLS: Record<string, { archive: string; homepage: string; license: string; author: string }> = {
  colorfigures: { archive: 'https://april-zhu.com/colorfigures/colorfigures.tar.gz', homepage: 'https://april-zhu.com/colorfigures', license: 'MIT', author: 'April Zhu' },
  'iso-glow': { archive: 'https://iso-glow.vercel.app/iso-glow.tar.gz', homepage: 'https://isoglow.dev', license: 'MIT', author: 'April Zhu' },
};

/** the author says "plain text only, nothing runs on install": hold the archive to that */
const LIMITS = { files: 100, bytes: 4 * 1024 * 1024, fileBytes: 1024 * 1024 };

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isSymbolicLink()) throw new Error(`${relative(dir, p)} is a symbolic link`);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const looksText = (buf: Buffer) => !buf.subarray(0, 8192).includes(0);

export async function vendor(name: string, opts: { from?: string } = {}): Promise<{ files: number; bytes: number; sha256: string }> {
  const spec = FIGURE_SKILLS[name];
  if (!spec) throw new Error(`unknown figure skill ${name}; known: ${Object.keys(FIGURE_SKILLS).join(', ')}`);
  const tmp = mkdtempSync(join(tmpdir(), `vendor-${name}-`));
  try {
    let src: string;
    if (opts.from) src = opts.from;
    else {
      const res = await fetch(spec.archive);
      if (!res.ok) throw new Error(`${spec.archive}: HTTP ${res.status}`);
      const tar = join(tmp, 'skill.tar.gz');
      writeFileSync(tar, Buffer.from(await res.arrayBuffer()));
      const x = Bun.spawnSync(['tar', '-xzf', tar, '-C', tmp]);
      if (x.exitCode !== 0) throw new Error(`tar failed: ${x.stderr.toString().slice(0, 300)}`);
      src = join(tmp, name);
    }
    if (!existsSync(join(src, 'SKILL.md'))) throw new Error(`${name}: the archive holds no ${name}/SKILL.md`);
    if (!existsSync(join(src, 'LICENSE'))) throw new Error(`${name}: no LICENSE file — the snapshot cannot be redistributed without it`);
    const files = walk(src);
    const bytes = files.reduce((n, f) => n + statSync(f).size, 0);
    if (files.length > LIMITS.files || bytes > LIMITS.bytes) throw new Error(`${name}: ${files.length} files, ${bytes} bytes — more than a plain-text skill should be`);
    for (const f of files) {
      if (statSync(f).size > LIMITS.fileBytes) throw new Error(`${relative(src, f)} is larger than ${LIMITS.fileBytes} bytes`);
      if (!looksText(readFileSync(f))) throw new Error(`${relative(src, f)} is not plain text`);
    }
    const dest = join(BUNDLED, name);
    rmSync(dest, { recursive: true, force: true });
    cpSync(src, dest, { recursive: true });
    rmSync(join(dest, 'SOURCE.json'), { force: true });
    const sha256 = hashSkillFolder(dest);
    const source = { name, author: spec.author, homepage: spec.homepage, license: spec.license, archive: spec.archive, fetchedAt: new Date().toISOString().slice(0, 10), files: files.length, bytes, sha256, note: 'A snapshot of the skill as its author publishes it, kept in Foundry so it installs offline and does not change under a goal; refresh with bun scripts/vendor-figure-skills.ts. The files are unmodified.' };
    writeFileSync(join(dest, 'SOURCE.json'), JSON.stringify(source, null, 2) + '\n');
    return { files: files.length, bytes, sha256 };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const names = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const fromIdx = process.argv.indexOf('--from');
  const from = fromIdx >= 0 ? process.argv[fromIdx + 1] : undefined;
  for (const name of names.length ? names : Object.keys(FIGURE_SKILLS)) {
    const r = await vendor(name, { from });
    console.log(`${name}: ${r.files} files, ${r.bytes} bytes, sha256 ${r.sha256.slice(0, 12)}… → catalog/bundled/${name}/`);
  }
}
