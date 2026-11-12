import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Goal } from '@foundry/core';
import type { Engine } from '../engine.ts';
import { screenshotsDir } from '../workspace.ts';
import { DESIGN_SHOT_WIDTHS, captureDesignShots, committedReferencesSection, designComparisonSection } from './design-shots.ts';
import { playwrightStatus } from './selfcheck.ts';

let home: string;
const goal = { id: 'g_design', workspaceDir: null } as unknown as Goal;
const engine = { config: { dataDir: '' } } as unknown as Pick<Engine, 'config'>;
const browser = (await playwrightStatus()).browser;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), 'foundry-design-shots-'));
  (engine.config as { dataDir: string }).dataDir = home;
});
afterAll(() => rmSync(home, { recursive: true, force: true }));

/** a one-file app with a dev script that honours PORT, as detectRun finds it */
const app = (name: string, body: string) => {
  const cwd = join(home, name);
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name, private: true, scripts: { dev: 'bun server.js' } }));
  mkdirSync(join(cwd, 'node_modules'), { recursive: true }); // installed already: no npm install before the look
  writeFileSync(join(cwd, 'server.js'), `Bun.serve({ port: Number(process.env.PORT), fetch: () => new Response(${JSON.stringify(body)}, { headers: { 'content-type': 'text/html' } }) });`);
  return cwd;
};

describe('design shots (ADR-0094)', () => {
  test.skipIf(!browser)('starts the app from its folder, shoots it at the design widths into the goal\'s screenshots folder, and stops it', async () => {
    const cwd = app('relay', '<!doctype html><html><body style="margin:0"><h1 style="font:48px serif">Relay</h1><p>answered once</p></body></html>');
    const lines: string[] = [];
    const r = await captureDesignShots(engine, goal, cwd, { prefix: 'design-t1-a1', log: (l) => lines.push(l) });
    expect(r.note).toBeNull();
    expect(r.url).toMatch(/^http:\/\/localhost:\d+$/);
    expect(r.shots.map((s) => s.width)).toEqual([...DESIGN_SHOT_WIDTHS]);
    for (const s of r.shots) {
      expect(s.path.startsWith(screenshotsDir(home, goal))).toBe(true);
      expect(s.path).toMatch(new RegExp(`design-t1-a1-\\d{8}-\\d{6}-${s.width}\\.png$`));
      expect(existsSync(s.path)).toBe(true);
      expect(statSync(s.path).size).toBeGreaterThan(1000);
    }
    // the server is gone once the shots are taken
    await Bun.sleep(300);
    await expect(fetch(r.url!, { signal: AbortSignal.timeout(1500) })).rejects.toThrow();
    expect(lines.some((l) => /^design shots: \$ npm run dev \(PORT=\d+\)$/.test(l))).toBe(true);
  }, 60_000);

  test('nothing startable is a note, never a throw', async () => {
    const cwd = join(home, 'lib');
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'lib', scripts: { build: 'tsc' } }));
    const r = await captureDesignShots(engine, goal, cwd, { prefix: 'design-t2-a1' });
    expect(r).toEqual({ shots: [], url: null, note: 'the result could not be started for a look: no dev or start script in package.json' });
  });

  test.skipIf(!browser)('an app that dies before answering is a note with its stderr', async () => {
    const cwd = join(home, 'broken');
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'broken', scripts: { dev: 'bun server.js' } }));
    writeFileSync(join(cwd, 'server.js'), `console.error('boom: no such module'); process.exit(1);`);
    const r = await captureDesignShots(engine, goal, cwd, { prefix: 'design-t3-a1', startTimeoutMs: 15_000 });
    expect(r.shots).toEqual([]);
    expect(r.note).toContain('did not answer');
    expect(r.note).toContain('boom: no such module');
  }, 30_000);
});

describe('the reviewer sections', () => {
  test('the design comparison lists the shots with the rule: missing or re-designed is a blocker, a drift a note', () => {
    const s = designComparisonSection({ shots: [{ width: 1440, path: '/shots/design-t1-a1-20261112-120000-1440.png' }, { width: 390, path: '/shots/design-t1-a1-20261112-120000-390.png' }], url: 'http://localhost:23456', note: null });
    expect(s.startsWith('# Design comparison')).toBe(true);
    expect(s).toContain('the result of this task');
    expect(s).toContain('- 1440px wide: /shots/design-t1-a1-20261112-120000-1440.png');
    expect(s).toContain('- 390px wide: /shots/design-t1-a1-20261112-120000-390.png');
    expect(s).toContain('missing, re-ordered or re-designed is a BLOCKER');
    expect(s).toContain('A drift of a few pixels, a shade or an opacity is a NOTE');
    expect(designComparisonSection({ shots: [], url: null, note: 'nothing startable' }, { forGoal: true })).toContain('the merged result');
    expect(designComparisonSection({ shots: [], url: null, note: 'nothing startable' })).toContain('(no screenshot: nothing startable)');
    expect(designComparisonSection(null)).toBe('');
  });
  test('committed reference files are a blocker section; none is nothing', () => {
    expect(committedReferencesSection(['public/mockup.png'])).toContain('- public/mockup.png');
    expect(committedReferencesSection(['public/mockup.png'])).toContain('BLOCKER');
    expect(committedReferencesSection([])).toBe('');
  });
});
