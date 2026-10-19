import { describe, expect, test } from 'bun:test';
import { type InterviewRound, interviewAnswers, interviewNotes } from './interview.ts';

const q = (key: string, text: string) => ({ key, text, options: [], reason: '', dependsOn: null, blocking: true });
const round = (n: number, answers: Record<string, string> | null, note: string | null = null): InterviewRound => ({ round: n, questions: [q(`R${n}Q1`, `question ${n}`)], answers, askedAt: '2026-01-01', answeredAt: answers ? '2026-01-01' : null, finish: false, note });

describe('interview helpers', () => {
  test('answers are the answered questions; notes are the rounds the human wrote something unasked on', () => {
    const iv = { rounds: [round(1, { R1Q1: 'Postgres' }, '  also keep the old login page  '), round(2, { R2Q1: '  ' }, ''), round(3, null)] };
    expect(interviewAnswers(iv).map((a) => [a.question.key, a.answer])).toEqual([['R1Q1', 'Postgres']]);
    expect(interviewNotes(iv)).toEqual([{ round: 1, note: 'also keep the old login page' }]);
  });
});
