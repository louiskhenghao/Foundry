import { readdirSync, readFileSync, readlinkSync } from 'node:fs';

/** a TCP port some process of a preview's process tree listens on */
export interface Listener {
  pid: number;
  port: number;
  /** the process's working directory, or null when it cannot be read */
  cwd: string | null;
}

type Run = (argv: string[]) => Promise<string>;

/** a command's output; killed after 5 s (lsof can block on a dead network mount), so polls never pile up */
const run: Run = async (argv) => {
  const proc = Bun.spawn(argv, { stdout: 'pipe', stderr: 'ignore' });
  const timer = setTimeout(() => proc.kill('SIGKILL'), 5_000);
  try {
    const [out] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    return out;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * The ports the process tree under `rootPid` listens on, so a start command that launches several servers (a demo
 * script, `turbo dev`, docker-less orchestrators) shows all of them, not only the one Foundry gave it. Linux reads
 * /proc (the Docker image has no lsof or ps); macOS asks ps and lsof. Never throws: an unreadable tree is no listeners.
 */
export async function listeningPorts(rootPid: number, opts: { platform?: NodeJS.Platform; run?: Run; proc?: string } = {}): Promise<Listener[]> {
  try {
    return (opts.platform ?? process.platform) === 'linux' ? linuxListeners(rootPid, opts.proc ?? '/proc') : await macListeners(rootPid, opts.run ?? run);
  } catch {
    return [];
  }
}

/** every pid under (and including) root, from a pid → parent map */
export function descendants(root: number, parents: Map<number, number>): number[] {
  const children = new Map<number, number[]>();
  for (const [pid, ppid] of parents) {
    const list = children.get(ppid);
    if (list) list.push(pid);
    else children.set(ppid, [pid]);
  }
  const seen = new Set<number>();
  const out: number[] = [];
  for (let queue = [root], i = 0; i < queue.length; i++) {
    const pid = queue[i]!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    out.push(pid);
    for (const child of children.get(pid) ?? []) queue.push(child);
  }
  return out;
}

/** the port of an lsof/ss style address: `*:3000`, `127.0.0.1:3000`, `[::1]:3000` */
export function addressPort(address: string): number | null {
  const m = /:(\d+)$/.exec(address.trim());
  const port = m ? Number(m[1]) : NaN;
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

async function macListeners(root: number, run: Run): Promise<Listener[]> {
  const parents = new Map<number, number>();
  for (const line of (await run(['ps', '-A', '-o', 'pid=,ppid='])).split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (Number.isInteger(pid) && Number.isInteger(ppid)) parents.set(pid!, ppid!);
  }
  const pids = descendants(root, parents);
  if (!pids.length) return [];
  const list = pids.join(',');
  // -F pn: one `p<pid>` line, then one `n<address>` line per socket (and per cwd in the second call)
  // -b -w: never block on a stalled mount, no warnings
  const ports = parseLsof(await run(['lsof', '-b', '-w', '-nP', '-a', '-iTCP', '-sTCP:LISTEN', '-p', list, '-F', 'pn']));
  const cwds = new Map(parseLsof(await run(['lsof', '-b', '-w', '-a', '-d', 'cwd', '-p', list, '-F', 'pn'])).map((r) => [r.pid, r.name]));
  const seen = new Set<number>();
  const out: Listener[] = [];
  for (const { pid, name } of ports) {
    const port = addressPort(name);
    if (port == null || seen.has(port)) continue;
    seen.add(port);
    out.push({ pid, port, cwd: cwds.get(pid) ?? null });
  }
  return out.sort((a, b) => a.port - b.port);
}

export function parseLsof(out: string): { pid: number; name: string }[] {
  const rows: { pid: number; name: string }[] = [];
  let pid = 0;
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && pid) rows.push({ pid, name: line.slice(1) });
  }
  return rows;
}

function linuxListeners(root: number, proc: string): Listener[] {
  const parents = new Map<number, number>();
  for (const entry of readdirSync(proc)) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      // /proc/<pid>/stat: "pid (comm) state ppid …"; comm may hold spaces and parentheses, so split after the last ')'
      const stat = readFileSync(`${proc}/${entry}/stat`, 'utf8');
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      parents.set(Number(entry), ppid);
    } catch {
      /* the process ended while reading */
    }
  }
  const listening = new Map<string, number>(); // socket inode → port
  for (const table of ['tcp', 'tcp6']) {
    let text = '';
    try {
      text = readFileSync(`${proc}/net/${table}`, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n').slice(1)) {
      const f = line.trim().split(/\s+/);
      // local_address is HEXIP:HEXPORT; st 0A is LISTEN; the inode is field 9
      if (f.length < 10 || f[3] !== '0A') continue;
      listening.set(f[9]!, parseInt(f[1]!.split(':')[1]!, 16));
    }
  }
  const out: Listener[] = [];
  const seen = new Set<number>();
  for (const pid of descendants(root, parents)) {
    let fds: string[] = [];
    try {
      fds = readdirSync(`${proc}/${pid}/fd`);
    } catch {
      continue;
    }
    let cwd: string | null = null;
    try {
      cwd = readlinkSync(`${proc}/${pid}/cwd`);
    } catch {}
    for (const fd of fds) {
      let target = '';
      try {
        target = readlinkSync(`${proc}/${pid}/fd/${fd}`);
      } catch {
        continue;
      }
      const inode = /^socket:\[(\d+)\]$/.exec(target)?.[1];
      const port = inode ? listening.get(inode) : undefined;
      if (port == null || seen.has(port)) continue;
      seen.add(port);
      out.push({ pid, port, cwd });
    }
  }
  return out.sort((a, b) => a.port - b.port);
}
