import { describe, expect, test } from 'bun:test';
import { needsOf, parseNeedsBlock, withoutNeedsBlock } from './needs.ts';

describe('a Request block in a worker\'s final text (ADR-0074)', () => {
  const text = 'Built the page.\n\n```foundry-needs\n{ "what": "the 3D car models (GLB)", "why": "the showroom loads them", "suggestions": "export glTF 2.0", "canProceedWithout": true }\n```\n';
  test('the block parses, its fields defaulted; the words without it are what the person reads', () => {
    expect(parseNeedsBlock(text)).toEqual({ what: 'the 3D car models (GLB)', why: 'the showroom loads them', suggestions: 'export glTF 2.0', canProceedWithout: true });
    expect(parseNeedsBlock('```foundry-needs\n{"what":"a key"}\n```')).toEqual({ what: 'a key', why: '', suggestions: '', canProceedWithout: false });
    expect(withoutNeedsBlock(text)).toBe('Built the page.');
  });
  test('no block, a block that is not JSON, or one without `what` is no request', () => {
    expect(parseNeedsBlock('done')).toBeNull();
    expect(parseNeedsBlock(null)).toBeNull();
    expect(parseNeedsBlock('```foundry-needs\nnot json\n```')).toBeNull();
    expect(parseNeedsBlock('```foundry-needs\n{"why":"x"}\n```')).toBeNull();
    // the last block wins when a session wrote two
    expect(parseNeedsBlock('```foundry-needs\n{"what":"first"}\n```\n```foundry-needs\n{"what":"second"}\n```')?.what).toBe('second');
  });
  test('needsOf reads a needs_input escalation and nothing else', () => {
    expect(needsOf({ trigger: 'needs_input', payload: { kind: 'needs_input', what: 'x' } })).toMatchObject({ what: 'x', source: 'worker', materialKey: null });
    expect(needsOf({ trigger: 'needs_input', payload: { kind: 'needs_input', what: 'x', source: 'foundry', materialKey: 'M1' } })?.materialKey).toBe('M1');
    expect(needsOf({ trigger: 'milestone', payload: {} })).toBeNull();
    expect(needsOf({ trigger: 'needs_input', payload: {} })).toBeNull();
  });
});
