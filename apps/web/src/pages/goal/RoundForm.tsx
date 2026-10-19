import type { InterviewQuestion } from '@foundry/core/browser';
import { CheckCheck, Send, SkipForward, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Button, Input, Textarea, cn } from '../../ui.tsx';

export type RoundSubmitKind = 'send' | 'all' | 'finish';

/**
 * One round of questions as the Clarifier asks them: options with its recommendation first, a free answer per
 * question, a note for what the questions missed, and the three ways to close the round (send, accept all
 * recommended, enough). Used by the interview before the Brief and by a Revise that asks before proposing.
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
      <ol className="space-y-3">
        {questions.map((q, i) => (
          <li key={q.key} className="rounded border border-zinc-800 bg-zinc-900/50 p-3 space-y-2">
            <div className="flex items-start gap-2">
              <span className="mono text-zinc-500 shrink-0">{i + 1}.</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-zinc-100 whitespace-pre-wrap">
                  {q.text}
                  {q.blocking && <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-300">blocking</span>}
                </div>
                {q.reason && <div className="text-[11px] text-zinc-500 mt-1 whitespace-pre-wrap">{q.reason}</div>}
                {q.dependsOn && <div className="text-[11px] text-zinc-600 mt-0.5">follows from {questionRef(rounds, q.dependsOn, round)}</div>}
              </div>
            </div>
            <div className="flex flex-col gap-1 pl-5">
              {q.options.map((o, j) => (
                <label key={o} className={cn('flex items-start gap-2 cursor-pointer rounded px-1 py-0.5', answers[q.key] === o && 'bg-emerald-500/10')}>
                  <input type="radio" name={`${round}-${q.key}`} className="mt-0.5 accent-emerald-500" checked={answers[q.key] === o} onChange={() => setAnswers((a) => ({ ...a, [q.key]: o }))} />
                  <span className="text-zinc-200">
                    {o}
                    {j === 0 && <span className="ml-2 text-[10px] uppercase tracking-wide text-emerald-300">recommended</span>}
                  </span>
                </label>
              ))}
              <label className="flex items-center gap-2 cursor-pointer rounded px-1 py-0.5">
                <input type="radio" name={`${round}-${q.key}`} className="accent-emerald-500" checked={answers[q.key] === '__other__'} onChange={() => setAnswers((a) => ({ ...a, [q.key]: '__other__' }))} />
                <Input className="flex-1 text-xs" placeholder={q.options.length ? 'something else…' : 'your answer'} value={other[q.key] ?? ''} onFocus={() => setAnswers((a) => ({ ...a, [q.key]: '__other__' }))} onChange={(e) => setOther((o) => ({ ...o, [q.key]: e.target.value }))} />
              </label>
            </div>
          </li>
        ))}
      </ol>
      <div className="rounded border border-zinc-800 bg-zinc-900/50 p-3 space-y-1">
        <label className="text-sm text-zinc-100" htmlFor={`round-note-${round}`}>
          Anything else? <span className="text-[11px] text-zinc-500">optional</span>
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
