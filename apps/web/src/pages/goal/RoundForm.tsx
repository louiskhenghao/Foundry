import type { InterviewQuestion } from '@foundry/core/browser';
import { CheckCheck, Send, SkipForward, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Button, Input, Textarea, choiceClass, cn } from '../../ui.tsx';

export type RoundSubmitKind = 'send' | 'all' | 'finish';

/** a small plate after a question or an option's words */
const PLATE = 'ml-2 inline-block rounded-sm px-1.5 py-[3px] align-[2px] text-[10.5px] font-extrabold uppercase tracking-[0.08em] leading-none whitespace-nowrap';

/**
 * One round of questions as the Clarifier asks them: options with its recommendation first, a free answer per
 * question, a note for what the questions missed, and the three ways to close the round (send, accept all
 * recommended, enough). Used by the interview before the Brief and by a Revise that asks before proposing.
 * Each question is numbered on a small plate; its options are cards, the chosen one in the accent; the recommended
 * one says so on a quiet plate, and a blocking question on a yellow one (only you can answer it).
 */
export function RoundForm({ round, questions, rounds, busy, intro, finishLabel, finishTitle, onSubmit, onCancel }: {
  round: number;
  questions: InterviewQuestion[];
  /** every round so far (for "follows from" references) */
  rounds: { round: number; questions: { key: string; text: string }[] }[];
  busy: RoundSubmitKind | null;
  intro?: ReactNode;
  finishLabel: string;
  finishTitle: string;
  onSubmit: (kind: RoundSubmitKind, answers: Record<string, string>, finish: boolean, note: string | null) => void;
  /** let the round go (a Revise that asked); absent for the interview, which cannot be cancelled */
  onCancel?: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  /** what the questions missed or got wrong: sent with the answers, a Decision like them */
  const [note, setNote] = useState('');
  const answerOf = (q: InterviewQuestion) => (answers[q.key] === '__other__' ? (other[q.key] ?? '') : (answers[q.key] ?? ''));
  const collected = () => Object.fromEntries(questions.map((q) => [q.key, answerOf(q).trim()]).filter(([, v]) => v));
  const recommended = () => Object.fromEntries(questions.map((q) => [q.key, answerOf(q).trim() || q.options[0] || '']).filter(([, v]) => v));
  const missing = questions.filter((q) => q.blocking && !answerOf(q).trim());
  const submit = (kind: RoundSubmitKind, finish: boolean, given: Record<string, string>) => onSubmit(kind, given, finish, note.trim() || null);
  return (
    <>
      {intro}
      <ol className="divide-y divide-line">
        {questions.map((q, i) => (
          <li key={q.key} className="py-4 first:pt-1 space-y-3">
            <div className="flex items-start gap-3">
              <span className="mono grid h-6 min-w-6 shrink-0 place-items-center rounded-[5px] bg-ink px-1.5 text-xs font-bold text-on-ink">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-bold leading-snug text-ink whitespace-pre-wrap">
                  {q.text}
                  {q.blocking && <span className={cn(PLATE, 'bg-you text-on-you')}>blocking</span>}
                </div>
                {q.reason && <div className="text-[13px] leading-snug text-ink-faint mt-1 whitespace-pre-wrap">{q.reason}</div>}
                {q.dependsOn && <div className="text-xs text-ink-faint mt-1">follows from {questionRef(rounds, q.dependsOn, round)}</div>}
              </div>
            </div>
            <div className="flex flex-col gap-1.5 sm:pl-9">
              {q.options.map((o, j) => (
                <label key={o} className={cn('flex items-start gap-2.5 cursor-pointer rounded-md border px-3 py-2 text-sm text-ink transition-colors', choiceClass(answers[q.key] === o))}>
                  <input type="radio" name={`${round}-${q.key}`} className="mt-[3px] shrink-0" checked={answers[q.key] === o} onChange={() => setAnswers((a) => ({ ...a, [q.key]: o }))} />
                  <span className="min-w-0">
                    {o}
                    {j === 0 && <span className={cn(PLATE, 'text-ink-soft ring-1 ring-inset ring-line-strong')}>recommended</span>}
                  </span>
                </label>
              ))}
              <label className={cn('flex items-center gap-2.5 cursor-pointer rounded-md border px-3 py-1.5 transition-colors', choiceClass(answers[q.key] === '__other__'))}>
                <input type="radio" name={`${round}-${q.key}`} className="shrink-0" checked={answers[q.key] === '__other__'} onChange={() => setAnswers((a) => ({ ...a, [q.key]: '__other__' }))} />
                <Input className="flex-1 text-xs" placeholder={q.options.length ? 'something else…' : 'your answer'} value={other[q.key] ?? ''} onFocus={() => setAnswers((a) => ({ ...a, [q.key]: '__other__' }))} onChange={(e) => setOther((o) => ({ ...o, [q.key]: e.target.value }))} />
              </label>
            </div>
          </li>
        ))}
      </ol>
      <div className="border-t border-line pt-4 space-y-1.5">
        <label className="block text-[15px] font-bold text-ink" htmlFor={`round-note-${round}`}>
          Anything else? <span className="text-xs font-normal text-ink-faint">optional</span>
        </label>
        <Textarea id={`round-note-${round}`} rows={2} className="text-xs" placeholder="Something the questions missed, or got wrong. It goes with your answers and becomes a Decision every worker receives." value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="primary" disabled={busy !== null || missing.length > 0} onClick={() => submit('send', false, collected())} title={missing.length ? `answer the blocking question${missing.length === 1 ? '' : 's'} first: ${missing.map((q) => questions.indexOf(q) + 1).join(', ')}` : 'Send these answers'}>
          <Send size={12} /> {busy === 'send' ? 'Sending…' : 'Send answers'}
        </Button>
        <Button size="sm" variant="default" disabled={busy !== null} onClick={() => submit('all', false, recommended())} title="Unanswered questions take the recommended option">
          <CheckCheck size={12} /> {busy === 'all' ? 'Sending…' : 'Accept all recommended'}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => submit('finish', true, collected())} title={finishTitle}>
          <SkipForward size={12} /> {busy === 'finish' ? 'Working…' : finishLabel}
        </Button>
        {onCancel && (
          <Button size="sm" variant="ghost" disabled={busy !== null} onClick={onCancel} title="Let this revision go; the Brief stays as it is">
            <X size={12} /> Cancel the revision
          </Button>
        )}
      </div>
    </>
  );
}

/** a question key (R1Q2) as a person reads it: "question 2" in the round on screen, "round 1, question 2 (…)" otherwise */
export function questionRef(rounds: { round: number; questions: { key: string; text: string }[] }[], key: string, current: number): string {
  for (const r of rounds) {
    const i = r.questions.findIndex((q) => q.key === key);
    if (i < 0) continue;
    if (r.round === current) return `question ${i + 1}`;
    const text = r.questions[i]!.text;
    return `round ${r.round}, question ${i + 1} ("${text.length > 60 ? `${text.slice(0, 60)}…` : text}")`;
  }
  return 'an earlier answer';
}
