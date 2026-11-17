import { describe, expect, test } from 'bun:test';
import { IdleWatch } from './idle-watch.ts';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('the idle limit', () => {
  test('fires after the limit when nothing comes down the stream', async () => {
    let fired = 0;
    const w = new IdleWatch(30, () => fired++);
    await wait(60);
    expect(fired).toBe(1);
    w.stop();
  });
  test('output restarts the clock', async () => {
    let fired = 0;
    const w = new IdleWatch(40, () => fired++);
    await wait(25);
    w.touch();
    await wait(25);
    expect(fired).toBe(0);
    await wait(30);
    expect(fired).toBe(1);
    w.stop();
  });
  test('a tool call under way is not idleness: the clock stops while it is open and starts again from zero after it', async () => {
    let fired = 0;
    const w = new IdleWatch(30, () => fired++);
    w.toolStarted('t1');
    expect(w.armed).toBe(false);
    await wait(80);
    expect(fired).toBe(0);
    w.touch(); // a stray chunk while the tool runs does not start the clock either
    expect(w.armed).toBe(false);
    w.toolEnded('t1');
    expect(w.armed).toBe(true);
    await wait(15);
    expect(fired).toBe(0);
    await wait(30);
    expect(fired).toBe(1);
    w.stop();
  });
  test('the clock waits for the last of several open tool calls', async () => {
    let fired = 0;
    const w = new IdleWatch(20, () => fired++);
    w.toolStarted('a');
    w.toolStarted('b');
    w.toolEnded('a');
    expect(w.openTools).toBe(1);
    await wait(40);
    expect(fired).toBe(0);
    w.toolEnded('b');
    await wait(40);
    expect(fired).toBe(1);
    w.stop();
  });
  test('a result for a call never seen changes nothing', async () => {
    let fired = 0;
    const w = new IdleWatch(30, () => fired++);
    w.toolStarted('a');
    w.toolEnded('never-started');
    expect(w.armed).toBe(false);
    w.stop();
  });
  test('nothing fires once stopped', async () => {
    let fired = 0;
    const w = new IdleWatch(10, () => fired++);
    w.stop();
    w.touch();
    w.toolStarted('a');
    w.toolEnded('a');
    await wait(30);
    expect(fired).toBe(0);
  });
});
