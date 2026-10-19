import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CutSessionsDot } from '../src/components/CutSessionsDot.tsx';
import { Meter } from '../src/ui.tsx';

test('the cost meter keeps its label on one line and puts the cut sessions behind a dot', () => {
  const html = renderToStaticMarkup(<Meter label="cost $97.80 / ∞" value={97.8} max={null} note={<CutSessionsDot n={19} est={{ usd: 12.4, sessions: 19, estimated: 19, bySession: {} }} />} />);
  expect(html).toContain('<span class="truncate">cost $97.80 / ∞</span>');
  expect(html).not.toContain('unmeasured');
  // hovered, the dot says what it is; the panel opens on a tap
  expect(html).toContain('title="19 sessions ended before Claude Code reported a cost: about $12.40 more, estimated"');
  expect(html).toContain('whitespace-nowrap">no limit');
});

test('without an estimate the dot says only how many', () => {
  const html = renderToStaticMarkup(<CutSessionsDot n={1} est={{ usd: 0, sessions: 1, estimated: 0, bySession: {} }} />);
  expect(html).toContain('title="1 session ended before Claude Code reported a cost"');
});

test("on a phone the dot keeps the meter's line height: it escapes the 32px button rule and keeps a thumb-sized target", () => {
  const html = renderToStaticMarkup(<CutSessionsDot n={2} est={undefined} />);
  expect(html).toMatch(/<button[^>]*class="relative [^"]*before:-inset-2[^"]*"[^>]*style="min-height:0"/);
});
