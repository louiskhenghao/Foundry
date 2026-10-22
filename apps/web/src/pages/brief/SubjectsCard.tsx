import { SUBJECT_LIMITS, type BriefSubject, type SubjectPicture } from '@foundry/core/browser';
import { ImagePlus, Loader2, Plus, Search, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { api } from '../../api.ts';
import { Button, Card, Input, focusFirst } from '../../ui.tsx';
import { MediaLightbox } from '../../components/MediaLightbox.tsx';
import { subjectLightbox } from '../goal/MilestoneEvidence.tsx';
import { HelpLink } from '../HelpPage.tsx';
import { SectionTitle } from './SectionTitle.tsx';

const host = (url: string | null) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
};

/**
 * The Brief's Subjects: the real things the result depicts, with the pictures workers build from and every review
 * compares against. Foundry looks for pictures by itself while the Brief waits; the person adds their own, removes wrong
 * ones and names what the Clarifier missed. It shows the server's copy: Subjects never ride on a Brief save.
 */
export function SubjectsCard({ goalId, subjects, searching, editable }: { goalId: string; subjects: BriefSubject[]; searching: string[]; editable: boolean }) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ key: string; index: number } | null>(null);
  const [adding, setAdding] = useState({ name: '', lookFor: '' });
  const act = async (key: string, fn: () => Promise<unknown>) => {
    setErr(null);
    setBusy(key);
    try {
      await fn();
    } catch (e: any) {
      setErr(e.body?.error ?? e.message);
    } finally {
      setBusy(null);
    }
  };
  const add = () => act('add', async () => {
    await api.addSubject(goalId, { name: adding.name.trim(), lookFor: adding.lookFor.trim() });
    setAdding({ name: '', lookFor: '' });
  });
  return (
    <Card title={<><SectionTitle section="subjects">Looks like</SectionTitle><HelpLink to="approving-the-brief#looks-like" className="ml-1.5" /></>}>
      <p className="text-xs text-ink-faint mb-3">
        Real things the result must look like. Workers build from these pictures and every review compares against them; the pictures stay on this computer and are never part of the result.
      </p>
      {subjects.length === 0 && <div className="text-sm text-ink-faint mb-2">Nothing real to match.</div>}
      <div className="space-y-4">
        {subjects.map((s) => (
          <SubjectRow key={s.key} goalId={goalId} subject={s} searching={searching.includes(s.key)} editable={editable} busy={busy} act={act} onView={(picture) => setViewing({ key: s.key, index: Math.max(0, s.pictures.findIndex((p) => p.file === picture.file)) })} />
        ))}
      </div>
      {editable && subjects.length < SUBJECT_LIMITS.subjects && (
        <form
          className="mt-4 pt-3 border-t border-line grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            if (adding.name.trim()) void add();
          }}
        >
          <Input value={adding.name} onChange={(e) => setAdding((a) => ({ ...a, name: e.target.value }))} placeholder="A real thing, e.g. Porsche 911 GT3 (992)" aria-label="Subject name" />
          <Input value={adding.lookFor} onChange={(e) => setAdding((a) => ({ ...a, lookFor: e.target.value }))} placeholder="What must match (proportions, features, colours)" aria-label="What must match" />
          <Button type="submit" size="sm" disabled={!adding.name.trim() || busy === 'add'}>
            <Plus size={12} /> Add and find pictures
          </Button>
        </form>
      )}
      {err && <div className="text-xs text-bad-ink mt-2">{err}</div>}
      {viewing && (() => {
        const s = subjects.find((x) => x.key === viewing.key);
        return s ? <MediaLightbox items={subjectLightbox(goalId, s)} index={Math.min(viewing.index, s.pictures.length - 1)} onIndex={(index) => setViewing({ ...viewing, index })} onClose={() => setViewing(null)} title={s.name} /> : null;
      })()}
    </Card>
  );
}

function SubjectRow({ goalId, subject: s, searching, editable, busy, act, onView }: { goalId: string; subject: BriefSubject; searching: boolean; editable: boolean; busy: string | null; act: (key: string, fn: () => Promise<unknown>) => Promise<void>; onView: (p: SubjectPicture) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [lookFor, setLookFor] = useState<string | null>(null);
  const full = s.pictures.length >= SUBJECT_LIMITS.pictures;
  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-ink">{s.name}</div>
          {lookFor === null ? (
            <button type="button" disabled={!editable} onClick={() => setLookFor(s.lookFor)} className="block text-left text-xs text-ink-soft enabled:hover:text-ink" title={editable ? 'Change what must match' : undefined}>
              {s.lookFor || (editable ? 'Say what must match…' : '')}
            </button>
          ) : (
            <form
              className="flex gap-1.5 mt-0.5"
              onSubmit={(e) => {
                e.preventDefault();
                void act(`look-${s.key}`, () => api.updateSubject(goalId, s.key, { lookFor: lookFor })).then(() => setLookFor(null));
              }}
            >
              <Input autoFocus={focusFirst} value={lookFor} onChange={(e) => setLookFor(e.target.value)} className="text-xs py-1" aria-label="What must match" />
              <Button type="submit" size="sm">Save</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setLookFor(null)}>Cancel</Button>
            </form>
          )}
        </div>
        {editable && (
          <button type="button" className="shrink-0 rounded p-1 text-ink-faint hover:text-bad-ink hover:bg-inset" title="Remove this Subject" aria-label={`Remove ${s.name}`} onClick={() => void act(`rm-${s.key}`, () => api.removeSubject(goalId, s.key))}>
            <X size={13} />
          </button>
        )}
      </div>
      {s.pictures.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {s.pictures.map((p) => (
            <div key={p.file} className="relative shrink-0 w-36 group">
              <button type="button" onClick={() => onView(p)} className="block w-full" title={p.caption || 'View full size'}>
                <img src={api.subjectPictureUrl(goalId, p.file)} alt={p.caption || s.name} loading="lazy" className="h-24 w-36 object-cover rounded border border-line group-hover:border-line-strong" />
              </button>
              <div className="text-[11px] text-ink-faint truncate mt-0.5">{[p.caption, p.source === 'person' ? 'yours' : host(p.url)].filter(Boolean).join(' · ')}</div>
              {editable && (
                <button type="button" className="absolute top-1 right-1 rounded bg-ink/80 p-0.5 text-on-ink opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-bad hover:text-on-bad" title="Remove this picture" aria-label={`Remove ${p.caption || p.file}`} onClick={() => void act(`pic-${p.file}`, () => api.removeSubjectPicture(goalId, s.key, p.file))}>
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {searching ? (
          <span className="inline-flex items-center gap-1.5 text-ink-soft">
            <Loader2 size={12} className="animate-spin shrink-0" /> Finding pictures… (a minute or two)
          </span>
        ) : s.search?.status === 'failed' ? (
          <span className="font-semibold text-bad-ink">The search failed: {s.search.detail}</span>
        ) : s.search && s.pictures.length === 0 ? (
          <span className="font-semibold text-ink-soft">No picture found{s.search.detail ? ` (${s.search.detail})` : ''}: search again, or add your own.</span>
        ) : s.pictures.length === 0 && !editable ? (
          <span className="text-ink-faint">No picture: workers go by the name.</span>
        ) : null}
        {editable && (
          <>
            <Button size="sm" variant="ghost" disabled={searching || full || busy === `search-${s.key}`} onClick={() => void act(`search-${s.key}`, () => api.searchSubject(goalId, s.key))} title={full ? `A Subject has at most ${SUBJECT_LIMITS.pictures} pictures` : 'Search the web for pictures of exactly this one (about $1)'}>
              <Search size={12} /> {s.pictures.length ? 'Find more' : 'Find pictures'}
            </Button>
            <Button size="sm" variant="ghost" disabled={full || busy === `up-${s.key}`} onClick={() => file.current?.click()} title="A photo or render of your own (PNG, JPEG, WebP or GIF, up to 5 MB)">
              <ImagePlus size={12} /> Add your own
            </Button>
            <input
              ref={file}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = '';
                if (files.length) void act(`up-${s.key}`, () => api.addSubjectPictures(goalId, s.key, files));
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
