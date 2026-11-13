import type { GoalSkillMandate, GoalSkillSource } from '@foundry/core/browser';
import type { GoalSkillView, SkillSnapshotView } from '@foundry/engine/skills-types';
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { Loading, Modal, ago, chipClass, cn } from '../ui.tsx';
import { MarkdownPanel } from './Markdown.tsx';

/**
 * A SKILL.md as a reader sees it: its frontmatter as rows of fields, then the body as Markdown. The Extensions page shows
 * an installed skill this way; a goal's Skills window shows the copy its sessions saw (ADR-0098).
 */
export function SkillMdView({ source, title = 'SKILL.md', maxHeight = 520 }: { source: string; title?: string; maxHeight?: number | string }) {
  const m = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const fm = m ? m[1]! : null;
  const body = m ? source.slice(m[0].length) : source;
  return (
    <>
      {fm && (
        <div className="rounded-md border border-line bg-sunken p-2.5 text-xs space-y-0.5">
          {fm.split('\n').map((line, i) => {
            const k = line.match(/^([\w-]+):\s*(.*)$/);
            return k ? (
              <div key={i} className="flex gap-2">
                <span className="mono text-ink-faint w-28 shrink-0">{k[1]}</span>
                <span className="text-ink break-words min-w-0">{k[2]}</span>
              </div>
            ) : (
              <div key={i} className="text-ink-soft pl-30 break-words">
                {line}
              </div>
            );
          })}
        </div>
      )}
      <MarkdownPanel title={title} source={body} maxHeight={maxHeight} />
    </>
  );
}

/** how a session was told about a skill, as the card and the window say it */
export const MANDATE_LABEL: Record<GoalSkillMandate, string> = { must: 'MUST', prefer: 'Prefer', available: 'Available', project: 'Project', invoked: 'Invoked' };
/** how the skill reached this machine */
export const SOURCE_LABEL: Record<GoalSkillSource, string> = {
  foundry: 'installed by Foundry',
  plugin: 'a plugin',
  suite: 'a workflow suite',
  bundled: 'bundled with Foundry',
  project: 'a project skill',
  linked: 'a linked folder',
  hand: 'installed by hand',
  unknown: 'not found on this machine',
};

const bare = (s: string) => s.replace(/^\//, '');
const last = (s: string) => s.split(':').at(-1)!;
/** the goal's skill a name a session used means (`tdd`, `mattpocock-skills:tdd`): the exact one, else a bare name's prefixed copy */
export function findSkill(skills: GoalSkillView[], used: string): GoalSkillView | null {
  return skills.find((s) => bare(s.invoke) === bare(used)) ?? skills.find((s) => last(bare(s.invoke)) === last(bare(used)) && (!used.includes(':') || !s.invoke.includes(':'))) ?? null;
}

/** what a skill's tooltip says: how it is named, where it came from, who was told, how often it was invoked */
export function skillTitle(s: GoalSkillView, observable: boolean): string {
  const parts = [s.invoke, `${MANDATE_LABEL[s.mandate]} · ${SOURCE_LABEL[s.source]}${s.origin ? ` (${s.origin})` : ''}`];
  if (s.roles.length) parts.push(`given to: ${s.roles.join(', ')}`);
  if (s.versions > 1) parts.push(`${s.versions} different versions during this goal`);
  if (observable) parts.push(s.used ? `invoked in ${s.used.sessions} session${s.used.sessions === 1 ? '' : 's'}` : 'never invoked');
  return parts.join('\n');
}

/** one skill of a goal as a quiet plate: its name, MUST when the suite requires it, how many sessions invoked it; click opens the window */
export function SkillChip({ goalId, skill, observable }: { goalId: string; skill: GoalSkillView; observable: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title={skillTitle(skill, observable)} className="mono inline-flex items-center gap-1 rounded-sm bg-sunken px-1.5 py-px text-[11px] text-ink ring-1 ring-inset ring-line hover:ring-line-strong hover:bg-panel">
        {skill.mandate === 'must' && <b className="text-[9px] font-extrabold uppercase tracking-[0.08em] text-bad-ink">must</b>}
        {skill.name}
        {observable && skill.used ? <span className="text-ink-faint">· {skill.used.sessions}</span> : null}
      </button>
      {open && <SkillWindow goalId={goalId} invoke={skill.invoke} onClose={() => setOpen(false)} />}
    </>
  );
}

/** a skill a session invoked, named as the session named it: a plate that opens the window when the goal has its record, plain text otherwise */
export function UsedSkillChip({ goalId, used, skills }: { goalId: string; used: string; skills: GoalSkillView[] }) {
  const [open, setOpen] = useState(false);
  const skill = findSkill(skills, used);
  if (!skill) return <span className="mono">{used}</span>;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title={skillTitle(skill, true)} className="mono rounded-sm bg-sunken px-1.5 py-px text-[11px] text-ink ring-1 ring-inset ring-line hover:ring-line-strong hover:bg-panel">
        {used}
      </button>
      {open && <SkillWindow goalId={goalId} invoke={skill.invoke} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * The window of one skill of a goal (ADR-0098): the SKILL.md as the goal's sessions saw it, and when the installed copy
 * has changed since, **As installed now** beside it. A goal from before the record, or one brought in from another
 * computer without its copies, gets the installed copy with a line saying so.
 */
export function SkillWindow({ goalId, invoke, onClose }: { goalId: string; invoke: string; onClose: () => void }) {
  const [view, setView] = useState<SkillSnapshotView | null | 'loading' | 'missing'>('loading');
  const [which, setWhich] = useState<'then' | 'now'>('then');
  useEffect(() => {
    let live = true;
    setView('loading');
    api
      .goalSkill(goalId, invoke)
      .then((v) => live && setView(v))
      .catch(() => live && setView('missing'));
    return () => {
      live = false;
    };
  }, [goalId, invoke]);
  const v = view !== 'loading' && view !== 'missing' ? view : null;
  const changed = !!(v?.snapshot && v.current && v.snapshot.sha !== v.current.sha);
  const shown = v ? (which === 'then' && v.snapshot ? v.snapshot.content : (v.current?.content ?? v.snapshot?.content ?? null)) : null;
  return (
    <Modal open title={<span className="mono">{invoke}</span>} onClose={onClose} wide>
      {view === 'loading' ? (
        <Loading size="card" label="Reading SKILL.md…" />
      ) : view === 'missing' ? (
        <div className="text-xs text-bad-ink">This goal has no record of {invoke}.</div>
      ) : v ? (
        <div className="space-y-3">
          <div className="text-xs text-ink-soft">
            <span className="font-semibold text-ink">{MANDATE_LABEL[v.skill.mandate]}</span> · {SOURCE_LABEL[v.skill.source]}
            {v.skill.origin ? <span className="mono"> · {v.skill.origin}</span> : null}
            {v.skill.version ? <span className="mono"> · v{v.skill.version}</span> : null}
            {v.skill.roles.length ? <> · given to {v.skill.roles.join(', ')}</> : null}
            {v.skill.used ? <> · invoked in {v.skill.used.sessions} session{v.skill.used.sessions === 1 ? '' : 's'}</> : null}
          </div>
          {v.snapshot ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {changed ? (
                <>
                  <button type="button" className={chipClass(which === 'then')} onClick={() => setWhich('then')}>
                    As the goal saw it
                  </button>
                  <button type="button" className={chipClass(which === 'now')} onClick={() => setWhich('now')}>
                    As installed now
                  </button>
                  <span className="text-ink-faint">The installed copy has changed since this goal read it{v.skill.lastSeenAt ? ` (${ago(v.skill.lastSeenAt)})` : ''}.</span>
                </>
              ) : (
                <span className="text-ink-faint">
                  As the goal saw it{v.skill.lastSeenAt ? `, ${ago(v.skill.lastSeenAt)}` : ''}
                  {v.current ? '; the installed copy is the same.' : v.skill.source === 'project' ? '; the goal folder no longer holds it.' : '; it is no longer installed here.'}
                  {v.skill.versions > 1 ? ` The skill changed ${v.skill.versions - 1} time${v.skill.versions === 2 ? '' : 's'} while the goal ran; this is the latest it saw.` : ''}
                </span>
              )}
            </div>
          ) : (
            <div className={cn('text-xs', v.current ? 'text-ink-faint' : 'text-bad-ink')}>
              {v.current ? 'Foundry kept no copy of what this goal saw (a goal from before the record, or brought in without its copies); this is the copy installed now.' : v.skill.source === 'project' ? 'Foundry kept no copy of what this goal saw, and the goal folder no longer holds it.' : 'Foundry kept no copy of what this goal saw, and the skill is not installed on this machine.'}
            </div>
          )}
          {(which === 'now' && v.current) || (!v.snapshot && v.current) ? <div className="text-[11px] text-ink-faint mono break-all">{v.current.dir}</div> : v.skill.dir ? <div className="text-[11px] text-ink-faint mono break-all">{v.skill.dir}</div> : null}
          {shown !== null && <SkillMdView source={shown} />}
        </div>
      ) : null}
    </Modal>
  );
}
