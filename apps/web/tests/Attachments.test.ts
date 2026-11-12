import { expect, test } from 'bun:test';
import type { Attachment } from '@foundry/core/browser';
import { refreshedStaged } from '../src/components/Attachments.tsx';

const staged: Attachment = { id: 'att_1', kind: 'file', name: 'design.html', mime: 'text/html', size: 10, path: 'attachments/_staging/att_1/design.html', url: null, note: null, addedAt: 't', markdown: { status: 'pending', path: null, bytes: null, tool: null, error: null, at: null } };

test('a staged upload refreshed from the server keeps the design mark set on the form (ADR-0093)', () => {
  const converted: Attachment = { ...staged, markdown: { status: 'ready', path: 'attachments/_staging/att_1/design.html.md', bytes: 2000, tool: 'markitdown', error: null, at: 't2' } };
  // marked as the design before the conversion finished: the fresh record has no mark, the local one wins
  expect(refreshedStaged(converted, { ...staged, design: true })).toEqual({ ...converted, design: true });
  // unticked by the person: stays unticked
  expect(refreshedStaged(converted, { ...staged, design: false })).toEqual({ ...converted, design: false });
  // never marked: the server's record as it is
  expect(refreshedStaged(converted, staged)).toEqual(converted);
});
