import { lstatSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { TransferError } from './errors.ts';

/**
 * The Transfer file is a gzipped tar written by the system `tar`, which streams: transcripts can run to gigabytes. Export
 * stages generated files beside links to the data files they stand for, and `-h` stores what the links point at.
 */
export async function packTransfer(stage: string, out: string): Promise<void> {
  mkdirSync(dirname(out), { recursive: true });
  const r = await Bun.$`tar -czhf ${out} -C ${stage} .`.quiet().nothrow();
  if (r.exitCode !== 0) throw new TransferError(`could not write the Transfer file: ${r.stderr.toString().trim() || `tar exited ${r.exitCode}`}`);
}

/**
 * Unpack a Transfer file into a folder of its own. `tar` keeps members inside it (no absolute paths, no `..`); anything
 * but plain files and folders — a link, a device — refuses the whole file, because what is read from it later must be
 * what it holds and nothing else on this computer.
 */
export async function unpackTransfer(file: string, dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  const r = await Bun.$`tar -xzf ${file} -C ${dir}`.quiet().nothrow();
  if (r.exitCode !== 0) throw new TransferError('this is not a Transfer file: it does not unpack', 422);
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = lstatSync(p);
      if (st.isDirectory()) walk(p);
      else if (!st.isFile()) throw new TransferError(`this Transfer file holds something other than files (${name}); it was not made by Foundry`, 422);
    }
  };
  walk(dir);
}
