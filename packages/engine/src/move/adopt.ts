/**
 * After a move (ADR-0107): the installer's record (install.env) and the `foundry` command name the install the goals
 * are in now. The release's own install.sh does it (`install.sh adopt`), so the command is the one the installer writes.
 * Only while the record still names a source or Docker install: a record of the person's own making is left alone.
 */
import { join } from 'node:path';
import { readInstallEnv } from '../migrate.ts';
import { localProbe, type Probe } from './probe.ts';

export async function adoptInstall(o: { root: string; kind: 'app' | 'binary'; execPath: string; log: (m: string) => void; probe?: Probe }): Promise<boolean> {
  const probe = o.probe ?? localProbe();
  const recorded = readInstallEnv(probe.env, probe.home);
  if (!recorded || !['source', 'docker'].includes(recorded.MODE ?? '')) return false;
  const script = join(o.root, 'install.sh');
  if (!probe.exists(script)) return false;
  // a binary install runs releases/<version>/foundry; its command names the current one
  const bin = o.kind === 'binary' ? o.execPath.replace(/\/releases\/[^/]+\/foundry$/, '/current/foundry') : o.execPath;
  const r = await probe.run(['bash', script, 'adopt', '--mode', o.kind, '--bin', bin], { timeoutMs: 60_000 });
  if (r.code !== 0) {
    o.log(`the foundry command still names the ${recorded.MODE} install: ${(r.stderr || r.stdout).trim().split('\n').pop()}`);
    return false;
  }
  o.log(`the foundry command and ${join('~/.config/foundry', 'install.env')} name this install now`);
  return true;
}
