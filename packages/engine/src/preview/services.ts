import { basename, join } from 'node:path';
import type { Goal } from '@foundry/core';
import { detectCompose, type ComposeService } from './detect.ts';

export interface ServiceStatus extends ComposeService {
  /** running = in Foundry's compose project; external = its host port is already taken by something else, which the apps use instead */
  state: 'running' | 'stopped' | 'external' | 'unknown';
  health: string | null;
}

export interface ServicesStatus {
  /** the compose file, relative to the progress folder */
  file: string;
  /** the compose project shared by every goal of this repository */
  project: string;
  /** how Foundry can reach Docker: in-container = the Docker image, which has no Docker access by design */
  docker: 'available' | 'unavailable' | 'in-container';
  services: ServiceStatus[];
  /** the command to start the services by hand */
  command: string;
  error: string | null;
}

export type Exec = (args: string[], cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>;

export interface ServicesDeps {
  exec?: Exec;
  which?: (bin: string) => string | null;
  inContainer?: () => boolean;
  portFree: (port: number) => Promise<boolean>;
  log: (line: string) => void;
}

const defaultExec: Exec = async (args, cwd) => {
  const proc = Bun.spawn(args, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  return { code, stdout, stderr };
};

/**
 * The Docker services a goal's apps need (databases, object storage), from the repository's compose file. One compose
 * project per repository, shared by its goals, so two goals never fight over Postgres's port; a service whose host port
 * is already taken (the person's own Postgres, another project) is reused instead of started. Services keep running
 * when previews stop, so their data and warm start survive; they are stopped from the preview card. Inside the Docker
 * image Foundry has no Docker access, so it only shows the command to run.
 */
export class ServicesManager {
  private exec: Exec;
  private cache = new Map<string, { at: number; status: ServicesStatus }>();

  constructor(private deps: ServicesDeps) {
    this.exec = deps.exec ?? defaultExec;
  }

  /** null = the progress folder has no compose file with dependency services */
  async status(goal: Goal, ws: string, fresh = false): Promise<ServicesStatus | null> {
    const found = detectCompose(ws);
    if (!found) return null;
    const hit = this.cache.get(goal.id);
    if (!fresh && hit && Date.now() - hit.at < 3_000) return hit.status;
    const base = this.base(goal, ws, found);
    if (base.docker !== 'available') return base;
    const ps = await this.exec(['docker', 'compose', '-p', base.project, ...this.files(goal, ws, found.file), 'ps', '--all', '--format', 'json'], ws).catch((e) => ({ code: 1, stdout: '', stderr: String(e) }));
    if (ps.code !== 0) return this.remember(goal.id, { ...base, error: firstLine(ps.stderr) ?? 'docker compose ps failed' });
    const rows = parsePs(ps.stdout);
    const services = await Promise.all(
      base.services.map(async (s): Promise<ServiceStatus> => {
        const row = rows.find((r) => r.Service === s.name);
        if (row?.State === 'running') return { ...s, state: 'running', health: row.Health || null };
        const busy = (await Promise.all(s.ports.map((p) => this.deps.portFree(p)))).some((free) => !free);
        return { ...s, state: busy ? 'external' : 'stopped', health: null };
      }),
    );
    return this.remember(goal.id, { ...base, services });
  }

  /** start the named services (all when none are named) that are neither running nor provided by something else */
  async up(goal: Goal, ws: string, names?: string[]): Promise<ServicesStatus | null> {
    const current = await this.status(goal, ws, true);
    if (!current || current.docker !== 'available') return current;
    const wanted = current.services.filter((s) => (!names || names.includes(s.name)) && s.state === 'stopped').map((s) => s.name);
    if (!wanted.length) return current;
    this.deps.log(`[services] ${current.project}: up ${wanted.join(' ')}`);
    const args = ['docker', 'compose', '-p', current.project, ...this.files(goal, ws, current.file), 'up', '-d', '--wait', '--wait-timeout', '90', ...wanted];
    const res = await this.exec(args, ws).catch((e) => ({ code: 1, stdout: '', stderr: String(e) }));
    const after = await this.status(goal, ws, true);
    return after && res.code !== 0 ? this.remember(goal.id, { ...after, error: lastLine(res.stderr) ?? `docker compose up failed (exit ${res.code})` }) : after;
  }

  /** stop the named services (all of Foundry's when none are named); containers and their data are kept */
  async stop(goal: Goal, ws: string, names?: string[]): Promise<ServicesStatus | null> {
    const current = await this.status(goal, ws, true);
    if (!current || current.docker !== 'available') return current;
    const running = current.services.filter((s) => (!names || names.includes(s.name)) && s.state === 'running').map((s) => s.name);
    if (!running.length) return current;
    this.deps.log(`[services] ${current.project}: stop ${running.join(' ')}`);
    const res = await this.exec(['docker', 'compose', '-p', current.project, ...this.files(goal, ws, current.file), 'stop', ...running], ws).catch((e) => ({ code: 1, stdout: '', stderr: String(e) }));
    const after = await this.status(goal, ws, true);
    return after && res.code !== 0 ? this.remember(goal.id, { ...after, error: lastLine(res.stderr) ?? 'docker compose stop failed' }) : after;
  }

  private base(goal: Goal, ws: string, found: { file: string; services: ComposeService[] }): ServicesStatus {
    const project = composeProject(goal.repoPath);
    const docker = this.deps.inContainer?.() ? 'in-container' : (this.deps.which ?? Bun.which)('docker') ? 'available' : 'unavailable';
    const names = found.services.map((s) => s.name).join(' ');
    return { file: found.file, project, docker, services: found.services.map((s) => ({ ...s, state: 'unknown', health: null })), command: `docker compose -p ${project} -f ${found.file} up -d ${names}`, error: null };
  }

  /** the goal's compose file, with relative volumes and env files resolved against the person's checkout so goals share them */
  private files(goal: Goal, ws: string, file: string): string[] {
    return ['-f', join(ws, file), '--project-directory', goal.repoPath];
  }

  private remember(goalId: string, status: ServicesStatus): ServicesStatus {
    this.cache.set(goalId, { at: Date.now(), status });
    return status;
  }
}

export function composeProject(repoPath: string): string {
  return `foundry-${basename(repoPath.replace(/\/+$/, '')).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'repo'}`;
}

/** `docker compose ps --format json` prints one object per line (Compose ≥ 2.21) or one array (older) */
export function parsePs(out: string): { Service?: string; State?: string; Health?: string }[] {
  const text = out.trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return text.split('\n').flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  }
}

const firstLine = (s: string) => s.split('\n').map((l) => l.trim()).find(Boolean) ?? null;
const lastLine = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? null;
