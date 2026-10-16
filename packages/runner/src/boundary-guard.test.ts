import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const script = join(import.meta.dir, '../hooks/boundary-guard.sh');
/** run the hook the way the CLI does: the call as JSON on stdin; exit 2 + stderr = denied */
async function guard(payload: unknown, env: Record<string, string> = {}): Promise<{ code: number; err: string }> {
  const proc = Bun.spawn(['sh', script], { env: { PATH: process.env.PATH ?? '', FOUNDRY_CALLBACK: '', ...env }, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  proc.stdin.write(JSON.stringify(payload));
  proc.stdin.end();
  const err = await new Response(proc.stderr).text();
  return { code: await proc.exited, err: err.trim() };
}
// stand-ins for the engine's patterns (packages/engine/src/guards/desktop-patterns.test.ts runs the real ones through this hook)
const desktop = '(^|[;&|(])[[:space:]]*(open|xdg-open)[[:space:]]+[^[:space:]]';
const slicer = '(^|[;&|(])[[:space:]]*orca-slicer([[:space:]]|$)';
const headless = '--slice';

describe('the boundary hook', () => {
  test('blocks what leaves the worktree, for Bash and for the Codex adapter payload without a tool name', async () => {
    expect((await guard({ tool_name: 'Bash', tool_input: { command: 'git push origin main' } })).code).toBe(2);
    expect((await guard({ tool_input: { command: 'npm publish' } })).code).toBe(2);
    expect((await guard({ tool_name: 'Bash', tool_input: { command: 'bun test' } })).code).toBe(0);
  });
  test('desktop apps and printers: openers are blocked only while the switch is off, and the message names the switch', async () => {
    const open = { tool_name: 'Bash', tool_input: { command: 'open -a BambuStudio bracket.3mf' } };
    expect(await guard(open)).toMatchObject({ code: 0 });
    const denied = await guard(open, { FOUNDRY_DESKTOP_PATTERNS: desktop });
    expect(denied.code).toBe(2);
    expect(denied.err).toContain('Desktop apps & printers');
    expect((await guard({ tool_name: 'Bash', tool_input: { command: 'open "bambu-connect://import-file?path=x"' } }, { FOUNDRY_DESKTOP_PATTERNS: desktop })).code).toBe(2);
    expect((await guard({ tool_name: 'Bash', tool_input: { command: 'cd out && open .' } }, { FOUNDRY_DESKTOP_PATTERNS: desktop })).code).toBe(2);
    expect((await guard({ tool_input: { command: 'xdg-open part.stl' } }, { FOUNDRY_DESKTOP_PATTERNS: desktop })).code).toBe(2);
  });
  test('only the command is read: a cwd, a description or a quoted word that names an opener blocks nothing', async () => {
    const env = { FOUNDRY_DESKTOP_PATTERNS: desktop };
    expect((await guard({ tool_name: 'Bash', tool_input: { command: 'ls', description: 'open the folder listing' }, cwd: '/Users/me/open-source/BambuStudio' }, env)).code).toBe(0);
    expect((await guard({ tool_name: 'Bash', tool_input: { command: 'grep -rn "xdg-open " src/' } }, env)).code).toBe(0);
    expect((await guard({ tool_name: 'Bash', tool_input: { command: 'git commit -m "open the dialog on click"' } }, env)).code).toBe(0);
    expect((await guard({ tool_name: 'Bash', tool_input: { command: 'python export.py --open bracket.step' } }, env)).code).toBe(0);
  });
  test("a slicer's program is blocked without its headless switches and allowed with them", async () => {
    const env = { FOUNDRY_SLICER_PATTERNS: slicer, FOUNDRY_HEADLESS_PATTERNS: headless };
    expect((await guard({ tool_name: 'Bash', tool_input: { command: 'orca-slicer model.stl' } }, env)).code).toBe(2);
    expect((await guard({ tool_name: 'Bash', tool_input: { command: 'orca-slicer model.stl --slice 0 --export-3mf out.gcode.3mf' } }, env)).code).toBe(0);
    // one command at a time: a headless run does not excuse the window opened after it
    expect((await guard({ tool_name: 'Bash', tool_input: { command: 'orca-slicer --slice 0 model.stl && orca-slicer part.3mf' } }, env)).code).toBe(2);
    expect((await guard({ tool_name: 'Bash', tool_input: { command: 'orca-slicer --slice 0 a.stl; orca-slicer --slice 0 b.stl' } }, env)).code).toBe(0);
    // without the list of headless switches, every run of the program counts as its window
    expect((await guard({ tool_name: 'Bash', tool_input: { command: 'orca-slicer --slice 0 model.stl' } }, { FOUNDRY_SLICER_PATTERNS: slicer })).code).toBe(2);
  });
  test('a skill behind the switch is refused on the Skill tool, bare or under its plugin; other skills and a Skill payload never meet the command patterns', async () => {
    const env = { FOUNDRY_DESKTOP_PATTERNS: desktop, FOUNDRY_DENIED_SKILLS: 'bambu-labs' };
    expect((await guard({ tool_name: 'Skill', tool_input: { skill: 'bambu-labs', args: '' } }, env)).code).toBe(2);
    // Claude Code invokes a plugin skill as plugin:skill
    const namespaced = await guard({ tool_name: 'Skill', tool_input: { skill: 'text-to-cad:bambu-labs', args: '' } }, env);
    expect(namespaced.code).toBe(2);
    expect(namespaced.err).toContain('Desktop apps & printers');
    expect((await guard({ tool_name: 'Skill', tool_input: { skill: 'text-to-cad:cad', args: 'open -a BambuStudio' } }, env)).code).toBe(0);
    expect((await guard({ tool_name: 'Skill', tool_input: { skill: 'commit', args: 'git push' } }, env)).code).toBe(0);
    expect((await guard({ tool_name: 'Skill', tool_input: { skill: 'bambu-labs' } })).code).toBe(0);
  });
});
