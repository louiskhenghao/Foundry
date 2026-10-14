import { expect, test } from 'bun:test';
import { conflictRegions } from '../src/components/CodeEditor.tsx';

test("a conflict's lines are told apart: markers, our side, the common ancestor and their side", () => {
  const text = ['a', '<<<<<<< HEAD', 'ours 1', 'ours 2', '||||||| base', 'base', '=======', 'theirs', '>>>>>>> task', 'b', '======='].join('\n');
  expect(conflictRegions(text.split('\n'))).toEqual([null, 'marker', 'ours', 'ours', 'marker', 'base', 'marker', 'theirs', 'marker', null, null]);
});
