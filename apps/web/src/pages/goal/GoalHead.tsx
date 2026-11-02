import type { Goal } from '@foundry/core/browser';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { api } from '../../api.ts';
import { FullTextDialog } from '../../components/FullTextDialog.tsx';
import { ConfirmDialog, GOAL_TITLE, Input, cn } from '../../ui.tsx';
import { goalExcerpt } from './excerpt.ts';

/**
 * Whether any of the elements shows less than its text (its line clamp cut it); watched as the text and the width
 * change. A cut line is at least a line tall: a display font's glyphs run a pixel or two past a tight line box, which
 * is no cut.
 */
function useClamped(refs: RefObject<HTMLElement | null>[], deps: unknown[]): boolean {
  const [cut, setCut] = useState(false);
  useEffect(() => {
    const over = (el: HTMLElement) => el.scrollHeight - el.clientHeight > (parseFloat(getComputedStyle(el).lineHeight) || el.clientHeight) / 2;
    const check = () => setCut(refs.some((r) => !!r.current && over(r.current)));
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    for (const r of refs) if (r.current) ro.observe(r.current);
    return () => ro.disconnect();
  }, deps);
  return cut;
}

/**
 * The goal's name as its page and its Brief head it: two lines at most, and under it (on the goal page) the first lines
 * of what was asked — one line on a phone. When either is cut, "Show more" opens the whole description with the full
 * name above it.
 */
export function GoalTitle({ goal, excerpt = false }: { goal: Pick<Goal, 'title' | 'prompt'>; /** the first lines of the description under the name: the goal page; the Brief shows the description in full below */ excerpt?: boolean }) {
  const h = useRef<HTMLHeadingElement>(null);
  const p = useRef<HTMLParagraphElement>(null);
  const text = excerpt && goal.prompt ? goalExcerpt(goal.prompt, goal.title) : '';
  const cut = useClamped([h, p], [goal.title, text]);
  const [full, setFull] = useState(false);
  return (
    <>
      <h1 ref={h} className={GOAL_TITLE} title={goal.title}>
        {goal.title}
      </h1>
      {text && (
        <p ref={p} className="mt-2 max-w-[72ch] text-[15px] leading-relaxed text-ink-soft line-clamp-1 md:text-[17px] md:line-clamp-2 header-compact:text-sm">
          {text}
        </p>
      )}
      {cut && (
        <button type="button" className="mt-1.5 mr-4 text-xs font-semibold text-ink-soft underline decoration-dotted underline-offset-[3px] hover:text-ink" onClick={() => setFull(true)}>
          Show more
        </button>
      )}
      <FullTextDialog value={full ? { title: 'Goal', text: goal.prompt, note: goal.title } : null} onClose={() => setFull(false)} />
    </>
  );
}

/**
 * The goal's facts and links under its name. On a phone they fold under one line, "Details", so the tabs come into
 * view without a long scroll; from a tablet up they are open and the line is not shown.
 */
export function HeaderDetails({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-ink-soft hover:text-ink md:hidden" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />} {open ? 'Hide details' : 'Details'}
      </button>
      <div className={cn(!open && 'hidden md:block')}>{children}</div>
    </>
  );
}

/** Rename… on the goal page: the name shows wherever the goal is named; the progress folder keeps the one it was made with. */
export function RenameDialog({ goal, open, onClose }: { goal: Pick<Goal, 'id' | 'title'>; open: boolean; onClose: () => void }) {
  const [name, setName] = useState(goal.title);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setName(goal.title);
      setErr(null);
    }
  }, [open, goal.title]);
  const ready = !!name.trim() && name.trim() !== goal.title;
  const save = async () => {
    if (!ready) return;
    setBusy(true);
    setErr(null);
    try {
      await api.renameGoal(goal.id, name);
      onClose();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <ConfirmDialog open={open} title="Rename the goal" confirmLabel="Rename" busy={busy} confirmDisabled={!ready} onClose={onClose} onConfirm={() => void save()}>
      <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus aria-label="The goal's name" onKeyDown={(e) => e.key === 'Enter' && void save()} />
      <p>The new name shows on this page, in the list of goals, in the Inbox and in notifications. The progress folder keeps the name it was made with.</p>
      {err && <p className="text-bad-ink">{err}</p>}
    </ConfirmDialog>
  );
}
