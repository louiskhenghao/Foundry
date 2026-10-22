import type { EngineEvent, Goal } from '@foundry/core/browser';
import { MessageCircleQuestion } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api.ts';
import { Card, NEEDS_YOU_CARD, YouStrip, cn } from '../../ui.tsx';
import { LiveLog } from '../LiveLog.tsx';
import { HelpLink } from '../HelpPage.tsx';
import { ClarifyProgress, SkeletonNotice, clarifyChannel } from './ClarifyProgress.tsx';
import { RoundForm, type RoundSubmitKind } from './RoundForm.tsx';

/**
 * The Clarify interview: one round per screen. Each question offers the Clarifier's options (its recommendation first)
 * and a free-text answer; "Accept all recommended" answers a round in one click, "Enough" asks for the Brief with what
 * there is; a note carries what the questions missed. Earlier rounds fold up below. A round waits for you, so it opens
 * with a yellow strip; while the Clarifier reads and thinks the panel is a plain card.
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
  const title = open ? `Round ${open.round} — ${open.questions.length} question${open.questions.length === 1 ? '' : 's'}` : iv.status === 'done' ? 'Interview done' : iv.rounds.length ? 'Thinking about your answers…' : 'Reading the repository…';
  const help = <HelpLink to="answering-the-interview" label="How the interview works (new tab)" />;
  const body = (
    <div className="space-y-4 text-xs text-ink-soft">
      {open ? (
        <>
          <RoundForm
            key={`${goal.id}-${open.round}`}
            round={open.round}
            questions={open.questions}
            rounds={iv.rounds}
            busy={busy}
            intro={<p className="max-w-[90ch] text-[13px] leading-relaxed text-ink-soft">Only decisions the repository could not settle are asked. The first option is the Clarifier's recommendation; the reason says what it found. After your answers it writes the Brief — or asks one more round only if they open new decisions, as deep as the goal's interview depth asks.</p>}
            finishLabel="Enough — write the Brief"
            finishTitle="Stop asking: the Brief is written with these answers and assumptions for the rest"
            onSubmit={submit}
          />
          {err && <div className="text-[13px] text-bad-ink">{err}</div>}
        </>
      ) : (
        <>
          <ClarifyProgress goal={goal} writingBrief={!!iv.rounds.at(-1)?.finish || goal.clarifyStage?.stage === 'planning'} skeleton={skeleton} events={events} />
          {skeleton && <SkeletonNotice goalId={goal.id} />}
          <LiveLog attemptId={clarifyChannel(goal)} />
        </>
      )}
      {past.length > 0 && (
        <div className="border-t border-line pt-3">
          <button type="button" className="text-xs font-semibold text-ink-soft hover:text-ink" onClick={() => setHistory((v) => !v)} aria-expanded={history}>
            {history ? '▾' : '▸'} {past.length} earlier round{past.length === 1 ? '' : 's'}
          </button>
          {history && (
            <div className="mt-3 space-y-3">
              {past.map((r) => (
                <div key={r.round}>
                  <div className="mb-1.5 text-[11px] font-extrabold uppercase tracking-[0.08em] text-ink-faint">Round {r.round}{r.finish ? ' · asked for the Brief' : ''}</div>
                  <ul className="space-y-1">
                    {r.questions.map((q) => (
                      <li key={q.key} className="text-xs">
                        <span className="text-ink-soft">{q.text}</span> <span className="font-semibold text-ink">— {r.answers?.[q.key] ?? <span className="font-normal text-ink-faint">not answered: the Clarifier went with its recommendation and listed it under Assumptions</span>}</span>
                      </li>
                    ))}
                    {r.note && (
                      <li className="text-xs">
                        <span className="text-ink-soft">Your note</span> <span className="font-semibold text-ink whitespace-pre-wrap">— {r.note}</span>
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
  );
  return open ? (
    <section className={NEEDS_YOU_CARD}>
      <YouStrip icon={MessageCircleQuestion} title={title} tags={help} since={open.askedAt} />
      <div className="p-4 sm:p-5">{body}</div>
    </section>
  ) : (
    <Card
      title={
        <span className="flex items-center gap-2">
          {/* how the interview stands: green once done, blue while the Clarifier reads and thinks */}
          <MessageCircleQuestion size={14} className={cn('shrink-0', iv.status === 'done' ? 'text-ok-ink' : 'text-work-ink')} aria-hidden="true" />
          {title}
          {help}
        </span>
      }
    >
      {body}
    </Card>
  );
}
