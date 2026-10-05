import type { GoalDetail } from '../../api.ts';
import { Card } from '../../ui.tsx';

/** groups by what a skill is about, matched on its name in this order (the first that matches wins) */
const GROUPS: [string, RegExp][] = [
  ['Testing', /test|vitest|jest|playwright|cypress|e2e/],
  ['Database', /prisma|postgres|mysql|sqlite|drizzle|mongo|redis|supabase|database|\bsql|orm/],
  ['Backend', /nest|node|express|fastify|hono|backend|api|graphql|trpc|server|django|flask|fastapi|rails|laravel|spring|go-|golang|rust/],
  ['Frontend', /react|next|vue|nuxt|svelte|angular|astro|remix|expo|tailwind|css|frontend|design|accessibility|a11y|seo|composition|ui\b|shadcn|web/],
  ['Tooling', /turbo|typescript|zod|eslint|biome|vite|webpack|docker|monorepo|pnpm|bun|deno|ci\b|git/],
];

/** the order the groups are shown in */
const SHOWN = ['Frontend', 'Backend', 'Database', 'Testing', 'Tooling', 'Other'];

function group(skills: string[]): [string, string[]][] {
  const out = new Map<string, string[]>();
  for (const s of skills) {
    const name = GROUPS.find(([, re]) => re.test(s))?.[0] ?? 'Other';
    out.set(name, [...(out.get(name) ?? []), s]);
  }
  return SHOWN.filter((n) => out.has(n)).map((n) => [n, out.get(n)!.sort()]);
}

/** The project skills autoskills matched to the repository's stack, grouped by what they cover. */
export function ProjectSkillsCard({ d }: { d: GoalDetail }) {
  const a = d.goal.autoskills;
  if (!a) return null;
  const dir = d.goal.provider === 'codex' ? '.agents/skills' : '.claude/skills';
  const installed = a.status === 'installed';
  return (
    <Card title={installed ? `Project skills · ${a.skills.length}` : 'Project skills'} actions={<span className="text-[11px] text-zinc-500">autoskills</span>}>
      {installed ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
          {group(a.skills).map(([name, list]) => (
            <div key={name} className="contents">
              <dt className="text-[11px] text-zinc-500 pt-0.5">{name}</dt>
              <dd className="flex flex-wrap gap-1">
                {list.map((s) => (
                  <span key={s} className="mono rounded border border-zinc-700 bg-zinc-900 px-1.5 py-px text-[11px] text-zinc-200" title={`/${s}`}>
                    {s}
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="text-xs text-zinc-400">
          <span className={a.status === 'failed' ? 'text-rose-300' : 'text-zinc-300'}>{a.status}</span> — {a.detail}
        </div>
      )}
      <p className="text-[11px] text-zinc-500 mt-3">
        Matched to this repository's stack and loaded in every worker session. Kept in <span className="mono">{dir}</span> of the goal folder and git-excluded, so they never reach a commit or pull request.
      </p>
    </Card>
  );
}
