import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A credential kept in Settings, handed to a command as a file (a server's SSH key, ADR-0091): written under the data
 * folder readable by its owner only, for as long as `fn` runs, and removed after it whatever `fn` did. Nothing of it
 * stays on disk between two runs, and no command line Foundry records carries its value.
 */
export async function withSecretFile<T>(dataDir: string, name: string, content: string, fn: (path: string) => Promise<T>): Promise<T> {
  const root = join(dataDir, 'tmp');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const dir = mkdtempSync(join(root, 'secret-'));
  const path = join(dir, name);
  // an OpenSSH key must end in a newline, and ssh refuses a key file others can read
  writeFileSync(path, content.endsWith('\n') ? content : `${content}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  try {
    return await fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
