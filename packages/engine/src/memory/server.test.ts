import { afterEach, describe, expect, test } from 'bun:test';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { waitFor } from '../test-helpers.ts';
import { AGENT_SDK_VERSION, HINDSIGHT_VERSION, HindsightServer, LAUNCHER, type ServerDeps, type ServerProcess } from './server.ts';

/** a server process that answers once started, writes to its log what it is told to, and stops when asked (or hangs, if told to) */
class FakeProc implements ServerProcess {
  static next = 41_000;
  pid = FakeProc.next++;
  signals: string[] = [];
  done = false;
  private resolve!: (c: number | null) => void;
  exited = new Promise<number | null>((r) => (this.resolve = r));
  constructor(
    public argv: string[],
    public opts: { cwd: string; env: Record<string, string>; log: string },
    private hang = false,
  ) {}
  kill(signal: 'SIGTERM' | 'SIGKILL') {
    this.signals.push(signal);
    if (signal === 'SIGKILL' || !this.hang) this.exit(signal === 'SIGKILL' ? 137 : 0);
  }
  exit(code: number | null) {
    this.done = true;
    this.resolve(code);
  }
  say(l: string) {
    appendFileSync(this.opts.log, `${l}\n`);
  }
}

const dirs: string[] = [];
const servers: HindsightServer[] = [];
afterEach(async () => {
  while (servers.length) await servers.pop()!.stop();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function harness(o: { dataDir?: string; llm?: 'claude-code' | 'openai-codex' | null; taken?: number[]; answers?: boolean; uv?: string | null; platform?: NodeJS.Platform; codexSignedIn?: () => boolean; installFails?: boolean; hang?: boolean; gate?: Promise<void>; startTimeoutMs?: number } = {}) {
  const dataDir = o.dataDir ?? mkdtempSync(join(tmpdir(), 'foundry-hserver-'));
  if (!o.dataDir) dirs.push(dataDir);
  const runs: string[][] = [];
  const procs: FakeProc[] = [];
  const urls: (string | null)[] = [];
  const deps: ServerDeps = {
    dataDir,
    log: () => {},
    llm: async () => (o.llm === undefined ? 'claude-code' : o.llm),
    claudeEnv: () => ({ CLAUDE_CONFIG_DIR: '/home/me/.claude-of-foundry' }),
    codexBin: () => '/usr/local/bin/codex',
    uv: () => (o.uv === undefined ? '/usr/local/bin/uv' : o.uv),
    run: async (argv, _cwd, onLine) => {
      runs.push(argv);
      if (o.gate) await o.gate;
      onLine(`uv ${argv[1]}`);
      if (argv[1] === 'venv') {
        mkdirSync(join(argv[4]!, 'bin'), { recursive: true });
        writeFileSync(join(argv[4]!, 'bin', 'python'), '');
      }
      const fails = o.installFails && argv[1] === 'pip';
      return { code: fails ? 1 : 0, tail: fails ? 'No solution found when resolving dependencies:\n  ╰─▶ Because torch has no wheels with a matching platform tag' : '' };
    },
    spawn: (argv, opts) => {
      const p = new FakeProc(argv, opts, o.hang);
      procs.push(p);
      return p;
    },
    answers: async () => ((o.answers ?? true) && procs.length > 0 && !procs.at(-1)!.done ? '1.1.0' : null),
    portFree: async (port) => !(o.taken ?? []).includes(port),
    codexSignedIn: async () => o.codexSignedIn?.() ?? false,
    commandOf: async () => '',
    platform: o.platform ?? 'darwin',
    pg0Home: join(dataDir, 'pg0-home'),
    pollMs: 5,
    backoffMs: 5,
    stopGraceMs: 60,
    startTimeoutMs: o.startTimeoutMs ?? 5_000,
  };
  const server = new HindsightServer(deps);
  servers.push(server);
  server.onUrl((u) => urls.push(u));
  return { server, dataDir, runs, procs, urls };
}

describe('the Hindsight server Foundry runs (ADR-0109)', () => {
  test('turned on, it installs the pinned Hindsight with uv, starts it on 127.0.0.1 with a database of its own, and gives Memory its address once it answers', async () => {
    const before = { key: process.env.ANTHROPIC_API_KEY, own: process.env.HINDSIGHT_API_LLM_API_KEY };
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api-key-in-foundry-env';
    process.env.HINDSIGHT_API_LLM_API_KEY = 'a key for a server of the person own';
    try {
      const { server, dataDir, runs, procs, urls } = harness();
      expect(server.view()).toMatchObject({ phase: 'off', url: null, installed: null, database: null });
      server.sync(true);
      await waitFor(() => server.view().phase === 'running');
      const venv = join(dataDir, 'python', 'hindsight');
      expect(runs[0]).toEqual(['/usr/local/bin/uv', 'venv', '--python', '3.12', venv]);
      expect(runs[1]).toEqual(['/usr/local/bin/uv', 'pip', 'install', '--python', join(venv, 'bin', 'python'), `hindsight-api==${HINDSIGHT_VERSION}`, `claude-agent-sdk==${AGENT_SDK_VERSION}`]);
      const home = join(dataDir, 'hindsight');
      expect(procs).toHaveLength(1);
      expect(procs[0]!.argv).toEqual([join(venv, 'bin', 'python'), join(home, 'launch.py')]);
      expect(readFileSync(join(home, 'launch.py'), 'utf8')).toBe(LAUNCHER);
      const env = procs[0]!.opts.env;
      expect(env).toMatchObject({ HINDSIGHT_API_HOST: '127.0.0.1', HINDSIGHT_API_PORT: '8888', HINDSIGHT_API_LLM_PROVIDER: 'claude-code', CLAUDE_CONFIG_DIR: '/home/me/.claude-of-foundry', HINDSIGHT_API_WORKERS: '1' });
      expect(env.HINDSIGHT_API_DATABASE_URL).toMatch(/^pg0:\/\/foundry-[0-9a-f]{8}$/);
      // the subscription, never a key that happens to be in Foundry's environment; nothing of another Hindsight's settings
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.HINDSIGHT_API_LLM_API_KEY).toBeUndefined();
      expect(server.url()).toBe('http://127.0.0.1:8888');
      expect(urls).toEqual(['http://127.0.0.1:8888']);
      const name = env.HINDSIGHT_API_DATABASE_URL!.slice('pg0://'.length);
      expect(server.view()).toMatchObject({ phase: 'running', port: 8888, llm: 'claude-code', installed: HINDSIGHT_VERSION, database: join(dataDir, 'pg0-home', 'instances', name), error: null });
      expect(readFileSync(join(home, 'server.pid'), 'utf8').trim()).toBe(String(procs[0]!.pid));
      await server.stop();
      expect(procs[0]!.signals).toEqual(['SIGTERM']);
      expect(server.view().phase).toBe('off');
      expect(urls).toEqual(['http://127.0.0.1:8888', null]);
      expect(existsSync(join(home, 'server.pid'))).toBe(false);
    } finally {
      for (const [k, v] of [['ANTHROPIC_API_KEY', before.key], ['HINDSIGHT_API_LLM_API_KEY', before.own]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  test('a later start uses the install it made, the port and the database it had: 8888 taken the first time means 8889 for good', async () => {
    const first = harness({ taken: [8888] });
    first.server.sync(true);
    await waitFor(() => first.server.view().phase === 'running');
    expect(first.server.url()).toBe('http://127.0.0.1:8889');
    const database = first.procs[0]!.opts.env.HINDSIGHT_API_DATABASE_URL;
    await first.server.stop();
    // 8888 is free now: the coding agents' MCP servers still point at 8889
    const again = harness({ dataDir: first.dataDir });
    again.server.sync(true);
    await waitFor(() => again.server.view().phase === 'running');
    expect(again.runs).toEqual([]);
    expect(again.server.url()).toBe('http://127.0.0.1:8889');
    expect(again.procs[0]!.opts.env.HINDSIGHT_API_DATABASE_URL).toBe(database);
  });

  test('on Linux it installs the CPU build of PyTorch, not the CUDA one', async () => {
    const { server, runs } = harness({ platform: 'linux' });
    server.sync(true);
    await waitFor(() => server.view().phase === 'running');
    expect(runs[1]).toContain('--torch-backend');
    expect(runs[1]![runs[1]!.indexOf('--torch-backend') + 1]).toBe('cpu');
  });

  test('without uv, or when the install fails, it stops with the reason and leaves no half-made environment', async () => {
    const noUv = harness({ uv: null });
    noUv.server.sync(true);
    await waitFor(() => noUv.server.view().phase === 'failed');
    expect(noUv.server.view().error).toContain('uv is not installed');
    expect(noUv.procs).toEqual([]);

    const broken = harness({ installFails: true });
    broken.server.sync(true);
    await waitFor(() => broken.server.view().phase === 'failed');
    expect(broken.server.view().error).toContain('uv pip install failed (1)');
    expect(broken.server.view().error).toContain('no wheels with a matching platform tag');
    expect(broken.server.view().lines).toContain('uv pip');
    expect(existsSync(join(broken.dataDir, 'python', 'hindsight'))).toBe(false);
    expect(broken.procs).toEqual([]);
  });

  test('with no coding agent signed in it does not start; with only Codex it waits for a Codex sign-in of its own', async () => {
    const none = harness({ llm: null });
    none.server.sync(true);
    await waitFor(() => none.server.view().phase === 'failed');
    expect(none.server.view().error).toContain('neither Claude Code nor Codex is signed in');
    expect(none.procs).toEqual([]);

    let signedIn = false;
    const codex = harness({ llm: 'openai-codex', codexSignedIn: () => signedIn });
    codex.server.sync(true);
    await waitFor(() => codex.server.view().phase === 'sign-in');
    expect(codex.procs).toEqual([]);
    signedIn = true;
    codex.server.retry();
    await waitFor(() => codex.server.view().phase === 'running');
    const env = codex.procs[0]!.opts.env;
    expect(env).toMatchObject({ HINDSIGHT_API_LLM_PROVIDER: 'openai-codex', HINDSIGHT_API_LLM_CODEX_HOME: join(codex.dataDir, 'hindsight', 'codex') });
    expect(env.CLAUDE_CONFIG_DIR).not.toBe('/home/me/.claude-of-foundry');
  });

  test('a server that stops on its own starts again; one that keeps stopping is left stopped with its last words', async () => {
    const { server, procs, urls } = harness();
    server.sync(true);
    await waitFor(() => server.view().phase === 'running');
    procs[0]!.say('Traceback: the database went away');
    procs[0]!.exit(1);
    await waitFor(() => procs.length === 2 && server.view().phase === 'running');
    expect(urls).toEqual(['http://127.0.0.1:8888', null, 'http://127.0.0.1:8888']);
    procs[1]!.exit(1);
    await waitFor(() => procs.length === 3 && server.view().phase === 'running');
    procs[2]!.say('Killed: out of memory');
    procs[2]!.exit(137);
    await waitFor(() => server.view().phase === 'failed');
    expect(server.view().error).toBe('it stopped 3 times in 10 minutes (exit 137): Killed: out of memory');
    // the card shows the log since the last start, not the runs before it
    expect(server.view().lines).toEqual(['Killed: out of memory']);
    expect(server.url()).toBeNull();
    // the person tries again: the count starts afresh
    server.retry();
    await waitFor(() => procs.length === 4 && server.view().phase === 'running');
  });

  test('stopping asks it to stop, then kills its group past the grace; turned off mid-install, nothing starts', async () => {
    const stuck = harness({ hang: true });
    stuck.server.sync(true);
    await waitFor(() => stuck.server.view().phase === 'running');
    await stuck.server.stop();
    expect(stuck.procs[0]!.signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(stuck.server.view().phase).toBe('off');

    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const off = harness({ gate });
    off.server.sync(true);
    await waitFor(() => off.server.view().phase === 'installing');
    off.server.sync(false);
    open();
    await waitFor(() => off.runs.length >= 1);
    await Bun.sleep(50);
    expect(off.procs).toEqual([]);
    expect(off.server.view().phase).toBe('off');
  });

  test('a server that never answers is stopped, and the reason says where its log is', async () => {
    const { server, procs, dataDir } = harness({ answers: false, startTimeoutMs: 60 });
    server.sync(true);
    await waitFor(() => server.view().phase === 'failed');
    expect(server.view().error).toContain('did not answer at http://127.0.0.1:8888');
    expect(server.view().error).toContain(join(dataDir, 'hindsight', 'server.log'));
    expect(procs[0]!.signals[0]).toBe('SIGTERM');
    expect(server.url()).toBeNull();
  });

  test('the launcher stops the server once its stdin closes, whatever became of Foundry', () => {
    // the server never reads its stdin: its end closing means Foundry is gone
    expect(LAUNCHER).toContain('os.read(0, 4096)');
    // a thread blocked in sys.stdin would hold its lock at interpreter shutdown: Python aborts ("could not acquire lock")
    expect(LAUNCHER).not.toContain('sys.stdin');
    expect(LAUNCHER).toContain('os.kill(os.getpid(), signal.SIGTERM)');
    expect(LAUNCHER).toContain('from hindsight_api.main import main');
  });
});
