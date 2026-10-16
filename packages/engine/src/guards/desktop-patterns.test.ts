import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { DESKTOP_APPS_PATTERNS, SLICER_APP_PATTERNS, SLICER_HEADLESS_PATTERNS } from './patterns.ts';

/** the shipped patterns through the shipped hook, the way a session meets them while Settings → Safety → Desktop apps & printers is off */
const hook = resolve(import.meta.dir, '../../../runner/hooks/boundary-guard.sh');
const env = { PATH: process.env.PATH ?? '', FOUNDRY_CALLBACK: '', FOUNDRY_DESKTOP_PATTERNS: DESKTOP_APPS_PATTERNS, FOUNDRY_SLICER_PATTERNS: SLICER_APP_PATTERNS, FOUNDRY_HEADLESS_PATTERNS: SLICER_HEADLESS_PATTERNS };
async function bash(command: string, extra: { description?: string; cwd?: string } = {}): Promise<number> {
  const p = Bun.spawn(['sh', hook], { env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  p.stdin.write(JSON.stringify({ tool_name: 'Bash', tool_input: { command, ...(extra.description ? { description: extra.description } : {}) }, cwd: extra.cwd ?? '/Users/me/Projects/bracket', session_id: 'x' }));
  p.stdin.end();
  return p.exited;
}

describe('the desktop-apps patterns through the boundary hook', () => {
  test('the openers are refused, in every spelling the hand-off skills document and the obvious variants', async () => {
    for (const c of [
      'open -a BambuStudio bracket.3mf',
      'open -a "Bambu Studio" bracket.3mf',
      'open -ga OrcaSlicer part.3mf',
      'open -W -a OrcaSlicer part.3mf',
      'open -b org.example.slicer part.stl',
      'open "my part.stl"',
      'open part.STL',
      'f=part.3mf; open "$f"',
      'cd out && open .',
      'open "bambu-connect://import-file?path=%2Ftmp%2Fbracket.gcode.3mf&name=bracket&version=1.0.0"',
      'xdg-open out.stl',
      'Start-Process bracket.3mf',
      `osascript -e 'tell application "OrcaSlicer" to open POSIX file "/tmp/p.stl"'`,
      'find . -name "*.3mf" | xargs open',
      'cat parts.txt | xargs -n1 open',
      '/usr/bin/open -a OrcaSlicer part.3mf',
      'env xdg-open part.stl',
      'CADGEN_TELEMETRY=0 open part.stl',
      'sudo /usr/bin/open part.stl',
      'orca-slicer part.3mf',
      'bambu-studio part.3mf',
      '/opt/orca/orca-slicer part.3mf',
      'orca-slicer --slice 0 model.stl && bambu-studio part.3mf',
      'orca-slicer --slice 0 model.stl; orca-slicer part.3mf',
      '/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer part.stl',
      '/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer',
      '/Applications/BambuStudio.app/Contents/MacOS/BambuStudio part.3mf',
      '"/Applications/Bambu Studio.app/Contents/MacOS/Bambu Studio" part.3mf',
    ]) expect([c, await bash(c)]).toEqual([c, 2]);
  });
  test('headless CAD work, prose that names an app, and the call\'s other fields pass', async () => {
    for (const c of [
      'cadgen snapshot bracket.step --out artifacts/',
      'uvx --from cadgen==0.7.21 cadgen export bracket.py --step',
      'python export.py --open bracket.step',
      'echo "sliced for bambu-studio later"',
      'ls /Applications/BambuStudio.app',
      'ls /Applications/OrcaSlicer.app/Contents/MacOS/',
      '/Applications/OrcaSlicer.app/Contents/MacOS/OrcaSlicer model.stl --slice 0 --export-3mf out.gcode.3mf',
      '/Applications/BambuStudio.app/Contents/MacOS/BambuStudio --slice 0 --export-3mf out.3mf model.3mf',
      'orca-slicer --load-settings "p.json;m.json" --slice 0 --export-3mf out.gcode.3mf model.stl',
      'orca-slicer --slice 0 a.stl && orca-slicer --info b.stl',
      'orca-slicer --help',
      'tools/open-model.sh part.step',
      'grep -n Start-Process scripts/build.ps1',
      'grep -rn "xdg-open " src/',
      'echo "bambu-connect://import-file?path=x" >> docs/notes.md',
      'git commit -m "open the dialog on click"',
      'cat "docs/notes-on-Bambu Studio.md"',
      'git reopen x.stl',
      'npm start',
      'bun test',
    ]) expect([c, await bash(c)]).toEqual([c, 0]);
    // a repository path or a description that names an app blocks nothing: only the command is read
    expect(await bash('ls', { cwd: '/Users/me/Projects/BambuStudio-profiles' })).toBe(0);
    expect(await bash('ls -la', { description: 'Check whether Bambu Studio is installed; open the folder' })).toBe(0);
  });
});
