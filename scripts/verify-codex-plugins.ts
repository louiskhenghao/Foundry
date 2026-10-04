/** Real native lifecycle smoke check. Uses disposable homes and a local fixture; no sign-in, network or inference. */
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexPlugins } from '../packages/engine/src/plugins/codex-plugins.ts';

const home = mkdtempSync(join(tmpdir(), 'foundry-plugin-native-'));
const codexHome = join(home, '.codex');
const bin = process.argv[2] ?? Bun.which('codex');
if (!bin) throw new Error('Install a compatible Codex CLI first.');
for (const path of ['.codex', '.agents/plugins', 'plugins/example/.codex-plugin', 'plugins/example/skills/hello']) mkdirSync(join(home, path), { recursive: true });
writeFileSync(join(home, 'plugins/example/.codex-plugin/plugin.json'), JSON.stringify({ name: 'example', version: '1.0.0', description: 'Isolated QA plugin', skills: './skills/' }));
writeFileSync(join(home, 'plugins/example/skills/hello/SKILL.md'), '---\nname: hello\ndescription: Example for QA\n---\nSay hello.\n');
writeFileSync(join(home, '.agents/plugins/marketplace.json'), JSON.stringify({ name: 'foundry-qa', plugins: [{ name: 'example', source: { source: 'local', path: './plugins/example' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }] }));
const manager = new CodexPlugins({ codexHome, processHome: home, codexBin: bin });
const id = 'example@foundry-qa';
try {
  const before = await manager.view();
  assert.equal(before.state, 'available', JSON.stringify(before));
  assert(before.state === 'available' && before.plugins.some(p => p.id === id && !p.installed));
  await manager.change(id, 'install');
  const installed = await manager.view();
  assert(installed.state === 'available' && installed.plugins.some(p => p.id === id && p.installed));
  await manager.change(id, 'remove');
  const removed = await manager.view();
  assert(removed.state === 'available' && removed.plugins.every(p => !p.installed));
  console.log('PASS: native plugin list → install → refreshed state → remove, with isolated homes.');
} finally {
  await manager.stop();
  rmSync(home, { recursive: true, force: true });
}
