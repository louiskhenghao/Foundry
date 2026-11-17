/**
 * `foundry serve` (ADR-0082): the engine and the HTTP server, started again in this same process when asked — on the same
 * data folder (a Setting marked restart) or on another one. Nothing exits, so under `bun --watch`, launchd or Docker the
 * process keeps its port. A switch whose folder cannot boot comes back on the folder before, with a notice for Settings.
 */
import type { AgentProvider } from '@foundry/core';
import { DataFolderInUse, Engine, FolderMoved, MOVED_NOTE, claimDataDir, defaultConfig, finishMove, keepPort, prepareDataDir, readHomeConfig, releaseDataDir, rememberRecent, swapIn, swapOut, writeHomeConfig, type DataDirNotice, type EngineConfig } from '@foundry/engine';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, type ServeOptions } from './index.ts';

type Server = ReturnType<typeof startServer>;

export interface ServeLoopOptions extends ServeOptions {
  root: string;
  /** config overrides every boot gets (tests: provider, homes, port 0, a silent log) */
  config?: Partial<EngineConfig>;
  /** how an engine is made (tests hand in a fake runner, or make one boot fail) */
  makeEngine?: (cfg: EngineConfig) => Engine;
  log?: (m: string) => void;
  /** called each time the server listens, before the engine starts its work */
  onListening?: (engine: Engine, server: Server) => void;
  /** how long the answer to the request that asked for the restart gets to leave (default 250 ms) */
  graceMs?: number;
  /**
   * A release install (ADR-0107): when another Foundry has the folder chosen in Settings open, this one starts on its
   * default folder (with a notice) instead of failing, and the move can then bring it over.
   */
  fallbackDataDir?: (provider: AgentProvider) => string;
  /** who else has a data folder's database open: a Foundry older than 2.36 writes no engine.pid to claim it */
  openedBy?: (dataDir: string) => Promise<string | null>;
}
export interface ServeLoop {
  /** settles when the loop ends (shutdown) or a boot fails with no folder to fall back to */
  done: Promise<void>;
  current(): { engine: Engine; server: Server } | null;
  /** stop the engine and the server for good (SIGINT) */
  shutdown(): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const message = (err: unknown) => String((err as Error)?.message ?? err);

export function serveLoop(opts: ServeLoopOptions): ServeLoop {
  const log = opts.log ?? ((m: string) => console.log(m));
  const make = opts.makeEngine ?? ((cfg: EngineConfig) => new Engine(cfg));
  let current: { engine: Engine; server: Server } | null = null;
  let stopping = false;
  // a switch under way: the folder it left, so a boot that fails goes back there
  let pending: { from: string; to: string; provider: string } | null = null;
  let notice: DataDirNotice | null = null;
  // the folder one boot opens instead of the one chosen (another Foundry has that open)
  let bootDir: string | null = null;
  // a move swapped in: what to take back when its copy cannot boot
  let moved: { staged: { provider: AgentProvider; staging: string; target: string }[]; setAside: string[]; port: string | undefined } | null = null;

  const run = async (): Promise<void> => {
    for (;;) {
      let engine: Engine | undefined;
      let server: Server | undefined;
      let cfg: EngineConfig | undefined;
      let claimed: string | null = null;
      try {
        cfg = defaultConfig(opts.root, bootDir ? { ...opts.config, dataDir: bootDir } : opts.config);
        bootDir = null;
        try {
          // a folder that moved (ADR-0107): its goals run in the copy now, and opening it would run them twice
          if (existsSync(join(cfg.dataDir, MOVED_NOTE))) throw new FolderMoved(cfg.dataDir);
          // one Foundry per data folder (ADR-0105): a folder another live process holds is refused before anything opens it
          claimDataDir(cfg.dataDir, { port: cfg.port });
          const other = await opts.openedBy?.(cfg.dataDir);
          if (other) {
            releaseDataDir(cfg.dataDir);
            throw new DataFolderInUse(cfg.dataDir, { pid: Number(/pid (\d+)/.exec(other)?.[1] ?? 0), port: null, startedAt: '' });
          }
        } catch (err) {
          if ((err instanceof DataFolderInUse || err instanceof FolderMoved) && cfg.dataDirSource === 'config' && opts.fallbackDataDir) {
            const fallback = opts.fallbackDataDir(cfg.provider);
            const holder = err instanceof DataFolderInUse ? `pid ${err.holder.pid}` : 'it moved (its MOVED.md says where)';
            log(`[data-dir] ${cfg.dataDir} cannot be opened here (${holder}); starting on ${fallback}`);
            notice = { kind: 'in-use', chosen: cfg.dataDir, holder, at: new Date().toISOString() };
            bootDir = fallback;
            continue;
          }
          throw err;
        }
        claimed = cfg.dataDir;
        engine = make(cfg);
        server = startServer(engine, { webDist: opts.webDist });
        engine.restart.attached = true;
        engine.dataDirNotice = notice ?? (cfg.dataDirMissing ? { kind: 'missing', chosen: cfg.dataDirMissing, at: new Date().toISOString() } : null);
        notice = null;
        current = { engine, server };
        log(`foundry listening on http://${engine.config.host}:${server.port}  (data: ${engine.config.dataDir})`);
        opts.onListening?.(engine, server);
        await engine.start();
        // a move's copy opened for the first time (ADR-0107): its worktrees linked again, the goals paused for it resumed
        const started = engine;
        await finishMove({ dataDir: started.config.dataDir, resume: (id) => started.resumeGoal(id), log }).catch((err) => log(`[move] finishing the move failed: ${message(err)}`));
        moved = null;
      } catch (err) {
        // half built: the server may listen, the engine may hold the database
        current = null;
        try {
          server?.stop(true);
        } catch {}
        try {
          await engine?.stop();
        } catch {}
        if (claimed) releaseDataDir(claimed);
        if (moved) {
          // the moved copy cannot boot: this install goes back on its own folder, the copy kept beside it
          log(`[move] the moved data could not be opened (${message(err)}); back on this install's own folder`);
          swapOut(moved.staged, moved.setAside);
          if (moved.port === undefined) delete process.env.FOUNDRY_PORT;
          else {
            process.env.FOUNDRY_PORT = moved.port;
            if (cfg?.foundryHome) keepPort(cfg.foundryHome, Number(moved.port));
          }
          notice = { kind: 'move-failed', error: message(err), at: new Date().toISOString() };
          moved = null;
          continue;
        }
        if (pending && cfg?.foundryHome) {
          log(`[data-dir] ${pending.to} could not be opened (${message(err)}); back on ${pending.from}`);
          const home = readHomeConfig(cfg.foundryHome, log);
          writeHomeConfig(cfg.foundryHome, { ...home, dataDirs: { ...home.dataDirs, [pending.provider]: pending.from } });
          notice = { kind: 'fell-back', from: pending.to, to: pending.from, error: message(err), at: new Date().toISOString() };
          pending = null;
          continue;
        }
        throw err;
      }
      pending = null;
      if (stopping) engine.restart.request({ kind: 'exit' });
      const req = await engine.restart.wait();
      if (opts.graceMs !== 0) await sleep(opts.graceMs ?? 250);
      log(req.kind === 'exit' ? '[engine] stopping' : req.kind === 'restart' ? `[engine] restarting: ${req.why}` : req.kind === 'move' ? '[engine] restarting on the moved data' : `[engine] restarting on ${req.to} (${req.mode})`);
      await engine.stop();
      server.stop(true);
      releaseDataDir(cfg.dataDir);
      current = null;
      if (req.kind === 'exit') return;
      if (req.kind === 'move') {
        const before = process.env.FOUNDRY_PORT;
        try {
          const staged = req.staged.map((x) => ({ provider: cfg!.provider, ...x }));
          const setAside = swapIn(staged, log);
          if (req.port) {
            process.env.FOUNDRY_PORT = String(req.port);
            if (cfg.foundryHome) keepPort(cfg.foundryHome, req.port);
          }
          moved = { staged, setAside, port: before };
        } catch (err) {
          log(`[move] the moved data could not be put in place: ${message(err)}; staying on this install's own folder`);
          notice = { kind: 'move-failed', error: message(err), at: new Date().toISOString() };
        }
        continue;
      }
      if (req.kind === 'data-dir') {
        const from = engine.config.dataDir;
        const provider = cfg.provider;
        if (!cfg.foundryHome) {
          notice = { kind: 'switch-failed', to: req.to, error: 'this Foundry keeps no choice of data folder (no FOUNDRY_HOME)', at: new Date().toISOString() };
          continue;
        }
        try {
          await prepareDataDir(from, req.to, req.mode, log);
          const home = readHomeConfig(cfg.foundryHome, log);
          writeHomeConfig(cfg.foundryHome, { ...home, dataDirs: { ...home.dataDirs, [provider]: req.to }, recent: rememberRecent(home.recent, from, req.to) });
          pending = { from, to: req.to, provider };
        } catch (err) {
          log(`[data-dir] the switch to ${req.to} failed: ${message(err)}; staying on ${from}`);
          notice = { kind: 'switch-failed', to: req.to, error: message(err), at: new Date().toISOString() };
        }
      }
    }
  };
  const done = run();
  return {
    done,
    current: () => current,
    shutdown: async () => {
      stopping = true;
      current?.engine.restart.request({ kind: 'exit' });
      await done.catch(() => {});
    },
  };
}
