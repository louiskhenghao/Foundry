/**
 * What `foundry serve` does differently when it runs inside the macOS app's menu bar shell (ADR-0105), and what a release
 * install does about its port.
 *
 * The shell starts it with the PATH a terminal has (the login shell's, resolved by the shell: Bun looks commands up in
 * the PATH its process started with and ignores later changes, so the engine cannot fix its own). It writes where it
 * listens to ~/.foundry/app.json, which the shell reads to open the page and poll the status, and it stops when the
 * shell is gone: its stdin is a pipe the shell holds, and the pipe closing is the shell's end, however it ended.
 */
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readHomeConfig, writeHomeConfig } from './data-dir.ts';

/** the file in ~/.foundry the menu bar shell reads: where the engine it started listens, and its data folder */
export const APP_STATE_FILE = 'app.json';

export interface AppState {
  pid: number;
  port: number;
  url: string;
  dataDir: string;
  version: string;
  startedAt: string;
}

/** nothing listens on this port on the loopback: a server may take it */
export function isPortFree(port: number, host = '127.0.0.1'): boolean {
  try {
    const s = Bun.serve({ port, hostname: host, fetch: () => new Response('') });
    s.stop(true);
    return true;
  } catch {
    return false;
  }
}

/**
 * The port a release install serves on when nothing names one: the one it used before (kept in ~/.foundry/config.json),
 * else 4111 or the next free one, written there so the page keeps its address across starts.
 */
export function choosePort(opts: { home: string; free?: (port: number) => boolean; from?: number; log?: (m: string) => void }): number {
  const free = opts.free ?? ((p: number) => isPortFree(p));
  const config = readHomeConfig(opts.home, opts.log);
  const kept = typeof config.port === 'number' ? config.port : null;
  if (kept && free(kept)) return kept;
  let port = opts.from ?? 4111;
  while (!free(port) && port < 65535) port++;
  if (kept) opts.log?.(`[app] port ${kept} is taken; Foundry uses ${port} from now on`);
  writeHomeConfig(opts.home, { ...config, port });
  return port;
}

/** a port named some other way (FOUNDRY_PORT from the installer's service), kept where the CLI looks */
export function keepPort(home: string, port: number, log?: (m: string) => void): void {
  if (!Number.isInteger(port) || port <= 0) return;
  const config = readHomeConfig(home, log);
  if (config.port !== port) writeHomeConfig(home, { ...config, port });
}

/** where the engine listens, for the menu bar shell; written each time the server listens (a data-folder switch moves it) */
export function writeAppState(home: string, state: AppState): void {
  mkdirSync(home, { recursive: true });
  const file = join(home, APP_STATE_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
  renameSync(tmp, file);
}

/** call `onGone` when stdin reaches its end: under the shell, stdin is a pipe only the shell holds */
export function watchParentPipe(onGone: () => void, stream: ReadableStream<Uint8Array> = Bun.stdin.stream()): void {
  void (async () => {
    try {
      const reader = stream.getReader();
      for (;;) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch {}
    onGone();
  })();
}
