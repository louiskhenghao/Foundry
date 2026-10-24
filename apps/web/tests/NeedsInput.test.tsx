import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { BriefProvide } from '@foundry/core/browser';
import type { EscalationRow } from '../src/api.ts';
import { EscalationCard } from '../src/pages/InboxPage.tsx';
import { ProvidesCard } from '../src/pages/goal/ProvidesCard.tsx';

const at = '2026-10-24T10:00:00.000Z';
const request: EscalationRow = { id: 'esc1', goalId: 'g1', taskId: 't1', attemptId: 'a1', trigger: 'needs_input', message: 'the 3D car models (GLB), one per car', payload: { kind: 'needs_input', source: 'worker', materialKey: null, what: 'the 3D car models (GLB), one per car', why: 'the showroom loads them', suggestions: 'Export glTF 2.0 from Blender, or take free ones at sketchfab.com', canProceedWithout: true }, state: 'open', answer: null, createdAt: at, answeredAt: null, suggestion: null, provider: 'claude', goalTitle: 'Car showroom', taskTitle: 'build the showroom' };

describe('a Request in the Inbox and the You will provide card (ADR-0074)', () => {
  test('the Request card says what, why and where to get it, takes files and words, and offers to go on without it', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <EscalationCard e={request} />
      </MemoryRouter>,
    );
    expect(html).toContain('Needs something from you');
    expect(html).toContain('the showroom loads them');
    expect(html).toContain('sketchfab.com');
    expect(html).toContain('The task could go on without it');
    expect(html).toContain('Send what I gave');
    expect(html).toContain('Continue without it');
    expect(html).toContain('Skip task');
    expect(html).toContain('type="file"');
  });

  test('a material waiting offers to give it or to say there is none; one received shows what came and when', () => {
    const waiting: BriefProvide = { key: 'M1', what: 'the logo files (SVG)', neededBy: ['T1'], mode: 'wait', status: 'waiting', receivedAt: null, attachmentIds: [], note: null };
    const received: BriefProvide = { key: 'M2', what: 'the trailer video', neededBy: ['T2'], mode: 'placeholder', status: 'received', receivedAt: at, attachmentIds: ['att1'], note: 'final cut' };
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ProvidesCard goalId="g1" provides={[waiting, received]} attachments={[{ id: 'att1', kind: 'link', name: 'trailer.mp4 (drive)', mime: null, size: null, path: null, url: 'https://example.com/trailer', note: null, addedAt: at, markdown: null, materialKey: 'M2' }]} taskTitles={{ T1: 'build the header', T2: 'the hero' }} />
      </MemoryRouter>,
    );
    expect(html).toContain('You will provide (1 waiting)');
    expect(html).toContain('waiting for you');
    expect(html).toContain('needed by build the header');
    expect(html).toContain('Give it');
    expect(html).toContain('I have none');
    expect(html).toContain('received');
    expect(html).toContain('built with a placeholder first');
    expect(html).toContain('trailer.mp4 (drive)');
    expect(html).toContain('final cut');
  });
});
