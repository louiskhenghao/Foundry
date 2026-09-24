import type { Brief } from '@foundry/core/browser';
import { Plus } from 'lucide-react';
import { Badge, Button, Card, Menu, MenuItem, cn } from '../../ui.tsx';
import { CheckRow } from './CheckRow.tsx';
import { areaStyle, newCheck } from './shared.ts';
import { HelpLink } from '../HelpPage.tsx';

/** Goal-level checks: run on the merged result at goal review. Task-level checks live in their task cards. */
export function GoalAcceptanceCard({ brief, editable, edit }: { brief: Brief; editable: boolean; edit: (fn: (b: Brief) => Brief) => void }) {
  const goalChecks = brief.checks.filter((c) => !c.taskKey);
  const taskChecks = brief.checks.length - goalChecks.length;
  const groups: { key: string | null; name: string }[] = brief.areas.length > 1 ? [{ key: null, name: 'Whole goal' }, ...brief.areas.map((a) => ({ key: a.key, name: a.name }))] : [{ key: null, name: '' }];
  const inGroup = (key: string | null) => goalChecks.filter((c) => (brief.areas.length > 1 ? (c.areaKey ?? null) === key : true));
  const add = (type: 'command' | 'reviewer', areaKey: string | null) => edit((b) => ({ ...b, checks: [...b.checks, newCheck(b, type, null, areaKey)] }));
  return (
    <Card
      title={<>{`Goal acceptance (${goalChecks.length})`}<HelpLink to="approving-the-brief#goal-acceptance" className="ml-1.5" /></>}
      actions={
        editable && (
          <Menu
            trigger={({ toggle }) => (
              <Button size="sm" onClick={toggle}>
                <Plus size={13} /> Add check
              </Button>
            )}
          >
            {(close) => (
              <>
                <MenuItem onClick={() => { add('command', null); close(); }}>Command — a shell command must exit 0</MenuItem>
                <MenuItem onClick={() => { add('reviewer', null); close(); }}>Reviewer — Claude judges the whole diff against a rubric</MenuItem>
              </>
            )}
          </Menu>
        )
      }
    >
      <p className="text-xs text-zinc-500 mb-3">
        Verified on the merged result once every task is done. <Badge state="must" /> all pass → <b>done</b>; <Badge state="stretch" /> also pass → <b>over-delivered</b>. Per-task checks ({taskChecks}) are inside the task cards; a task check can be moved here and vice versa.
      </p>
      {goalChecks.length === 0 && <div className="text-xs text-zinc-500">No goal-level checks — the goal will be judged only by its tasks' checks and the Goal reviewer.</div>}
      <div className="space-y-3">
        {groups.map((g) => {
          const xs = inGroup(g.key);
          if (!xs.length && g.key !== null) return null;
          return (
            <div key={g.key ?? '_'}>
              {g.name && (
                <div className="flex items-center gap-2 mb-1.5">
                  {g.key && <span className="w-2 h-2 rounded-full" style={{ background: areaStyle(brief, g.key).dot }} />}
                  <span className={cn('text-[11px] uppercase tracking-wide', g.key ? 'text-zinc-300' : 'text-zinc-500')}>{g.name}</span>
                </div>
              )}
              <div className="space-y-1.5">
                {xs.map((c) => (
                  <CheckRow key={c.key} check={c} brief={brief} editable={editable} context="goal" onChange={(nc) => edit((b) => ({ ...b, checks: b.checks.map((x) => (x.key === c.key ? nc : x)) }))} onRemove={() => edit((b) => ({ ...b, checks: b.checks.filter((x) => x.key !== c.key) }))} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
