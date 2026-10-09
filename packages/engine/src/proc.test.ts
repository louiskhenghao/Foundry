import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInGroup } from './proc.ts';

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('runInGroup', () => {
  test('a timeout kills the children holding the pipe, not just the shell', async () => {
    const started = Date.now();
    const r = await runInGroup(['sh', '-c', 'sleep 30 | cat'], { cwd: tmpdir(), timeoutMs: 300 });
    expect(r.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  test('a leader that exits while a background child keeps the pipe open still returns', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'proc-'));
    const r = await runInGroup(['sh', '-c', 'echo hi; sleep 30 & echo $! > pid'], { cwd: dir, timeoutMs: 60_000, graceMs: 200 });
    expect(r).toMatchObject({ code: 0, timedOut: false });
    expect(r.stdout).toContain('hi');
    const pid = Number(await Bun.file(join(dir, 'pid')).text());
    expect(alive(pid)).toBe(true); // left alone unless asked
    process.kill(pid, 'SIGKILL');
  });

  test('killLeftovers takes down what the leader left running', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'proc-'));
    writeFileSync(join(dir, 'run.sh'), 'sleep 30 &\necho $! > pid\n');
    const r = await runInGroup(['sh', 'run.sh'], { cwd: dir, timeoutMs: 60_000, graceMs: 200, killLeftovers: true });
    expect(r.code).toBe(0);
    const pid = Number(await Bun.file(join(dir, 'pid')).text());
    await Bun.sleep(100);
    expect(alive(pid)).toBe(false);
  });

  test('streams output as it comes', async () => {
    const chunks: string[] = [];
    const r = await runInGroup(['sh', '-c', 'echo one; echo two >&2'], { cwd: tmpdir(), timeoutMs: 5_000, onStdout: (c) => chunks.push(c) });
    expect(chunks.join('')).toBe('one\n');
    expect(r.stderr).toBe('two\n');
  });
});
