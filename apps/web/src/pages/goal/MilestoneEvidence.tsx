import { ARTIFACT_SCENARIOS, type BriefSubject, type LikenessVerdict } from '@foundry/core/browser';
import { CheckCircle2, ChevronRight, ExternalLink, Eye, FastForward, FileCode2, FileDown, Loader2, MessageSquare, Play, RotateCcw, ScrollText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { type GoalDetail, api, fileUrl } from '../../api.ts';
import { type LightboxItem, MediaLightbox } from '../../components/MediaLightbox.tsx';
import { Button, Card, Modal, ago, cn } from '../../ui.tsx';

type Item = { file: string; caption: string };
export type Evidence = {
  taskId: string;
  video: string | null;
  shots: Item[];
  summary: string;
  error: string | null;
  mock?: boolean;
  script?: string | null;
  status?: 'pass' | 'fail' | 'unverified';
  clips?: Item[];
  outputs?: Item[];
  log?: string | null;
  final?: boolean;
  /** 'files': what a task produced (a model's snapshots, images, video), not a walkthrough */
  kind?: 'files';
  /** a milestone of files: the models, drawings and too-large clips it names, relative to artifacts/ */
  files?: string[];
};

/** a task whose milestone shows the files it produced (a model's snapshots, images, video) instead of a walkthrough, as the engine decides: a milestone script comes first */
export const showsFiles = (t: { scenario: string; milestoneScript?: string | null }) => !t.milestoneScript && (ARTIFACT_SCENARIOS as readonly string[]).includes(t.scenario);

/** the task id the final walkthrough uses where a milestone's goes */
export const FINAL_WALK = 'final';

/** what a recording proved: older recordings carry no status, so it is read from what they hold */
export const evidenceStatus = (e: Evidence): 'pass' | 'fail' | 'unverified' => e.status ?? (e.mock ? 'unverified' : e.shots.length || e.video ? 'pass' : 'fail');

/** how a milestone's recording went: green when it was shown, red when it failed, blue while it records, quiet otherwise (fake data is not the person's to act on, so not yellow) */
const STATUS: Record<'pass' | 'fail' | 'unverified' | 'running' | 'none', { label: string; className: string }> = {
  pass: { label: 'shown', className: 'bg-ok/10 text-ok-ink ring-ok/30' },
  unverified: { label: 'unverified · fake data', className: 'text-ink ring-line-strong' },
  fail: { label: 'failed', className: 'bg-bad/10 text-bad-ink ring-bad/40' },
  running: { label: 'recording…', className: 'bg-work/10 text-work-ink ring-work/30' },
  none: { label: 'not reached yet', className: 'text-ink-faint ring-line-strong' },
};

/** `files`: a milestone of files, which is collected, not recorded */
function StatusChip({ status, files = false }: { status: keyof typeof STATUS; files?: boolean }) {
  const s = STATUS[status];
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em] ring-1 ring-inset', s.className)}>
      {status === 'running' && <Loader2 size={10} className="animate-spin" />}
      {status === 'running' && files ? 'collecting…' : s.label}
    </span>
  );
}

type Media = { kind: 'video' | 'image'; file: string; caption: string };

/** why an item's media would not load: the file is not on this computer (a goal moved from another one leaves the clips of
 * delivered files behind), or it is there and this browser cannot show it (a clip in a format it does not play) */
type Broken = 'gone' | 'unplayable';

/** the recording as one row of items: the videos first (one per scripted test), then the screenshots in the order taken */
const mediaOf = (e: Evidence): Media[] => [
  ...(e.video ? [{ kind: 'video' as const, file: e.video, caption: 'Walkthrough video' }] : []),
  ...(e.clips ?? []).map((c) => ({ kind: 'video' as const, ...c })),
  ...e.shots.map((s) => ({ kind: 'image' as const, ...s })),
];

/** text a milestone script attached (an API's responses), shown as it came */
function OutputBlock({ goalId, item }: { goalId: string; item: Item }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(api.screenshotUrl(goalId, item.file))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => {
        if (!alive) return;
        try {
          setText(JSON.stringify(JSON.parse(t), null, 2));
        } catch {
          setText(t);
        }
      })
      .catch(() => alive && setText('(could not be read)'));
    return () => {
      alive = false;
    };
  }, [goalId, item.file]);
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-ink-faint truncate mb-1">{item.caption}</div>
      <pre className="mono text-[11px] text-ink-soft bg-sunken border border-line rounded-md p-2 max-h-48 overflow-auto whitespace-pre">{text ?? '…'}</pre>
    </div>
  );
}

/**
 * a milestone's recording: the videos and screenshots as same-size tiles (a click opens them in a viewer), what an API
 * answered, the script and its log, and why when it could not show it. A milestone of files shows what the task
 * produced: its pictures whole (a model's snapshot is not a page to crop), and its models and drawings as links.
 */
export function EvidenceView({ goalId, evidence, taskId }: { goalId: string; evidence: Evidence; taskId?: string }) {
  const [shown, setShown] = useState<number | null>(null);
  // an item whose media would not load says why; only a file the server does not have is "not on this computer"
  const [broken, setBroken] = useState<ReadonlyMap<string, Broken>>(new Map());
  const failed = (file: string) => {
    if (broken.has(file)) return;
    void fetch(api.screenshotUrl(goalId, file), { method: 'HEAD' })
      .then((r): Broken => (r.status === 404 ? 'gone' : 'unplayable'), (): Broken => 'unplayable')
      .then((why) => setBroken((b) => new Map(b).set(file, why)));
  };
  const items = mediaOf(evidence);
  const status = evidenceStatus(evidence);
  const files = evidence.kind === 'files';
  const fit = files ? 'object-contain' : 'object-cover object-top';
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] text-ink-faint">
        {files ? 'What the task produced' : 'What Foundry saw'}
        {evidence.summary ? `${files ? ' · ' : ': '}${evidence.summary}` : ''}
      </div>
      {files && (evidence.files ?? []).length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          {evidence.files!.map((f) => (
            <a key={f} href={api.artifactUrl(goalId, f)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 max-sm:min-h-8 font-semibold text-work-ink hover:underline mono" title={`${f}: opens or downloads in a new tab`}>
              <FileDown size={11} /> {f}
            </a>
          ))}
        </div>
      )}
      {(evidence.script || evidence.log) && (
        <div className="flex flex-wrap items-center gap-3 text-[11px]">
          {evidence.script && (
            taskId ? (
              <a href={fileUrl({ goal: goalId, task: taskId, rel: evidence.script })} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 max-sm:min-h-8 font-semibold text-work-ink hover:underline mono" title="The Playwright script that recorded this milestone (opens in a new tab)">
                <FileCode2 size={11} /> {evidence.script}
              </a>
            ) : (
              <span className="inline-flex items-center gap-1 text-ink-soft mono"><FileCode2 size={11} /> {evidence.script}</span>
            )
          )}
          {evidence.log && (
            <a href={api.screenshotUrl(goalId, evidence.log)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 max-sm:min-h-8 font-semibold text-work-ink hover:underline" title="What the script runner printed (opens in a new tab)">
              <ScrollText size={11} /> runner log
            </a>
          )}
        </div>
      )}
      {items.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {items.map((m, i) => {
            const why = broken.get(m.file);
            // a file this browser cannot show opens in a tab of its own (a download, or a player that can)
            const open = () => (why === 'unplayable' ? void window.open(api.screenshotUrl(goalId, m.file), '_blank', 'noreferrer') : setShown(i));
            return (
            <button key={m.file} type="button" onClick={open} disabled={why === 'gone'} title={m.caption} className="min-w-0 text-left group disabled:cursor-default">
              {/* media sit on black (a picture of files on the inset grey); a tile is outlined, and darkens its outline under the pointer */}
              <span className={cn('relative block aspect-video overflow-hidden rounded-md border border-line-strong', why !== 'gone' && 'group-hover:border-ink-soft', files || why ? 'bg-sunken' : 'bg-black')}>
                {why === 'gone' ? (
                  <span className="flex h-full w-full items-center justify-center px-2 text-center text-[11px] text-ink-faint">not on this computer</span>
                ) : why ? (
                  // a click opens it: shown as the link it is, not as the dead tile above
                  <span className="flex h-full w-full items-center justify-center gap-1 px-2 text-center text-[11px] font-semibold text-work-ink">
                    <ExternalLink size={10} className="shrink-0" /> can't be shown here · open the file
                  </span>
                ) : m.kind === 'video' ? (
                  <>
                    {/* the first frame as the tile's picture */}
                    <video src={`${api.screenshotUrl(goalId, m.file)}#t=0.1`} muted preload="metadata" playsInline onError={() => failed(m.file)} className={cn('h-full w-full pointer-events-none', fit)} />
                    <span className="absolute inset-0 flex items-center justify-center">
                      {/* white on a dark disc over the picture, whatever the theme */}
                      <span className="rounded-full bg-black/60 p-2 text-white">
                        <Play size={14} fill="currentColor" />
                      </span>
                    </span>
                  </>
                ) : (
                  <img src={api.screenshotUrl(goalId, m.file)} alt={m.caption} loading="lazy" onError={() => failed(m.file)} className={cn('h-full w-full', fit)} />
                )}
              </span>
              {/* a file's caption keeps its folder and name, where a long path would lose the view that tells two apart */}
              <span className="block text-[11px] text-ink-faint truncate mt-1">{files ? m.caption.split('/').slice(-2).join('/') : m.caption}</span>
            </button>
            );
          })}
        </div>
      )}
      {(evidence.outputs ?? []).length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {evidence.outputs!.map((o) => (
            <OutputBlock key={o.file} goalId={goalId} item={o} />
          ))}
        </div>
      )}
      {status === 'unverified' && <div className="text-[11px] font-semibold text-ink">Shown with fake data only: it does not count as reached. Rerun it once the real app can start.</div>}
      {evidence.error && <div className={cn('text-[11px] whitespace-pre-wrap', status === 'fail' ? 'text-bad-ink' : 'text-ink-soft')}>{evidence.error}</div>}
      {shown !== null && items[shown] && (
        <MediaLightbox
          items={items.map((m) => ({ kind: m.kind, src: api.screenshotUrl(goalId, m.file), caption: m.caption || (m.kind === 'video' ? 'Walkthrough video' : 'Screenshot') }))}
          index={shown}
          onIndex={setShown}
          onClose={() => setShown(null)}
          title={files ? 'What the task produced' : 'What Foundry saw'}
          onError={(it) => failed(items.find((m) => api.screenshotUrl(goalId, m.file) === it.src)!.file)}
          unavailable={(it) => {
            const file = items.find((m) => api.screenshotUrl(goalId, m.file) === it.src)!.file;
            const why = broken.get(file);
            return why === 'gone' ? 'Not on this computer' : why ? (
              <a href={it.src} target="_blank" rel="noreferrer" className="font-semibold text-work-ink hover:underline">
                This browser cannot show it: open the file
              </a>
            ) : null;
          }}
        />
      )}
    </div>
  );
}

/** the Likeness review of one recording (its milestone.evidence event at `evidenceAt`) */
export type Likeness = { taskId: string; evidenceAt: string; status: 'ok' | 'failed'; verdict: LikenessVerdict | null; detail: string; costUsd: number; fixTaskId: string | null };

/** the review of the recording a milestone made at `at`, or null */
export function likenessOf(d: Pick<GoalDetail, 'milestoneEvents'>, taskId: string, at: string): Likeness | null {
  const e = d.milestoneEvents.filter((x) => x.type === 'milestone.likeness' && (x.payload as Likeness).taskId === taskId && (x.payload as Likeness).evidenceAt === at).at(-1);
  return e ? (e.payload as Likeness) : null;
}

/** a likeness score's plate: green from 8, quiet from 6, red below (a middling score asks nothing of you, so it is not yellow) */
const scoreClass = (n: number) => (n >= 8 ? 'bg-ok/10 text-ok-ink ring-ok/30' : n >= 6 ? 'text-ink ring-line-strong' : 'bg-bad/10 text-bad-ink ring-bad/40');

/** the lowest score a review gave a Subject it saw, for the milestone's row */
export function LikenessChip({ look }: { look: Likeness | null }) {
  const scores = (look?.verdict?.subjects ?? []).filter((v) => v.shown && v.score != null).map((v) => v.score!);
  if (!scores.length) return null;
  const low = Math.min(...scores);
  return <span className={cn('rounded-sm px-1.5 py-0.5 text-[11px] font-semibold mono ring-1 ring-inset', scoreClass(low))} title="How much it looks like the Subjects' pictures (the lowest Subject)">likeness {low}/10</span>;
}

/**
 * How close a recording is to the Subjects' pictures: per Subject its score, its pictures beside the shots above, what
 * differs (major ones first in red) and what already matches; and the fix task Foundry added for the major differences.
 */
export function LikenessView({ goalId, look, subjects, running, fixTitle }: { goalId: string; look: Likeness | null; subjects: BriefSubject[]; running: boolean; fixTitle: string | null }) {
  const [viewing, setViewing] = useState<{ key: string; index: number } | null>(null);
  // a review under way: the review colour
  if (!look) return running ? <div className="text-[11px] text-extra-ink flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> Comparing with the pictures…</div> : null;
  if (look.status === 'failed' || !look.verdict) return <div className="text-[11px] text-ink-soft">The likeness review gave no verdict{look.detail ? `: ${look.detail}` : ''}.</div>;
  return (
    // rounded-md: the guide's screenshot script finds this box by it
    <div className="rounded-md border border-line bg-sunken p-3 space-y-3">
      <div className="text-[11px] text-ink-soft">
        <span className="font-extrabold caps text-ink">Likeness to the pictures</span>
        {look.verdict.summary ? ` · ${look.verdict.summary}` : ''}
      </div>
      {look.verdict.subjects.map((v) => {
        const s = subjects.find((x) => x.key === v.key);
        const diffs = [...v.differences].sort((a, b) => Number(b.major) - Number(a.major));
        return (
          <div key={v.key} className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-bold text-ink">{s?.name ?? v.key}</span>
              {v.shown && v.score != null ? <span className={cn('rounded-sm px-1.5 py-0.5 text-[11px] font-semibold mono ring-1 ring-inset', scoreClass(v.score))}>{v.score}/10</span> : <span className="text-[11px] text-ink-faint">not in these shots</span>}
            </div>
            {v.shown && (s?.pictures.length ?? 0) > 0 && (
              <div className="flex gap-1.5 overflow-x-auto">
                {s!.pictures.slice(0, 6).map((p, i) => (
                  <button key={p.file} type="button" onClick={() => setViewing({ key: v.key, index: i })} title={p.caption || 'a picture of it'} className="shrink-0">
                    <img src={api.subjectPictureUrl(goalId, p.file)} alt={p.caption || s!.name} loading="lazy" className="h-12 w-16 object-cover rounded-md border border-line hover:border-line-strong" />
                  </button>
                ))}
              </div>
            )}
            {diffs.length > 0 && (
              <ul className="text-[11px] space-y-0.5">
                {diffs.map((d, i) => (
                  <li key={i} className={cn('flex gap-1.5', d.major ? 'text-bad-ink' : 'text-ink-soft')}>
                    <span className="shrink-0">{d.major ? '●' : '○'}</span>
                    <span>{d.what}</span>
                  </li>
                ))}
              </ul>
            )}
            {v.matches.length > 0 && <div className="text-[11px] text-ok-ink">Matches: {v.matches.join('; ')}</div>}
          </div>
        );
      })}
      {fixTitle && <div className="text-[11px] text-work-ink">Foundry added “{fixTitle}” for the major differences; the milestone is recorded and compared again once it lands.</div>}
      {viewing && (() => {
        const s = subjects.find((x) => x.key === viewing.key);
        return s ? <MediaLightbox items={subjectLightbox(goalId, s)} index={viewing.index} onIndex={(index) => setViewing({ ...viewing, index })} onClose={() => setViewing(null)} title={s.name} /> : null;
      })()}
    </div>
  );
}

/** a Subject's pictures as the lightbox shows them: what each shows, and where it was found */
export function subjectLightbox(goalId: string, s: BriefSubject): LightboxItem[] {
  return s.pictures.map((p) => {
    let host = '';
    try {
      host = p.url ? new URL(p.url).hostname.replace(/^www\./, '') : '';
    } catch {
      /* not a URL: no link */
    }
    return { kind: 'image' as const, src: api.subjectPictureUrl(goalId, p.file), caption: p.caption || s.name, link: p.source === 'person' ? null : p.url && host ? { href: p.url, label: `found on ${host}` } : null };
  });
}

/** what happened at one milestone visit */
interface Visit {
  at: string;
  paused: boolean;
  recheck: boolean;
  outcome: { action: 'continue' | 'feedback'; feedback: string | null } | null;
}

/** a recording of one milestone, with when it was made */
type Recording = { at: string; evidence: Evidence };

/**
 * Every milestone of the goal in plan order, one per feature: whether it was shown (a passing script, a walkthrough of
 * the real app, or the files a task produced), shown with fake data only, or failed; when it landed and what the person
 * answered; its latest recording, so it can be looked at again; and a Rerun. On top, the final walkthrough that ran
 * every script once all tasks were done.
 */
export function MilestonesCard({ d }: { d: GoalDetail }) {
  const g = d.goal;
  // each milestone opens on its own: looking at one never folds another away
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [asked, setAsked] = useState<ReadonlySet<string>>(() => new Set());
  const [err, setErr] = useState<string | null>(null);
  const toggle = (id: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const visits = new Map<string, Visit[]>();
  const latest = new Map<string, Recording>();
  let finalWalk: { at: string; passed: boolean; failed: string[] } | null = null;
  for (const e of d.milestoneEvents) {
    if (e.type === 'milestone.final_walk') {
      const p = e.payload as { passed: boolean; failed: string[] };
      finalWalk = { at: e.ts, passed: p.passed, failed: p.failed };
      continue;
    }
    const p = e.payload as { taskId?: string; recheck?: boolean; action?: 'continue' | 'feedback'; feedback?: string | null };
    if (!p.taskId) continue;
    if (e.type === 'milestone.evidence') {
      latest.set(p.taskId, { at: e.ts, evidence: e.payload as Evidence });
      continue;
    }
    const list = visits.get(p.taskId) ?? [];
    if (e.type === 'goal.checkpoint_opened') list.push({ at: e.ts, paused: true, recheck: !!p.recheck, outcome: null });
    else if (e.type === 'goal.milestone_passed') list.push({ at: e.ts, paused: false, recheck: false, outcome: null });
    else if (e.type === 'goal.checkpoint_closed' && list.length) list.at(-1)!.outcome = { action: p.action!, feedback: p.feedback ?? null };
    else continue;
    visits.set(p.taskId, list);
  }
  const runs = new Set([...(d.milestoneRuns ?? []), ...asked]);
  const milestones = d.tasks.filter((t) => t.milestone).map((t) => ({ task: t, visits: visits.get(t.id) ?? [], rec: latest.get(t.id) ?? null }));
  if (!milestones.length) return null;
  const reached = milestones.filter((m) => m.rec && evidenceStatus(m.rec.evidence) === 'pass').length;
  const landed = milestones.filter((m) => m.task.state === 'done');
  const rerun = async (taskId: string) => {
    setErr(null);
    setAsked((a) => new Set([...a, ...(taskId === FINAL_WALK ? landed.map((m) => m.task.id) : [taskId])]));
    try {
      await api.rerunMilestone(g.id, taskId);
    } catch (e: any) {
      setErr(e.body?.error ?? e.message);
    } finally {
      // the goal's own list says what still runs from here on
      setTimeout(() => setAsked(new Set()), 4000);
    }
  };
  const finalRunning = runs.has(FINAL_WALK);
  return (
    <Card
      // the count turns green once every milestone was shown
      title={
        <>
          Milestones (<span className={cn(reached === milestones.length && 'text-ok-ink')}>{reached}/{milestones.length} shown</span>)
        </>
      }
      actions={
        landed.length > 0 && (
          <Button size="sm" variant="info" disabled={landed.every((m) => runs.has(m.task.id))} onClick={() => void rerun(FINAL_WALK)} title="Record every milestone that landed again: scripts run, walkthroughs replay, milestones of files collect their files again">
            <RotateCcw size={12} /> Rerun all
          </Button>
        )
      }
    >
      {err && <div className="mb-2 text-[11px] text-bad-ink">{err}</div>}
      {(finalWalk || finalRunning) && (
        // what it says wraps under the name on a narrow screen rather than being cut
        <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-line bg-sunken px-3 py-2 text-xs">
          <span className="font-bold text-ink">Final walkthrough</span>
          <StatusChip status={finalRunning ? 'running' : finalWalk!.passed ? 'pass' : 'fail'} />
          <span className="min-w-0 text-[11px] text-ink-faint">
            {finalRunning ? 'every feature’s script runs once more on the finished branch' : finalWalk!.passed ? `every script passed · ${ago(finalWalk!.at)}` : `${finalWalk!.failed.length} script${finalWalk!.failed.length > 1 ? 's' : ''} failed · ${ago(finalWalk!.at)}`}
          </span>
        </div>
      )}
      <ul className="text-xs divide-y divide-line">
        {milestones.map(({ task, visits: vs, rec }) => {
          const last = vs.at(-1);
          const expanded = open.has(task.id);
          const running = runs.has(task.id);
          const files = showsFiles(task);
          const status = running ? 'running' : rec ? evidenceStatus(rec.evidence) : 'none';
          // the goal is paused at this milestone right now: the look waits for you
          const waiting = g.state === 'awaiting_feedback' && g.checkpoint?.taskId === task.id;
          return (
            <li key={task.id} className="py-2.5 first:pt-0 last:pb-0">
              {/* on a phone the row keeps the whole width and Rerun goes under it, in line with its words */}
              <div className="flex flex-wrap items-start gap-x-2 gap-y-1.5">
                <button type="button" disabled={!rec} onClick={() => toggle(task.id)} className="group min-w-0 grow basis-full sm:basis-0 flex items-start gap-2 text-left" aria-expanded={rec ? expanded : undefined}>
                  {/* the look that waits for you now in yellow, a past one in ink, a milestone it went past quiet, one not reached yet faint */}
                  <span className="mt-0.5 shrink-0">{!last ? <Eye size={13} className="text-ink-faint" /> : last.paused ? <Eye size={13} className={waiting ? 'text-you-ink' : 'text-ink'} /> : <FastForward size={13} className="text-ink-soft" />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[13px] font-bold text-ink group-enabled:group-hover:underline underline-offset-[3px]">{task.title}</span>
                      <StatusChip status={status} files={files} />
                      {rec && <LikenessChip look={likenessOf(d, task.id, rec.at)} />}
                    </span>
                    {/* whole on a phone (no pointer to hover for the rest), one line beside Rerun on a wider screen */}
                    <span className="block text-ink-soft sm:truncate" title={task.milestone ?? undefined}>{task.milestone}</span>
                    <span className="block text-[11px] text-ink-faint">
                      {!last ? (task.state === 'done' ? 'landed' : 'not reached yet') : `${ago(last.at)} · ${last.paused ? (last.recheck ? 'second look' : 'paused for a look') : task.milestoneScript ? 'recorded, the goal went on' : 'went on (Have a look off)'}`}
                      {rec && rec.at !== last?.at && <span> · {files ? 'collected' : 'recorded'} {ago(rec.at)}{rec.evidence.final ? ' (final walkthrough)' : ''}</span>}
                      {last?.outcome?.action === 'continue' && <span className="inline-flex items-center gap-0.5 text-ok-ink"> · <CheckCircle2 size={10} /> continued</span>}
                      {last?.outcome?.action === 'feedback' && <span className="inline-flex items-center gap-0.5 text-work-ink"> · <MessageSquare size={10} /> feedback: {last.outcome.feedback?.slice(0, 80)}</span>}
                    </span>
                  </span>
                  {rec && <ChevronRight size={13} className={cn('mt-0.5 shrink-0 text-ink-faint transition-transform', expanded && 'rotate-90')} />}
                </button>
                {task.state === 'done' && (
                  <Button size="sm" variant="info" className="shrink-0 ml-5 sm:ml-0" disabled={running} onClick={() => void rerun(task.id)} title={task.milestoneScript ? `Run ${task.milestoneScript} again and record what it shows` : files ? "Show the task's files again (snapshots, images, video)" : 'Replay the walkthrough recorded last time in the preview'}>
                    <RotateCcw size={12} /> Rerun
                  </Button>
                )}
              </div>
              {expanded && rec && (
                <div className="mt-2 ml-5 space-y-2">
                  <EvidenceView key={rec.at} goalId={g.id} evidence={rec.evidence} taskId={task.id} />
                  <LikenessView goalId={g.id} look={likenessOf(d, task.id, rec.at)} subjects={d.brief?.brief.subjects ?? []} running={(d.likenessRuns ?? []).includes(task.id)} fixTitle={d.tasks.find((t) => t.id === likenessOf(d, task.id, rec.at)?.fixTaskId)?.title ?? null} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
