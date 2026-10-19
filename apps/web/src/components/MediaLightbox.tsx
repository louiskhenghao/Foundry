import { ChevronLeft, ChevronRight } from 'lucide-react';
import { type ReactNode, type TouchEvent, useEffect, useRef } from 'react';
import { Modal } from '../ui.tsx';

export type LightboxItem = {
  kind: 'image' | 'video';
  src: string;
  caption: string;
  /** a link under the caption: the page a picture was found on, the file itself */
  link?: { href: string; label: string } | null;
};

/** a horizontal swipe longer than this, and clearly more sideways than up or down, steps to the next or the previous */
const SWIPE_PX = 48;

/**
 * One picture or clip large in a window, the others a step away: the arrows under it, where a thumb reaches them on a
 * phone, a swipe left or right on a touch screen, or ← and → on a keyboard. `unavailable` says why one cannot be shown;
 * `onError` hears of one that would not load.
 */
export function MediaLightbox({ items, index, onIndex, onClose, title, unavailable, onError }: { items: LightboxItem[]; index: number; onIndex: (i: number) => void; onClose: () => void; title?: ReactNode; unavailable?: (item: LightboxItem) => ReactNode | null; onError?: (item: LightboxItem) => void }) {
  const m = items[index];
  const touch = useRef<{ x: number; y: number } | null>(null);
  const go = (d: -1 | 1) => {
    const i = index + d;
    if (i >= 0 && i < items.length) onIndex(i);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented) return;
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [index, items.length]);
  if (!m) return null;
  const why = unavailable?.(m) ?? null;
  const onTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    const t = e.touches[0];
    // two fingers zoom; a touch on a clip's bottom strip is the person working its controls (scrubbing), not swiping
    const r = e.currentTarget.getBoundingClientRect();
    touch.current = !t || e.touches.length > 1 || (m.kind === 'video' && t.clientY > r.bottom - 64) ? null : { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    const s = touch.current;
    touch.current = null;
    const t = e.changedTouches[0];
    if (!s || !t) return;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  };
  const arrow = (d: -1 | 1) => (
    <button type="button" className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-md border border-zinc-800 text-zinc-300 hover:bg-zinc-800 disabled:opacity-30" disabled={!items[index + d]} onClick={() => go(d)} aria-label={d < 0 ? 'previous' : 'next'} title={d < 0 ? 'previous (←)' : 'next (→)'}>
      {d < 0 ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
    </button>
  );
  return (
    <Modal open wide onClose={onClose} title={title ?? (m.caption || (m.kind === 'video' ? 'Video' : 'Picture'))}>
      <div className="space-y-2">
        <div className="touch-pan-y select-none" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          {/* keyed by source: switching items starts the next clip from its beginning */}
          {why ? (
            <div className="flex h-48 items-center justify-center rounded border border-zinc-800 text-xs text-zinc-500">{why}</div>
          ) : m.kind === 'video' ? (
            <video key={m.src} src={m.src} controls autoPlay muted playsInline onError={() => onError?.(m)} className="w-full max-h-[65vh] rounded border border-zinc-800 bg-black" />
          ) : (
            <img key={m.src} src={m.src} alt={m.caption} draggable={false} onError={() => onError?.(m)} className="w-full max-h-[65vh] object-contain rounded border border-zinc-800 bg-zinc-950" />
          )}
        </div>
        <div className="flex items-center gap-2">
          {arrow(-1)}
          <div className="min-w-0 flex-1 text-center">
            <div className="truncate text-xs text-zinc-300" title={m.caption}>
              {m.caption}
            </div>
            <div className="text-[11px] text-zinc-500">
              {index + 1} / {items.length}
              {m.link && (
                <>
                  {' · '}
                  <a href={m.link.href} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">
                    {m.link.label}
                  </a>
                </>
              )}
            </div>
          </div>
          {arrow(1)}
        </div>
      </div>
    </Modal>
  );
}
