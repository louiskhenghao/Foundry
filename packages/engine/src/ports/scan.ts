import { readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { runInGroup } from '../proc.ts';

/**
 * Every TCP port something on this computer listens on, with the process holding it when that can be told. macOS asks
 * `netstat -anv`, which names the process of every socket, the system's and other users' too (`lsof` without sudo only
 * sees the person's own); Linux reads /proc, where another user's sockets have no visible process. Never throws.
 */
export interface Socket {
  port: number;
  /** where it listens: `*`, `127.0.0.1`, `::1`, a tailnet address… */
  address: string;
  pid: number | null;
  /** the process name as the system reports it (netstat cuts it at 15 characters) */
  process: string | null;
}

export interface ProcessInfo {
  pid: number;
  uid: number | null;
  /** the full command name */
  command: string | null;
  cwd: string | null;
}

export type Run = (argv: string[]) => Promise<string>;

const run: Run = async (argv) => (await runInGroup(argv, { cwd: '/', timeoutMs: 5_000 })).stdout;

/**
 * One `netstat -anv -p tcp` LISTEN line: `tcp46 0 0 *.3000 *.* LISTEN … next-server:4242 …`. The local address ends
 * in `.<port>`; the process column is `name:pid`, where the name may hold spaces.
 */
export function parseNetstat(out: string): Socket[] {
  const rows: Socket[] = [];
  for (const line of out.split('\n')) {
    if (!/^tcp/.test(line) || !/\sLISTEN\s/.test(line)) continue;
    const f = line.trim().split(/\s+/);
    const local = f[3] ?? '';
    const dot = local.lastIndexOf('.');
    const port = Number(local.slice(dot + 1));
    if (dot < 0 || !Number.isInteger(port) || port <= 0 || port > 65535) continue;
    // after LISTEN: rxbytes, txbytes, rhiwat, shiwat, then `name:pid` (the name may hold spaces), then the state flags
    const owner = /\sLISTEN\s+\d+\s+\d+\s+\d+\s+\d+\s+(.+?):(\d+)\s+[0-9a-f]{5}\s/.exec(line);
    rows.push({ port, address: local.slice(0, dot), pid: owner ? Number(owner[2]) : null, process: owner ? owner[1]!.trim() : null });
  }
  return rows;
}

/** /proc/net/tcp(6) rows in LISTEN: port, address (hex, as the kernel writes it) and socket inode */
export function parseProcNet(text: string, v6: boolean): { port: number; address: string; inode: string }[] {
  const out: { port: number; address: string; inode: string }[] = [];
  for (const line of text.split('\n').slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f.length < 10 || f[3] !== '0A') continue;
    const [hexIp = '', hexPort = '0'] = f[1]!.split(':');
    const zero = /^0+$/.test(hexIp);
    const loop = v6 ? hexIp === '00000000000000000000000001000000' : hexIp === '0100007F';
    out.push({ port: parseInt(hexPort, 16), address: zero ? '*' : loop ? (v6 ? '::1' : '127.0.0.1') : hexIp, inode: f[9]! });
  }
  return out;
}

function linuxSockets(proc: string): Socket[] {
  const byInode = new Map<string, { port: number; address: string }>();
  for (const [table, v6] of [['tcp', false], ['tcp6', true]] as const) {
    try {
      for (const r of parseProcNet(readFileSync(`${proc}/net/${table}`, 'utf8'), v6)) byInode.set(r.inode, r);
    } catch {
      /* no IPv6 */
    }
  }
  const owners = new Map<string, { pid: number; process: string | null }>();
  for (const entry of readdirSync(proc)) {
    if (!/^\d+$/.test(entry)) continue;
    let fds: string[] = [];
    try {
      fds = readdirSync(`${proc}/${entry}/fd`);
    } catch {
      continue; // another user's process
    }
    let name: string | null = null;
    try {
      name = readFileSync(`${proc}/${entry}/comm`, 'utf8').trim();
    } catch {}
    for (const fd of fds) {
      try {
        const inode = /^socket:\[(\d+)\]$/.exec(readlinkSync(`${proc}/${entry}/fd/${fd}`))?.[1];
        if (inode && byInode.has(inode) && !owners.has(inode)) owners.set(inode, { pid: Number(entry), process: name });
      } catch {}
    }
  }
  return [...byInode].map(([inode, s]) => ({ ...s, pid: owners.get(inode)?.pid ?? null, process: owners.get(inode)?.process ?? null }));
}

export async function listSockets(opts: { platform?: NodeJS.Platform; run?: Run; proc?: string } = {}): Promise<Socket[]> {
  try {
    const platform = opts.platform ?? process.platform;
    if (platform === 'linux') return linuxSockets(opts.proc ?? '/proc');
    if (platform === 'darwin') return parseNetstat(await (opts.run ?? run)(['netstat', '-anv', '-p', 'tcp']));
    return [];
  } catch {
    return [];
  }
}

/** `ps -o pid=,uid=,comm=` lines: the command may hold spaces (an app bundle path) */
export function parsePs(out: string): Map<number, { uid: number; command: string }> {
  const m = new Map<number, { uid: number; command: string }>();
  for (const line of out.split('\n')) {
    const r = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (r) m.set(Number(r[1]), { uid: Number(r[2]), command: r[3]! });
  }
  return m;
}

/** owner, full command name and working directory of these processes (what can be read without sudo) */
export async function processInfo(pids: number[], opts: { platform?: NodeJS.Platform; run?: Run; proc?: string } = {}): Promise<Map<number, ProcessInfo>> {
  const out = new Map<number, ProcessInfo>();
  const unique = [...new Set(pids)].filter((p) => Number.isInteger(p) && p > 0);
  if (!unique.length) return out;
  try {
    const platform = opts.platform ?? process.platform;
    if (platform === 'linux') {
      const proc = opts.proc ?? '/proc';
      for (const pid of unique) {
        let uid: number | null = null;
        let command: string | null = null;
        let cwd: string | null = null;
        try {
          uid = Number(/^Uid:\s+(\d+)/m.exec(readFileSync(`${proc}/${pid}/status`, 'utf8'))?.[1] ?? NaN);
          if (!Number.isInteger(uid)) uid = null;
        } catch {}
        try {
          command = readFileSync(`${proc}/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean).join(' ') || null;
        } catch {}
        try {
          cwd = readlinkSync(`${proc}/${pid}/cwd`);
        } catch {}
        out.set(pid, { pid, uid, command, cwd });
      }
      return out;
    }
    const exec = opts.run ?? run;
    const ps = parsePs(await exec(['ps', '-o', 'pid=,uid=,comm=', '-p', unique.join(',')]));
    const cwds = new Map<number, string>();
    let pid = 0;
    for (const line of (await exec(['lsof', '-b', '-w', '-a', '-d', 'cwd', '-p', unique.join(','), '-F', 'pn'])).split('\n')) {
      if (line.startsWith('p')) pid = Number(line.slice(1));
      else if (line.startsWith('n') && pid) cwds.set(pid, line.slice(1));
    }
    for (const p of unique) out.set(p, { pid: p, uid: ps.get(p)?.uid ?? null, command: ps.get(p)?.command ?? null, cwd: cwds.get(p) ?? null });
  } catch {
    /* what was read so far */
  }
  return out;
}
