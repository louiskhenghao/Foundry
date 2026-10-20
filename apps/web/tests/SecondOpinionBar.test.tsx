import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SecondOpinionBar } from '../src/pages/brief/SecondOpinionBar.tsx';

const failed = { at: new Date(Date.now() - 60_000).toISOString(), auto: false, costUsd: 3.2, reason: 'the reviewer ran out of budget before answering, even nudged once for the answer' };
const noop = () => {};

describe('SecondOpinionBar (ADR-0051): a second opinion written in the background', () => {
  test('says why the last one did not come in, and offers to ask again', () => {
    const html = renderToStaticMarkup(<SecondOpinionBar goalId="g1" stored={null} failed={failed} running={false} editable edit={noop} />);
    expect(html).toContain('asked for');
    expect(html).toContain('could not finish: the reviewer ran out of budget before answering, even nudged once for the answer.');
    expect(html).toContain('Ask again when you like.');
    expect(html).toContain('>Ask again<');
    expect(html).not.toContain('Reading…');
  });

  test('while one is being written — on this tab or another — the failure gives way to the live output', () => {
    const html = renderToStaticMarkup(<SecondOpinionBar goalId="g1" stored={null} failed={failed} running editable edit={noop} />);
    expect(html).toContain('Reading…');
    expect(html).toContain('It goes on while you leave the page');
    expect(html).not.toContain('could not finish');
  });

  test('a page that cannot edit the Brief still says what happened, without the button', () => {
    const html = renderToStaticMarkup(<SecondOpinionBar goalId="g1" stored={null} failed={{ ...failed, auto: true }} running={false} editable={false} edit={noop} />);
    expect(html).toContain('written by itself');
    expect(html).toContain('could not finish');
    expect(html).not.toContain('Ask again');
  });
});
