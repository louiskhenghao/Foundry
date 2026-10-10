#!/usr/bin/env bun
/**
 * foundry CLI — thin client over the local server, plus `serve` and `replay`.
 */
import { help } from './help.ts';
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
const FLAGS = new Set(['--auto-approve', '--approve', '--verify', '--json', '--follow', '--force', '--self-check', '--no-attachments', '--no-style', '--settings', '--secrets', '--transcripts', '--dry-run', '--password-stdin']);
const BASE = process.env.FOUNDRY_URL ?? `http://127.0.0.1:${process.env.FOUNDRY_PORT ?? 4111}`;

async function api(path: string, init?: RequestInit): Promise<any> {
  let res: Response;
  try {
    res = await fetch(BASE + path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  } catch {
    console.error(`Cannot reach foundry at ${BASE}. Start it with: bun run serve`);
    process.exit(2);
  }
  const text = await res.text();
  const body = text ? safeJson(text) : null;
  if (!res.ok) {
    console.error(`error ${res.status}: ${body?.error ?? text}`);
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
async function skillsLocal(selected?: 'claude' | 'codex') {
  const { SkillsManager, defaultConfig, SettingsStore, applySettingsToConfig } = await import('@foundry/engine');
  const cfg = defaultConfig(ROOT);
  const settings = new SettingsStore(cfg.dataDir);
  applySettingsToConfig(cfg, settings.values(), settings.fileLeaves());
  const provider = selected ?? cfg.provider;
  return new SkillsManager({ provider, codexBin: cfg.codexBin, codexHome: cfg.codexHome, claudeBin: cfg.claudeBin, claudeHome: provider === 'codex' ? cfg.codexHome : cfg.claudeHome, dataDir: provider === cfg.provider ? cfg.dataDir : join(cfg.dataDir, 'providers', provider), catalogPath: cfg.catalogPath, log: (m) => console.error(m) });
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
if (has('--provider') && selected !== 'claude' && selected !== 'codex') return usage('--provider must be claude or codex');
const provider = selected as 'claude' | 'codex' | undefined;
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
    const prompt = rest[1];
    // a Follow-up: the earlier goal's repository and settings are the defaults, any flag given wins
    const followsId = opt('--follows');
    const draft = followsId ? await api(`/api/goals/${followsId}/follow-up-draft`) : null;
    if (draft && !draft.followable) return usage(`goal ${followsId} cannot be followed: ${draft.reason}`);
    const repoPath = opt('--repo') ?? draft?.prefill.repoPath;
    if (!prompt || !repoPath) return usage('goal new needs "<prompt>" and --repo <path> (or --follows <goal id>)');
    const effort = opt('--effort');
    const body: any = {
      prompt,
      repoPath: resolve(repoPath),
      title: opt('--title'),
      provider: opt('--provider') ?? draft?.prefill.provider,
      codexModel: opt('--codex-model') ?? (opt('--models') ? undefined : draft?.prefill.codexModel),
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
      workflow: opt('--pace') ? { pace: opt('--pace') } : undefined,
      interview: opt('--interview'),
      effort: effort === 'default' ? null : effort,
      ...(has('--self-check') ? { selfCheck: true } : {}),
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
      for (const g of goals) console.log(`${g.id}  ${pad(g.state, 24)} ${g.provider === 'codex' ? 'Codex · cost unavailable' : `$${g.costUsd.toFixed(2)}/${g.budgets.maxCostUsd ?? '∞'}`}  tasks=${JSON.stringify(g.taskCounts)}  esc=${g.openEscalations}  ${g.title}`);
    } else {
      const d = await api(`/api/goals/${id}`);
      if (has('--json')) return console.log(JSON.stringify(d, null, 2));
      const g = d.goal;
      console.log(`${g.id} [${g.state}] ${g.title}\n  repo ${g.repoPath} (${g.baseBranch} → ${g.branch})\n  cost ${g.provider === 'codex' ? 'unavailable' : `$${g.costUsd.toFixed(3)} / ${g.budgets.maxCostUsd == null ? 'no cap' : `$${g.budgets.maxCostUsd}`}`}    elapsed ${d.budget.elapsedMin.toFixed(1)} / ${g.budgets.maxDurationMin ?? '∞'} min   preset ${g.budgetPreset}`);
      for (const t of d.tasks) {
        const attempts = d.attempts.filter((a: any) => a.taskId === t.id);
        console.log(`  - ${pad(t.state, 10)} ${t.title}  (attempts ${attempts.length}/${t.retryBudget + t.extraAttempts}${t.worktreePath ? ', own worktree' : ''})`);
        for (const a of attempts) {
          const res = d.checkResults.filter((r: any) => r.attemptId === a.id);
          console.log(`      #${a.index} ${a.kind} ${pad(a.state, 9)} ${g.provider === 'codex' ? 'cost and turns unavailable' : `$${a.costUsd.toFixed(3)} turns=${a.numTurns}`} ${a.resultSubtype ?? ''} checks: ${res.map((r: any) => (r.status === 'pass' ? '✅' : '❌')).join('') || '-'}`);
        }
      }
      const open = d.escalations.filter((e: any) => e.state === 'open');
      for (const e of open) console.log(`  ⚠ escalation ${e.id} [${e.trigger}] ${e.message.split('\n')[0]}`);
    }
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
      if (b.questions.length) console.log('\nQuestions:\n' + b.questions.map((q: any) => `  ${q.blocking ? '(blocking) ' : ''}${q.text} → ${q.answer ?? '(unanswered)'}`).join('\n'));
      console.log(`\nEstimate: ${d.goal.provider === 'codex' ? 'cost unavailable' : `$${b.costEstimateUsd}`} / ${b.timeEstimateMin} min`);
    }
    if (has('--approve')) {
      const answers = opts('--answer');
      if (answers.length) b.questions.forEach((q: any, i: number) => (q.answer = answers[i] ?? q.answer));
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
          for (const { window, label } of windows) console.log(`  ${bucket.label} · ${label}: ${window.usedPercent == null ? 'usage unknown' : `${window.usedPercent}% used`}; ${window.resetsAt == null ? 'reset unknown' : `reported reset ${new Date(window.resetsAt * 1000).toISOString()}`}`);
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

async function serverLogin(provider: 'claude' | 'codex'): Promise<void> {
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

async function watch(goalId: string): Promise<void> {
  const costAvailable = (await api(`/api/goals/${goalId}`)).goal.provider !== 'codex';
  const wsUrl = BASE.replace(/^http/, 'ws') + '/ws';
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
