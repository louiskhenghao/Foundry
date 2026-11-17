/**
 * `foundry setup` (ADR-0105): everything Foundry needs on this computer, installed where it is missing — what install.sh
 * did in bash for a source install, done by the compiled foundry itself so the app's Setup page, a terminal and the
 * installer run one implementation. Required: git, uv, the chosen coding agents' CLIs and graphify (with its skill for
 * each agent). Recommended: the GitHub CLI and Node.js. Chosen: markitdown, Chromium for the self-check, ffmpeg. A tool
 * already there is left as it is; what only the person can install is said with the command to run.
 */
import type { AgentProvider } from '@foundry/core';
import { delimiter, join } from 'node:path';
import { agentCliInstall } from '../agent-cli.ts';
import { MARKITDOWN_INSTALL } from '../convert/markitdown.ts';
import { spawnStreaming } from '../skills/updaters.ts';
import { defaultToolEnv, toolRecipe, type ToolEnv, type ToolId } from './installers.ts';

export const OPTIONAL_TOOLS = ['markitdown', 'chromium', 'ffmpeg'] as const;
export type OptionalTool = (typeof OPTIONAL_TOOLS)[number];

export interface SetupStep {
  name: string;
  status: 'ok' | 'installed' | 'failed' | 'manual' | 'pending' | 'planned';
  detail: string;
  required: boolean;
}

export interface SetupOptions {
  agents: AgentProvider[];
  with?: string[];
  dryRun?: boolean;
  env?: ToolEnv;
  /** runs one install command through bash; resolves with its exit code */
  run?: (command: string) => Promise<number>;
  say?: (line: string) => void;
  /** Chromium for the self-check, through Playwright's own CLI */
  installChromium?: () => Promise<boolean>;
  /** the Node.js major on PATH (0 when there is none) */
  nodeMajor?: () => Promise<number>;
}

const AGENT_BIN: Record<AgentProvider, string> = { claude: 'claude', codex: 'codex', agy: 'agy' };
const AGENT_LABEL: Record<AgentProvider, string> = { claude: 'Claude Code', codex: 'Codex CLI', agy: 'Antigravity CLI' };
/** graphify's skill, per coding agent: Antigravity reads the ~/.agents/skills Codex's copy lands in */
const GRAPHIFY_PLATFORM: Record<AgentProvider, string> = { claude: 'claude', codex: 'codex', agy: 'antigravity' };

export async function runSetup(opts: SetupOptions): Promise<{ ok: boolean; steps: SetupStep[] }> {
  const real = !opts.env;
  const env = opts.env ?? defaultToolEnv();
  const say = opts.say ?? ((l: string) => console.log(l));
  // what an installer drops in ~/.local/bin is found the moment it lands
  if (real) {
    const local = join(env.home, '.local', 'bin');
    if (!(process.env.PATH ?? '').split(delimiter).includes(local)) process.env.PATH = `${local}${delimiter}${process.env.PATH ?? ''}`;
  }
  const run =
    opts.run ??
    (async (command: string) => (await spawnStreaming(['bash', '-c', command], env.home, (l) => say(`    ${l}`), { timeoutMs: 20 * 60_000 })).code);
  const steps: SetupStep[] = [];
  const done = (s: SetupStep) => {
    steps.push(s);
    const mark = { ok: '✓', installed: '✓', planned: '•', pending: '…', manual: '!', failed: '✘' }[s.status];
    say(`  ${mark} ${s.name}${s.detail ? `  ${s.detail}` : ''}`);
  };
  /** one tool: there already, or its command run, then looked for again */
  const ensure = async (name: string, bin: string, command: string | null, manual: string, required: boolean, extra: { finishesLater?: boolean } = {}) => {
    const at = env.which(bin);
    if (at) return done({ name, status: 'ok', detail: at, required });
    if (!command) return done({ name, status: 'manual', detail: `install it yourself: ${manual}`, required });
    if (opts.dryRun) return done({ name, status: 'planned', detail: `would run: ${command.split('\n')[0]}${command.includes('\n') ? ' …' : ''}`, required });
    say(`  → installing ${name}`);
    const code = await run(command);
    if (extra.finishesLater) return done({ name, status: 'pending', detail: "finish the installer Apple opened, then run foundry setup again", required });
    const now = env.which(bin);
    if (code === 0 && now) return done({ name, status: 'installed', detail: now, required });
    return done({ name, status: 'failed', detail: `did not install (exit ${code}); by hand: ${manual}`, required });
  };
  const tool = (id: ToolId, required: boolean) => {
    const r = toolRecipe(id, env);
    return ensure(r.label, r.bin, r.command, r.manual, required, { finishesLater: r.finishesLater });
  };

  say('Required');
  await tool('git', true);
  await tool('uv', true);
  for (const a of opts.agents) {
    const install = agentCliInstall(a, env.which, env.platform as NodeJS.Platform, env.arch);
    await ensure(AGENT_LABEL[a], AGENT_BIN[a], install?.command ?? null, a === 'claude' ? 'curl -fsSL https://claude.ai/install.sh | bash' : a === 'codex' ? 'npm install -g @openai/codex' : 'curl -fsSL https://antigravity.google/cli/install.sh | bash', true);
  }
  // Python 3.12: uv's newest Python may be one tree-sitter has no wheel for, which then needs a compiler
  await ensure('graphify', 'graphify', env.which('uv') || opts.dryRun ? 'uv tool install --python 3.12 graphifyy' : null, 'uv tool install --python 3.12 graphifyy (uv first: https://docs.astral.sh/uv/)', true);
  // its skill for each coding agent, every time: an agent added since gets it too
  if (!opts.dryRun && env.which('graphify')) {
    for (const a of opts.agents) {
      if (a === 'agy' && opts.agents.includes('codex')) continue;
      await run(`graphify install --platform ${GRAPHIFY_PLATFORM[a]} >/dev/null 2>&1 || true`);
    }
  }

  say('Recommended');
  await tool('gh', false);
  const major = await (opts.nodeMajor ?? (() => nodeMajor(env)))();
  if (major >= 18) done({ name: 'Node.js', status: 'ok', detail: `v${major}`, required: false });
  else await tool('node', false);

  const chosen = (opts.with ?? []).filter((w): w is OptionalTool => (OPTIONAL_TOOLS as readonly string[]).includes(w));
  if (chosen.length) say('Chosen');
  for (const w of chosen) {
    if (w === 'markitdown') await ensure('markitdown', 'markitdown', env.which('uv') || opts.dryRun ? MARKITDOWN_INSTALL.map((p) => (p.includes('[') ? `'${p}'` : p)).join(' ') : null, `${MARKITDOWN_INSTALL.join(' ')} (needs uv)`, false);
    else if (w === 'ffmpeg') await tool('ffmpeg', false);
    else if (w === 'chromium') {
      if (opts.dryRun) done({ name: 'Chromium', status: 'planned', detail: 'would download Chromium for the self-check', required: false });
      else {
        say('  → downloading Chromium for the self-check');
        const ok = (await opts.installChromium?.()) ?? false;
        done({ name: 'Chromium', status: ok ? 'installed' : 'failed', detail: ok ? 'for the self-check' : 'did not download; Settings → Preview & self-check can try again', required: false });
      }
    }
  }
  const ok = steps.filter((s) => s.required).every((s) => s.status === 'ok' || s.status === 'installed' || s.status === 'planned');
  return { ok, steps };
}

async function nodeMajor(env: ToolEnv): Promise<number> {
  const bin = env.which('node');
  if (!bin) return 0;
  try {
    const p = Bun.spawn([bin, '--version'], { stdout: 'pipe', stderr: 'ignore' });
    const v = (await new Response(p.stdout).text()).trim();
    await p.exited;
    return Number(/^v?(\d+)/.exec(v)?.[1] ?? 0);
  } catch {
    return 0;
  }
}
