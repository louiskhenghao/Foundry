import { describe, expect, test } from 'bun:test';
import { EFFORT_LADDER, effortLevelsInHelp, nearestEffort } from './discover.ts';

/** the effort levels Claude Code takes, read from its own --help, and what a level it no longer takes runs as (ADR-0085) */
describe('effort levels from the binary', () => {
  test('reads the levels the --effort option names, on the same or the following line', () => {
    const help = `Options:\n  --model <model>                       Model for the current session\n  --effort <level>                      Effort level for the current session\n                                        (low, medium, high, xhigh, max)\n  --environment <environment_id>        Create a new cloud session`;
    expect(effortLevelsInHelp(help)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(effortLevelsInHelp('  --effort <level>  Effort (low | medium | high | ultra)')).toEqual(['low', 'medium', 'high', 'ultra']);
    expect(effortLevelsInHelp('  --model <model>  nothing about effort')).toEqual([]);
    expect(effortLevelsInHelp('')).toEqual([]);
  });
  test('a renamed top level lands on its new name, a dropped middle level on the next one up, a level beyond the top on the top', () => {
    const renamed = ['low', 'medium', 'high', 'xhigh', 'ultra'];
    expect(nearestEffort('max', renamed)).toBe('ultra');
    expect(nearestEffort('xhigh', renamed)).toBe('xhigh');
    expect(nearestEffort('xhigh', ['low', 'medium', 'high', 'max'])).toBe('max');
    expect(nearestEffort('ultra', ['low', 'medium', 'high', 'xhigh', 'max'])).toBe('max');
    expect(nearestEffort('none', ['low', 'medium', 'high'])).toBe('low');
    expect(nearestEffort('brand-new', ['low', 'medium', 'high'])).toBe('high');
    expect(nearestEffort('high', [])).toBe('high');
    expect(EFFORT_LADDER[0]).toBe('none');
  });
});
