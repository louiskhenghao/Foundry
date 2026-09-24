/**
 * Regenerate the reference pages that are derived from code:
 *   docs/operate/configuration.md  ← packages/engine/src/docs/settings-reference.ts + the settings schema
 *   docs/operate/cli.md            ← apps/cli/src/help.ts
 * reference.test.ts fails when either file is out of date. Run: bun scripts/gen-docs.ts
 */
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { help } from '../apps/cli/src/help.ts';
import { renderCliReference, renderConfigurationReference } from '../packages/engine/src/docs/settings-reference.ts';

const root = resolve(import.meta.dir, '..');
writeFileSync(join(root, 'docs/operate/configuration.md'), renderConfigurationReference());
writeFileSync(join(root, 'docs/operate/cli.md'), renderCliReference(help));
console.log('wrote docs/operate/configuration.md and docs/operate/cli.md');
