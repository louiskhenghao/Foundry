#!/usr/bin/env bun
/**
 * foundry CLI — thin client over the local server, plus `serve` and `replay`.
 */
import { help } from './help.ts';
import { resolve } from 'node:path';

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
const FLAGS = new Set(['--auto-approve', '--approve', '--verify', '--json', '--follow', '--force', '--self-check', '--no-attachments', '--no-style']);
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
async function skillsLocal() {
  const { SkillsManager, defaultConfig } = await import('@foundry/engine');
  const cfg = defaultConfig(ROOT);
  return new SkillsManager({ claudeHome: cfg.claudeHome, dataDir: cfg.dataDir, catalogPath: cfg.catalogPath, log: (m) => console.error(m) });
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
switch (cmd) {
  case 'serve': {
    const { Engine, defaultConfig } = await import('@foundry/engine');
    const { startServer } = await import('@foundry/server');
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
    const body: any = {
      prompt,
      repoPath: resolve(repoPath),
      title: opt('--title'),
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
      effort: opt('--effort'),
      ...(has('--self-check') ? { selfCheck: true } : {}),
    };
    if (has('--auto-approve')) body.autoBrief = { mustChecks: opts('--check'), stretchChecks: opts('--stretch') };
    if (opt('--deliver')) body.delivery = { mode: opt('--deliver'), remote: opt('--remote') ?? 'origin', remoteUrl: opt('--remote-url') ?? null };
    if (draft) {
      const p = draft.prefill;
      body.nature ??= p.nature;
      body.modelPreset ??= p.modelPreset ?? undefined;
      body.effort ??= p.effort ?? undefined;
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
      for (const g of goals) console.log(`${g.id}  ${pad(g.state, 24)} $${g.costUsd.toFixed(2)}/${g.budgets.maxCostUsd ?? '∞'}  tasks=${JSON.stringify(g.taskCounts)}  esc=${g.openEscalations}  ${g.title}`);
    } else {
      const d = await api(`/api/goals/${id}`);
      if (has('--json')) return console.log(JSON.stringify(d, null, 2));
      const g = d.goal;
      console.log(`${g.id} [${g.state}] ${g.title}\n  repo ${g.repoPath} (${g.baseBranch} → ${g.branch})\n  cost $${g.costUsd.toFixed(3)} / ${g.budgets.maxCostUsd == null ? 'no cap' : `$${g.budgets.maxCostUsd}`}   elapsed ${d.budget.elapsedMin.toFixed(1)} / ${g.budgets.maxDurationMin ?? '∞'} min   preset ${g.budgetPreset}`);
      for (const t of d.tasks) {
        const attempts = d.attempts.filter((a: any) => a.taskId === t.id);
        console.log(`  - ${pad(t.state, 10)} ${t.title}  (attempts ${attempts.length}/${t.retryBudget + t.extraAttempts}${t.worktreePath ? ', own worktree' : ''})`);
        for (const a of attempts) {
          const res = d.checkResults.filter((r: any) => r.attemptId === a.id);
          console.log(`      #${a.index} ${a.kind} ${pad(a.state, 9)} $${a.costUsd.toFixed(3)} turns=${a.numTurns} ${a.resultSubtype ?? ''} checks: ${res.map((r: any) => (r.status === 'pass' ? '✅' : '❌')).join('') || '-'}`);
        }
      }
      const open = d.escalations.filter((e: any) => e.state === 'open');
      for (const e of open) console.log(`  ⚠ escalation ${e.id} [${e.trigger}] ${e.message.split('\n')[0]}`);
    }
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
      console.log(`\nEstimate: $${b.costEstimateUsd} / ${b.timeEstimateMin} min`);
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
    const store = new EventStore(openDatabase(resolve(ROOT, 'data/engine.db')));
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
    const sub = rest[0] ?? 'status';
    if (sub === 'login' || sub === 'logout') {
      // hand the terminal to claude itself (browser + prompts)
      const p = Bun.spawn([Bun.which('claude') ?? 'claude', 'auth', sub], { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
      process.exit(await p.exited);
    }
    const st = (await serverUp()) ? (await api('/api/auth?force=1')).status : await (await import('@foundry/engine')).claudeAuthStatus(Bun.which('claude'));
    if (has('--json')) return console.log(JSON.stringify(st, null, 2));
    console.log(st.loggedIn ? `✔ logged in as ${st.email ?? '?'} (${st.subscriptionType ?? st.authMethod ?? '?'})${st.orgName ? ` · ${st.orgName}` : ''}` : `✘ not logged in${st.error ? ` — ${st.error}` : ''}\n  run: foundry auth login`);
    break;
  }
  case 'usage': {
    const u = has('--probe') ? await api('/api/usage/probe', { method: 'POST' }) : await api('/api/usage');
    if (has('--json')) return console.log(JSON.stringify(u, null, 2));
    const win = (w: any) => {
      const reset = w.resetsAt ? `resets ${new Date(w.resetsAt).toLocaleTimeString()}` : 'no reset signal yet';
      console.log(`${w.label}: ${w.status ?? 'unknown'} (${reset}${w.isUsingOverage ? ', using overage' : ''})`);
      console.log(`  sessions ${w.sessions}  in ${fmtK(w.inputTokens)}  out ${fmtK(w.outputTokens)}  cache-read ${fmtK(w.cacheReadTokens)}  est $${w.costUsd.toFixed(2)}`);
    };
    win(u.fiveHour);
    win(u.sevenDay);
    if (u.pausedUntil) console.log(`⏸ engine paused (rate limited) until ${new Date(u.pausedUntil).toLocaleTimeString()}`);
    if (u.byModel.length) console.log('by model (7d): ' + u.byModel.map((m: any) => `${m.model} $${m.costUsd.toFixed(2)}`).join(', '));
    if (u.byKind.length) console.log('by kind (7d):  ' + u.byKind.map((k: any) => `${k.kind} ${k.sessions}×$${k.costUsd.toFixed(2)}`).join(', '));
    console.log(`\n${u.note}`);
    break;
  }
  case 'doctor': {
    const report = (await serverUp()) ? await api('/api/doctor') : await (await skillsLocal()).doctor();
    if (has('--json')) console.log(JSON.stringify(report, null, 2));
    else {
      for (const ch of report.checks) {
        const mark = ch.ok ? '✔' : ch.severity === 'warn' ? '⚠' : '✘';
        console.log(`${mark} ${pad(ch.label, 30)} ${ch.detail}`);
        if (!ch.ok && ch.fix?.command) console.log(`      fix: ${ch.fix.command}`);
        if (!ch.ok && ch.fix?.installId) console.log(`      or:  foundry skills install ${ch.fix.installId}`);
        if (!ch.ok && ch.fix?.url) console.log(`      see: ${ch.fix.url}`);
      }
      console.log(report.ok ? '\nall good ✔' : '\nsome checks failed ✘');
    }
    if (!report.ok) process.exit(1);
    break;
  }
  case 'skills': {
    const sub = rest[0];
    const up = await serverUp();
    const local = up ? null : await skillsLocal();
    const STATUS_ICON: Record<string, string> = { installed: '✔', 'installed-unmanaged': '✔', 'installed-via-plugin': '✔', partial: '◐', missing: '✘' };
    if (sub === 'list' || sub === undefined) {
      const repo = opt('--repo') ? resolve(opt('--repo')!) : undefined;
      const scope = opt('--scope') ?? 'all';
      const o = up ? await api(`/api/skills${repo ? `?repo=${encodeURIComponent(repo)}` : ''}`) : await local!.overview(repo);
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
      const o = up ? await api('/api/skills') : await local!.overview();
      for (const tier of ['required', 'recommended', 'optional']) {
        console.log(`\n[${tier}]`);
        for (const s of o.catalog.filter((x: any) => x.entry.tier === tier)) console.log(`  ${STATUS_ICON[s.status] ?? '?'} ${pad(s.entry.id, 26)} ${pad(s.status, 22)} ${s.entry.summary}\n      why: ${s.entry.why}${s.manual && s.status !== 'installed' ? `\n      install: ${s.manual.command}` : ''}`);
      }
      break;
    }
    if (sub === 'install') {
      const tier = opt('--tier');
      if (tier) {
        const r = up ? await api('/api/skills/install-tier', { method: 'POST', body: JSON.stringify({ tiers: [tier] }) }) : await local!.installTier([tier as any]);
        for (const x of r.results) console.log(`${x.ok ? '✔' : '✘'} ${pad(x.name, 28)} ${x.ok ? (x.path ? 'installed' : 'already satisfied') : x.error}${x.manual ? `\n      run: ${x.manual.command}` : ''}`);
        break;
      }
      const id = rest[1];
      if (!id) return usage('skills install needs <id|name> or --tier');
      const r = up ? await api('/api/skills/install', { method: 'POST', body: JSON.stringify({ id, force: has('--force') }) }) : await local!.install(id, { force: has('--force') });
      if (r.manual) console.log(`${r.name}: manual install required\n  run: ${r.manual.command}${r.manual.docs ? `\n  see: ${r.manual.docs}` : ''}`);
      else console.log(`✔ ${r.name} installed at ${r.path}${r.commit ? ` @ ${r.commit.slice(0, 7)}` : ''}`);
      break;
    }
    if (sub === 'uninstall' || sub === 'restore') {
      const name = rest[1];
      if (!name) return usage(`skills ${sub} needs <name>`);
      const r = up ? await api(`/api/skills/${encodeURIComponent(name)}/${sub}`, { method: 'POST', body: JSON.stringify({ force: has('--force') }) }) : sub === 'uninstall' ? await local!.uninstall(name, { force: has('--force') }) : await local!.restore(name, { force: has('--force') });
      console.log(sub === 'uninstall' ? `✔ ${name} moved to ${r.trash.path}${r.note ? `\n  note: ${r.note}` : ''}` : `✔ ${name} restored to ${r.path}`);
      break;
    }
    if (sub === 'update') {
      const r = up ? await api('/api/skills/update', { method: 'POST', body: JSON.stringify({ name: rest[1] }) }) : await local!.update(rest[1]);
      for (const u of r.updated) console.log(`↑ ${u.name} ${u.from?.slice(0, 7) ?? '?'} → ${u.to?.slice(0, 7) ?? '?'}`);
      for (const n of r.unchanged) console.log(`= ${n} up to date`);
      for (const e of r.errors) console.log(`✘ ${e.name}: ${e.error}`);
      if (!r.updated.length && !r.unchanged.length && !r.errors.length) console.log('nothing installed by foundry to update');
      break;
    }
    if (sub === 'trash') {
      const list = up ? await api('/api/skills/trash') : local!.trash();
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
          e.type === 'attempt.finished' ? `attempt ${p.attemptId.slice(-6)} ${p.resultSubtype} $${p.costUsd.toFixed(3)} turns=${p.numTurns}` :
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
