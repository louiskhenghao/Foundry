import { agentsFolder } from '@foundry/core/browser';
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
  const dir = `${agentsFolder(d.goal.provider)}/skills`;
  const installed = a.status === 'installed';
  return (
    <Card title={installed ? `Project skills · ${a.skills.length}` : 'Project skills'} actions={<span className="mono text-[11px] text-ink-faint">autoskills</span>}>
      {installed ? (
        // per group, its name in small capitals and its skills as quiet plates
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-xs">
          {group(a.skills).map(([name, list]) => (
            <div key={name} className="contents">
              <dt className="text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-ink-faint pt-1">{name}</dt>
              <dd className="flex flex-wrap gap-1">
                {list.map((s) => (
                  <span key={s} className="mono rounded-sm bg-sunken px-1.5 py-px text-[11px] text-ink ring-1 ring-inset ring-line" title={`/${s}`}>
                    {s}
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="text-xs text-ink-soft">
          <span className={a.status === 'failed' ? 'font-semibold text-bad-ink' : 'font-semibold text-ink'}>{a.status}</span> — {a.detail}
        </div>
      )}
      <p className="text-[11px] text-ink-faint mt-3">
        Matched to this repository's stack and loaded in every worker session. Kept in <span className="mono">{dir}</span> of the goal folder and git-excluded, so they never reach a commit or pull request.
      </p>
    </Card>
  );
}
