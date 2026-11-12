import { expect, test } from 'bun:test';
import { matchVerdict } from './verdict-match.ts';

const v = (checkName: string, pass = true) => ({ checkName, pass, reason: '' });

test('a verdict answers its check by exact name, by name without case or spacing, or by the name with the rubric copied after it', () => {
  const verdicts = [v('Typecheck'), v('matches the design: relay landing page: relay-landing-desktop.png (with relay-landing.html): the layout and sections as the design shows them', true), v('Nothing else changed', false)];
  expect(matchVerdict(verdicts, 'Typecheck')?.checkName).toBe('Typecheck');
  expect(matchVerdict(verdicts, ' nothing else  changed ')?.pass).toBe(false);
  // the live case: the goal reviewer copied "name: rubric" as the name of the design check
  expect(matchVerdict(verdicts, 'Matches the design: Relay landing page')?.pass).toBe(true);
  // a suffix in parentheses or after a dash is the same check; the longest extension wins over a shorter one
  expect(matchVerdict([v('Matches the design: Relay landing page (pricing band)', false), v('Matches the design: Relay landing page — hero and footer', true)], 'Matches the design: Relay landing page')?.checkName).toBe('Matches the design: Relay landing page — hero and footer');
  // a verdict that is only a prefix of the check's name may belong to a shorter check: no match
  expect(matchVerdict([v('Matches the design')], 'Matches the design: Relay landing page')).toBeNull();
  // another check that merely starts with the same words, without a separator, is not it
  expect(matchVerdict([v('Lintable')], 'Lint')).toBeNull();
  expect(matchVerdict([], 'Lint')).toBeNull();
});
