import { describe, expect, test } from 'bun:test';
import type { ReviewRound } from '@foundry/core';
import type { PrReview, PrReviewComment } from './gh.ts';
import { REPLY_MARK, newReviewComments, renderReviewSpec, replyText, reviewReply, seenKeys } from './reviews.ts';

const inline = (over: Partial<PrReviewComment> = {}): PrReviewComment => ({ id: 1, author: 'pat', bot: false, body: 'rename this', path: 'src/x.ts', line: 4, diffHunk: '@@ -1,2 +1,2 @@\n-a\n+b', url: 'https://github.com/acme/app/pull/3#discussion_r1', createdAt: '2026-10-20T10:00:00Z', inReplyTo: null, ...over });
const review = (over: Partial<PrReview> = {}): PrReview => ({ id: 50, author: 'sam', bot: false, state: 'CHANGES_REQUESTED', body: 'Please add a test for the empty case.', url: 'https://github.com/acme/app/pull/3#pullrequestreview-50', submittedAt: '2026-10-20T11:00:00Z', ...over });

describe('what counts as a review comment', () => {
  test('inline comments and reviews that request changes count; approvals, plain remarks, bots, replies of Foundry and empty bodies do not', () => {
    const found = {
      comments: [inline(), inline({ id: 2, bot: true, author: 'vercel[bot]' }), inline({ id: 3, body: `Addressed in abc1234.\n\n${REPLY_MARK}` }), inline({ id: 4, body: '   ' })],
      reviews: [review(), review({ id: 51, state: 'APPROVED', body: 'LGTM' }), review({ id: 52, state: 'COMMENTED', body: 'just a thought' }), review({ id: 53, state: 'CHANGES_REQUESTED', body: '' }), review({ id: 54, bot: true })],
    };
    const got = newReviewComments(found, new Set());
    expect(got.map((c) => [c.kind, c.id])).toEqual([
      ['inline', 1],
      ['review', 50],
    ]);
    expect(got[0]).toMatchObject({ author: 'pat', path: 'src/x.ts', line: 4, url: 'https://github.com/acme/app/pull/3#discussion_r1' });
    expect(got[1]).toMatchObject({ author: 'sam', path: null, line: null, body: 'Please add a test for the empty case.' });
  });

  test('comments already in a round are not counted again; an inline comment and a review may share a number', () => {
    const round: ReviewRound = { id: 'rev_1', prNumber: 3, at: '2026-10-20T10:05:00Z', comments: [{ id: 50, kind: 'inline', author: 'pat', body: 'x', path: null, line: null, diffHunk: null, url: null, createdAt: null }], status: 'addressed', requested: false, commit: 'abc', replied: 1, detail: null, finishedAt: null };
    const got = newReviewComments({ comments: [inline({ id: 50 }), inline({ id: 51, createdAt: '2026-10-20T12:00:00Z' })], reviews: [review({ id: 50 })] }, seenKeys([round]));
    expect(got.map((c) => `${c.kind}:${c.id}`)).toEqual(['review:50', 'inline:51']);
  });
});

describe('the fix task and the replies', () => {
  const round: ReviewRound = {
    id: 'rev_1',
    prNumber: 3,
    at: '2026-10-20T10:05:00Z',
    comments: [
      { id: 1, kind: 'inline', author: 'pat', body: 'rename this to parseRef', path: 'src/x.ts', line: 4, diffHunk: '@@ -1,2 +1,2 @@\n-a\n+b', url: 'https://github.com/acme/app/pull/3#discussion_r1', createdAt: null },
      { id: 50, kind: 'review', author: null, body: 'Please add a test\nfor the empty case.', path: null, line: null, diffHunk: null, url: null, createdAt: null },
    ],
    status: 'pending',
    requested: false,
    commit: null,
    replied: 0,
    detail: null,
    finishedAt: null,
  };
  test('the spec names every comment with where it is, the diff around it and who wrote it', () => {
    const spec = renderReviewSpec(3, round);
    expect(spec).toStartWith('A person reviewed pull request #3');
    expect(spec).toContain('## Comments (2)');
    expect(spec).toContain('### 1. src/x.ts:4 — @pat\n> rename this to parseRef\n```diff\n@@ -1,2 +1,2 @@\n-a\n+b\n```\nhttps://github.com/acme/app/pull/3#discussion_r1');
    expect(spec).toContain('### 2. Review by a reviewer (changes requested)\n> Please add a test\n> for the empty case.');
    expect(spec).toContain('Never weaken or delete a check.');
  });
  test('a reply says the commit and the files, or that the code was left as it is; every reply carries the mark', () => {
    const done = replyText('addressed', { commit: 'abcdef1234567', header: 'chore(review): address review comments on PR #3', files: ['src/x.ts', 'src/x.test.ts'] });
    expect(done).toBe(`Addressed in \`abcdef1\` (chore(review): address review comments on PR #3). Changed: \`src/x.ts\`, \`src/x.test.ts\`.\n\n${REPLY_MARK}`);
    expect(replyText('nochange', { commit: null, header: null, files: [] })).toBe(`Looked at this and left the code as it is; the review-fix task's report on the goal page says why.\n\n${REPLY_MARK}`);
    const many = replyText('addressed', { commit: 'abcdef1', header: null, files: Array.from({ length: 10 }, (_, i) => `f${i}.ts`) });
    expect(many).toContain('`f7.ts` and 2 more.');
    expect(reviewReply(round.comments[1]!, 'Addressed.')).toBe('> Please add a test\n> for the empty case.\n\nAddressed.');
  });
});
