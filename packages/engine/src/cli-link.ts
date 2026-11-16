/**
 * `foundry` in a terminal (ADR-0102): a link in ~/.local/bin to the compiled foundry, so `foundry ask`, `foundry usage`
 * and the rest work from a shell. The installer writes a small script there instead, which runs its own commands (start,
 * stop, logs, update…) and hands everything else to the same binary; a script of the installer's is left as it is.
 * Never /usr/local/bin: nothing here asks for a password.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';

/** the line the installer's `foundry` script carries */
export const INSTALLER_COMMAND_MARK = "Foundry's own command (written by its installer)";

export interface CliLinkState {
  /** ~/.local/bin/foundry */
  path: string;
  target: string;
  state: 'linked' | 'installer' | 'missing' | 'elsewhere' | 'other';
  /** ~/.local/bin is on the PATH this process has (the login shell's, under the app) */
  onPath: boolean;
  detail: string;
}

export function cliLinkState(opts: { target: string; home: string; path?: string }): CliLinkState {
  const dir = join(opts.home, '.local', 'bin');
  const link = join(dir, 'foundry');
  const onPath = (opts.path ?? process.env.PATH ?? '').split(delimiter).includes(dir);
  // both sides resolved: /var is /private/var on macOS, and the app may sit behind a link of its own
  const real = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  const target = real(opts.target);
  const base = { path: link, target, onPath };
  let st: import('node:fs').Stats | null = null;
  try {
    st = lstatSync(link);
  } catch {}
  if (!st) return { ...base, state: 'missing', detail: `${link} is not there` };
  if (st.isSymbolicLink()) {
    let to = readlinkSync(link);
    try {
      to = realpathSync(link);
    } catch {}
    return to === target ? { ...base, state: 'linked', detail: `${link} → ${target}` } : { ...base, state: 'elsewhere', detail: `${link} points at ${to}` };
  }
  try {
    if (st.isFile() && readFileSync(link, 'utf8').includes(INSTALLER_COMMAND_MARK)) return { ...base, state: 'installer', detail: `${link} is the installer's command` };
  } catch {}
  return { ...base, state: 'other', detail: `${link} is a file Foundry did not write` };
}

/** link ~/.local/bin/foundry to the compiled foundry; an old link is replaced, the installer's script or a stranger's file stays */
export function linkCli(opts: { target: string; home: string; path?: string }): CliLinkState & { changed: boolean } {
  const now = cliLinkState(opts);
  if (now.state === 'linked' || now.state === 'installer') return { ...now, changed: false };
  if (now.state === 'other') throw new Error(`${now.path} is a file Foundry did not write: move it away first`);
  mkdirSync(join(opts.home, '.local', 'bin'), { recursive: true });
  if (now.state === 'elsewhere') rmSync(now.path, { force: true });
  symlinkSync(now.target, now.path);
  return { ...cliLinkState(opts), changed: true };
}

/** the line that puts ~/.local/bin on PATH for the person's shell */
export function pathHint(shell = process.env.SHELL ?? ''): { file: string; line: string } {
  if (shell.endsWith('fish')) return { file: '~/.config/fish/conf.d/foundry.fish', line: 'fish_add_path ~/.local/bin' };
  if (shell.endsWith('bash')) return { file: process.platform === 'darwin' ? '~/.bash_profile' : '~/.bashrc', line: 'export PATH="$HOME/.local/bin:$PATH"' };
  return { file: '~/.zshrc', line: 'export PATH="$HOME/.local/bin:$PATH"' };
}

export const cliLinkExists = (home: string) => existsSync(join(home, '.local', 'bin', 'foundry'));
