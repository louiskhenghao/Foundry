/**
 * The role-prompt regression set (ADR-0062): a few small, fixed goals against the real coding agent, judged on their
 * finished checkouts, summed up and compared with a saved run. For maintainers, after a workflow suite or model bump
 * or a change to a role's prompt. It spends real money (a few dollars for the whole set) and uses the signed-in
 * coding agent of this machine.
 *
 *   bun scripts/regress.ts [--only a,b] [--provider claude|codex|agy] [--profile mattpocock|pstack|plain] [--model alias]
 *                          [--no-clarify] [--label text] [--baseline regress/baselines/<name>.json]
 *                          [--save-baseline <name>] [--work-dir path] [--dry-run]
 *
 * Results land in regress/results/<time>-<label>.json and .md (not committed); --save-baseline keeps the run as
 * regress/baselines/<name>.json for the next comparison. Exit 1 when a case failed or something got worse.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pickCases } from '../packages/engine/src/regress/cases.ts';
import { compare, renderMarkdown, runSuite, type RegressRun } from '../packages/engine/src/regress/run.ts';

const ROOT = resolve(import.meta.dir, '..');
const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string) => args.includes(name);
const usage = (why: string): never => {
  console.error(why);
  process.exit(2);
};

const provider = (opt('--provider') ?? 'claude') as 'claude' | 'codex' | 'agy';
if (!['claude', 'codex', 'agy'].includes(provider)) usage('--provider expects claude, codex or agy');
const profile = opt('--profile') as 'mattpocock' | 'pstack' | 'plain' | undefined;
if (profile && !['mattpocock', 'pstack', 'plain'].includes(profile)) usage('--profile expects mattpocock, pstack or plain');
const cases = pickCases(opt('--only')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null);
const label = (opt('--label') ?? `${provider}-${profile ?? 'default'}${opt('--model') ? `-${opt('--model')}` : ''}`).replace(/[^A-Za-z0-9._-]+/g, '-');
const budget = cases.reduce((a, c) => a + c.maxCostUsd, 0);

if (has('--dry-run')) {
  console.log(`${cases.length} case(s), at most $${budget.toFixed(2)} and ${cases.reduce((a, c) => a + c.maxMinutes, 0)} min in all, as ${label}:`);
  for (const c of cases) console.log(`  ${c.name}: ${c.title} (fixture ${c.fixture}, ≤ $${c.maxCostUsd}, ≤ ${c.maxMinutes} min)`);
  process.exit(0);
}

const workDir = opt('--work-dir') ?? mkdtempSync(join(tmpdir(), 'foundry-regress-'));
console.log(`Running ${cases.length} case(s) as ${label} with the real ${provider} (at most $${budget.toFixed(2)}); work in ${workDir}`);
const run = await runSuite({ cases, workDir, root: ROOT, provider, profile, model: opt('--model') ?? null, clarify: !has('--no-clarify'), label, log: (l) => console.log(`  ${l}`) });

const baselinePath = opt('--baseline');
let cmp = null;
if (baselinePath) {
  const baseline = JSON.parse(readFileSync(resolve(ROOT, baselinePath), 'utf8')) as RegressRun;
  cmp = compare(run, baseline);
}
const md = renderMarkdown(run, cmp);
const outDir = join(ROOT, 'regress', 'results');
mkdirSync(outDir, { recursive: true });
const stem = join(outDir, `${run.at.replace(/[:.]/g, '-').slice(0, 19)}-${label}`);
writeFileSync(`${stem}.json`, JSON.stringify(run, null, 2));
writeFileSync(`${stem}.md`, md);
console.log(`\n${md}`);
console.log(`Written to ${stem}.json and .md`);
const save = opt('--save-baseline');
if (save) {
  const dir = join(ROOT, 'regress', 'baselines');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${save.replace(/[^A-Za-z0-9._-]+/g, '-')}.json`), JSON.stringify(run, null, 2));
  console.log(`Saved as the baseline regress/baselines/${save}.json`);
}
process.exit(run.summary.passed < run.summary.total || (cmp && (cmp.regressions.length || cmp.costlier.length)) ? 1 : 0);
