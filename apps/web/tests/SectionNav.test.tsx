import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SectionSideNav } from '../src/components/SectionNav.tsx';

test('a section menu says how each section stands: yellow for what waits for you, else in its signal colour', () => {
  const html = renderToStaticMarkup(
    <SectionSideNav
      label="Sections"
      items={[
        { id: 'goal', label: 'Goal', status: 'missing', warn: true },
        { id: 'repo', label: 'Repository', status: 'checking…', tone: 'work' },
        { id: 'agent', label: 'Coding agent', status: 'Claude Code', tone: 'ok' },
        { id: 'budget', label: 'Budget', status: 'Auto' },
      ]}
    />,
  );
  expect(html).toMatch(/bg-you[^"]*text-on-you">missing</);
  expect(html).toMatch(/text-work-ink">checking…</);
  expect(html).toMatch(/text-ok-ink">Claude Code</);
  expect(html).toMatch(/text-ink-faint">Auto</);
});
