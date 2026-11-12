import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Attachment, Brief, BriefQuestion } from '@foundry/core/browser';
import { DesignQuestion, WITHOUT_DESIGN } from '../src/pages/brief/DesignQuestion.tsx';

const question: BriefQuestion = { id: 'q1', text: 'Your goal points to a Claude design (https://claude.ai/artifact/abc) that Foundry cannot open: the page needs a sign-in, so no session has seen it.', answer: null, blocking: true, areaKey: null, options: ['I attached the export — run Re-run Clarify', WITHOUT_DESIGN], kind: 'design', applied: false };
const brief = { questions: [question], styleOptions: [] } as unknown as Brief;
const picture: Attachment = { id: 'att_1', kind: 'file', name: 'home.png', mime: 'image/png', size: 10, path: 'attachments/g/att_1/home.png', url: null, note: null, addedAt: 't', markdown: null, design: true };
const render = (attachments: Attachment[], q: BriefQuestion = question) => renderToStaticMarkup(<DesignQuestion goalId="g" brief={brief} question={q} attachments={attachments} editable update={() => {}} onRerun={async () => {}} />);

test('the design question carries a drop zone and waits for a file before the Brief can be written again (ADR-0093)', () => {
  const html = render([]);
  expect(html).toContain('blocking');
  expect(html).toContain('Attach screenshots, PDFs, files or links');
  expect(html).toContain('is marked as the design reference');
  expect(html).toContain('Re-run Clarify with the design');
  expect(html).toContain('No design attached yet.');
  // nothing attached: the re-run button is disabled, going without is not
  expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>Re-run Clarify with the design/);
  expect(html).toContain(`>${WITHOUT_DESIGN}</button>`);
});

test('with a design attached the re-run button is live and counts the files; an answered question is ticked', () => {
  const html = render([picture]);
  expect(html).toContain('Re-run Clarify with the design · 1 file<');
  expect(html).not.toMatch(/<button[^>]*\sdisabled=""[^>]*>Re-run Clarify with the design/);
  expect(html).toContain('Your Decisions are kept; the Brief is written again from the design.');
  expect(html).toContain('>Design reference</button>');
  expect(render([picture], { ...question, answer: WITHOUT_DESIGN })).toContain('aria-label="answered"');
});
