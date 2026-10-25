import { expect, test } from 'bun:test';
import { goalExcerpt } from '../src/pages/goal/excerpt.ts';

test('the goal header reads a Markdown description as plain words: no marks, a heading runs into its section, the title is not repeated', () => {
  const prompt = "# Bug: the bulk discount comes off twice.\n\n## How to see it\nCall `totalCents` with **ten** of one item.\n\n## Already decided\n- Write a failing test first.\n- Leave unrelated code alone.";
  expect(goalExcerpt(prompt, 'Bug: the bulk discount comes off twice.')).toBe('How to see it: Call totalCents with ten of one item. Already decided: Write a failing test first. Leave unrelated code alone.');
  // a title cut short from the first line keeps that line whole
  expect(goalExcerpt(prompt, 'Bug: the bulk discount').startsWith('Bug: the bulk discount comes off twice. How to see it: Call')).toBe(true);
  // plain words stay as they were; nothing left after the title shows nothing
  expect(goalExcerpt('Add a dark mode to the settings page', 'Add a dark mode')).toBe('Add a dark mode to the settings page');
  expect(goalExcerpt('# Fix the footer', 'Fix the footer')).toBe('');
});
