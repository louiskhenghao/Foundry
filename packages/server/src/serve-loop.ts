/**
 * `foundry serve` (ADR-0082): the engine and the HTTP server, started again in this same process when asked — on the same
 * data folder (a Setting marked restart) or on another one. Nothing exits, so under `bun --watch`, launchd or Docker the
 * process keeps its port. A switch whose folder cannot boot comes back on the folder before, with a notice for Settings.
 */
import { Engine, defaultConfig, prepareDataDir, readHomeConfig, rememberRecent, writeHomeConfig, type DataDirNotice, type EngineConfig } from '@foundry/engine';
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

  const run = async (): Promise<void> => {
    for (;;) {
      let engine: Engine | undefined;
      let server: Server | undefined;
      let cfg: EngineConfig | undefined;
      try {
        cfg = defaultConfig(opts.root, opts.config);
        engine = make(cfg);
        server = startServer(engine, { webDist: opts.webDist });
        engine.restart.attached = true;
        engine.dataDirNotice = notice ?? (cfg.dataDirMissing ? { kind: 'missing', chosen: cfg.dataDirMissing, at: new Date().toISOString() } : null);
        notice = null;
        current = { engine, server };
        log(`foundry listening on http://${engine.config.host}:${server.port}  (data: ${engine.config.dataDir})`);
        opts.onListening?.(engine, server);
        await engine.start();
      } catch (err) {
        // half built: the server may listen, the engine may hold the database
        current = null;
        try {
          server?.stop(true);
        } catch {}
        try {
          await engine?.stop();
        } catch {}
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
      log(req.kind === 'exit' ? '[engine] stopping' : req.kind === 'restart' ? `[engine] restarting: ${req.why}` : `[engine] restarting on ${req.to} (${req.mode})`);
      await engine.stop();
      server.stop(true);
      current = null;
      if (req.kind === 'exit') return;
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
