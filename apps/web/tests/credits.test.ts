import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOG } from '../../../scripts/credits/catalog.ts';
import { CREDITS_JSON, NOTICES_TXT, ROOT, catalogProjects, collectCredits, productionPackages, readLock, renderCreditsJson, renderNotices } from '../../../scripts/credits/credits.ts';
import { SETUP_NOT_CREDITED, TOOLS } from '../../../scripts/credits/tools.ts';
import { TOOL_IDS } from '../../../packages/engine/src/tools/installers.ts';
import { OPTIONAL_TOOLS } from '../../../packages/engine/src/tools/setup.ts';
import { HINDSIGHT_VERSION } from '../../../packages/engine/src/memory/server.ts';
import { FEATURED, resolveFeatured } from '../src/pages/credits/featured.ts';
import type { Credits } from '../src/pages/credits/types.ts';

const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const committed = JSON.parse(read(CREDITS_JSON)) as Credits;

describe('Open source credits', () => {
  test('the notices list exactly what bun install --production puts in the release (run `bun scripts/gen-credits.ts`)', () => {
    expect(committed.packages.map((p) => `${p.name}@${p.version}`)).toEqual(productionPackages(readLock()));
  });

  test('credits.json and THIRD-PARTY-NOTICES.txt are up to date (run `bun install --frozen-lockfile`, then `bun scripts/gen-credits.ts`)', () => {
    const credits = collectCredits();
    expect(read(CREDITS_JSON)).toBe(renderCreditsJson(credits));
    expect(read(NOTICES_TXT)).toBe(renderNotices(credits));
  });

  test('everything foundry setup installs is credited in scripts/credits/tools.ts or left out with a reason, and nothing credited is gone (ADR-0108)', () => {
    // the coding agents' CLIs, graphify, and the Python uv installs for graphify and MarkItDown come with foundry setup too
    const setup = [...new Set([...TOOL_IDS, ...OPTIONAL_TOOLS, 'claude', 'codex', 'agy', 'graphify', 'python'])];
    const credited = TOOLS.filter((t) => t.ships === 'setup').map((t) => t.id);
    expect(setup.filter((id) => !credited.includes(id) && !SETUP_NOT_CREDITED[id])).toEqual([]);
    expect([...credited, ...Object.keys(SETUP_NOT_CREDITED)].filter((id) => !setup.includes(id))).toEqual([]);
    // the release itself ships the runtime compiled into foundry, and nothing of the image any more
    expect(TOOLS.filter((t) => t.ships === 'release').map((t) => t.id)).toEqual(['bun']);
    // Memory's own server (ADR-0109): credited at the version Foundry installs
    expect(TOOLS.filter((t) => t.ships === 'memory').map((t) => [t.id, t.version])).toEqual([['hindsight', HINDSIGHT_VERSION]]);
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
