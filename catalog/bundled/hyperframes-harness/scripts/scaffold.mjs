#!/usr/bin/env node
// Lay a HyperFrames film out under Foundry's harness (ADR-0087), from the repository root:
//   node <skill>/scripts/scaffold.mjs <slug> [--title "…"] [--version 0.9.8]
// Runs `hyperframes init video/<slug>` (blank, no prompts, no skills), copies the harness scripts to video/lib/, writes
// docs/video/review_log.md and the film's README, and makes artifacts/video/<slug>/rounds/. Idempotent: an existing
// project is left as it is; the scripts are refreshed.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith('--'));
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) { console.error('usage: scaffold.mjs <slug> [--title "…"] [--version <hyperframes release>]  (slug: lowercase letters, digits, hyphens)'); process.exit(2); }
const skill = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const title = opt('title', slug);
const version = opt('version', '0.9.8');
const project = join('video', slug);
mkdirSync('video', { recursive: true });
if (!existsSync(join(project, 'hyperframes.json'))) {
  execFileSync('npx', ['--yes', `hyperframes@${version}`, 'init', project, '--non-interactive', '--skip-skills'], { stdio: 'inherit' });
} else console.log(`${project} exists: left as it is`);
mkdirSync(join('video', 'lib'), { recursive: true });
for (const f of readdirSync(join(skill, 'lib'))) copyFileSync(join(skill, 'lib', f), join('video', 'lib', f));
mkdirSync(join('docs', 'video'), { recursive: true });
const fill = (text) => text.replaceAll('FILM TITLE', title).replaceAll('<slug>', slug).replaceAll('<version>', version);
if (!existsSync(join('docs', 'video', 'review_log.md'))) writeFileSync(join('docs', 'video', 'review_log.md'), fill(readFileSync(join(skill, 'templates', 'review_log.md'), 'utf8')));
if (!existsSync(join(project, 'README.md'))) writeFileSync(join(project, 'README.md'), fill(readFileSync(join(skill, 'templates', 'README.md'), 'utf8')));
mkdirSync(join('artifacts', 'video', slug, 'rounds'), { recursive: true });
// the editor's and the CLI's own folders never belong to the goal's commits
const exclude = join(project, '.gitignore');
if (!existsSync(exclude)) writeFileSync(exclude, 'renders/\n.hyperframes/\n.thumbnails/\nnode_modules/\n');
console.log(`laid out ${project} (hyperframes ${version}), video/lib/, docs/video/review_log.md, artifacts/video/${slug}/rounds/`);
