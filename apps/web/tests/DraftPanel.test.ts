import { describe, expect, test } from 'bun:test';
import { diffWords, sectionsOf, type ProposalItem } from '../src/pages/brief/DraftPanel.tsx';

describe('proposal panel helpers', () => {
  test('diffWords keeps the words that stay and marks the ones that go and come, whitespace intact', () => {
    const segs = diffWords('keep the old login page', 'keep the new login page and more');
    expect(segs.map((s) => [s.kind, s.text])).toEqual([
      ['same', 'keep the '],
      ['del', 'old'],
      ['add', 'new'],
      ['same', ' login page'],
      ['add', ' and more'],
    ]);
    expect(diffWords('', 'all new').map((s) => s.kind)).toEqual(['add']);
    expect(diffWords('same text', 'same text')).toEqual([{ kind: 'same', text: 'same text' }]);
  });

  test('sectionsOf groups items in the order the Brief page shows them, skipping empty sections', () => {
    const it = (id: string, section: ProposalItem['section']): ProposalItem => ({ id, section, op: 'change', what: id, fields: [], apply: (b) => b });
    const groups = sectionsOf([it('c1', 'checks'), it('t1', 'tasks'), it('u', 'understanding'), it('t2', 'tasks'), it('a', 'assumptions')]);
    expect(groups.map((g) => [g.label, g.items.map((x) => x.id)])).toEqual([
      ['Understanding', ['u']],
      ['Tasks', ['t1', 't2']],
      ['Checks', ['c1']],
      ['Assumptions', ['a']],
    ]);
  });
});
