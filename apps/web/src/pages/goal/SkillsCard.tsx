import { agentsFolder } from '@foundry/core/browser';
import type { GoalSkillMandate } from '@foundry/core/browser';
import type { GoalSkillView } from '@foundry/engine/skills-types';
import type { GoalDetail } from '../../api.ts';
import { SkillChip } from '../../components/SkillMd.tsx';
import { CODES, Card, cn } from '../../ui.tsx';

/** the card's groups, in order: how a session was told about the skill */
const GROUPS: { name: string; mandates: GoalSkillMandate[]; code: (typeof CODES)[number] | null }[] = [
  { name: 'Workflow', mandates: ['must', 'prefer'], code: CODES[0] },
  { name: 'Project', mandates: ['project'], code: CODES[2] },
  { name: 'Available', mandates: ['available'], code: CODES[6] },
  { name: 'Also invoked', mandates: ['invoked'], code: null },
];

/**
 * Every skill the goal's sessions were given or invoked (ADR-0098), by how they were told: the workflow suite's rules
 * (MUST ones marked), the project skills autoskills matched to the repository, the installed skills listed as relevant,
 * and the ones a session chose itself. A count after a skill is how many sessions invoked it; click one to read its
 * SKILL.md as the goal saw it.
 */
export function SkillsCard({ d }: { d: GoalDetail }) {
  const v = d.skills;
  const a = d.goal.autoskills;
  const skills: GoalSkillView[] = v?.skills ?? [];
  if (!skills.length && !a) return null;
  const observable = v?.observable ?? ((d.goal.provider ?? 'claude') === 'claude');
  const dir = `${agentsFolder(d.goal.provider)}/skills`;
  const groups = GROUPS.map((g) => ({ ...g, list: skills.filter((s) => g.mandates.includes(s.mandate)) })).filter((g) => g.list.length);
  const invoked = observable ? skills.filter((s) => s.used).length : 0;
  return (
    <Card title={skills.length ? `Skills · ${skills.length}` : 'Skills'} actions={observable && skills.length ? <span className="text-[11px] text-ink-faint">{invoked ? `${invoked} invoked` : 'none invoked yet'}</span> : null}>
      {groups.length ? (
        // per group, its name in small capitals after a square in its colour, and its skills as quiet plates; on a phone
        // the name sits over its skills
        <dl className="grid grid-cols-1 sm:grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 sm:gap-y-2.5 text-xs">
          {groups.map((g, i) => (
            <div key={g.name} className="contents">
              <dt className={cn('flex items-center gap-1.5 self-start text-[11px] font-extrabold uppercase tracking-[0.08em] sm:pt-1', i > 0 && 'mt-2 sm:mt-0', g.code?.ink ?? 'text-ink-faint')}>
                <i className={cn('block h-2 w-2 shrink-0 rounded-[2px]', g.code?.dot ?? 'bg-line-strong')} aria-hidden="true" />
                {g.name}
              </dt>
              <dd className="flex flex-wrap gap-1">
                {g.list.map((s) => (
                  <SkillChip key={s.invoke} goalId={d.goal.id} skill={s} observable={observable} />
                ))}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {a && a.status !== 'installed' && (
        <div className={cn('text-xs text-ink-soft', groups.length > 0 && 'mt-3')}>
          Project skills: <span className={a.status === 'failed' ? 'font-semibold text-bad-ink' : 'font-semibold text-ink'}>{a.status}</span> — {a.detail}
        </div>
      )}
      <p className="text-[11px] text-ink-faint mt-3">
        What the goal's sessions were told about, as each SKILL.md read then; click one to read it.{' '}
        {observable ? 'A number after a skill is how many sessions invoked it.' : 'This coding agent reports no invocations.'} Project skills are matched to the repository's stack, kept in <span className="mono">{dir}</span> of the goal folder and git-excluded, so they never reach a commit or pull request.
      </p>
    </Card>
  );
}
