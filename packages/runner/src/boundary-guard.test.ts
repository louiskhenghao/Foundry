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
const desktop = 'open[[:space:]]+-a[[:space:]]|xdg-open[[:space:]]|bambu-connect://|BambuStudio';

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
    // headless slicing is not an opener
    expect((await guard({ tool_name: 'Bash', tool_input: { command: '/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer model.stl --slice 0 --export-3mf out.gcode.3mf' } }, { FOUNDRY_DESKTOP_PATTERNS: desktop })).code).toBe(0);
  });
  test('a skill behind the switch is refused on the Skill tool; other skills and a Skill payload never meet the command patterns', async () => {
    const env = { FOUNDRY_DESKTOP_PATTERNS: desktop, FOUNDRY_DENIED_SKILLS: 'bambu-labs' };
    expect((await guard({ tool_name: 'Skill', tool_input: { skill: 'bambu-labs', args: '' } }, env)).code).toBe(2);
    expect((await guard({ tool_name: 'Skill', tool_input: { skill: 'cad', args: 'open -a BambuStudio' } }, env)).code).toBe(0);
    expect((await guard({ tool_name: 'Skill', tool_input: { skill: 'commit', args: 'git push' } }, env)).code).toBe(0);
    expect((await guard({ tool_name: 'Skill', tool_input: { skill: 'bambu-labs' } })).code).toBe(0);
  });
});
