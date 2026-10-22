/**
 * Regenerate the open-source credits from bun.lock, node_modules, the Dockerfile and the Extensions catalog:
 *   apps/web/src/pages/credits/credits.json  ← the Open source credits page
 *   THIRD-PARTY-NOTICES.txt                  ← the same notices as plain text, shipped in the image
 * credits.test.ts fails when either is out of date. Run after a dependency, Dockerfile or catalog change (and after
 * bun install --frozen-lockfile, so node_modules matches the lock): bun scripts/gen-credits.ts
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CREDITS_JSON, NOTICES_TXT, ROOT, collectCredits, renderCreditsJson, renderNotices } from './credits/credits.ts';

const credits = collectCredits();
writeFileSync(join(ROOT, CREDITS_JSON), renderCreditsJson(credits));
writeFileSync(join(ROOT, NOTICES_TXT), renderNotices(credits));
console.log(`wrote ${CREDITS_JSON} and ${NOTICES_TXT}: ${credits.packages.length} packages, ${credits.tools.length} tools, ${credits.catalog.length} catalog projects`);
