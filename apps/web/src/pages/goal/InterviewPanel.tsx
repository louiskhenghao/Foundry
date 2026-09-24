import type { Goal, InterviewQuestion } from '@foundry/core/browser';
import { CheckCheck, MessageCircleQuestion, Send, SkipForward } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../../api.ts';
import { Button, Card, Input, cn } from '../../ui.tsx';
import { LiveLog } from '../LiveLog.tsx';
import { HelpLink } from '../HelpPage.tsx';

const MAX_ROUNDS = 4;

/**
 * The Clarify interview: one round per screen. Each question offers the Clarifier's options (its recommendation first)
 * and a free-text answer; "Accept all recommended" answers a round in one click, "Enough" asks for the Brief with what
 * there is. Earlier rounds fold up below.
 */
export function InterviewPanel({ goal }: { goal: Goal }) {
  const iv = goal.interview;
  const open = iv?.status === 'awaiting_answers' ? iv.rounds.at(-1) : null;
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<null | 'send' | 'all' | 'finish'>(null);
  const [err, setErr] = useState<string | null>(null);
  const [history, setHistory] = useState(false);
  useEffect(() => {
    setAnswers({});
    setOther({});
    setErr(null);
  }, [open?.round, goal.id]);
  if (!iv) return null;
  const answerOf = (q: InterviewQuestion) => (answers[q.key] === '__other__' ? (other[q.key] ?? '') : (answers[q.key] ?? ''));
  const submit = async (kind: NonNullable<typeof busy>, finish: boolean, given: Record<string, string>) => {
    setBusy(kind);
    setErr(null);
    try {
      await api.interviewAnswer(goal.id, given, finish);
    } catch (e: any) {
      setErr(e.body?.error ?? e.message);
    } finally {
      setBusy(null);
    }
  };
  const collected = () => Object.fromEntries((open?.questions ?? []).map((q) => [q.key, answerOf(q).trim()]).filter(([, v]) => v));
  const recommended = () => Object.fromEntries((open?.questions ?? []).map((q) => [q.key, answerOf(q).trim() || q.options[0] || '']).filter(([, v]) => v));
  const missing = (open?.questions ?? []).filter((q) => q.blocking && !answerOf(q).trim());
  const past = iv.rounds.filter((r) => r.answers);
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <MessageCircleQuestion size={14} className="text-sky-300" />
          {open ? `Round ${open.round} — ${open.questions.length} question${open.questions.length === 1 ? '' : 's'}` : iv.status === 'done' ? 'Interview done' : iv.rounds.length ? 'Thinking about your answers…' : 'Reading the repository…'}
          <HelpLink to="answering-the-interview" label="How the interview works (new tab)" />
        </span>
      }
    >
      <div className="space-y-3 text-xs text-zinc-400">
        {open ? (
          <>
            <p className="text-zinc-400">Only decisions the repository could not settle are asked. The first option is the Clarifier's recommendation; the reason says what it found. After your answers it writes the Brief — or asks one more round only if they open new decisions (at most {MAX_ROUNDS} rounds in all).</p>
            <ol className="space-y-3">
              {open.questions.map((q, i) => (
                <li key={q.key} className="rounded border border-zinc-800 bg-zinc-900/50 p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <span className="mono text-zinc-500 shrink-0">{i + 1}.</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-zinc-100 whitespace-pre-wrap">
                        {q.text}
                        {q.blocking && <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-300">blocking</span>}
                      </div>
                      {q.reason && <div className="text-[11px] text-zinc-500 mt-1 whitespace-pre-wrap">{q.reason}</div>}
                      {q.dependsOn && <div className="text-[11px] text-zinc-600 mt-0.5">follows from {questionRef(iv.rounds, q.dependsOn, open.round)}</div>}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 pl-5">
                    {q.options.map((o, j) => (
                      <label key={o} className={cn('flex items-start gap-2 cursor-pointer rounded px-1 py-0.5', answers[q.key] === o && 'bg-emerald-500/10')}>
                        <input type="radio" name={q.key} className="mt-0.5 accent-emerald-500" checked={answers[q.key] === o} onChange={() => setAnswers((a) => ({ ...a, [q.key]: o }))} />
                        <span className="text-zinc-200">
                          {o}
                          {j === 0 && <span className="ml-2 text-[10px] uppercase tracking-wide text-emerald-300">recommended</span>}
                        </span>
                      </label>
                    ))}
                    <label className="flex items-center gap-2 cursor-pointer rounded px-1 py-0.5">
                      <input type="radio" name={q.key} className="accent-emerald-500" checked={answers[q.key] === '__other__'} onChange={() => setAnswers((a) => ({ ...a, [q.key]: '__other__' }))} />
                      <Input className="flex-1 text-xs" placeholder={q.options.length ? 'something else…' : 'your answer'} value={other[q.key] ?? ''} onFocus={() => setAnswers((a) => ({ ...a, [q.key]: '__other__' }))} onChange={(e) => setOther((o) => ({ ...o, [q.key]: e.target.value }))} />
                    </label>
                  </div>
                </li>
              ))}
            </ol>
            {err && <div className="text-rose-300">{err}</div>}
            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" variant="primary" disabled={busy !== null || missing.length > 0} onClick={() => submit('send', false, collected())} title={missing.length ? `answer the blocking question${missing.length === 1 ? '' : 's'} first: ${missing.map((q) => open.questions.indexOf(q) + 1).join(', ')}` : 'Send these answers; the Clarifier asks the next round or writes the Brief'}>
                <Send size={12} /> {busy === 'send' ? 'Sending…' : 'Send answers'}
              </Button>
              <Button size="sm" variant="default" disabled={busy !== null} onClick={() => submit('all', false, recommended())} title="Unanswered questions take the recommended option">
                <CheckCheck size={12} /> {busy === 'all' ? 'Sending…' : 'Accept all recommended'}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => submit('finish', true, collected())} title="Stop asking: the Brief is written with these answers and assumptions for the rest">
                <SkipForward size={12} /> {busy === 'finish' ? 'Writing…' : 'Enough — write the Brief'}
              </Button>
            </div>
          </>
        ) : (
          <>
            {iv.status !== 'done' && (
              <p className="text-zinc-400">
                {iv.rounds.length ? <Elapsed since={iv.rounds.at(-1)!.answeredAt} label="Planning with your answers" /> : 'Exploring the repository and the attachments before asking anything'} — the planner sub-agent usually takes 2–8 minutes; the log below keeps moving while it does.
              </p>
            )}
            {iv.status !== 'done' && <LiveLog attemptId={`clarify-${goal.id}`} />}
          </>
        )}
        {past.length > 0 && (
          <div className="border-t border-zinc-800 pt-2">
            <button type="button" className="text-[11px] text-zinc-500 hover:text-zinc-300" onClick={() => setHistory((v) => !v)}>
              {history ? '▾' : '▸'} {past.length} earlier round{past.length === 1 ? '' : 's'}
            </button>
            {history && (
              <div className="mt-2 space-y-2">
                {past.map((r) => (
                  <div key={r.round}>
                    <div className="text-[11px] text-zinc-500 mb-1">Round {r.round}{r.finish ? ' · asked for the Brief' : ''}</div>
                    <ul className="space-y-1">
                      {r.questions.map((q) => (
                        <li key={q.key} className="text-[11px]">
                          <span className="text-zinc-400">{q.text}</span> <span className="text-zinc-200">— {r.answers?.[q.key] ?? <span className="text-zinc-600">not answered: the Clarifier went with its recommendation and listed it under Assumptions</span>}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

/** a question key (R1Q2) as a person reads it: "question 2" in the round on screen, "round 1, question 2 (…)" otherwise */
function questionRef(rounds: { round: number; questions: { key: string; text: string }[] }[], key: string, current: number): string {
  for (const r of rounds) {
    const i = r.questions.findIndex((q) => q.key === key);
    if (i < 0) continue;
    if (r.round === current) return `question ${i + 1}`;
    const text = r.questions[i]!.text;
    return `round ${r.round}, question ${i + 1} ("${text.length > 60 ? `${text.slice(0, 60)}…` : text}")`;
  }
  return 'an earlier answer';
}

/** "Planning with your answers · 3m 20s", ticking */
function Elapsed({ since, label }: { since: string | null; label: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!since) return <>{label}</>;
  const s = Math.max(0, Math.round((now - Date.parse(since)) / 1000));
  return (
    <>
      {label} · {s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`}
    </>
  );
}
