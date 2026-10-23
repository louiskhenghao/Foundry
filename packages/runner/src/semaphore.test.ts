import { expect, test } from 'bun:test';
import { Semaphore } from './semaphore.ts';

test('semaphore limits concurrency FIFO', async () => {
  const s = new Semaphore(2);
  const order: number[] = [];
  const r1 = await s.acquire();
  const r2 = await s.acquire();
  let third = false;
  const p3 = s.acquire().then((r) => {
    third = true;
    order.push(3);
    return r;
  });
  await Bun.sleep(5);
  expect(third).toBe(false);
  expect(s.waiting).toBe(1);
  r1();
  const r3 = await p3;
  expect(third).toBe(true);
  r2();
  r3();
  expect(s.activeCount).toBe(0);
});

test('the interactive lane may use one slot beyond the limit and goes before queued work', async () => {
  const s = new Semaphore(1);
  const work1 = await s.acquire('work');
  expect(s.available('work')).toBe(false);
  expect(s.available('interactive')).toBe(true);
  // a session a person waits for: one beyond the limit
  const inter1 = await s.acquire('interactive');
  expect(s.activeCount).toBe(2);
  expect(s.available('interactive')).toBe(false);
  let work2Started = false;
  let inter2Started = false;
  const p2 = s.acquire('work').then((r) => {
    work2Started = true;
    return r;
  });
  const p3 = s.acquire('interactive').then((r) => {
    inter2Started = true;
    return r;
  });
  await Bun.sleep(5);
  expect(s.waiting).toBe(2);
  // the extra slot frees: the queued interactive run takes it although the work run queued first
  inter1();
  await Bun.sleep(5);
  expect(inter2Started).toBe(true);
  expect(work2Started).toBe(false);
  // work runs within the limit, whatever the interactive lane holds
  work1();
  await Bun.sleep(5);
  expect(work2Started).toBe(true);
  expect(s.activeCount).toBe(2);
  (await p2)();
  (await p3)();
  expect(s.activeCount).toBe(0);
  expect(s.waiting).toBe(0);
});

test('work never passes work, and a lower limit holds the lanes back together', async () => {
  const s = new Semaphore(2);
  const a = await s.acquire('work');
  const b = await s.acquire('work');
  let c = false;
  let d = false;
  const pc = s.acquire('work').then((r) => ((c = true), r));
  const pd = s.acquire('work').then((r) => ((d = true), r));
  s.setLimit(1);
  a();
  await Bun.sleep(5);
  expect([c, d]).toEqual([false, false]); // one is still over the lowered limit
  b();
  await Bun.sleep(5);
  expect([c, d]).toEqual([true, false]); // FIFO
  (await pc)();
  await Bun.sleep(5);
  expect(d).toBe(true);
  (await pd)();
  expect(s.activeCount).toBe(0);
});

test('the aside lane never waits and takes no slot from the others, yet counts among the active runs (ADR-0073)', async () => {
  const s = new Semaphore(1);
  const work = await s.acquire('work');
  expect(s.available('work')).toBe(false);
  expect(s.available('aside')).toBe(true);
  // beside the limit: three asides while the one slot is held
  const asides = await Promise.all([s.acquire('aside'), s.acquire('aside'), s.acquire('aside')]);
  expect(s.activeCount).toBe(4);
  // the asides took nothing: the interactive extra slot is still there, and work still waits
  expect(s.available('interactive')).toBe(true);
  expect(s.available('work')).toBe(false);
  for (const r of asides) r();
  // a release called twice releases once
  asides[0]!();
  expect(s.activeCount).toBe(1);
  work();
  expect(s.activeCount).toBe(0);
});
