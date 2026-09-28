import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * mmx, MiniMax's CLI, reads its key only from `<MMX_CONFIG_DIR or ~/.mmx>/config.json` when it runs non-interactively, as
 * it does inside a session: MINIMAX_API_KEY alone is ignored there. A key from Settings (or the engine's environment) is
 * therefore written to a config directory of Foundry's own, which sessions are pointed at through MMX_CONFIG_DIR.
 */
export const mmxConfigDir = (dataDir: string) => join(dataDir, 'mmx');

/** Write (or, with no key, remove) Foundry's mmx config. Never throws: a failure only means sessions fall back to ~/.mmx. */
export function writeMmxConfig(dataDir: string, key: string | undefined, log: (msg: string) => void): void {
  const file = join(mmxConfigDir(dataDir), 'config.json');
  try {
    if (!key) {
      rmSync(file, { force: true });
      return;
    }
    mkdirSync(mmxConfigDir(dataDir), { recursive: true, mode: 0o700 });
    writeFileSync(file, `${JSON.stringify({ api_key: key }, null, 2)}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
  } catch (e) {
    log(`[mmx] could not write ${file}: ${(e as Error).message}`);
  }
}

/** Has the user signed in to mmx themselves (`mmx auth login`)? Reads the config file; no process, no network. */
export function mmxSignedIn(dir = process.env.MMX_CONFIG_DIR ?? join(homedir(), '.mmx')): boolean {
  const file = join(dir, 'config.json');
  if (!existsSync(file)) return false;
  try {
    const c = JSON.parse(readFileSync(file, 'utf8'));
    return typeof c?.api_key === 'string' || !!c?.oauth;
  } catch {
    return false;
  }
}
