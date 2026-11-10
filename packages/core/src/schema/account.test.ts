import { describe, expect, test } from 'bun:test';
import { planName } from './account.ts';

describe('the name of the plan an account is on', () => {
  test("the coding agent's own display name wins over the subscription type's key", () => {
    // Claude Code: the token still says max while the plan is sold as Ultra
    expect(planName('claude', { displayName: 'Ultra', type: 'max' })).toBe('Ultra');
    expect(planName('claude', { displayName: '  Ultra ', type: 'max' })).toBe('Ultra');
  });
  test('a known key is said as its maker names the plan', () => {
    expect(planName('claude', { type: 'max' })).toBe('Max');
    expect(planName('claude', { type: 'pro' })).toBe('Pro');
    expect(planName('claude', { type: 'enterprise' })).toBe('Enterprise');
    expect(planName('codex', { type: 'plus' })).toBe('Plus');
    expect(planName('codex', { type: 'pro' })).toBe('Pro');
    expect(planName('codex', { type: 'business' })).toBe('Business');
    expect(planName('claude', { type: 'MAX' })).toBe('Max');
  });
  test('a key never seen before is said in title case, so a renamed or new plan is never a bare key', () => {
    expect(planName('claude', { type: 'ultra' })).toBe('Ultra');
    expect(planName('claude', { type: 'ultra_plus' })).toBe('Ultra Plus');
    expect(planName('codex', { type: 'pro-max' })).toBe('Pro Max');
  });
  test('a name already in words passes through: Antigravity reports one, and a stored name is given again', () => {
    expect(planName('agy', { displayName: 'AI Pro' })).toBe('AI Pro');
    expect(planName('agy', { type: 'AI Ultra' })).toBe('AI Ultra');
    expect(planName('claude', { type: 'Ultra' })).toBe('Ultra');
  });
  test('no plan reported is null, never an empty word', () => {
    expect(planName('claude', {})).toBeNull();
    expect(planName('claude', { displayName: '', type: '' })).toBeNull();
    expect(planName('codex', { displayName: null, type: null })).toBeNull();
    expect(planName('claude', { type: '  ' })).toBeNull();
  });
});
