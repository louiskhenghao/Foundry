import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DagTask } from '../src/pages/goal/DagCanvas.tsx';
import { TaskList, flowOf } from '../src/pages/goal/TaskList.tsx';

const task = (id: string, created: string, patch: Partial<DagTask> = {}) =>
  ({ id, title: `task ${id}`, state: 'pending', dependsOn: [], createdAt: created, attempts: 0, maxAttempts: 3, totalCost: null, model: null, minutes: null, kind: 'feature', area: null, origin: 'brief', depth: 0, ...patch }) as unknown as DagTask;

test('the list shows the tasks in planned order, numbered, each saying what it waits for and how far it is', () => {
  const html = renderToStaticMarkup(
    <TaskList
      tasks={[task('b', '2026-10-20T10:02:00Z', { state: 'running', attempts: 2, model: 'opus-5', minutes: 12.4, totalCost: 0.46 }), task('a', '2026-10-20T10:01:00Z', { state: 'done', attempts: 1 }), task('c', '2026-10-20T10:03:00Z', { dependsOn: ['a', 'b'] })]}
      selected="b"
      onSelect={() => {}}
    />,
  );
  // planned order, whatever order the tasks came in
  expect(html.indexOf('task a')).toBeLessThan(html.indexOf('task b'));
  expect(html.indexOf('task b')).toBeLessThan(html.indexOf('task c'));
  expect(html).toContain('>T1<');
  expect(html).toContain('after T1, T2');
  expect(html).toContain('attempt 2 of 3 · opus-5');
  // a task sent back once says so on its review step
  expect(html).toContain('Review ↺1');
  expect(html).toContain('12 min');
  expect(html).toContain('$0.460');
  expect(html).toContain('aria-pressed="true"');
});

test('work, review and merge follow the task through its states', () => {
  expect(flowOf('pending')).toEqual(['next', 'next', 'next']);
  expect(flowOf('running')).toEqual(['run', 'next', 'next']);
  expect(flowOf('observing')).toEqual(['done', 'run', 'next']);
  expect(flowOf('merging')).toEqual(['done', 'done', 'run']);
  expect(flowOf('done')).toEqual(['done', 'done', 'done']);
  expect(flowOf('blocked')).toEqual(['you', 'next', 'next']);
  expect(flowOf('failed')).toEqual(['bad', 'off', 'off']);
});
