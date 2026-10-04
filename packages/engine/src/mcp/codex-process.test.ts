import { expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { codexProcess } from './codex-process.ts';

test.skipIf(process.platform === 'win32')('native process cleanup kills a grandchild after its parent exits on SIGTERM', async () => {
  const home = mkdtempSync(join(tmpdir(), 'foundry-mcp-process-group-'));
  let grandchildPid: number | null = null;
  const bin = join(home, 'parent');
  const grandchild = join(home, 'grandchild.ts');
  writeFileSync(grandchild, `import {writeFileSync} from 'node:fs';process.on('SIGTERM',()=>{});writeFileSync(process.env.CODEX_HOME+'/grandchild.pid',String(process.pid));setInterval(()=>{},1000);`);
  writeFileSync(bin, `#!${process.execPath}\nimport {spawn} from 'node:child_process';spawn(process.execPath,[${JSON.stringify(grandchild)}],{stdio:'ignore',env:process.env});process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);`);
  chmodSync(bin, 0o755);
  const proc = codexProcess({ codexBin: bin, codexHome: home, processHome: home, timeoutMs: 4_000 }, []);
  try {
    for (let i = 0; !existsSync(join(home, 'grandchild.pid')) && i < 200; i++) await Bun.sleep(10);
    grandchildPid = Number(readFileSync(join(home, 'grandchild.pid'), 'utf8'));
    proc.kill();
    await proc.result;
    let alive = true;
    for (let i = 0; alive && i < 100; i++) {
      try { process.kill(grandchildPid, 0); await Bun.sleep(10); } catch { alive = false; }
    }
    expect(alive).toBe(false);
  } finally {
    proc.kill();
    if (grandchildPid) try { process.kill(grandchildPid, 'SIGKILL'); } catch {}
    await proc.result;
    rmSync(home, { recursive: true, force: true });
  }
}, 6_000);
