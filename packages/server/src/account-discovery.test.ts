import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

for (const provider of ['claude', 'codex'] as const) test(`${provider} installed after startup agrees across Setup, Accounts and sign-in`, async () => {
  const home = mkdtempSync(join(tmpdir(), 'foundry-account-discovery-'));
  mkdirSync(join(home, 'bin'));
  const child = Bun.spawn([process.execPath, '-e', `import { checkAccountDiscovery } from ${JSON.stringify(join(import.meta.dir, 'account-discovery.test-helper.ts'))}; await checkAccountDiscovery(${JSON.stringify(home)}, ${JSON.stringify(provider)});`], {
    env: { ...process.env, PATH: join(home, 'bin') },
    stdout: 'pipe', stderr: 'pipe',
  });
  try {
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
  } finally {
    child.kill();
    await child.exited;
    rmSync(home, { recursive: true, force: true });
  }
}, 15_000);
