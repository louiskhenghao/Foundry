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
