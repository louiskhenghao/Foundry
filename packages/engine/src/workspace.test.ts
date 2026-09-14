import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyStyleSamples } from './workspace.ts';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'foundry-ws-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('copyStyleSamples', () => {
  test('copies the Brief style samples into a task worktree, never overwriting, and is a no-op without samples', () => {
    const goalWs = tmp();
    const taskWs = tmp();
    expect(copyStyleSamples(goalWs, taskWs)).toBe(0);
    mkdirSync(join(goalWs, 'artifacts', 'samples'), { recursive: true });
    writeFileSync(join(goalWs, 'artifacts', 'samples', 'S1-1.png'), 'png-1');
    writeFileSync(join(goalWs, 'artifacts', 'samples', 'S1-2.png'), 'png-2');
    expect(copyStyleSamples(goalWs, taskWs)).toBe(2);
    expect(readFileSync(join(taskWs, 'artifacts', 'samples', 'S1-1.png'), 'utf8')).toBe('png-1');
    writeFileSync(join(taskWs, 'artifacts', 'samples', 'S1-1.png'), 'edited');
    expect(copyStyleSamples(goalWs, taskWs)).toBe(0);
    expect(readFileSync(join(taskWs, 'artifacts', 'samples', 'S1-1.png'), 'utf8')).toBe('edited');
    expect(existsSync(join(taskWs, 'artifacts', 'samples', 'S1-2.png'))).toBe(true);
  });
});
