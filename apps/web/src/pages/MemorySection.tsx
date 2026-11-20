import { PROVIDER_LABEL } from '@foundry/core/browser';
import type { MemoryStatus } from '@foundry/engine/memory-types';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api.ts';
import { BOARD_ROW, Button, CopyButton, Input, cn } from '../ui.tsx';
import { statePlate, type Tone } from './agents/marks.ts';
import { BOARD_PANEL } from './agents/rows.tsx';
import { HelpLink } from './HelpPage.tsx';
import { OpsDock } from './skills/OpsDock.tsx';
import { startOp, useRunningOp, useSkillOps } from './skills/ops.ts';
import { BottomDock } from './skills/SkillsPage.tsx';

/** how a server is started on this computer by hand, for the card's fold; the LLM is the person's own */
export const HINDSIGHT_DOCKER = ['docker run -d --name hindsight --restart unless-stopped --shm-size=1g -p 8888:8888 -p 9999:9999 \\', '  -e HINDSIGHT_API_LLM_PROVIDER=openai -e HINDSIGHT_API_LLM_API_KEY=sk-… \\', '  -v hindsight-data:/home/hindsight/.pg0 ghcr.io/vectorize-io/hindsight:latest'].join('\n');

/** the coding agents that take the hindsight MCP server from Foundry (Antigravity keeps its own: its goals get text) */
export type MemoryAgent = 'claude' | 'codex';
type Server = MemoryStatus['server'];
/** the server Foundry runs, as the card names where it stands */
const SERVER_PLATE: Record<Server['phase'], { tone: Tone; label: (s: Server) => string }> = {
  off: { tone: 'none', label: () => 'off' },
  installing: { tone: 'work', label: () => 'installing' },
  starting: { tone: 'work', label: () => 'starting' },
  running: { tone: 'ok', label: (s) => `running · 127.0.0.1:${s.port}` },
  'sign-in': { tone: 'you', label: () => 'needs a sign-in' },
  failed: { tone: 'bad', label: () => 'stopped' },
};
const LLM_LABEL: Record<NonNullable<Server['llm']>, string> = { 'claude-code': 'Claude Code', 'openai-codex': 'Codex' };
/** a server whose LLM is a coding agent's CLI answers in a minute or two: what the wait becomes when Foundry runs it */
const CLI_WAIT = 120;
/** the wait the form shows: still the default while Foundry is about to run the server, the one that server needs */
const waitShown = (status: MemoryStatus | null, mode: 'run' | 'own'): number => (mode === 'run' && status && !status.run && status.reflectSec === 20 ? CLI_WAIT : (status?.reflectSec ?? 20));

/** where Memory stands, in a word or two: the server Foundry runs, a server of the person's, or off */
export function memoryStanding(status: MemoryStatus): { tone: Tone; label: string } {
  if (status.run) return { tone: SERVER_PLATE[status.server.phase].tone, label: SERVER_PLATE[status.server.phase].label(status.server) };
  if (status.configured) return status.reachable ? { tone: 'ok', label: `connected${status.version ? ` · ${status.version}` : ''}` } : { tone: 'bad', label: 'not reachable' };
  return status.ownUrl ? { tone: 'bad', label: 'not reachable' } : { tone: 'none', label: 'off' };
}

/** the coding agents the card offers to connect: Claude Code always, Codex where its CLI could be asked */
const agentsOf = (status: MemoryStatus): MemoryAgent[] => (['claude', 'codex'] as const).filter((p) => p === 'claude' || status.mcp[p] !== null);

const OPEN_KEY = 'foundry.learnings.memoryOpen';
function readOpen(): boolean | null {
  try {
    const v = localStorage.getItem(OPEN_KEY);
    return v === null ? null : v === '1';
  } catch {
    return null;
  }
}

/**
 * Memory (ADR-0072) at the head of the Learnings page, above the notebooks whose folders it remembers: the Hindsight
 * server and the coding agents connected to it, set up where each folder's switch is. A row like a folder's, folded to
 * where Memory stands; open, the Hindsight card. `/learnings#memory` opens it (the Extensions page's MCP servers tab
 * links here), and so does a server that needs the person; otherwise it stays as the person left it.
 */
export function MemorySection({ onStatus }: { onStatus?: (status: MemoryStatus) => void }) {
  const { hash } = useLocation();
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [chosen, setChosen] = useState<boolean | null>(() => (hash === '#memory' ? true : readOpen()));
  const ref = useRef<HTMLElement>(null);
  const running = useRunningOp();
  // every answer of the server's is the status: the folders' lines below follow it too
  const take = (s: MemoryStatus) => {
    setStatus(s);
    setErr(null);
    onStatus?.(s);
  };
  const load = () =>
    api
      .memoryStatus()
      .then(take)
      .catch((e) => setErr(e.message));
  // connecting a coding agent is an operation of the Extensions page's kind, in the same dock: reload when one ends
  const isMemoryOp = (targets: string[]) => targets.some((x) => x.endsWith(':mcp:hindsight'));
  const opsEnded = useSkillOps((s) => s.tabs.filter((t) => t.status !== 'running' && isMemoryOp(t.targets)).length);
  const opsShown = useSkillOps((s) => s.tabs.some((t) => isMemoryOp(t.targets)));
  useEffect(() => {
    void load();
  }, [opsEnded]);
  useEffect(() => {
    if (hash !== '#memory') return;
    setChosen(true);
    ref.current?.scrollIntoView({ block: 'start' });
  }, [hash]);
  const server = status?.server ?? null;
  const needsYou = !!status?.run && !!server && (server.phase === 'sign-in' || server.phase === 'failed');
  const open = chosen ?? needsYou;
  const toggle = () => {
    setChosen(!open);
    try {
      localStorage.setItem(OPEN_KEY, open ? '0' : '1');
    } catch {
      /* private mode */
    }
  };
  const connect = (provider: MemoryAgent, disconnect: boolean) => startOp({ kind: disconnect ? 'uninstall' : 'install', label: `${PROVIDER_LABEL[provider]} · ${disconnect ? 'Disconnect' : 'Connect'} Memory (hindsight)`, targets: [`${provider}:mcp:hindsight`], call: (opId) => api.memoryMcp(provider, opId, disconnect) });
  const stand = status ? memoryStanding(status) : null;
  return (
    <section ref={ref} id="memory" aria-label="Memory" className="scroll-mt-4">
      <div className={BOARD_PANEL}>
        <div className={cn(BOARD_ROW, 'px-4 md:px-5 py-3.5')}>
          <div className="flex items-center gap-2.5 min-w-0">
            {/* the fold button covers the row, as on a folder's row; the guide's link stays above it */}
            <button type="button" className="flex items-center gap-2.5 min-w-0 flex-1 text-left rounded after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-accent" aria-expanded={open} aria-controls="memory-setup" onClick={toggle} title={open ? 'collapse' : 'set up Memory'}>
              {open ? <ChevronDown size={14} className="text-ink-faint shrink-0" /> : <ChevronRight size={14} className="text-ink-faint shrink-0" />}
              {/* a phone keeps the row to one line beside where it stands: the card names Hindsight when open */}
              <span className="min-w-0 text-[15px] font-bold leading-snug text-ink whitespace-nowrap">
                Memory <span className="hidden sm:inline font-normal text-ink-faint">· Hindsight</span>
              </span>
            </button>
            {/* folded, where it stands; open, the card's own line says it */}
            {stand && !open && (
              <span className={cn(statePlate(stand.tone), 'min-w-0 overflow-hidden text-ellipsis')} title={stand.label}>
                {stand.label}
              </span>
            )}
            <HelpLink to="memory" className="relative z-10 shrink-0" />
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-ink-faint min-w-0 pl-6">
            <Brain size={12} className="shrink-0" aria-hidden="true" />
            <span className="min-w-0">the long version of the notebooks below: what each folder's goals did and taught, asked before every stage</span>
          </div>
        </div>
        {/* folded, the card stays: what was typed in it is kept, and it follows a server on its way */}
        <div id="memory-setup" hidden={!open} className="border-t border-line px-4 md:px-5 py-4">
          {err && !status ? <div className="text-xs text-bad-ink">{err}</div> : <HindsightCard status={status} running={(p) => !!running(`${p}:mcp:hindsight`)} onTest={(url, token) => api.memoryTest(url, token || undefined)} onSave={(body) => api.memorySave(body).then(take)} onConnect={(p, disconnect) => void connect(p, disconnect)} onRefresh={load} onSignIn={() => api.memorySignIn().then(take)} onSignInCancel={() => api.memorySignInCancel().then(take)} />}
        </div>
      </div>
      {opsShown && (
        <BottomDock>
          <OpsDock />
        </BottomDock>
      )}
    </section>
  );
}

/**
 * The Hindsight card (ADR-0072): the Hindsight server, one for every coding agent, and its MCP server in each coding
 * agent. Foundry runs it on this computer (ADR-0109: installed the first time, started and stopped with Foundry), or
 * the person runs one and gives its address. Nothing runs until one of the two is saved; a server that does not answer
 * costs goals nothing. The body of the Memory section on the Learnings page.
 */
export function HindsightCard({ status, running, onTest, onSave, onConnect, onRefresh, onSignIn, onSignInCancel }: { status: MemoryStatus | null; running: (provider: MemoryAgent) => boolean; onTest: (url: string, token: string) => Promise<{ ok: boolean; version: string | null; error: string | null }>; onSave: (body: { run?: boolean; url?: string | null; token?: string | null; retainTranscripts?: boolean; reflectSec?: number; seedCommits?: number }) => Promise<unknown>; onConnect: (provider: MemoryAgent, disconnect: boolean) => void; onRefresh: () => Promise<unknown>; onSignIn: () => Promise<unknown>; onSignInCancel: () => Promise<unknown> }) {
  // the form holds the address of a server the person runs (ownUrl), never that of the one Foundry runs
  const firstMode: 'run' | 'own' = status?.run || !status?.ownUrl ? 'run' : 'own';
  const [mode, setMode] = useState<'run' | 'own'>(firstMode);
  const [url, setUrl] = useState(status?.ownUrl ?? '');
  const [token, setToken] = useState('');
  const [transcripts, setTranscripts] = useState(status?.retainTranscripts ?? true);
  const [reflectSec, setReflectSec] = useState(String(waitShown(status, firstMode)));
  const [seedCommits, setSeedCommits] = useState(String(status?.seedCommits ?? 300));
  const [tried, setTried] = useState<{ ok: boolean; version: string | null; error: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // the form follows what is saved until the person types
  useEffect(() => {
    if (!status) return;
    const m = status.run || !status.ownUrl ? 'run' : 'own';
    setMode(m);
    setUrl(status.ownUrl ?? '');
    setTranscripts(status.retainTranscripts);
    setReflectSec(String(waitShown(status, m)));
    setSeedCommits(String(status.seedCommits));
  }, [status?.run, status?.ownUrl, status?.retainTranscripts, status?.reflectSec, status?.seedCommits]);
  const server = status?.server ?? null;
  // while the server installs, starts or waits for a sign-in, the card follows it
  const moving = !!status?.run && !!server && (server.phase === 'installing' || server.phase === 'starting' || server.phase === 'sign-in' || (!!server.signIn && !server.signIn.done));
  useEffect(() => {
    if (!moving) return;
    const t = setInterval(() => void onRefresh().catch(() => {}), 2000);
    return () => clearInterval(t);
  }, [moving]);
  const wait = Number(reflectSec);
  const seed = Number(seedCommits);
  const numbersOk = Number.isInteger(wait) && wait >= 5 && wait <= 300 && Number.isInteger(seed) && seed >= 0 && seed <= 5000;
  const valid = /^https?:\/\/\S+$/.test(url.trim());
  const changed = !!status && (transcripts !== status.retainTranscripts || wait !== status.reflectSec || seed !== status.seedCommits);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await work();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const choose = (m: 'run' | 'own') => {
    setMode(m);
    setTried(null);
    // an untouched wait follows the choice: the server Foundry runs answers through a coding agent's CLI, and the
    // default wait would give up before it does
    if (Number(reflectSec) === waitShown(status, mode)) setReflectSec(String(waitShown(status, m)));
  };
  const stand = status ? memoryStanding(status) : null;
  const agents = status ? agentsOf(status) : [];
  return (
    <div>
      <p className="text-xs text-ink-faint mb-3 max-w-[80ch]">
        <a href="https://github.com/vectorize-io/hindsight" target="_blank" rel="noreferrer" className="underline hover:text-ink">
          Hindsight
        </a>{' '}
        remembers what each folder's goals did and taught, and every stage asks it before it starts. Foundry can run it on this computer for you, or use a server you run. It is open source (MIT); nothing runs until you turn it on.
      </p>
      {status && stand && server && (
        <div className="flex items-center gap-2 flex-wrap text-xs mb-2">
          <span className={statePlate(stand.tone)}>{stand.label}</span>
          {status.run && server.llm && server.phase !== 'failed' && <span className="text-ink-faint">its LLM: your {LLM_LABEL[server.llm]} sign-in</span>}
          {status.run && server.phase === 'running' && status.version && <span className="text-ink-faint">· Hindsight {status.version}</span>}
          {!status.run && status.configured && !status.reachable && status.error && <span className="text-bad-ink truncate">{status.error}</span>}
        </div>
      )}
      <div role="radiogroup" aria-label="Which server Memory uses" className="inline-flex rounded-md border border-line p-0.5 mb-2 text-xs">
        {(
          [
            ['run', 'Foundry runs it'],
            ['own', 'A server you run'],
          ] as const
        ).map(([m, label]) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} className={cn('px-2.5 py-1 rounded font-semibold', mode === m ? 'bg-sunken text-ink' : 'text-ink-faint hover:text-ink')} onClick={() => choose(m)}>
            {label}
          </button>
        ))}
      </div>

      {mode === 'run' ? (
        <div className="space-y-1.5 text-xs max-w-[80ch]">
          <p className="text-ink-faint">
            Foundry installs Hindsight the first time (about 2 GB, a few minutes) and runs it on this computer only, started and stopped with Foundry. Its LLM is your Claude Code sign-in, or Codex where Claude Code is not signed in: no key. An answer takes a minute or two that way, so stages wait {CLI_WAIT} s for one.
          </p>
          {status?.run && server?.error && <div className="text-bad-ink">{server.error}</div>}
          {status?.run && server?.phase === 'sign-in' && (
            <div className="rounded-md border border-line p-2 space-y-1.5">
              <p className="text-ink-soft">Claude Code is not signed in here, so the server uses Codex, signed in for itself: a Codex token is good once, so it never shares the CLI's.</p>
              {server.signIn && !server.signIn.done ? (
                <div className="space-y-1">
                  {server.signIn.url && (
                    <div>
                      Open{' '}
                      <a href={server.signIn.url} target="_blank" rel="noreferrer" className="underline mono">
                        {server.signIn.url}
                      </a>{' '}
                      and enter:
                    </div>
                  )}
                  {server.signIn.deviceCode ? (
                    <div className="flex items-center gap-2">
                      <span className="mono text-lg font-bold tracking-[0.2em] text-ink">{server.signIn.deviceCode}</span>
                      <CopyButton text={server.signIn.deviceCode} />
                    </div>
                  ) : (
                    <div className="text-ink-faint">Getting a code…</div>
                  )}
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(onSignInCancel)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <>
                  {server.signIn?.error && <div className="text-bad-ink">{server.signIn.error}</div>}
                  <Button size="sm" variant="primary" disabled={busy} onClick={() => void run(onSignIn)}>
                    Sign the server in to Codex
                  </Button>
                </>
              )}
            </div>
          )}
          {status?.run && server && server.lines.length > 0 && (server.phase === 'installing' || server.phase === 'starting' || server.phase === 'failed') && <pre className="mono text-[11px] whitespace-pre-wrap break-all bg-sunken rounded-md p-2 max-h-36 overflow-auto">{server.lines.slice(-8).join('\n')}</pre>}
          {status?.run && server?.phase === 'starting' && !server.error && <div className="text-ink-faint">The first start downloads the models it reads with, a few hundred MB.</div>}
        </div>
      ) : (
        // the inputs fill a box of their own: a width class of theirs would lose to Input's w-full
        <div className="space-y-1.5 max-w-md">
          <Input
            aria-label="server address"
            className="mono"
            placeholder="http://127.0.0.1:8888"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setTried(null);
            }}
          />
          <Input
            type="password"
            autoComplete="off"
            aria-label="bearer token"
            placeholder={status?.tokenSet ? 'token kept — leave empty to keep it' : 'bearer token, if the server asks for one'}
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setTried(null);
            }}
          />
        </div>
      )}

      <div className="space-y-1.5 mt-2">
        <label className="flex items-center gap-1.5 text-xs font-semibold text-ink-soft cursor-pointer" title="The turns and one line per tool call, without arguments or outputs">
          <input type="checkbox" checked={transcripts} onChange={(e) => setTranscripts(e.target.checked)} /> Write each attempt's transcript to the bank, in compact form
        </label>
        <div className="grid grid-cols-1 gap-y-1.5 text-xs">
          <label className="flex items-center gap-1.5 text-ink-soft" title="Past this, a stage is given the memories themselves (found without a model, well under a second) and goes on. A server whose LLM is a coding agent's CLI (claude-code, openai-codex) answers in 60–120 s.">
            <span className="font-semibold shrink-0">Wait for an answer</span>
            {/* the input fills a box of its own: its own width class would lose to Input's w-full */}
            <span className="w-20 shrink-0">
              <Input type="number" inputMode="numeric" min={5} max={300} aria-label="seconds to wait for an answer" className="mono" value={reflectSec} onChange={(e) => setReflectSec(e.target.value)} />
            </span>
            <span className="text-ink-faint">s</span>
          </label>
          <label className="flex items-center gap-1.5 text-ink-soft" title="The first time Memory is used for a folder, its newest commits seed the bank, one document each; skipped when the bank already holds documents">
            <span className="font-semibold shrink-0">Seed a new folder from</span>
            <span className="w-24 shrink-0">
              <Input type="number" inputMode="numeric" min={0} max={5000} aria-label="commits that seed a new folder's bank" className="mono" value={seedCommits} onChange={(e) => setSeedCommits(e.target.value)} />
            </span>
            <span className="text-ink-faint">commits</span>
          </label>
        </div>
      </div>
      {tried && <div className={cn('text-xs mt-1.5', tried.ok ? 'text-ok-ink' : 'text-bad-ink')}>{tried.ok ? `The server answers: Hindsight ${tried.version ?? ''}.` : `No answer: ${tried.error}`}</div>}
      {err && <div className="text-xs text-bad-ink mt-1.5">{err}</div>}
      <div className="flex flex-wrap items-center gap-2 mt-2">
        {mode === 'run' ? (
          <>
            {!status?.run ? (
              <Button size="sm" variant="primary" disabled={!numbersOk || busy} onClick={() => void run(() => onSave({ run: true, retainTranscripts: transcripts, reflectSec: wait, seedCommits: seed }))}>
                Run Hindsight here
              </Button>
            ) : (
              <>
                {server?.phase === 'failed' && (
                  <Button size="sm" variant="primary" disabled={busy} onClick={() => void run(() => onSave({ run: true }))}>
                    Try again
                  </Button>
                )}
                <Button size="sm" disabled={!changed || !numbersOk || busy} onClick={() => void run(() => onSave({ retainTranscripts: transcripts, reflectSec: wait, seedCommits: seed }))}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => onSave({ run: false }))}>
                  Turn off
                </Button>
              </>
            )}
          </>
        ) : (
          <>
            <Button size="sm" disabled={!valid || busy} onClick={() => void run(async () => setTried(await onTest(url.trim(), token)))}>
              Test
            </Button>
            <Button size="sm" variant="primary" disabled={!valid || !numbersOk || busy} onClick={() => void run(() => onSave({ run: false, url: url.trim(), ...(token ? { token } : {}), retainTranscripts: transcripts, reflectSec: wait, seedCommits: seed }).then(() => setToken('')))}>
              Save
            </Button>
            {(status?.ownUrl || status?.run) && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => onSave({ run: false, url: null }))}>
                Turn off
              </Button>
            )}
          </>
        )}
      </div>
      {status?.configured && (
        // the hindsight MCP server in each coding agent's own configuration, connected from here for every one of them
        <div className="mt-3 pt-3 border-t border-line text-xs space-y-1.5">
          <div className="font-semibold text-ink-soft">Connect the coding agents</div>
          {agents.map((p) => {
            const mcp = status.mcp[p];
            const busyHere = running(p);
            return (
              <div key={p} className="flex items-center gap-2 flex-wrap">
                <span className="w-24 shrink-0 text-ink-soft">{PROVIDER_LABEL[p]}</span>
                {mcp === null ? <span className="text-ink-faint">unknown</span> : mcp.installed ? <span className={statePlate(mcp.allowed ? 'ok' : 'you')}>{mcp.allowed ? 'connected · allowed in goals' : 'installed, not allowed in goals'}</span> : <span className={statePlate('none')}>not connected</span>}
                <Button size="sm" variant={mcp?.installed ? 'ghost' : 'default'} disabled={busyHere} onClick={() => onConnect(p, !!mcp?.installed)}>
                  {busyHere ? 'Working…' : mcp?.installed ? 'Disconnect' : `Connect ${PROVIDER_LABEL[p]}`}
                </Button>
              </div>
            );
          })}
          <p className="text-ink-faint max-w-[80ch]">
            Connected, a worker can ask the memory itself mid-way (recall, reflect) and is told its bank; Foundry asks it before every stage either way. The server also works in your own sessions of that coding agent.
            {agents.includes('codex') && status.tokenSet && !status.run && ' Codex reads the token from HINDSIGHT_API_TOKEN, which Foundry sets for its sessions; export it in your own shell too.'} Antigravity takes no MCP server from Foundry: its goals get what Memory recalls as text.
          </p>
        </div>
      )}
      {mode === 'run' && server && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer font-semibold text-ink-soft">Where it keeps things</summary>
          <div className="mt-1.5 space-y-1 text-ink-faint">
            <p>
              Hindsight {server.installed ?? 'not installed yet'} in <code className="mono break-all">{server.venv}</code>
            </p>
            <p>
              Its memories: {server.database ? <code className="mono break-all">{server.database}</code> : 'a database named at its first start, in ~/.pg0/instances'} (pg0's embedded Postgres keeps them there, outside the data folder)
            </p>
            <p>Turning it off stops the server and keeps both; deleting the two folders removes it.</p>
          </div>
        </details>
      )}
      {mode === 'own' && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer font-semibold text-ink-soft">Run a server yourself</summary>
          <div className="mt-1.5 space-y-1.5 text-ink-faint max-w-[80ch]">
            <p>With Docker — the full image (3.7–9 GB) carries its own embedded database and models, so nothing else is installed — and an LLM key of your own for its extraction (set HINDSIGHT_API_LLM_MODEL to pin a model):</p>
            <div className="flex items-start gap-1">
              <pre className="mono text-[11px] whitespace-pre-wrap break-all bg-sunken rounded-md p-2 flex-1">{HINDSIGHT_DOCKER}</pre>
              <CopyButton text={HINDSIGHT_DOCKER} />
            </div>
            <p>
              Or with Python: <code className="mono">pip install hindsight-api</code>, then <code className="mono">hindsight-api</code> with the same variables. The server listens on :8888, its console on :9999.
            </p>
            <p>
              A server on this computer can use a sign-in you already have instead of a key: <code className="mono">HINDSIGHT_API_LLM_PROVIDER=claude-code</code> spawns your <code className="mono">claude</code> for each call (so an answer takes a minute or more: raise the wait above), <code className="mono">openai-codex</code> reads a Codex sign-in from <code className="mono">CODEX_HOME</code> (give it one of its own: <code className="mono">CODEX_HOME=~/.hindsight/codex codex login</code>, so it never fights the CLI over tokens). Both are for your own use, says Hindsight.
            </p>
          </div>
        </details>
      )}
    </div>
  );
}
