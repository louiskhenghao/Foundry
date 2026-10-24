import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** where the Playwright package the engine imports lives, or null when it cannot be resolved */
export const PLAYWRIGHT_PACKAGE_DIR: string | null = (() => {
  try {
    return dirname(fileURLToPath(import.meta.resolve('playwright/package.json')));
  } catch {
    return null;
  }
})();

/**
 * The environment entry that hands a process the engine's Playwright (ADR-0076): sessions get it, and so do command
 * checks, since a check that renders a film (`render.mjs --hash`) runs the same script the worker ran.
 */
export const playwrightEnv = (): Record<string, string> => (PLAYWRIGHT_PACKAGE_DIR ? { FOUNDRY_PLAYWRIGHT: PLAYWRIGHT_PACKAGE_DIR } : {});
