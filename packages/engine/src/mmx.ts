import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * mmx, MiniMax's CLI, reads its key only from `<MMX_CONFIG_DIR or ~/.mmx>/config.json` when it runs non-interactively, as
 * it does inside a session: MINIMAX_API_KEY alone is ignored there. A key from Settings (or the engine's environment) is
 * therefore written to a config directory of Foundry's own, which sessions are pointed at through MMX_CONFIG_DIR.
 */
export const mmxConfigDir = (dataDir: string) => join(dataDir, 'mmx');

/** the user's own settings worth carrying over into Foundry's config: never their credentials */
const CARRIED = ['proxy', 'default_text_model', 'default_speech_model', 'default_video_model'] as const;

const readConfig = (file: string): Record<string, unknown> | null => {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  } catch {
    return null;
  }
};

/**
 * Keep Foundry's mmx config in step with the key (or remove it when there is none). While the key stays the same the
 * file is left alone, so the region mmx detected and saved there survives restarts; a new key starts a fresh file with
 * the user's own proxy and default models. Never throws. Returns whether sessions can be pointed at the file.
 */
export function writeMmxConfig(dataDir: string, key: string | undefined, log: (msg: string) => void, ownDir = join(homedir(), '.mmx')): boolean {
  const file = join(mmxConfigDir(dataDir), 'config.json');
  try {
    if (!key) {
      rmSync(file, { force: true });
      return false;
    }
    if (readConfig(file)?.api_key === key) {
      chmodSync(file, 0o600);
      return true;
    }
    const own = readConfig(join(ownDir, 'config.json')) ?? {};
    const carried = Object.fromEntries(CARRIED.filter((k) => own[k] !== undefined).map((k) => [k, own[k]]));
    mkdirSync(mmxConfigDir(dataDir), { recursive: true, mode: 0o700 });
    writeFileSync(file, `${JSON.stringify({ ...carried, api_key: key }, null, 2)}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
    return true;
  } catch (e) {
    log(`[mmx] could not write ${file}: ${(e as Error).message} — sessions use ~/.mmx`);
    return false;
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
