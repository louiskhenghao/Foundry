import { describe, expect, test } from 'bun:test';
import { parseProposalBlocks, withoutProposalBlocks } from './proposal.ts';

describe('proposal blocks in an answer (ADR-0075)', () => {
  const task = { type: 'task', title: 'Add the export button', summary: 'A button on the orders page.', task: { title: 'add the export button', spec: 'Put a Download CSV button on the orders page.', dependsOn: ['add the export endpoint'] } };
  test('one block, or an array in one; defaults filled; the words without the block', () => {
    const text = `Yes — that is a task of its own.\n\n\`\`\`foundry-proposal\n${JSON.stringify(task)}\n\`\`\`\n`;
    const [p] = parseProposalBlocks(text);
    expect(p?.type).toBe('task');
    expect(p?.task).toMatchObject({ kind: 'feature', scenario: 'general', difficulty: 'standard', dependsOn: ['add the export endpoint'], relevantFiles: [], checks: [] });
    expect(withoutProposalBlocks(text)).toBe('Yes — that is a task of its own.');
    const two = parseProposalBlocks(`\`\`\`foundry-proposal\n${JSON.stringify([task, { type: 'decision', title: 'No Tailwind', decision: { text: 'Plain CSS only.' } }])}\n\`\`\``);
    expect(two.map((p) => p.type)).toEqual(['task', 'decision']);
  });
  test('a block that is not JSON, a kind without its part, or an unknown kind is dropped; the rest stays', () => {
    expect(parseProposalBlocks('```foundry-proposal\nnot json\n```')).toEqual([]);
    expect(parseProposalBlocks('```foundry-proposal\n{"type":"task","title":"x"}\n```')).toEqual([]);
    expect(parseProposalBlocks('```foundry-proposal\n{"type":"wish","title":"x"}\n```')).toEqual([]);
    expect(parseProposalBlocks(`\`\`\`foundry-proposal\n[{"type":"wish","title":"x"}, {"type":"follow-up","title":"Next","followUp":{"prompt":"do more"}}]\n\`\`\``).map((p) => p.type)).toEqual(['follow-up']);
    expect(parseProposalBlocks('no blocks here')).toEqual([]);
    expect(parseProposalBlocks(null)).toEqual([]);
  });
});
