import type { EngineEvent, Goal } from '@foundry/core/browser';
import { MessageCircleQuestion } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api.ts';
import { Card } from '../../ui.tsx';
import { LiveLog } from '../LiveLog.tsx';
import { HelpLink } from '../HelpPage.tsx';
import { ClarifyProgress, SkeletonNotice, clarifyChannel } from './ClarifyProgress.tsx';
import { RoundForm, type RoundSubmitKind } from './RoundForm.tsx';

/**
 * The Clarify interview: one round per screen. Each question offers the Clarifier's options (its recommendation first)
 * and a free-text answer; "Accept all recommended" answers a round in one click, "Enough" asks for the Brief with what
 * there is; a note carries what the questions missed. Earlier rounds fold up below.
 */
export function InterviewPanel({ goal, skeleton = false, events = [] }: { goal: Goal; /** the Brief skeleton is out: the planner works, the Brief page shows it */ skeleton?: boolean; /** the goal's events, for how long each Clarify step took */ events?: Pick<EngineEvent, 'type' | 'ts' | 'payload'>[] }) {
  const iv = goal.interview;
  const open = iv?.status === 'awaiting_answers' ? iv.rounds.at(-1) : null;
  const [busy, setBusy] = useState<RoundSubmitKind | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [history, setHistory] = useState(false);
  if (!iv) return null;
  const submit = async (kind: RoundSubmitKind, given: Record<string, string>, finish: boolean, note: string | null) => {
    setBusy(kind);
    setErr(null);
    try {
      await api.interviewAnswer(goal.id, given, finish, note);
    } catch (e: any) {
      setErr(e.body?.error ?? e.message);
    } finally {
      setBusy(null);
    }
  };
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
            <RoundForm
              key={`${goal.id}-${open.round}`}
              round={open.round}
              questions={open.questions}
              rounds={iv.rounds}
              busy={busy}
              intro={<p className="text-zinc-400">Only decisions the repository could not settle are asked. The first option is the Clarifier's recommendation; the reason says what it found. After your answers it writes the Brief — or asks one more round only if they open new decisions, as deep as the goal's interview depth asks.</p>}
              finishLabel="Enough — write the Brief"
              finishTitle="Stop asking: the Brief is written with these answers and assumptions for the rest"
              onSubmit={submit}
            />
            {err && <div className="text-rose-300">{err}</div>}
          </>
        ) : (
          <>
            <ClarifyProgress goal={goal} writingBrief={!!iv.rounds.at(-1)?.finish || goal.clarifyStage?.stage === 'planning'} skeleton={skeleton} events={events} />
            {skeleton && <SkeletonNotice goalId={goal.id} />}
            <LiveLog attemptId={clarifyChannel(goal)} />
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
                      {r.note && (
                        <li className="text-[11px]">
                          <span className="text-zinc-400">Your note</span> <span className="text-zinc-200 whitespace-pre-wrap">— {r.note}</span>
                        </li>
                      )}
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
