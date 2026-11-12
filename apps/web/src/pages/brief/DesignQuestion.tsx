import type { Attachment, Brief, BriefQuestion } from '@foundry/core/browser';
import { designReferences } from '@foundry/core/browser';
import { useState } from 'react';
import { AttachmentInput } from '../../components/Attachments.tsx';
import { Button } from '../../ui.tsx';
import { AnsweredTick, answerChip, blockingTag } from './marks.tsx';

export const WITHOUT_DESIGN = 'Go without the design';

/**
 * The Brief's question about a design the sessions cannot open (ADR-0093), with the remedy in the same place: drop
 * the export here (it is marked as the design reference as it lands), then write the Brief again from it — the
 * Decisions already answered are kept. Or go without, and the Brief's own style direction stands.
 */
export function DesignQuestion({ goalId, brief, question, attachments, editable, update, onRerun, tag = 'blocking' }: {
  goalId: string;
  brief: Brief;
  question: BriefQuestion;
  /** the goal's attachments as they stand; the drop zone adds to them and the live refresh brings them back */
  attachments: Attachment[];
  editable: boolean;
  update: (patch: Partial<Brief>) => void;
  /** write the Brief again from the attached design (Re-run Clarify), then leave the page */
  onRerun: () => Promise<void>;
  /** the word on the blocking tag, as the view says it beside its other questions */
  tag?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const designs = designReferences(attachments);
  const without = question.answer === WITHOUT_DESIGN;
  const answerWithout = () => update({ questions: brief.questions.map((x) => (x.id === question.id ? { ...x, answer: without ? null : WITHOUT_DESIGN, applied: false } : x)) });
  const rerun = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onRerun();
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  };
  return (
    <div>
      <div className="text-sm font-semibold text-ink mb-2 flex items-start gap-2 flex-wrap">
        <AnsweredTick answer={question.answer} />
        {question.blocking && <span className={blockingTag(!!question.answer?.trim())}>{tag}</span>}
        <span className="min-w-0 flex-1 basis-64">{question.text}</span>
      </div>
      {editable && <AttachmentInput items={attachments} goalId={goalId} onChange={() => {}} markDesigns />}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="primary" disabled={!editable || busy || designs.length === 0} onClick={rerun} title={designs.length ? 'Write the Brief again from the design; the Decisions you answered are kept' : 'Attach the export first: a picture, an HTML file or a zip'}>
          {busy ? 'Starting…' : `Re-run Clarify with the design${designs.length ? ` · ${designs.length} file${designs.length === 1 ? '' : 's'}` : ''}`}
        </Button>
        <button type="button" disabled={!editable} onClick={answerWithout} className={answerChip(without)}>
          {WITHOUT_DESIGN}
        </button>
        <span className="text-xs text-ink-faint">{designs.length ? 'Your Decisions are kept; the Brief is written again from the design.' : 'No design attached yet.'}</span>
      </div>
      {err && <div className="text-xs text-bad-ink mt-1">{err}</div>}
    </div>
  );
}
