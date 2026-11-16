import { describe, expect, test } from 'bun:test';
import { runSetup } from './setup.ts';
import type { ToolEnv } from './installers.ts';

/** a computer with these commands; an install puts its command there when the script exits 0 */
function machine(have: string[], fail: string[] = []) {
  const bins = new Set(have);
  const ran: string[] = [];
  const env: ToolEnv = { which: (b) => (bins.has(b) ? `/bin/${b}` : null), platform: 'darwin', arch: 'arm64', home: '/Users/me' };
  const run = async (command: string) => {
    ran.push(command);
    if (fail.some((f) => command.includes(f))) return 1;
    for (const [needle, bin] of [['uv/install.sh', 'uv'], ['claude.ai/install.sh', 'claude'], ['graphifyy', 'graphify'], ['brew install gh', 'gh'], ['cli/cli/releases', 'gh'], ['nodejs.org', 'node'], ['markitdown', 'markitdown'], ['brew install ffmpeg', 'ffmpeg'], ['brew install --cask codex', 'codex']] as const) if (command.includes(needle)) bins.add(bin);
    return 0;
  };
  return { env, run, ran, bins };
}

describe('foundry setup (ADR-0102)', () => {
  test('a fresh Mac with curl: everything required installs, in order, and graphify gets its skill', async () => {
    const m = machine(['curl', 'git', 'tar']);
    const lines: string[] = [];
    const r = await runSetup({ agents: ['claude'], env: m.env, run: m.run, say: (l) => lines.push(l), nodeMajor: async () => 0 });
    expect(r.ok).toBe(true);
    expect(r.steps.map((s) => [s.name, s.status])).toEqual([
      ['git', 'ok'],
      ['uv', 'installed'],
      ['Claude Code', 'installed'],
      ['graphify', 'installed'],
      ['GitHub CLI', 'installed'],
      ['Node.js', 'installed'],
    ]);
    expect(m.ran[0]).toBe('curl -LsSf https://astral.sh/uv/install.sh | sh');
    expect(m.ran).toContain('graphify install --platform claude >/dev/null 2>&1 || true');
    expect(lines.join('\n')).toContain('→ installing uv');
  });

  test('a required tool that fails makes setup fail; one that is optional does not', async () => {
    const m = machine(['curl', 'git', 'uv', 'claude', 'graphify', 'brew'], ['brew install gh']);
    const r = await runSetup({ agents: ['claude'], env: m.env, run: m.run, say: () => {}, nodeMajor: async () => 22 });
    expect(r.ok).toBe(true);
    expect(r.steps.find((s) => s.name === 'GitHub CLI')).toMatchObject({ status: 'failed' });
    const broken = machine(['curl', 'git'], ['astral.sh/uv']);
    const r2 = await runSetup({ agents: ['claude'], env: broken.env, run: broken.run, say: () => {}, nodeMajor: async () => 22 });
    expect(r2.ok).toBe(false);
    // graphify needs uv: without it there is nothing to run, and it says how
    expect(r2.steps.find((s) => s.name === 'graphify')).toMatchObject({ status: 'manual' });
  });

  test("git on a Mac without it: Apple's installer opens and setup asks to be run again", async () => {
    const m = machine(['curl']);
    const r = await runSetup({ agents: ['claude'], env: m.env, run: m.run, say: () => {}, nodeMajor: async () => 22 });
    expect(r.steps[0]).toMatchObject({ name: 'git', status: 'pending' });
    expect(r.ok).toBe(false);
  });

  test('a dry run runs nothing; the chosen tools come last; Antigravity shares Codex’s graphify skill', async () => {
    const m = machine(['curl', 'git', 'uv', 'brew']);
    const r = await runSetup({ agents: ['codex', 'agy'], with: ['markitdown', 'ffmpeg', 'chromium', 'bogus'], dryRun: true, env: m.env, run: m.run, say: () => {}, nodeMajor: async () => 0 });
    expect(m.ran).toEqual([]);
    expect(r.steps.map((s) => s.name)).toEqual(['git', 'uv', 'Codex CLI', 'Antigravity CLI', 'graphify', 'GitHub CLI', 'Node.js', 'markitdown', 'ffmpeg', 'Chromium']);
    expect(r.steps.every((s) => s.status === 'ok' || s.status === 'planned')).toBe(true);
    const real = machine(['curl', 'git', 'uv', 'codex', 'agy', 'graphify', 'gh']);
    await runSetup({ agents: ['codex', 'agy'], env: real.env, run: real.run, say: () => {}, nodeMajor: async () => 22 });
    expect(real.ran).toEqual(['graphify install --platform codex >/dev/null 2>&1 || true']);
  });
});
