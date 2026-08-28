import type { Brief, BriefCheck } from '@foundry/core/browser';
import { ArrowUpToLine, Trash2 } from 'lucide-react';
import { Badge, Button, Input, Select, cn } from '../../ui.tsx';
import { assignCheck, checkProblem, convertCheck } from './shared.ts';

/**
 * One acceptance check. `context` decides the re-homing control: inside a task card the check can be
 * promoted to goal level; in the goal card it can be assigned to a task (and, with several Areas, to an Area).
 */
export function CheckRow({ check, brief, editable, context, onChange, onRemove }: { check: BriefCheck; brief: Brief; editable: boolean; context: 'task' | 'goal'; onChange: (c: BriefCheck) => void; onRemove: () => void }) {
  const problem = checkProblem(check);
  return (
    <div className={cn('rounded-md border bg-zinc-950/50 p-2 space-y-1.5', problem && editable ? 'border-rose-500/40' : 'border-zinc-800')}>
      <div className="flex items-center gap-2 flex-wrap">
        <button disabled={!editable} onClick={() => onChange({ ...check, tier: check.tier === 'must' ? 'stretch' : 'must' })} title="Must = what you asked for; Stretch = proposed extra. Click to toggle.">
          <Badge state={check.tier} />
        </button>
        <span className="w-24 shrink-0">
          <Select disabled={!editable} className="text-xs py-1" value={check.spec.type === 'reviewer' ? 'reviewer' : 'command'} onChange={(e) => onChange(convertCheck(check, e.target.value as 'command' | 'reviewer'))} title="Command: a shell command that must exit 0. Reviewer: a Claude session judges the diff against a rubric.">
            <option value="command">Command</option>
            <option value="reviewer">Reviewer</option>
          </Select>
        </span>
        <Input className="flex-1 min-w-[8rem]" disabled={!editable} placeholder="what this check verifies" value={check.name} onChange={(e) => onChange({ ...check, name: e.target.value })} />
        {context === 'goal' && (
          <span className="w-40 shrink-0">
            <Select disabled={!editable} className="text-xs py-1 mono" value={check.taskKey ?? ''} onChange={(e) => onChange(assignCheck(check, e.target.value || null, check.areaKey))} title="Which task must make this pass; blank = verified on the merged goal">
              <option value="">whole goal</option>
              {brief.tasks.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.key} · {t.title || '(untitled)'}
                </option>
              ))}
            </Select>
          </span>
        )}
        {context === 'goal' && !check.taskKey && brief.areas.length > 1 && (
          <span className="w-36 shrink-0">
            <Select disabled={!editable} className="text-xs py-1" value={check.areaKey ?? ''} onChange={(e) => onChange({ ...check, areaKey: e.target.value || null })} title="The Area this check verifies; blank = repo-wide">
              <option value="">all Areas</option>
              {brief.areas.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.name}
                </option>
              ))}
            </Select>
          </span>
        )}
        {editable && context === 'task' && (
          <Button size="sm" variant="ghost" title="Move to goal level: verified on the merged result instead of this task" onClick={() => onChange(assignCheck(check, null, null))}>
            <ArrowUpToLine size={13} />
          </Button>
        )}
        {editable && (
          <Button size="sm" variant="ghost" onClick={onRemove} title="Remove check">
            <Trash2 size={13} />
          </Button>
        )}
      </div>
      {check.spec.type === 'command' ? (
        (() => {
          const spec = check.spec; // narrowed here; the onChange closure would otherwise see the whole union
          return <Input className="mono text-xs" disabled={!editable} placeholder="shell command run from the repo root; exit 0 = pass (e.g. bun test)" value={spec.cmd} onChange={(e) => onChange({ ...check, spec: { ...spec, cmd: e.target.value } })} />;
        })()
      ) : check.spec.type === 'reviewer' ? (
        (() => {
          const spec = check.spec;
          return <Input className="text-xs" disabled={!editable} placeholder="rubric: what the reviewer must verify in the diff" value={spec.rubric} onChange={(e) => onChange({ ...check, spec: { ...spec, rubric: e.target.value } })} />;
        })()
      ) : (
        <div className="text-[11px] text-zinc-500">llm-judge: {check.spec.prompt}</div>
      )}
      {problem && editable && <div className="text-[11px] text-rose-300">{problem}</div>}
    </div>
  );
}
