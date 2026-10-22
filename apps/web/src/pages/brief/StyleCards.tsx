import type { Brief, BriefQuestion } from '@foundry/core/browser';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.ts';
import { useLive } from '../../store.ts';
import { Button, Modal, choiceClass, cn } from '../../ui.tsx';

/** a quiet tag (a keyword, the recommendation): the Goals page's trait chip */
const TAG = 'inline-flex items-center whitespace-nowrap rounded-sm px-1.5 py-px text-[10.5px] font-semibold leading-tight ring-1 ring-inset ring-line-strong text-ink-soft';

/**
 * The style question rendered as something the human can SEE: one card per Style Proposal
 * (palette, typefaces, keywords, feel), pick one, then optionally generate real sample images.
 * Samples are a history — regenerating appends, earlier ones stay pickable as the reference image.
 */
export function StyleCards({ goalId, brief, question, editable, update }: { goalId: string; brief: Brief; question: BriefQuestion; editable: boolean; update: (patch: Partial<Brief>) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /** sample opened full-size in the lightbox; picking the reference image happens in there */
  const [viewing, setViewing] = useState<{ key: string; file: string } | null>(null);
  const safetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEvent = useLive((s) => s.lastEvent);
  // generation takes minutes: stay busy until this goal's brief.style_sampled event lands, and surface a failure —
  // a failed sample changes nothing on the Brief, so without this the user sees no sample and no error at all
  useEffect(() => {
    if (!lastEvent || lastEvent.type !== 'brief.style_sampled' || lastEvent.goalId !== goalId) return;
    if (safetyTimer.current) clearTimeout(safetyTimer.current);
    setBusy(null);
    const p = lastEvent.payload;
    const name = brief.styleOptions.find((o) => o.key === p.styleKey)?.name ?? p.styleKey;
    setErr(p.status === 'failed' ? `sample for "${name}" failed: ${p.detail}` : null);
  }, [lastEvent, goalId]);
  const pick = (name: string) => update({ questions: brief.questions.map((x) => (x.id === question.id ? { ...x, answer: name, applied: false } : x)) });
  const chooseSample = (key: string, file: string) => update({ styleOptions: brief.styleOptions.map((o) => (o.key === key ? { ...o, chosenSample: o.chosenSample === file ? null : file } : o)) });
  const generate = async (key: string) => {
    setBusy(key);
    setErr(null);
    try {
      await api.styleSample(goalId, key);
      // the result lands as a brief.style_sampled event (handled above); the samples refresh off goalVersion.
      // safety net: if the engine restarts mid-generation no event ever comes — free the button after 6 min
      if (safetyTimer.current) clearTimeout(safetyTimer.current);
      safetyTimer.current = setTimeout(() => setBusy(null), 6 * 60_000);
    } catch (e: any) {
      setErr(e.message);
      setBusy(null);
    }
  };
  return (
    <div>
      <div className="text-sm font-semibold text-ink mb-2">{question.text}</div>
      <div className="grid sm:grid-cols-2 gap-2.5">
        {brief.styleOptions.map((o, i) => {
          const chosen = (question.answer ?? '') === o.name;
          return (
            // the direction picked is outlined in the accent, as a chosen option anywhere
            <div key={o.key} className={cn('rounded-lg border p-3 space-y-2 transition-colors', choiceClass(chosen))}>
              <button type="button" disabled={!editable} onClick={() => pick(o.name)} className="w-full text-left space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn('h-3.5 w-3.5 rounded-full border shrink-0', chosen ? 'border-accent bg-accent shadow-[inset_0_0_0_2px_var(--color-panel)]' : 'border-line-strong')} />
                  <span className="text-sm font-bold text-ink">{o.name}</span>
                  {i === 0 && <span className={TAG} title="Recommended by the Clarifier">★ recommended</span>}
                </div>
                {o.palette.length > 0 && (
                  // the direction's own colours, as proposed: data, not the theme's
                  <div className="flex h-6 rounded overflow-hidden border border-line">
                    {o.palette.map((hex) => (
                      <span key={hex} className="flex-1" style={{ backgroundColor: hex }} title={hex} />
                    ))}
                  </div>
                )}
                {o.fonts.length > 0 && <div className="text-xs text-ink-soft">Aa · {o.fonts.join(' · ')}</div>}
                {o.keywords.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {o.keywords.map((k) => (
                      <span key={k} className={TAG}>{k}</span>
                    ))}
                  </div>
                )}
                {o.description && <div className="text-xs text-ink-faint leading-snug">{o.description}</div>}
              </button>
              {(o.samples.length > 0 || (chosen && editable)) && (
                <div className="pt-2 border-t border-line space-y-1.5">
                  {o.samples.length > 0 && (
                    <div className="flex gap-1.5 overflow-x-auto">
                      {o.samples.map((f) => (
                        <button key={f} type="button" onClick={() => setViewing({ key: o.key, file: f })} title={o.chosenSample === f ? 'Reference image for the workers — click to view full size' : 'Click to view full size'}>
                          <img src={api.styleSampleUrl(goalId, f)} alt={f} className={cn('h-20 w-20 object-cover rounded border-2', o.chosenSample === f ? 'border-accent' : 'border-transparent hover:border-line-strong')} />
                        </button>
                      ))}
                    </div>
                  )}
                  {chosen && editable && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button size="sm" variant="ghost" disabled={busy === o.key || o.samples.length >= 8} onClick={() => generate(o.key)}>
                        {busy === o.key ? 'Generating… (a minute or two)' : o.samples.length ? 'Regenerate (~$1) — earlier ones are kept' : 'Generate a sample (~$1)'}
                      </Button>
                      {o.samples.length >= 8 && <span className="text-xs text-ink-faint">sample limit reached for this direction</span>}
                      {o.chosenSample && <span className="text-xs font-semibold text-accent-ink">reference image set — workers will match it</span>}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {err && <div className="text-xs text-bad-ink mt-1.5">{err}</div>}
      {viewing &&
        (() => {
          const o = brief.styleOptions.find((x) => x.key === viewing.key);
          if (!o) return null;
          const isRef = o.chosenSample === viewing.file;
          return (
            <Modal open title={`${o.name} — sample ${o.samples.indexOf(viewing.file) + 1} of ${o.samples.length}`} onClose={() => setViewing(null)} wide>
              <div className="space-y-3">
                <img src={api.styleSampleUrl(goalId, viewing.file)} alt={viewing.file} className="max-h-[65vh] w-auto mx-auto rounded border border-line" />
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  {editable && (
                    <Button size="sm" variant={isRef ? 'ghost' : 'primary'} onClick={() => chooseSample(o.key, viewing.file)}>
                      {isRef ? 'Unpick reference image' : 'Use as the reference image'}
                    </Button>
                  )}
                  {isRef && <span className="text-xs font-semibold text-accent-ink">reference image — workers will match it</span>}
                </div>
              </div>
            </Modal>
          );
        })()}
    </div>
  );
}
