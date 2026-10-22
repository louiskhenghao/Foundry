import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOG } from '../../../scripts/credits/catalog.ts';
import { CREDITS_JSON, NOTICES_TXT, ROOT, catalogProjects, collectCredits, dockerfileInstalls, productionPackages, readLock, renderCreditsJson, renderNotices } from '../../../scripts/credits/credits.ts';
import { EXCLUDED_INSTALLS, TOOLS } from '../../../scripts/credits/tools.ts';
import { FEATURED, resolveFeatured } from '../src/pages/credits/featured.ts';
import type { Credits } from '../src/pages/credits/types.ts';

const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const committed = JSON.parse(read(CREDITS_JSON)) as Credits;

describe('Open source credits', () => {
  test('the notices list exactly what bun install --production puts in the image (run `bun scripts/gen-credits.ts`)', () => {
    expect(committed.packages.map((p) => `${p.name}@${p.version}`)).toEqual(productionPackages(readLock()));
  });

  test('credits.json and THIRD-PARTY-NOTICES.txt are up to date (run `bun install --frozen-lockfile`, then `bun scripts/gen-credits.ts`)', () => {
    const credits = collectCredits();
    expect(read(CREDITS_JSON)).toBe(renderCreditsJson(credits));
    expect(read(NOTICES_TXT)).toBe(renderNotices(credits));
  });

  test('everything the Dockerfile installs is credited in scripts/credits/tools.ts or excluded with a reason, and nothing credited is gone', () => {
    const installs = dockerfileInstalls(read('Dockerfile'));
    const claimed = TOOLS.flatMap((t) => t.installs);
    expect(installs.filter((k) => !claimed.includes(k) && !EXCLUDED_INSTALLS[k])).toEqual([]);
    expect([...claimed, ...Object.keys(EXCLUDED_INSTALLS)].filter((k) => !installs.includes(k))).toEqual([]);
  });

  test('the Dockerfile reading finds each kind of install', () => {
    const dockerfile = ['FROM node:22-bookworm-slim AS base', 'RUN apt-get update \\', ' && apt-get install -y --no-install-recommends git curl \\', ' && rm -rf /var/lib/apt/lists/*', 'FROM base AS runtime', '# RUN npm install -g ignored', 'COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv', "RUN uv tool install --python 3.12 'markitdown[all]' && markitdown --version", 'RUN npm install -g bun@${BUN_VERSION} @openai/codex@1.0 && npm cache clean --force', 'COPY --from=base /app /app'].join('\n');
    expect(dockerfileInstalls(dockerfile)).toEqual(['apt:curl', 'apt:git', 'image:ghcr.io/astral-sh/uv', 'image:node', 'npm:@openai/codex', 'npm:bun', 'python:3.12', 'uv:markitdown']);
  });

  test('every project the Extensions catalog draws on is credited or excluded in scripts/credits/catalog.ts, and nothing named there is gone', () => {
    const projects = [...catalogProjects().keys()];
    expect(projects.filter((p) => !CATALOG[p])).toEqual([]);
    expect(Object.keys(CATALOG).filter((p) => !projects.includes(p))).toEqual([]);
  });

  test("every featured card resolves to a package, tool or catalog project in the credits", () => {
    const items = FEATURED.flatMap((g) => g.items);
    expect(items.filter((f) => !resolveFeatured(f, committed)).map((f) => f.name)).toEqual([]);
    // a featured catalog project is not listed twice
    const featuredProjects = items.flatMap((f) => ('ref' in f && 'catalog' in f.ref ? [f.ref.catalog] : []));
    expect(committed.catalog.filter((p) => p.featured).map((p) => p.project).sort()).toEqual(expect.arrayContaining(featuredProjects));
  });
});
