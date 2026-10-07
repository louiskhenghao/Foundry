import { afterEach, describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodeServer } from './code-server.ts';

const dirs: string[] = [];
const servers: CodeServer[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await s.dispose();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** a stand-in code-server: serves /healthz on the --bind-addr it is given and records its arguments */
function fakeBin(): { bin: string; argsFile: string } {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-code-server-'));
  dirs.push(dir);
  const argsFile = join(dir, 'args.json');
  const bin = join(dir, 'code-server');
  writeFileSync(bin, `#!/usr/bin/env bun
const args = process.argv.slice(2);
await Bun.write(${JSON.stringify(argsFile)}, JSON.stringify(args));
await Bun.write(${JSON.stringify(argsFile)} + '.env', JSON.stringify(process.env));
const [host, port] = args[args.indexOf('--bind-addr') + 1].split(':');
Bun.serve({ hostname: host, port: Number(port), fetch: () => Response.json({ status: 'alive' }) });
`);
  chmodSync(bin, 0o755);
  return { bin, argsFile };
}

describe('CodeServer', () => {
  test('starts on first use on loopback behind a generated password, links the folder here and on the tailnet, and takes the tailnet address down when stopped', async () => {
    const { bin, argsFile } = fakeBin();
    const exposed: number[] = [];
    const removed: number[] = [];
    const dataDir = mkdtempSync(join(tmpdir(), 'foundry-code-server-data-'));
    dirs.push(dataDir);
    const cs = new CodeServer({ dataDir, bin, log: () => {}, expose: async (p) => (exposed.push(p), 'https://mac.tail-1.ts.net:9999'), unexpose: async (p) => void removed.push(p) });
    servers.push(cs);
    expect(cs.status()).toMatchObject({ installed: true, running: false });
    const r = await cs.open('/Users/me/My App');
    const { port } = cs.status();
    expect(r).toEqual({ url: `http://localhost:${port}/?folder=%2FUsers%2Fme%2FMy%20App`, tailnetUrl: 'https://mac.tail-1.ts.net:9999/?folder=%2FUsers%2Fme%2FMy%20App', password: cs.password() });
    expect(r.password).toMatch(/^[\w-]{20,}$/);
    expect((await Bun.file(join(dataDir, 'code-server', 'password')).stat()).mode & 0o777).toBe(0o600);
    const args = JSON.parse(await Bun.file(argsFile).text()) as string[];
    expect(args).toContain(`127.0.0.1:${port}`);
    expect(args.slice(args.indexOf('--auth'), args.indexOf('--auth') + 2)).toEqual(['--auth', 'password']);
    expect(args).not.toContain('--disable-workspace-trust');
    // the editor's terminals get the password and the basics, none of Foundry's keys, and no PORT of their own
    const env = JSON.parse(await Bun.file(`${argsFile}.env`).text()) as Record<string, string>;
    expect(env.PASSWORD).toBe(r.password);
    expect(env.PORT).toBeUndefined();
    expect(Object.keys(env).filter((k) => k.startsWith('FOUNDRY_') || k.endsWith('_API_KEY'))).toEqual([]);
    // a second folder reuses the running editor
    await cs.open('/tmp');
    expect(exposed).toEqual([port!]);
    await cs.stop();
    expect(removed).toEqual([port!]);
    expect(cs.status().running).toBe(false);
  });

  test('not installed: opening says where to install it', async () => {
    const cs = new CodeServer({ dataDir: tmpdir(), bin: null, log: () => {}, expose: async () => null, unexpose: async () => {} });
    expect(cs.status().installed).toBe(false);
    await expect(cs.open('/tmp')).rejects.toThrow(/Settings → Tools/);
  });
});
