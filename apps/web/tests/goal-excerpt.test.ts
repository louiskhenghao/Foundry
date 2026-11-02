import { expect, test } from 'bun:test';
import { goalExcerpt } from '../src/pages/goal/excerpt.ts';

test('the goal header reads a Markdown description as plain words: no marks, a heading runs into its section, the title is not repeated', () => {
  const prompt = "# Bug: the bulk discount comes off twice.\n\n## How to see it\nCall `totalCents` with **ten** of one item.\n\n## Already decided\n- Write a failing test first.\n- Leave unrelated code alone.";
  expect(goalExcerpt(prompt, 'Bug: the bulk discount comes off twice.')).toBe('How to see it: Call totalCents with ten of one item. Already decided: Write a failing test first. Leave unrelated code alone.');
  // a title the person cut short themselves keeps that line whole
  expect(goalExcerpt(prompt, 'Bug: the bulk discount').startsWith('Bug: the bulk discount comes off twice. How to see it: Call')).toBe(true);
  // the name a goal starts with is its first line cut at 80 characters: that line is the title and is not said again
  const long = 'Bug: A cart with 10 or more of one item is charged too little: the bulk discount comes off twice.';
  expect(goalExcerpt(`${long}\nHow to see it: call totalCents.`, long.slice(0, 80))).toBe('How to see it: call totalCents.');
  // a shorter cut is a name of the person's own: the line stays
  expect(goalExcerpt(`${long}\nHow to see it.`, long.slice(0, 40))).toBe(`${long} How to see it.`);
  // plain words stay as they were; nothing left after the title shows nothing
  expect(goalExcerpt('Add a dark mode to the settings page', 'Add a dark mode')).toBe('Add a dark mode to the settings page');
  expect(goalExcerpt('# Fix the footer', 'Fix the footer')).toBe('');
});
