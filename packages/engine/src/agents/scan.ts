import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { Envelope } from './transcript.ts';

/** One live Claude CLI process, from ~/.claude/sessions/<pid>.json (written on start, removed on exit). */
export interface LiveRegistryEntry {
  pid: number;
  sessionId: string;
  cwd: string | null;
  startedAt: number | null; // epoch ms
  entrypoint: string | null;
  name: string | null;
  version: string | null;
}

export interface TranscriptRef {
  sessionId: string;
  path: string;
  projDir: string;
  mtimeMs: number;
  birthtimeMs: number;
}

const PID_FILE = /^\d+\.json$/; // never matches the <pid>.<sha>.key secret next to it
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e?.code === 'EPERM'; // alive, owned by someone else
  }
}

/** Live sessions: registry files whose pid still answers. Stale files (crash leftovers) are dropped. */
export function liveRegistry(claudeHome: string): LiveRegistryEntry[] {
  const dir = join(claudeHome, 'sessions');
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: LiveRegistryEntry[] = [];
  for (const name of names) {
    if (!PID_FILE.test(name)) continue;
    try {
      const v = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      const pid = Number(v?.pid);
      if (!Number.isFinite(pid) || pid <= 0 || typeof v?.sessionId !== 'string' || !pidAlive(pid)) continue;
      out.push({
        pid,
        sessionId: v.sessionId,
        cwd: typeof v.cwd === 'string' ? v.cwd : null,
        startedAt: Number.isFinite(v.startedAt) ? v.startedAt : null,
        entrypoint: typeof v.entrypoint === 'string' ? v.entrypoint : null,
        name: typeof v.name === 'string' ? v.name : null,
        version: typeof v.version === 'string' ? v.version : null,
      });
    } catch {
      // unreadable/corrupt registry file — skip
    }
  }
  return out;
}

/** Transcripts touched within the window. stat-only: no file contents are read here. */
export function recentTranscripts(claudeHome: string, sinceMs: number): TranscriptRef[] {
  const projects = join(claudeHome, 'projects');
  let dirs: string[];
  try {
    dirs = readdirSync(projects);
  } catch {
    return [];
  }
  const out: TranscriptRef[] = [];
  for (const d of dirs) {
    const projDir = join(projects, d);
    let files: string[];
    try {
      files = readdirSync(projDir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const sessionId = f.slice(0, -'.jsonl'.length);
      if (!UUID.test(sessionId)) continue;
      try {
        const st = statSync(join(projDir, f));
        if (!st.isFile() || st.mtimeMs < sinceMs) continue;
        out.push({ sessionId, path: join(projDir, f), projDir, mtimeMs: st.mtimeMs, birthtimeMs: st.birthtimeMs });
      } catch {}
    }
  }
  return out;
}

export interface SubagentRef {
  agentId: string;
  agentType: string;
  description: string;
  toolUseId: string | null;
  jsonlPath: string | null;
  mtimeMs: number | null;
}

const AGENT_META = /^agent-([A-Za-z0-9_-]+)\.meta\.json$/;

export function listSubagents(projDir: string, sessionId: string): SubagentRef[] {
  const dir = join(projDir, sessionId, 'subagents');
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: SubagentRef[] = [];
  for (const name of names) {
    const agentId = AGENT_META.exec(name)?.[1];
    if (!agentId) continue;
    try {
      const meta = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      const jsonl = join(dir, `agent-${agentId}.jsonl`);
      let mtimeMs: number | null = null;
      let jsonlPath: string | null = null;
      try {
        mtimeMs = statSync(jsonl).mtimeMs;
        jsonlPath = jsonl;
      } catch {}
      out.push({
        agentId,
        agentType: typeof meta?.agentType === 'string' ? meta.agentType : 'agent',
        description: typeof meta?.description === 'string' ? meta.description : '',
        toolUseId: typeof meta?.toolUseId === 'string' ? meta.toolUseId : null,
        jsonlPath,
        mtimeMs,
      });
    } catch {}
  }
  return out;
}

/** Does the parent tail show the Task tool returning for this subagent? (Reliable done-signal.) */
export function subagentDone(parentTail: Envelope[], toolUseId: string | null): boolean {
  if (!toolUseId) return false;
  return parentTail.some((e) => e.type === 'user' && (e as any).toolUseResult && ((e as any).sourceToolUseID === toolUseId || (Array.isArray(e.message?.content) && e.message.content.some((b: any) => b?.type === 'tool_result' && b.tool_use_id === toolUseId))));
}

/**
 * sessionId → transcript location, memoized (a scan over projects/ per miss).
 * Entries are dropped when the file disappears.
 */
export class TranscriptIndex {
  private byId = new Map<string, TranscriptRef>();
  constructor(private claudeHome: string) {}

  find(sessionId: string): TranscriptRef | null {
    if (!UUID.test(sessionId)) return null;
    const hit = this.byId.get(sessionId);
    if (hit && existsSync(hit.path)) return hit;
    this.byId.delete(sessionId);
    const projects = join(this.claudeHome, 'projects');
    let dirs: string[];
    try {
      dirs = readdirSync(projects);
    } catch {
      return null;
    }
    for (const d of dirs) {
      const path = join(projects, d, `${sessionId}.jsonl`);
      try {
        const st = statSync(path);
        if (!st.isFile()) continue;
        const ref: TranscriptRef = { sessionId, path, projDir: join(projects, d), mtimeMs: st.mtimeMs, birthtimeMs: st.birthtimeMs };
        this.byId.set(sessionId, ref);
        return ref;
      } catch {}
    }
    return null;
  }

  remember(ref: TranscriptRef): void {
    this.byId.set(ref.sessionId, ref);
  }

  findSubagentLog(sessionId: string, agentId: string): string | null {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(agentId)) return null;
    const parent = this.find(sessionId);
    if (!parent) return null;
    const path = join(parent.projDir, sessionId, 'subagents', `agent-${agentId}.jsonl`);
    return this.safe(path) && existsSync(path) ? path : null;
  }

  /** Defense in depth: every served path must live under claudeHome/projects and end in .jsonl. */
  safe(path: string): boolean {
    const root = resolve(this.claudeHome, 'projects') + sep;
    const r = resolve(path);
    return r.startsWith(root) && r.endsWith('.jsonl');
  }
}
