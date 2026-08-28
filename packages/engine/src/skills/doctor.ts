import { accessSync, constants, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { claudeAuthStatus } from '../auth/claude-auth.ts';
import { exec } from '../git/git.ts';
import { SATISFIED, type WhichFn, defaultWhich } from './catalog.ts';
import { packAllows } from './packs.ts';
import type { SkillsPaths } from './paths.ts';
import type { Catalog, CatalogEntryStatus, DoctorCheck, DoctorReport, SkillsUpdateReport } from './types.ts';

export interface DoctorContext {
  paths: SkillsPaths;
  catalog: Catalog;
  statuses: CatalogEntryStatus[];
  claudeBin?: string;
  which?: WhichFn;
  exec?: typeof exec;
  /** offline update report (for shadow-copy and update-available warnings) */
  updates?: SkillsUpdateReport | null;
  /** chosen pack options (skills of unchosen packs skip the missing-env warning) */
  packs?: Record<string, string | undefined>;
  /** engine-level checks (optional tools such as markitdown) appended after the gh check */
  extra?: DoctorCheck[];
}

export async function runDoctor(ctx: DoctorContext): Promise<DoctorReport> {
  const which = ctx.which ?? defaultWhich;
  const run = ctx.exec ?? exec;
  const checks: DoctorCheck[] = [];
  const claude = ctx.claudeBin ?? which('claude');

  // claude binary
  if (!claude) {
    checks.push(err('claude-bin', 'Claude Code CLI', 'claude not found on PATH', { command: 'npm install -g @anthropic-ai/claude-code', url: 'https://code.claude.com/docs/en/setup' }));
    checks.push(err('claude-auth', 'Claude login', 'cannot check: claude not installed', null));
  } else {
    const v = await run([claude, '--version'], process.cwd(), { timeoutMs: 15_000 }).catch(() => ({ code: 1, stdout: '', stderr: '' }));
    checks.push(v.code === 0 ? ok('claude-bin', 'Claude Code CLI', `${v.stdout.trim() || claude}`) : err('claude-bin', 'Claude Code CLI', `${claude} failed to run: ${(v.stderr || v.stdout).trim().slice(0, 200)}`, { url: 'https://code.claude.com/docs/en/setup' }));
    const st = await claudeAuthStatus(claude, run);
    const detail = st.loggedIn ? `logged in as ${st.email ?? '?'} (${st.subscriptionType ?? st.authMethod ?? 'unknown plan'})` : `not logged in${st.error ? ` (${st.error})` : ''}`;
    checks.push(st.loggedIn ? ok('claude-auth', 'Claude login', detail) : err('claude-auth', 'Claude login', detail, { command: 'claude auth login' }));
  }

  const git = which('git');
  checks.push(git ? ok('git', 'git', git) : err('git', 'git', 'git not found on PATH', { command: 'xcode-select --install', url: 'https://git-scm.com/downloads' }));
  const bun = which('bun');
  checks.push(bun ? ok('bun', 'Bun runtime', `${bun} (${typeof Bun !== 'undefined' ? Bun.version : '?'})`) : err('bun', 'Bun runtime', 'bun not found on PATH', { command: 'curl -fsSL https://bun.sh/install | bash', url: 'https://bun.sh' }));

  // required catalog entries (graphify CLI is one of them)
  for (const s of ctx.statuses.filter((x) => x.entry.tier === 'required')) {
    const id = `required:${s.entry.id}`;
    if (SATISFIED.includes(s.status)) checks.push(ok(id, `Required: ${s.entry.name}`, s.detail));
    else {
      // cli entries can be installed by the engine (their documented command runs through sh, streamed to the UI)
      const runnable = s.entry.source.type === 'cli' && !!which(s.manual!.command.trim().split(/\s+/)[0]!);
      checks.push(err(id, `Required: ${s.entry.name}`, `${s.detail} — ${s.entry.why}`, s.manual ? { command: s.manual.command, url: s.manual.docs ?? undefined, installId: s.entry.id, ...(runnable ? { action: 'install-tool' as const } : {}) } : { installId: s.entry.id }));
    }
  }

  // installed skills whose API mode is dead because sessions lack a required env var (e.g. the image pack without OPENAI_API_KEY)
  for (const s of ctx.statuses.filter((x) => SATISFIED.includes(x.status) && x.missingEnv.length && packAllows(x.entry, ctx.packs ?? {}))) {
    checks.push(warn(`env:${s.entry.id}`, `${s.entry.name} backend`, `${s.missingEnv.join(', ')} not set — sessions get the skill in degraded (advisory-only) mode; media deliverables fall back to hand-authored renders`, { url: '/settings' }));
  }

  // GitHub CLI (optional: only delivery modes pr / pr-automerge need it)
  const gh = which('gh');
  if (!gh) checks.push(warn('gh-bin', 'GitHub CLI (optional)', 'gh not installed — needed only for PR / auto-merge delivery', { command: 'brew install gh', url: 'https://cli.github.com' }));
  else {
    const a = await run([gh, 'auth', 'status', '-h', 'github.com'], process.cwd(), { timeoutMs: 20_000 }).catch(() => ({ code: 1, stdout: '', stderr: '' }));
    checks.push(a.code === 0 ? ok('gh-auth', 'GitHub CLI (optional)', `${gh}; logged in`) : warn('gh-auth', 'GitHub CLI (optional)', 'gh installed but not logged in — needed only for PR / auto-merge delivery', { command: 'gh auth login --web' }));
  }

  for (const c of ctx.extra ?? []) checks.push(c);

  // loose user copies that hide newer plugin skills of the same name (the prompt uses the plugin invoke, but both load)
  if (ctx.updates) {
    const shadows = ctx.updates.shadowed;
    if (shadows.length) checks.push(warn('shadow-copies', 'Stale skill copies', `${shadows.length} user-level copies shadow newer plugin skills: ${shadows.slice(0, 8).join(', ')}${shadows.length > 8 ? '…' : ''}`, { action: 'trash-shadows', names: shadows }));
    else checks.push(ok('shadow-copies', 'Stale skill copies', 'none'));
    const outdated = ctx.updates.sources.filter((s) => s.updateAvailable === true);
    if (outdated.length) checks.push(warn('skills-updates', 'Skill updates', `updates available for ${outdated.map((s) => s.label).join(', ')}`, { action: 'check-updates', url: '/skills' }));
  }

  // skills dir writable
  try {
    mkdirSync(ctx.paths.skillsDir, { recursive: true });
    accessSync(ctx.paths.skillsDir, constants.W_OK);
    checks.push(ok('skills-dir', 'Skills directory writable', ctx.paths.skillsDir));
  } catch {
    checks.push(err('skills-dir', 'Skills directory writable', `${ctx.paths.skillsDir} is not writable`, { command: `chmod u+w ${ctx.paths.skillsDir}` }));
  }

  // settings.json parsable + hook paths exist
  if (existsSync(ctx.paths.settingsJson)) {
    try {
      const j = JSON.parse(readFileSync(ctx.paths.settingsJson, 'utf8'));
      const missing: string[] = [];
      for (const group of Object.values<any>(j.hooks ?? {})) {
        for (const entry of Array.isArray(group) ? group : []) {
          for (const h of entry.hooks ?? []) {
            const cmd = String(h.command ?? '').split(' ')[0];
            if (cmd && cmd.startsWith('/') && !existsSync(cmd)) missing.push(cmd);
          }
        }
      }
      checks.push(missing.length ? warn('settings-json', 'settings.json', `hook command(s) not found: ${missing.join(', ')} — every session will log hook errors`, { url: 'https://code.claude.com/docs/en/hooks' }) : ok('settings-json', 'settings.json', 'parsable; hook paths exist'));
    } catch (e) {
      checks.push(warn('settings-json', 'settings.json', `not valid JSON: ${String(e).slice(0, 120)}`, null));
    }
  } else {
    checks.push(ok('settings-json', 'settings.json', 'absent (defaults)'));
  }

  return { ok: checks.every((c) => c.ok || c.severity === 'warn'), at: new Date().toISOString(), checks };
}

const ok = (id: string, label: string, detail: string): DoctorCheck => ({ id, label, ok: true, severity: 'error', detail, fix: null });
const err = (id: string, label: string, detail: string, fix: DoctorCheck['fix']): DoctorCheck => ({ id, label, ok: false, severity: 'error', detail, fix });
const warn = (id: string, label: string, detail: string, fix: DoctorCheck['fix']): DoctorCheck => ({ id, label, ok: false, severity: 'warn', detail, fix });
