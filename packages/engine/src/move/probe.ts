/**
 * What a move asks of the computer it runs on (ADR-0107): commands, files, and the pages of other Foundries. One seam,
 * so a test hands in a computer of its own.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface Probe {
  platform: NodeJS.Platform;
  home: string;
  env: NodeJS.ProcessEnv;
  uid: number;
  /** this process and the one that started it: never an earlier install */
  self: number[];
  /** run a command; code 127 when it is not there, 124 when it ran out of time */
  run(argv: string[], opts?: { timeoutMs?: number }): Promise<RunResult>;
  read(path: string): string | null;
  exists(path: string): boolean;
  /** the path with its links resolved, or as given when it is not there */
  real(path: string): string;
  /** a JSON page of another Foundry; null when it does not answer */
  json(url: string, opts?: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number }): Promise<any | null>;
}

export function localProbe(env: NodeJS.ProcessEnv = process.env): Probe {
  return {
    platform: process.platform,
    home: env.HOME || homedir(),
    env,
    uid: process.getuid?.() ?? 501,
    self: [process.pid, process.ppid],
    async run(argv, opts = {}) {
      // a bare name is looked up in this PATH: Bun's own lookup keeps the PATH the process started with
      const exe = argv[0]!.includes('/') ? argv[0]! : Bun.which(argv[0]!, { PATH: env.PATH ?? '' });
      if (!exe) return { code: 127, stdout: '', stderr: `${argv[0]}: not found` };
      try {
        const p = Bun.spawn([exe, ...argv.slice(1)], { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore', env: { ...env } });
        let timedOut = false;
        const timer = opts.timeoutMs ? setTimeout(() => ((timedOut = true), p.kill()), opts.timeoutMs) : null;
        const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
        if (timer) clearTimeout(timer);
        return { code: timedOut ? 124 : code, stdout, stderr };
      } catch (err) {
        return { code: 127, stdout: '', stderr: String((err as Error).message ?? err) };
      }
    },
    read(path) {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
    exists: (path) => existsSync(path),
    real(path) {
      try {
        return realpathSync(path);
      } catch {
        return path;
      }
    },
    async json(url, opts = {}) {
      try {
        const r = await fetch(url, {
          method: opts.method ?? 'GET',
          headers: opts.body === undefined ? undefined : { 'content-type': 'application/json' },
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 3000),
        });
        if (!r.ok) return null;
        return await r.json();
      } catch {
        return null;
      }
    },
  };
}
