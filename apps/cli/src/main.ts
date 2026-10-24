#!/usr/bin/env bun
/**
 * foundry CLI — thin client over the local server, plus `serve` and `replay`.
 */
import { AGENT_PROVIDERS, reportsDollars } from '@foundry/core';
import type { AgentProvider } from '@foundry/core';
import { help } from './help.ts';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { codexQuotaWindows } from '@foundry/engine/quota-windows';

const ROOT = resolve(import.meta.dir, '../../..');
const argv = process.argv.slice(2);
const cmd = argv[0];
const rest = argv.slice(1);

/** `none` / `0` / `∞` → null (no limit); otherwise a positive number */
function limitArg(v: string): number | null {
  if (/^(none|0|∞|unlimited|inf)$/i.test(v.trim())) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return usage(`invalid limit "${v}" (number or "none")`);
  return n;
}
function opt(name: string): string | undefined {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
}
function opts(name: string): string[] {
  const out: string[] = [];
  rest.forEach((a, i) => {
    if (a === name && rest[i + 1] != null) out.push(rest[i + 1]!);
  });
  return out;
}
const has = (name: string) => rest.includes(name);
const positional = () => rest.filter((a, i) => !a.startsWith('--') && !(i > 0 && rest[i - 1]!.startsWith('--') && !FLAGS.has(rest[i - 1]!)));
const FLAGS = new Set(['--auto-approve', '--approve', '--verify', '--json', '--follow', '--force', '--self-check', '--no-attachments', '--no-style', '--settings', '--secrets', '--transcripts', '--dry-run', '--password-stdin', '--all', '--new']);
const BASE = process.env.FOUNDRY_URL ?? `http://127.0.0.1:${process.env.FOUNDRY_PORT ?? 4111}`;

async function api(path: string, init?: RequestInit): Promise<any> {
  let res: Response;
  try {
    // Access (ADR-0061): the person's token travels as a bearer header
    res = await fetch(BASE + path, { ...init, headers: { 'content-type': 'application/json', ...(process.env.FOUNDRY_TOKEN ? { authorization: `Bearer ${process.env.FOUNDRY_TOKEN}` } : {}), ...(init?.headers ?? {}) } });
  } catch {
    console.error(`Cannot reach foundry at ${BASE}. Start it with: bun run serve`);
    process.exit(2);
  }
  const text = await res.text();
  const body = text ? safeJson(text) : null;
  if (!res.ok) {
    if (res.status === 401 && body?.code === 'auth') console.error('This Foundry asks for an access token: set FOUNDRY_TOKEN to yours (Settings → Access makes one per person; on the machine, `foundry access add <name>` before Access is on).');
    else console.error(`error ${res.status}: ${body?.error ?? text}`);
    process.exit(1);
  }
  return body;
}
const safeJson = (t: string) => {
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
};


/** Use the server when it is up, otherwise run in-process (doctor/skills must work before `serve`). */
async function skillsLocal(selected?: AgentProvider) {
  const { SkillsManager, defaultConfig, SettingsStore, applySettingsToConfig } = await import('@foundry/engine');
  const cfg = defaultConfig(ROOT);
  const settings = new SettingsStore(cfg.dataDir);
  applySettingsToConfig(cfg, settings.values(), settings.fileLeaves());
  const provider = selected ?? cfg.provider;
  return new SkillsManager({ provider, codexBin: cfg.codexBin, codexHome: cfg.codexHome, claudeBin: cfg.claudeBin, claudeHome: provider === 'codex' ? cfg.codexHome : provider === 'agy' ? join(homedir(), '.agents') : cfg.claudeHome, dataDir: provider === cfg.provider ? cfg.dataDir : join(cfg.dataDir, 'providers', provider), catalogPath: cfg.catalogPath, log: (m) => console.error(m) });
}
/** a Transfer's password: the first line of stdin with --password-stdin, else FOUNDRY_TRANSFER_PASSWORD */
async function transferPassword(): Promise<string> {
  const pw = has('--password-stdin') ? (await new Response(Bun.stdin.stream()).text()).split('\n')[0]!.replace(/\r$/, '') : process.env.FOUNDRY_TRANSFER_PASSWORD;
  if (!pw) return usage('Keys & secrets need a password: pipe it with --password-stdin or set FOUNDRY_TRANSFER_PASSWORD');
  return pw;
}
/** export without a running server: the data folder is read directly */
async function localTransferHost() {
  const { defaultConfig, SettingsStore, applySettingsToConfig, PreviewEnvStore } = await import('@foundry/engine');
  const { EventStore, openDatabase } = await import('@foundry/core');
  const cfg = defaultConfig(ROOT);
  const settings = new SettingsStore(cfg.dataDir);
  applySettingsToConfig(cfg, settings.values(), settings.fileLeaves());
  const release = String(JSON.parse(await Bun.file(join(ROOT, 'package.json')).text()).version ?? '0.0.0');
  return { store: new EventStore(openDatabase(join(cfg.dataDir, 'engine.db'))), dataDir: cfg.dataDir, provider: cfg.provider, release, settingsFile: () => settings.fileSnapshot(), previewEnv: () => new PreviewEnvStore(cfg.dataDir).all() };
}
function printIncoming(r: any): void {
  console.log(`Transfer file from ${r.hostname}, Foundry ${r.release}, written ${r.exportedAt.slice(0, 16).replace('T', ' ')}`);
  for (const g of r.goals) console.log(`  ${pad(g.status, 13)} ${pad(g.id, 26)} ${g.unfinished ? 'unfinished ' : 'finished   '} ${g.title}${g.follows && !g.follows.inFile && !g.follows.here ? `  (follows "${g.follows.title}", not in this file)` : ''}`);
  for (const repo of r.repos) console.log(`  repository ${repo.original} → ${repo.match ?? 'not found here (map it with --map old=new, or later)'}`);
  for (const s of r.settings) console.log(`  settings ${pad(s.section, 14)} differs: ${s.keys.join(', ')}`);
  if (r.secrets) console.log('  Keys & secrets: present (bring them in with --secrets)');
}
function printApplied(r: any): void {
  for (const g of r.imported) console.log(`imported   ${g.id}  ${g.title}`);
  for (const g of r.skipped) console.log(`skipped    ${g.id}  ${g.title} — ${g.reason}`);
  for (const m of r.repos) console.log(m.error ? `not mapped ${m.original}: ${m.error}` : `mapped     ${m.original} → ${m.to}`);
  if (r.settings.length) console.log(`settings   ${r.settings.join(', ')}`);
  if (r.secrets.length) console.log(`secrets    ${r.secrets.join(', ')}`);
  if (r.previewEnv.waiting.length) console.log(`preview variables wait for: ${r.previewEnv.waiting.join(', ')}`);
}

async function serverUp(): Promise<boolean> {
  try {
    const r = await fetch(BASE + '/api/health', { signal: AbortSignal.timeout(800) });
    return r.ok;
  } catch {
    return false;
  }
}

await main();

async function main(): Promise<void> {
const selected = opt('--provider');
if (has('--provider') && !AGENT_PROVIDERS.includes(selected as AgentProvider)) return usage('--provider must be claude, codex or agy');
const provider = selected as AgentProvider | undefined;
const scoped = (path: string) => provider ? `${path}${path.includes('?') ? '&' : '?'}provider=${provider}` : path;
const providerApi = (path: string, init?: RequestInit) => api(scoped(path), init);
switch (cmd) {
  case 'serve': {
    const { Engine, adoptLocalBin, defaultConfig } = await import('@foundry/engine');
    const { startServer } = await import('@foundry/server');
    // a natively installed claude lives in ~/.local/bin, which launchd/systemd PATHs often lack
    adoptLocalBin();
    const engine = new Engine(defaultConfig(ROOT));
    const server = startServer(engine, { webDist: resolve(ROOT, 'apps/web/dist') });
    console.log(`foundry listening on http://${engine.config.host}:${server.port}  (data: ${engine.config.dataDir})`);
    engine.updater.startSchedule();
    await engine.start();
    const shutdown = async () => {
      console.log('\nshutting down…');
      await engine.stop();
      server.stop(true);
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    break;
  }
  case 'goal': {
    if (rest[0] !== 'new') return usage();
    // the prompt is the first positional; a goal from an issue may have none
    const prompt = rest[1] && !rest[1].startsWith('--') ? rest[1] : undefined;
    // a Follow-up: the earlier goal's repository and settings are the defaults, any flag given wins
    const followsId = opt('--follows');
    const draft = followsId ? await api(`/api/goals/${followsId}/follow-up-draft`) : null;
    if (draft && !draft.followable) return usage(`goal ${followsId} cannot be followed: ${draft.reason}`);
    const repoPath = opt('--repo') ?? draft?.prefill.repoPath;
    // a goal from a GitHub issue: its title and body stand in for the prompt, its thread is attached (ADR-0052)
    const issueRef = opt('--issue');
    if (!repoPath || (!prompt && !issueRef)) return usage('goal new needs "<prompt>" (or --issue <link>) and --repo <path> (or --follows <goal id>)');
    const issue = issueRef ? await api('/api/issues/read', { method: 'POST', body: JSON.stringify({ ref: issueRef, repoPath: resolve(repoPath) }) }) : null;
    const effort = opt('--effort');
    const body: any = {
      prompt: prompt ?? issue.prompt,
      repoPath: resolve(repoPath),
      title: opt('--title') ?? issue?.title,
      ...(issue ? { issue: issue.issue, attachments: [issue.attachment] } : {}),
      provider: opt('--provider') ?? draft?.prefill.provider,
      codexModel: opt('--codex-model') ?? (opt('--models') ? undefined : draft?.prefill.codexModel),
      agyModel: opt('--agy-model') ?? draft?.prefill.agyModel,
      baseBranch: opt('--base'),
      budgetPreset: opt('--preset') ?? (opt('--max-cost') || opt('--max-min') ? 'custom' : 'auto'),
      budgets: {
        // `none` (or 0) = no limit
        ...(opt('--max-cost') ? { maxCostUsd: limitArg(opt('--max-cost')!) } : {}),
        ...(opt('--max-min') ? { maxDurationMin: limitArg(opt('--max-min')!) } : {}),
        ...(opt('--concurrency') ? { maxConcurrent: Number(opt('--concurrency')) } : {}),
        ...(opt('--attempts') ? { attemptsPerTask: Number(opt('--attempts')) } : {}),
      },
      modelPreset: opt('--models'),
      nature: opt('--nature'),
      // the Figure pack a figure goal follows instead of Settings' default (ADR-0076, beta)
      figurePack: opt('--figure-pack'),
      workflow: opt('--pace') || opt('--suite') ? { ...(opt('--pace') ? { pace: opt('--pace') } : {}), ...(opt('--suite') ? { profile: opt('--suite') } : {}) } : undefined,
      interview: opt('--interview'),
      effort: effort === 'default' ? null : effort,
      ...(has('--self-check') ? { selfCheck: true } : {}),
      // delegated goals: the planner may hand big steps to goals of their own; their Briefs approved by the engine on request
      ...(has('--delegate') || has('--delegate-auto-approve') ? { delegation: { allow: true, autoApprove: has('--delegate-auto-approve') } } : {}),
      // companion repositories (ADR-0063)
      ...(opts('--also').length ? { companions: opts('--also').map((p) => ({ repoPath: resolve(p) })) } : {}),
    };
    if (has('--auto-approve')) body.autoBrief = { mustChecks: opts('--check'), stretchChecks: opts('--stretch') };
    if (opt('--deliver')) body.delivery = { mode: opt('--deliver'), remote: opt('--remote') ?? 'origin', remoteUrl: opt('--remote-url') ?? null };
    if (draft) {
      const p = draft.prefill;
      body.nature ??= p.nature;
      body.modelPreset ??= p.modelPreset;
      // null means use the preset/CLI default; omitting it would reapply the server's current goal default.
      if (body.effort === undefined) body.effort = p.effort;
      body.workflow ??= { pace: p.pace };
      body.mode = p.mode;
      body.delivery ??= { ...p.delivery, createRepo: null, remoteUrl: null };
      body.follows = { goalId: followsId, startFrom: opt('--start-from'), attachments: !has('--no-attachments'), style: !has('--no-style') };
    }
    const goal = await api('/api/goals', { method: 'POST', body: JSON.stringify(body) });
    console.log(`created goal ${goal.id} [${goal.state}] ${goal.title}`);
    if (goal.issue) console.log(`  from issue ${goal.issue.repo}#${goal.issue.number} (${goal.issue.url}); its pull request closes it`);
    if (goal.follows) console.log(`  follows ${goal.follows.title} (${goal.follows.goalId}), starting from ${goal.follows.startFrom === 'previous' ? `its goal branch ${goal.follows.branch}` : goal.baseBranch}`);
    console.log(`  ui: ${BASE}/goals/${goal.id}`);
    if (has('--follow')) await watch(goal.id);
    break;
  }
  case 'status': {
    const id = positional()[0];
    if (!id) {
      const goals = await api('/api/goals');
      if (!goals.length) console.log('no goals');
      for (const g of goals) console.log(`${g.id}  ${pad(g.state, 24)} ${!reportsDollars(g.provider) ? 'Codex · cost unavailable' : `$${g.costUsd.toFixed(2)}/${g.budgets.maxCostUsd ?? '∞'}`}  tasks=${JSON.stringify(g.taskCounts)}  esc=${g.openEscalations}  ${g.title}`);
    } else {
      const d = await api(`/api/goals/${id}`);
      if (has('--json')) return console.log(JSON.stringify(d, null, 2));
      const g = d.goal;
      console.log(`${g.id} [${g.state}] ${g.title}\n  repo ${g.repoPath} (${g.baseBranch} → ${g.branch})\n  cost ${!reportsDollars(g.provider) ? 'unavailable' : `$${g.costUsd.toFixed(3)} / ${g.budgets.maxCostUsd == null ? 'no cap' : `$${g.budgets.maxCostUsd}`}`}    elapsed ${d.budget.elapsedMin.toFixed(1)} / ${g.budgets.maxDurationMin ?? '∞'} min   preset ${g.budgetPreset}`);
      for (const t of d.tasks) {
        const attempts = d.attempts.filter((a: any) => a.taskId === t.id);
        console.log(`  - ${pad(t.state, 10)} ${t.title}  (attempts ${attempts.length}/${t.retryBudget + t.extraAttempts}${t.worktreePath ? ', own worktree' : ''})`);
        for (const a of attempts) {
          const res = d.checkResults.filter((r: any) => r.attemptId === a.id);
          console.log(`      #${a.index} ${a.kind} ${pad(a.state, 9)} ${!reportsDollars(g.provider) ? 'cost and turns unavailable' : `$${a.costUsd.toFixed(3)} turns=${a.numTurns}`} ${a.resultSubtype ?? ''} checks: ${res.map((r: any) => (r.status === 'pass' ? '✅' : '❌')).join('') || '-'}`);
        }
      }
      const open = d.escalations.filter((e: any) => e.state === 'open');
      for (const e of open) console.log(`  ⚠ escalation ${e.id} [${e.trigger}] ${e.message.split('\n')[0]}`);
    }
    break;
  }
  case 'schedules': {
    // goals that run on their own (ADR-0054): list them, or fire one now
    const sub = rest[0] ?? 'list';
    if (sub === 'run') {
      const id = rest[1];
      if (!id) return usage('schedules run needs <scheduleId>');
      const r = await api(`/api/schedules/${id}/run`, { method: 'POST' });
      console.log(r.goalId ? `started goal ${r.goalId}\n  ui: ${BASE}/goals/${r.goalId}` : `skipped: ${r.skipped}`);
      break;
    }
    if (sub !== 'list') return usage('schedules [list] | schedules run <scheduleId>');
    const v = await api('/api/schedules');
    if (has('--json')) return console.log(JSON.stringify(v, null, 2));
    if (!v.schedules.length) return console.log('no schedules (save one from the New goal form: Schedule…)');
    for (const s of v.schedules as any[]) console.log(`${pad(s.id, 24)} ${s.enabled ? 'on ' : 'off'} ${pad(s.name, 30)} next ${s.nextRunAt ? new Date(s.nextRunAt).toLocaleString() : '—'}${s.lastGoal ? `  last: ${s.lastGoal.state} ${s.lastGoal.id}` : s.lastRun?.skipped ? `  last: skipped (${s.lastRun.skipped})` : ''}`);
    break;
  }
  case 'ports': {
    // what the Ports page shows: every port in use and who holds it (stopping one is done on the page)
    const v = await api('/api/ports');
    if (has('--json')) return console.log(JSON.stringify(v, null, 2));
    const rows = (v.rows as any[]).filter((r) => has('--all') || r.relevant);
    if (v.inContainer) console.log("Foundry runs in Docker: only ports inside its container are visible here.\n");
    if (!rows.length) console.log('no ports in use' + (has('--all') ? '' : ' (--all shows system ports too)'));
    for (const r of rows) console.log(`${String(r.port).padStart(5)}  ${pad(r.category, 9)} ${r.label}${r.detail ? `  — ${r.detail}` : ''}${r.pid ? `  (pid ${r.pid})` : ''}`);
    if (!has('--all') && rows.length < v.rows.length) console.log(`\n${v.rows.length - rows.length} more (system and background processes): foundry ports --all`);
    break;
  }
  case 'brief': {
    const id = positional()[0];
    if (!id) return usage();
    const d = await api(`/api/goals/${id}`);
    if (!d.brief) return console.log('no brief yet (goal is ' + d.goal.state + ')');
    const b = d.brief.brief;
    if (has('--json')) console.log(JSON.stringify(b, null, 2));
    else {
      console.log(`# ${d.goal.title} [${d.goal.state}]${d.brief.approved ? ' (approved)' : ''}\n\n${b.understanding}\n`);
      if (b.assumptions.length) console.log('Assumptions:\n' + b.assumptions.map((a: any) => `  [${a.accepted ? 'x' : ' '}] ${a.text}`).join('\n'));
      console.log('\nTasks:\n' + b.tasks.map((t: any) => `  ${t.key} ${t.title}${t.dependsOnKeys.length ? ` (after ${t.dependsOnKeys.join(',')})` : ''}${t.parallelizable ? ' ∥' : ''}`).join('\n'));
      console.log('\nChecks:\n' + b.checks.map((c: any) => `  [${c.tier}] ${c.taskKey ?? 'goal'}: ${c.name}${c.spec.type === 'command' ? `  \`${c.spec.cmd}\`` : ''}`).join('\n'));
      const asked = b.questions.filter((q: any) => q.kind !== 'note');
      const notes = b.questions.filter((q: any) => q.kind === 'note');
      if (asked.length) console.log('\nQuestions:\n' + asked.map((q: any) => `  ${q.blocking ? '(blocking) ' : ''}${q.text} → ${q.answer ?? '(unanswered)'}`).join('\n'));
      if (notes.length) console.log('\nNotes from you:\n' + notes.map((q: any) => `  ${q.text}`).join('\n'));
      console.log(`\nEstimate: ${!reportsDollars(d.goal.provider) ? 'cost unavailable' : `$${b.costEstimateUsd}`} / ${b.timeEstimateMin} min`);
    }
    if (has('--approve')) {
      const answers = opts('--answer');
      // --answer fills the questions in the order shown; a note is not a question
      if (answers.length) b.questions.filter((q: any) => q.kind !== 'note').forEach((q: any, i: number) => (q.answer = answers[i] ?? q.answer));
      await api(`/api/goals/${id}/brief/approve`, { method: 'POST', body: JSON.stringify(b) });
      console.log('approved ✔');
    }
    break;
  }
  case 'escalations': {
    const list = await api('/api/escalations?open=1');
    if (!list.length) console.log('no open escalations');
    for (const e of list) console.log(`${e.id}  [${e.trigger}] goal=${e.goalId} task=${e.taskId ?? '-'}\n    ${e.message.split('\n').join('\n    ')}`);
    break;
  }
  case 'answer': {
    const [id, action] = positional();
    if (!id || !action) return usage();
    await api(`/api/escalations/${id}/answer`, {
      method: 'POST',
      body: JSON.stringify({
        action,
        hint: opt('--hint'),
        extraAttempts: opt('--attempts') ? Number(opt('--attempts')) : undefined,
        newMaxCostUsd: opt('--max-cost') ? Number(opt('--max-cost')) : undefined,
        newMaxDurationMin: opt('--max-min') ? Number(opt('--max-min')) : undefined,
      }),
    });
    console.log('answered ✔');
    break;
  }
  case 'watch': {
    const id = positional()[0];
    if (!id) return usage();
    await watch(id);
    break;
  }
  case 'ask': {
    // the question is the words after the goal id, quoted or not
    const [id, ...words] = positional();
    const text = words.join(' ').trim();
    if (!id || !text) return usage('ask <goalId> "<question>" [--new]');
    await ask(id, text, has('--new'));
    break;
  }
  case 'diff': {
    const id = positional()[0];
    if (!id) return usage();
    const res = await fetch(`${BASE}/api/goals/${id}/diff`);
    console.log(await res.text());
    break;
  }
  case 'cancel': {
    const id = positional()[0];
    if (!id) return usage();
    await api(`/api/goals/${id}/cancel`, { method: 'POST' });
    console.log('cancelled');
    break;
  }
  case 'replay': {
    const { openDatabase, EventStore } = await import('@foundry/core');
    const store = new EventStore(openDatabase(resolve((await import('@foundry/engine')).defaultConfig(ROOT).dataDir, 'engine.db')));
    const before = store.snapshotReadModels();
    const n = store.replay();
    const after = store.snapshotReadModels();
    const same = JSON.stringify(before) === JSON.stringify(after);
    console.log(`replayed ${n} events; read models ${same ? 'identical ✔' : 'DIFFER ✘'}`);
    if (!same && has('--verify')) {
      for (const k of Object.keys(after)) if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) console.log(`  table ${k} differs (${before[k]?.length} → ${after[k]?.length} rows)`);
      process.exit(1);
    }
    break;
  }
  case 'export': {
    const goalsArg = opt('--goals');
    const picked = has('--settings') || has('--secrets') || goalsArg != null;
    const categories = { settings: !picked || has('--settings'), secrets: has('--secrets'), goals: !picked || goalsArg != null, transcripts: has('--transcripts') };
    const goalIds = !goalsArg || goalsArg === 'all' ? 'all' : goalsArg.split(',').map((s) => s.trim()).filter(Boolean);
    const password = categories.secrets ? await transferPassword() : undefined;
    const out = resolve(opt('--out') ?? `foundry-transfer-${new Date().toISOString().slice(0, 10)}.tgz`);
    let goals: number;
    if (await serverUp()) {
      const r = await api('/api/transfer/export', { method: 'POST', body: JSON.stringify({ categories, goalIds, password }) });
      const res = await fetch(`${BASE}/api/transfer/download/${r.downloadId}`);
      if (!res.ok) return usage(`download failed: ${res.status}`);
      await Bun.write(out, res);
      goals = r.goals;
    } else {
      const { exportTransfer } = await import('@foundry/engine');
      goals = (await exportTransfer(await localTransferHost(), { categories, goalIds, password, out })).manifest.goals.length;
    }
    console.log(`wrote ${out} — ${Object.entries(categories).filter(([, on]) => on).map(([c]) => c).join(', ')}${categories.goals ? ` (${goals} goal${goals === 1 ? '' : 's'})` : ''}`);
    break;
  }
  case 'import': {
    const file = positional()[0];
    if (!file) return usage('import needs <file>');
    const repos: Record<string, string | null> = {};
    for (const m of opts('--map')) {
      const i = m.indexOf('=');
      if (i <= 0) return usage(`--map takes <path there>=<path here>, not "${m}"`);
      repos[m.slice(0, i)] = resolve(m.slice(i + 1));
    }
    for (const p of opts('--no-map')) repos[p] = null;
    const choices = {
      ...(opt('--goals') && opt('--goals') !== 'all' ? { goals: opt('--goals')!.split(',').map((s) => s.trim()) } : {}),
      settings: Object.fromEntries((opt('--keep-mine') ?? '').split(',').filter(Boolean).map((s) => [s.trim(), 'mine' as const])),
      secrets: has('--secrets') ? { password: await transferPassword(), keepMine: (opt('--keep-key') ?? '').split(',').filter(Boolean) } : null,
      ...(Object.keys(repos).length ? { repos } : {}),
    };
    if (await serverUp()) {
      const report = await api('/api/transfer/incoming', { method: 'POST', body: Bun.file(resolve(file)), headers: { 'content-type': 'application/octet-stream' } });
      printIncoming(report);
      if (has('--dry-run')) {
        await api(`/api/transfer/incoming/${report.uploadId}`, { method: 'DELETE' });
        break;
      }
      printApplied(await api(`/api/transfer/incoming/${report.uploadId}/apply`, { method: 'POST', body: JSON.stringify(choices) }));
    } else {
      const { Engine, defaultConfig, receiveTransfer, applyIncoming, discardIncoming } = await import('@foundry/engine');
      const engine = new Engine(defaultConfig(ROOT));
      try {
        const report = await receiveTransfer(engine, resolve(file));
        printIncoming(report);
        if (has('--dry-run')) discardIncoming(engine.config.dataDir, report.uploadId);
        else printApplied(await applyIncoming(engine, report.uploadId, choices));
      } finally {
        await engine.stop();
      }
    }
    break;
  }
  case 'reattach': {
    const id = positional()[0];
    if (!id) return usage('reattach needs <goalId>');
    if (!(await serverUp())) return usage('start Foundry first (foundry serve): a Reattached goal carries on right away');
    if (opt('--repo')) {
      const m = await api(`/api/goals/${id}/map-repo`, { method: 'POST', body: JSON.stringify({ path: resolve(opt('--repo')!) }) });
      console.log(`mapped ${m.original} → ${m.to}${m.restored.length ? ` (branch restored for ${m.restored.length} goal${m.restored.length === 1 ? '' : 's'})` : ''}`);
    }
    const g = await api(`/api/goals/${id}/reattach`, { method: 'POST' });
    console.log(`reattached: ${g.title} — its progress folder is ${g.workspaceDir}. If it still runs on the other computer, the two now diverge.`);
    break;
  }
  case 'deliver': {
    const id = positional()[0];
    if (!id) return usage('deliver needs <goalId>');
    const mode = opt('--mode');
    if (!mode) {
      const p = await api(`/api/goals/${id}/delivery/plan?mode=${opt('--plan') ?? 'pr'}`);
      console.log(`plan (${p.policy.mode}):`);
      for (const s of p.steps) console.log(`  ${pad(s.step, 14)} ${s.command ?? ''}${s.command ? '\n' + ' '.repeat(17) : ''}${s.note}`);
      console.log('\nrun with: foundry deliver ' + id + ' --mode push|pr|pr-automerge [--remote-url URL] [--owner O --name N] [--merge squash|merge|rebase]');
      break;
    }
    const body: any = { mode, remote: opt('--remote') ?? 'origin', remoteUrl: opt('--remote-url') ?? null, mergeMethod: opt('--merge') ?? 'squash' };
    if (opt('--owner') && opt('--name')) body.createRepo = { owner: opt('--owner'), name: opt('--name'), visibility: opt('--visibility') ?? 'private' };
    const r = await api(`/api/goals/${id}/deliver`, { method: 'POST', body: JSON.stringify(body) });
    console.log(`delivery ${r.delivery.status} (mode ${r.delivery.policy.mode}) — watch with: foundry watch ${id}`);
    break;
  }
  case 'github': {
    const sub = rest[0] ?? 'status';
    if (sub === 'login') {
      const p = Bun.spawn([Bun.which('gh') ?? 'gh', 'auth', 'login', '--web', '-h', 'github.com', '-p', 'https'], { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
      process.exit(await p.exited);
    }
    const s = (await serverUp()) ? await api('/api/github/status') : await new (await import('@foundry/engine')).CliGh().available();
    console.log(s.installed ? (s.authenticated ? `✔ gh ${s.version} logged in as ${s.login}` : `✘ gh ${s.version} installed but not logged in — run: foundry github login`) : '✘ gh not installed — run: brew install gh');
    break;
  }
  case 'auth': {
    const sub = positional()[0] ?? 'status';
    if (!['status', 'login', 'logout'].includes(sub)) return usage('auth expects status, login or logout');
    if (await serverUp()) {
      if (sub === 'logout') {
        const status = await providerApi('/api/auth/logout', { method: 'POST' });
        console.log(has('--json') ? JSON.stringify(status, null, 2) : 'Signed out through the running Foundry instance.');
        break;
      }
      const info = await providerApi('/api/auth?force=1');
      if (sub === 'login') { await serverLogin(info.provider); break; }
      const status = info.status;
      console.log(has('--json') ? JSON.stringify(status, null, 2) : status.loggedIn ? `✔ ${info.provider}: signed in (${status.email ?? status.authMethod ?? 'account'})` : `✘ ${info.provider}: ${status.error ?? 'not signed in'}`);
      break;
    }
    if (process.env.FOUNDRY_URL) {
      console.error(`Cannot reach the configured Foundry instance at ${BASE}. Account changes require that instance to be available.`);
      process.exitCode = 2;
      break;
    }
    const { defaultConfig, SettingsStore, applySettingsToConfig, codexAuthStatus, claudeAuthStatus, claudeConfigEnv } = await import('@foundry/engine');
    const cfg = defaultConfig(ROOT);
    const settings = new SettingsStore(cfg.dataDir);
    applySettingsToConfig(cfg, settings.values(), settings.fileLeaves());
    const backend = provider ?? cfg.provider;
    if (sub === 'login' || sub === 'logout') {
      const bin = backend === 'codex' ? cfg.codexBin ?? Bun.which('codex') ?? 'codex' : cfg.claudeBin ?? Bun.which('claude') ?? 'claude';
      const args = backend === 'codex' ? [sub, ...(sub === 'login' ? ['--device-auth'] : [])] : ['auth', sub, ...(sub === 'login' ? ['--claudeai'] : [])];
      const p = Bun.spawn([bin, ...args], { env: { ...process.env, ...(backend === 'codex' ? { CODEX_HOME: cfg.codexHome } : claudeConfigEnv(cfg.claudeHome)) }, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
      process.exit(await p.exited);
    }
    const st = backend === 'codex' ? await codexAuthStatus(cfg.codexBin ?? Bun.which('codex'), undefined, cfg.codexHome) : await claudeAuthStatus(cfg.claudeBin ?? Bun.which('claude'), undefined, cfg.claudeHome);
    console.log(has('--json') ? JSON.stringify(st, null, 2) : st.loggedIn ? `✔ ${backend}: signed in (${st.email ?? st.authMethod ?? 'account'})` : `✘ ${backend}: ${st.error ?? 'not signed in'} — run: foundry auth login --provider ${backend}`);
    break;
  }
  case 'access': {
    // Access (ADR-0061): who may use this Foundry from elsewhere; each person a token, shown once
    const sub = positional()[0] ?? 'list';
    if (sub === 'add') {
      const name = positional()[1];
      if (!name) return usage('access add needs a name');
      const r = await api('/api/access/people', { method: 'POST', body: JSON.stringify({ name }) });
      if (has('--json')) return console.log(JSON.stringify(r, null, 2));
      console.log(`${r.person.name}'s token, shown once: ${r.token}`);
      console.log('Set it as FOUNDRY_TOKEN for the CLI, or paste it on the sign-in page in a browser.');
      break;
    }
    if (sub === 'revoke') {
      const id = positional()[1];
      if (!id) return usage('access revoke needs the id `foundry access` lists');
      const r = await api(`/api/access/people/${encodeURIComponent(id)}`, { method: 'DELETE' });
      console.log(has('--json') ? JSON.stringify(r, null, 2) : `revoked ${r.person.name}'s token`);
      break;
    }
    if (sub !== 'list') return usage('access expects list, add <name> or revoke <id>');
    const r = await api('/api/access/people');
    if (has('--json')) return console.log(JSON.stringify(r, null, 2));
    if (!r.people.length) console.log('Access is off: no one has a token, so every request is let in. `foundry access add <name>` turns it on.');
    for (const p of r.people) console.log(`${p.id}  ${p.name}  since ${p.createdAt.slice(0, 10)}  last used ${p.lastUsedAt ? p.lastUsedAt.slice(0, 16).replace('T', ' ') : 'never'}`);
    break;
  }
  case 'report': {
    // Reports (ADR-0060): a window of days, or everything
    const r = await api(`/api/reports?days=${has('--all') ? 'all' : encodeURIComponent(opt('--days') ?? '30')}`);
    if (has('--json')) return console.log(JSON.stringify(r, null, 2));
    const t = r.totals;
    const pct = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)}%`);
    const usd = (x: number) => `$${x.toFixed(2)}`;
    const hours = (min: number) => (min < 60 ? `${Math.round(min)} min` : `${(min / 60).toFixed(1)} h`);
    const factor = (f: { factor: number } | null) => (f ? `×${f.factor}` : '—');
    console.log(`${r.window.days == null ? 'All time' : `Last ${r.window.days} days`}: ${usd(t.costUsd)} (Claude Code)  ${t.sessions} sessions  ${t.goals.finished}/${t.goals.total} goals finished (${t.goals.failed} failed, ${t.goals.cancelled} cancelled)  ${hours(t.activeMin)} worked`);
    console.log(`retries: ${pct(t.retries.rate)} of ${t.retries.tasks} tasks needed more than one attempt; ${t.retries.fixTasks} fix tasks`);
    console.log(`estimates: cost ${factor(t.estimate.cost)}, time ${factor(t.estimate.time)} (actual ÷ estimate over ${t.estimate.samples} goal${t.estimate.samples === 1 ? '' : 's'} with one)`);
    if (r.repos.length) {
      console.log('by project:');
      for (const p of r.repos) console.log(`  ${p.name}: ${usd(p.costUsd)}  ${p.goals.finished}/${p.goals.total} finished  ${hours(p.activeMin)}  retries ${pct(p.retries.rate)}  estimate ${factor(p.estimate.cost)}/${factor(p.estimate.time)}`);
    }
    if (r.kinds.length) console.log('by kind: ' + r.kinds.map((k: any) => `${k.kind} ${pct(k.costShare)} of $ · ${pct(k.timeShare)} of time`).join(', '));
    console.log(`\n${r.note}`);
    break;
  }
  case 'usage': {
    const query = opt('--provider') ? `?provider=${encodeURIComponent(opt('--provider')!)}` : '';
    const u = has('--probe') ? await api(`/api/usage/probe${query}`, { method: 'POST' }) : await api(`/api/usage${query}`);
    const cost = (value: number) => u.costAvailable === false ? 'cost unavailable' : `$${value.toFixed(2)}`;
    if (has('--json')) return console.log(JSON.stringify(u, null, 2));
    const win = (w: any, showSignal = true) => {
      const reset = w.resetsAt ? `resets ${new Date(w.resetsAt).toLocaleTimeString()}` : 'no reset signal yet';
      console.log(showSignal ? `${w.label}: ${w.status ?? 'unknown'} (${reset}${w.isUsingOverage ? ', using overage' : ''})` : w.label);
      console.log(`  sessions ${w.sessions}  in ${fmtK(w.inputTokens)}  out ${fmtK(w.outputTokens)}  cache-read ${fmtK(w.cacheReadTokens)}  ${cost(w.costUsd)}`);
    };
    if (u.provider === 'codex') {
      const quota = u.codexQuota;
      if (quota?.state === 'available') {
        console.log(`ChatGPT account quota: ${quota.ordinaryUsageAllowed === true ? 'allowed' : quota.ordinaryUsageAllowed === false ? 'blocked' : 'allowance unknown'}`);
        for (const bucket of quota.buckets) {
          const windows = codexQuotaWindows(bucket);
          if (!windows.length) console.log(`  ${bucket.label}: no quota windows reported`);
          for (const { window, label } of windows) console.log(`  ${bucket.label} · ${label}: ${window.usedPercent == null ? 'usage unknown' : `${window.usedPercent}% used`}; ${window.resetsAt == null ? 'reset unknown' : `reported reset ${new Date(window.resetsAt * 1000).toLocaleString()}`}`);
        }
        if (!quota.buckets.length) console.log('No quota windows were returned for this account.');
        console.log('Reported windows do not prove recovery.');
      } else console.log(`ChatGPT account quota: ${quota?.message ?? 'unavailable'}`);
      console.log('Foundry activity only (not an account limit):');
      win({ ...u.sevenDay, label: 'Last 7 days' }, false);
    } else {
      win(u.fiveHour);
      win(u.sevenDay);
    }
    if (u.pausedUntil) console.log(`⏸ ${u.provider} paused (rate limited) until ${new Date(u.pausedUntil).toLocaleTimeString()}`);
    if (u.byModel.length) console.log('by model (7d): ' + u.byModel.map((m: any) => `${m.model} ${cost(m.costUsd)}`).join(', '));
    if (u.byKind.length) console.log('by kind (7d):  ' + u.byKind.map((k: any) => `${k.kind} ${k.sessions}× ${cost(k.costUsd)}`).join(', '));
    console.log(`\n${u.note}`);
    break;
  }
  case 'doctor': {
    const report = (await serverUp()) ? await providerApi('/api/doctor') : await (await skillsLocal(provider)).doctor();
    if (has('--json')) console.log(JSON.stringify(report, null, 2));
    else {
      for (const ch of report.checks) {
        const mark = ch.ok ? '✔' : ch.severity === 'warn' ? '⚠' : '✘';
        console.log(`${mark} ${pad(ch.label, 30)} ${ch.detail}`);
        if (!ch.ok && ch.fix?.command) console.log(`      fix: ${ch.fix.command}`);
        if (!ch.ok && ch.fix?.installId) console.log(`      or:  foundry skills install ${ch.fix.installId}${provider ? ` --provider ${provider}` : ''}`);
        if (!ch.ok && ch.fix?.url) console.log(`      see: ${ch.fix.url}`);
      }
      console.log(report.ok ? '\nall good ✔' : '\nsome checks failed ✘');
    }
    if (!report.ok) process.exit(1);
    break;
  }
  case 'skills': {
    const [sub, target] = positional();
    const up = await serverUp();
    const local = up ? null : await skillsLocal(provider);
    const STATUS_ICON: Record<string, string> = { installed: '✔', 'installed-unmanaged': '✔', 'installed-via-plugin': '✔', partial: '◐', missing: '✘' };
    if (sub === 'list' || sub === undefined) {
      const repo = opt('--repo') ? resolve(opt('--repo')!) : undefined;
      const scope = opt('--scope') ?? 'all';
      const o = up ? await providerApi(`/api/skills${repo ? `?repo=${encodeURIComponent(repo)}` : ''}`) : await local!.overview(repo);
      const rows = o.installed.filter((r: any) => scope === 'all' || r.scope === scope);
      if (has('--json')) return console.log(JSON.stringify({ ...o, installed: rows }, null, 2));
      console.log(`${rows.length} skills (${o.skillsDir}) — ${o.duplicates.length} duplicate name(s)${o.lastSession ? `; Claude last saw ${o.lastSession.skills.length} skills` : ''}\n`);
      for (const r of rows) {
        const tags = [r.scope, r.managedBy, r.duplicateOf.length ? 'duplicate' : null, r.unparsable ? 'unparsable' : null, r.symlink?.broken ? 'broken-link' : null].filter(Boolean).join(',');
        console.log(`${pad(r.invoke, 40)} ${pad(tags, 28)} ${r.description.slice(0, 70)}`);
      }
      break;
    }
    if (sub === 'catalog') {
      const o = up ? await providerApi('/api/skills') : await local!.overview();
      for (const tier of ['required', 'recommended', 'optional']) {
        console.log(`\n[${tier}]`);
        for (const s of o.catalog.filter((x: any) => x.entry.tier === tier)) console.log(`  ${STATUS_ICON[s.status] ?? '?'} ${pad(s.entry.id, 26)} ${pad(s.status, 22)} ${s.entry.summary}\n      why: ${s.entry.why}${s.manual && s.status !== 'installed' ? `\n      install: ${s.manual.command}` : ''}`);
      }
      break;
    }
    if (sub === 'install') {
      const tier = opt('--tier');
      if (tier) {
        const r = up ? await providerApi('/api/skills/install-tier', { method: 'POST', body: JSON.stringify({ tiers: [tier] }) }) : await local!.installTier([tier as any]);
        for (const x of r.results) console.log(`${x.ok ? '✔' : '✘'} ${pad(x.name, 28)} ${x.ok ? (x.path ? 'installed' : 'already satisfied') : x.error}${x.manual ? `\n      run: ${x.manual.command}` : ''}`);
        break;
      }
      const id = target;
      if (!id) return usage('skills install needs <id|name> or --tier');
      const r = up ? await providerApi('/api/skills/install', { method: 'POST', body: JSON.stringify({ id, force: has('--force') }) }) : await local!.install(id, { force: has('--force') });
      if (r.manual) console.log(`${r.name}: manual install required\n  run: ${r.manual.command}${r.manual.docs ? `\n  see: ${r.manual.docs}` : ''}`);
      else console.log(`✔ ${r.name} installed at ${r.path}${r.commit ? ` @ ${r.commit.slice(0, 7)}` : ''}`);
      break;
    }
    if (sub === 'uninstall' || sub === 'restore') {
      const name = target;
      if (!name) return usage(`skills ${sub} needs <name>`);
      const r = up ? await providerApi(`/api/skills/${encodeURIComponent(name)}/${sub}`, { method: 'POST', body: JSON.stringify({ force: has('--force') }) }) : sub === 'uninstall' ? await local!.uninstall(name, { force: has('--force') }) : await local!.restore(name, { force: has('--force') });
      console.log(sub === 'uninstall' ? `✔ ${name} moved to ${r.trash.path}${r.note ? `\n  note: ${r.note}` : ''}` : `✔ ${name} restored to ${r.path}`);
      break;
    }
    if (sub === 'update') {
      const r = up ? await providerApi('/api/skills/update', { method: 'POST', body: JSON.stringify({ name: target }) }) : await local!.update(target);
      for (const u of r.updated) console.log(`↑ ${u.name} ${u.from?.slice(0, 7) ?? '?'} → ${u.to?.slice(0, 7) ?? '?'}`);
      for (const n of r.unchanged) console.log(`= ${n} up to date`);
      for (const e of r.errors) console.log(`✘ ${e.name}: ${e.error}`);
      if (!r.updated.length && !r.unchanged.length && !r.errors.length) console.log('nothing installed by foundry to update');
      break;
    }
    if (sub === 'trash') {
      const list = up ? await providerApi('/api/skills/trash') : local!.trash();
      if (!list.length) console.log('trash is empty');
      for (const t of list) console.log(`${t.trashedAt.slice(0, 19)}  ${pad(t.name, 28)} ${t.reason}`);
      break;
    }
    return usage(`unknown skills subcommand: ${sub}`);
  }
  default:
    usage();
}
}

async function serverLogin(provider: AgentProvider): Promise<void> {
  const query = `?provider=${provider}`;
  let session = await api(`/api/auth/login${query}`, { method: 'POST', body: '{}' });
  const id = session.id;
  let shown = 0;
  let shownUrl: string | null = null;
  let cancelled = false;
  const cancel = () => { cancelled = true; };
  process.on('SIGINT', cancel);
  try {
    while (session && session.id === id) {
      for (const line of session.lines.slice(shown)) console.log(line);
      shown = session.lines.length;
      if (session.url && session.url !== shownUrl) { console.log(`Open ${session.url}`); shownUrl = session.url; }
      if (session.done) {
        if (!session.ok) { console.error(session.error ?? 'Sign-in failed.'); process.exitCode = 1; }
        else console.log(`✔ ${provider}: signed in.`);
        return;
      }
      if (cancelled) { await api(`/api/auth/login/cancel${query}`, { method: 'POST' }); process.exitCode = 130; return; }
      if (session.needsCode) {
        console.log(`Complete this sign-in at ${BASE}/accounts; the session remains active there.`);
        return;
      }
      await Bun.sleep(1000);
      session = await api(`/api/auth/login${query}`);
    }
    console.error('The sign-in session changed. Check Accounts in Foundry.'); process.exitCode = 1;
  } finally { process.off('SIGINT', cancel); }
}

function usage(msg?: string): never {
  if (msg) console.error(msg + '\n');
  console.log(help);
  process.exit(msg ? 1 : 0);
}
function pad(s: string, n: number) {
  return s.padEnd(n);
}
function fmtK(n: number) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

/** the live feed's address, the person's token on it: a WebSocket cannot carry the bearer header (ADR-0061) */
function wsAddress(): string {
  return BASE.replace(/^http/, 'ws') + '/ws' + (process.env.FOUNDRY_TOKEN ? `?token=${encodeURIComponent(process.env.FOUNDRY_TOKEN)}` : '');
}

/** what the Explainer is doing, from its tool call, for the lines beside the answer: Claude's tools by name, Codex's and Antigravity's by what the call says */
function describeTool(ev: { name: string; input: any }): string {
  const i: Record<string, unknown> = ev.input && typeof ev.input === 'object' ? ev.input : {};
  const tail = (p: unknown) => String(p ?? '').split('/').filter(Boolean).slice(-2).join('/');
  const short = (s: unknown, n = 80) => String(s ?? '').replace(/\s+/g, ' ').slice(0, n);
  // Codex wraps every command in its login shell
  const plain = (c: unknown) => String(c ?? '').replace(/^(?:\/bin\/)?(?:zsh|bash|sh)\s+-lc\s+/, '').replace(/^(['"])([\s\S]*)\1$/, '$2');
  const field = (re: RegExp) => Object.entries(i).find(([k, v]) => re.test(k) && typeof v === 'string' && v)?.[1] as string | undefined;
  if (ev.name === 'Read') return `reading ${tail(i.file_path)}`;
  if (ev.name === 'Grep' || ev.name === 'Glob') return `searching for ${short(i.pattern, 60)}`;
  if (ev.name === 'Bash') return `running ${short(plain(i.command))}`;
  if (ev.name.startsWith('mcp__')) return `asking ${ev.name.split('__')[1] ?? 'a tool'}`;
  const name = ev.name.toLowerCase();
  if (/command|shell|exec/.test(name)) return `running ${short(plain(field(/command/i) ?? Object.values(i).find((v) => typeof v === 'string')))}`;
  if (/read|view|open|cat/.test(name)) return `reading ${tail(field(/path|file/i)) || 'a file'}`;
  if (/grep|search|find/.test(name)) return `searching for ${short(field(/query|pattern|search/i), 60) || '…'}`;
  if (/list|dir|ls/.test(name)) return `listing ${tail(field(/path|dir/i)) || 'the folder'}`;
  return ev.name;
}

/**
 * A question to a goal's Explainer (Conversation, ADR-0073): kept by the server at once, its answer streamed here as it is
 * written, then how it ended and what it cost. Without the live feed the answer is fetched once it is there.
 */
async function ask(goalId: string, text: string, fresh: boolean): Promise<void> {
  const started = await api(`/api/goals/${goalId}/conversations/ask`, { method: 'POST', body: JSON.stringify({ text, fresh }) });
  const { conversationId, messageId, channel } = started;
  const costAvailable = (await api(`/api/goals/${goalId}`)).goal.provider !== 'codex';
  const summary = (p: any) => `\n— ${p.status}${p.reason ? ` (${p.reason})` : ''} · ${costAvailable && p.costAvailable ? `$${Number(p.costUsd).toFixed(3)}` : 'cost unavailable'}${p.model ? ` · ${p.model}` : ''}`;
  await new Promise<void>((done) => {
    let streamed = false;
    let finished = false;
    const finish = (line: string) => {
      if (finished) return;
      finished = true;
      console.log(line);
      done();
    };
    // the answer read back once it is there: for a feed that could not be opened
    const poll = async () => {
      for (;;) {
        await Bun.sleep(2000);
        const v = await api(`/api/goals/${goalId}/conversations`);
        const a = v.conversations.find((c: any) => c.id === conversationId)?.messages.find((m: any) => m.askedId === messageId);
        if (a) return finish(`${a.text}${summary(a)}`);
      }
    };
    const ws = new WebSocket(wsAddress());
    ws.onmessage = (m) => {
      const msg = JSON.parse(String(m.data));
      if (msg.kind === 'stream' && msg.stream.attemptId === channel) {
        const ev = msg.stream.event;
        if (ev.kind === 'text_delta') {
          streamed = true;
          process.stdout.write(ev.text);
        } else if (ev.kind === 'text' && !streamed) console.log(ev.text);
        else if (ev.kind === 'tool_use') console.error(`  ⚙ ${describeTool(ev)}`);
      } else if (msg.kind === 'event' && msg.event.type === 'conversation.answered' && msg.event.payload.askedId === messageId) {
        const p = msg.event.payload;
        if (streamed) process.stdout.write('\n');
        else if (p.text && p.status !== 'done') console.log(p.text);
        finish(summary(p));
        ws.close();
      }
    };
    ws.onerror = () => ws.close();
    ws.onclose = () => {
      if (!finished) void poll();
    };
  });
}

async function watch(goalId: string): Promise<void> {
  const costAvailable = (await api(`/api/goals/${goalId}`)).goal.provider !== 'codex';
  const wsUrl = wsAddress();
  await new Promise<void>((resolveDone) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => console.log(`watching ${goalId} … (ctrl-c to stop)`);
    ws.onmessage = (m) => {
      const msg = JSON.parse(String(m.data));
      if (msg.kind === 'event' && msg.event.goalId === goalId) {
        const e = msg.event;
        const p = e.payload;
        const line =
          e.type === 'goal.state_changed' ? `${p.from} → ${p.to} (${p.reason})` :
          e.type === 'task.state_changed' ? `task ${p.taskId.slice(-6)} ${p.from} → ${p.to} (${p.reason})` :
          e.type === 'check.finished' ? `check ${p.result.status} ${p.result.summary.split('\n')[0]?.slice(0, 80)}` :
          e.type === 'attempt.finished' ? `attempt ${p.attemptId.slice(-6)} ${p.resultSubtype} ${costAvailable ? `$${p.costUsd.toFixed(3)} turns=${p.numTurns}` : 'cost and turns unavailable'}` :
          e.type === 'escalation.raised' ? `⚠ ESCALATION [${p.escalation.trigger}] ${p.escalation.id}: ${p.escalation.message.split('\n')[0]}` :
          e.type === 'engine.note' ? `${p.level}: ${p.message.split('\n')[0]}` :
          e.type === 'goal.cost_added' ? `+$${p.costUsd.toFixed(3)} ${p.source}` : '';
        console.log(`[${e.ts.slice(11, 19)}] ${e.type}${line ? '  ' + line : ''}`);
        if (e.type === 'goal.state_changed' && ['done', 'over_delivered', 'failed', 'cancelled'].includes(p.to)) {
          ws.close();
          resolveDone();
        }
      } else if (msg.kind === 'stream' && msg.stream.goalId === goalId) {
        const ev = msg.stream.event;
        if (ev.kind === 'text') console.log(`    ${ev.text.split('\n').join('\n    ')}`);
        else if (ev.kind === 'tool_use') console.log(`    ⚙ ${ev.name} ${JSON.stringify(ev.input).slice(0, 120)}`);
        else if (ev.kind === 'tool_result' && ev.isError) console.log(`    ✗ ${ev.content.slice(0, 160).replace(/\n/g, ' ')}`);
        else if (ev.kind === 'rate_limit' && ev.info.status !== 'allowed') console.log(`    ⏳ rate limit: ${ev.info.status}`);
      }
    };
    ws.onclose = () => resolveDone();
    ws.onerror = () => resolveDone();
  });
}
