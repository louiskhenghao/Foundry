import type { Brief } from '@foundry/core/browser';
import { newId, noteQuestion } from '@foundry/core/browser';
import { MessageSquarePlus, X } from 'lucide-react';
import { useState } from 'react';
import { Button, Textarea, cn } from '../../ui.tsx';

/**
 * The human's notes: what the questions did not ask, or got wrong. Each note is a Decision kept among the Brief's
 * questions (kind `note`): saved with the Brief, carried into a Re-run Clarify, received verbatim by every session.
 */
export function NotesComposer({ brief, editable, edit, compact = false }: { brief: Brief; editable: boolean; edit: (fn: (b: Brief) => Brief) => void; compact?: boolean }) {
  const [draft, setDraft] = useState('');
  const notes = brief.questions.filter((q) => q.kind === 'note');
  const add = () => {
    const words = draft.trim();
    if (!words) return;
    edit((b) => ({ ...b, questions: [...b.questions, noteQuestion(newId('q'), words)] }));
    setDraft('');
  };
  const remove = (id: string) => edit((b) => ({ ...b, questions: b.questions.filter((q) => q.id !== id) }));
  return (
    <div className="space-y-2">
      {compact && notes.length > 0 && (
        <ul className="space-y-1 text-sm">
          {notes.map((n) => (
            <li key={n.id} className="flex gap-2 items-start text-ink">
              {/* as in the Decisions card: green once the plan follows it, yellow while it waits for you to Revise */}
              <span className={cn('mt-1.5 w-2 h-2 rounded-full shrink-0', n.applied ? 'bg-ok' : 'bg-you ring-1 ring-inset ring-on-you/40')} title={n.applied ? 'applied to the plan' : 'not yet applied to the plan'} />
              <span className="flex-1 whitespace-pre-wrap">{n.text}</span>
              {editable && (
                <button type="button" className="text-ink-faint hover:text-bad-ink shrink-0" title="Remove this note" onClick={() => remove(n.id)}>
                  <X size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <div className="space-y-1.5">
          {/* three lines on a phone, so its hint shows whole */}
          <Textarea rows={2} className="text-sm min-h-[4.75rem] sm:min-h-0" placeholder="Something the questions missed, or got wrong? Write it here. It becomes a Decision every worker receives." value={draft} onChange={(e) => setDraft(e.target.value)} />
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" disabled={!draft.trim()} onClick={add} title="Keep this note with the Brief's Decisions (saved with the Brief)">
              <MessageSquarePlus size={12} /> Add note
            </Button>
            <span className="text-xs text-ink-faint">Saved with the Brief. Press Revise with answers to have the plan follow it.</span>
          </div>
        </div>
      )}
    </div>
  );
}
