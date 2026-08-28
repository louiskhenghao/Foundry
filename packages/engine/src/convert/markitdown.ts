/**
 * Thin wrapper around Microsoft's `markitdown` CLI: turns PDFs, Office documents, HTML, EPUB, … and web pages
 * into markdown *before* a session sees them, so Claude reads one `.md` with the Read tool instead of rendering
 * PDF pages as images or spending a WebFetch. Optional dependency; everything degrades when it is absent.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { exec as defaultExec } from '../git/git.ts';

export interface ConvertResult {
  ok: boolean;
  bytes: number;
  durationMs: number;
  error: string | null;
  truncated: boolean;
}

export interface MarkitdownOptions {
  bin?: string;
  exec?: typeof defaultExec;
  log?: (m: string) => void;
  /** per-file conversion timeout (default 2 min) */
  timeoutMs?: number;
  /** output cap in bytes (default 2 MB); larger outputs are truncated with a trailer */
  maxBytes?: number;
  which?: (bin: string) => string | null;
}

/** Extensions markitdown turns into useful markdown. Text-like files and images are deliberately excluded. */
const CONVERTIBLE = new Set(['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.html', '.htm', '.csv', '.xml', '.epub', '.msg', '.zip', '.rtf', '.odt', '.odp', '.ods']);
const CONVERTIBLE_MIME = [/pdf$/, /msword/, /officedocument/, /ms-excel/, /ms-powerpoint/, /html/, /csv/, /epub/, /vnd\.ms-outlook/, /zip$/, /rtf/, /opendocument/];

export const MARKITDOWN_INSTALL = ['uv', 'tool', 'install', '--python', '3.12', 'markitdown[all]'];

export class Markitdown {
  private bin: string | null;
  private exec: typeof defaultExec;
  private which: (b: string) => string | null;

  constructor(private opts: MarkitdownOptions = {}) {
    this.exec = opts.exec ?? defaultExec;
    this.which = opts.which ?? ((b) => Bun.which(b));
    this.bin = this.locate();
  }

  private locate(): string | null {
    if (this.opts.bin) return existsSync(this.opts.bin) ? this.opts.bin : null;
    const onPath = this.which('markitdown');
    if (onPath) return onPath;
    // `uv tool install` puts shims in ~/.local/bin, which a long-running server may not have on PATH yet
    const local = join(homedir(), '.local', 'bin', 'markitdown');
    return existsSync(local) ? local : null;
  }

  /** Re-detect the binary (after an install). */
  refresh(): boolean {
    this.bin = this.locate();
    return this.bin !== null;
  }
  available(): boolean {
    return this.bin !== null;
  }
  binary(): string | null {
    return this.bin;
  }

  async version(): Promise<string | null> {
    if (!this.bin) return null;
    const r = await this.exec([this.bin, '--version'], homedir(), { timeoutMs: 15_000 }).catch(() => null);
    if (!r || r.code !== 0) return null;
    return (r.stdout || r.stderr).trim().split('\n')[0] ?? null;
  }

  /** The install command for this machine, or null when `uv` is missing (the doctor then shows it as copy-paste). */
  installCommand(): string[] | null {
    return this.which('uv') ? [this.which('uv')!, ...MARKITDOWN_INSTALL.slice(1)] : null;
  }

  /** Should this attachment be converted? Images and plain text are not (Read handles them better). */
  canConvert(name: string, mime: string | null): boolean {
    const ext = extname(name).toLowerCase();
    if (CONVERTIBLE.has(ext)) return true;
    if (!mime) return false;
    if (mime.startsWith('image/') || mime.startsWith('text/')) return false;
    return CONVERTIBLE_MIME.some((re) => re.test(mime));
  }

  async convertFile(abs: string, outMd: string): Promise<ConvertResult> {
    if (!existsSync(abs)) return { ok: false, bytes: 0, durationMs: 0, error: 'source file missing', truncated: false };
    return this.run([abs], dirname(abs), outMd, this.opts.timeoutMs ?? 120_000);
  }

  /** Snapshot an http(s) page (or a YouTube video's transcript) as markdown. */
  async convertUrl(url: string, outMd: string): Promise<ConvertResult> {
    if (!/^https?:\/\//i.test(url)) return { ok: false, bytes: 0, durationMs: 0, error: 'only http(s) URLs are converted', truncated: false };
    return this.run([url], dirname(outMd), outMd, Math.min(this.opts.timeoutMs ?? 120_000, 60_000));
  }

  private async run(input: string[], cwd: string, outMd: string, timeoutMs: number): Promise<ConvertResult> {
    const t0 = Date.now();
    if (!this.bin) return { ok: false, bytes: 0, durationMs: 0, error: 'markitdown not installed', truncated: false };
    mkdirSync(dirname(outMd), { recursive: true });
    const env: Record<string, string> = { NO_COLOR: '1' };
    const r = await this.exec([this.bin, ...input, '-o', outMd], cwd, { timeoutMs, env }).catch((e) => ({ code: -1, stdout: '', stderr: String(e) }));
    const durationMs = Date.now() - t0;
    if (r.code !== 0 || !existsSync(outMd)) {
      const err = (r.stderr || r.stdout).trim().split('\n').filter(Boolean).at(-1) ?? (r.code === -1 ? 'conversion failed' : `markitdown exited ${r.code}`);
      return { ok: false, bytes: 0, durationMs, error: err.slice(0, 300), truncated: false };
    }
    const max = this.opts.maxBytes ?? 2 * 1024 * 1024;
    let bytes = statSync(outMd).size;
    let truncated = false;
    if (bytes > max) {
      const buf = readFileSync(outMd);
      writeFileSync(outMd, Buffer.concat([buf.subarray(0, max), Buffer.from(`\n\n---\n*[foundry: output truncated at ${(max / 1048576).toFixed(0)} MB; original ${(bytes / 1048576).toFixed(1)} MB — read the source file for the rest]*\n`)]));
      bytes = statSync(outMd).size;
      truncated = true;
    }
    this.opts.log?.(`[markitdown] ${basename(input[0]!)} → ${bytes} B in ${durationMs} ms`);
    return { ok: true, bytes, durationMs, error: null, truncated };
  }
}
