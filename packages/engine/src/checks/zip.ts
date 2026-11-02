import { inflateRawSync } from 'node:zlib';

/** one file of a zip archive, as its central directory lists it */
export interface ZipEntry {
  name: string;
  /** 0 = stored, 8 = deflated */
  method: number;
  compressedSize: number;
  size: number;
  /** of the local file header */
  offset: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/**
 * The files of a zip archive (a PPTX is one), read from its central directory: enough to count a deck's slides and read
 * its parts without a zip library. ZIP64 archives (over 4 GB, or over 65,535 files) are not read; a deck is never one.
 */
export function listZip(buf: Buffer): ZipEntry[] {
  const min = Math.max(0, buf.length - 22 - 65_535);
  let at = -1;
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      at = i;
      break;
    }
  }
  if (at < 0) throw new Error('not a zip archive (no end-of-central-directory record)');
  const count = buf.readUInt16LE(at + 10);
  const cdOffset = buf.readUInt32LE(at + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error('a ZIP64 archive: not read');
  const out: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL) throw new Error('a damaged zip archive (central directory)');
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    out.push({ name, method, compressedSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** the bytes of one file of the archive */
export function readZipEntry(buf: Buffer, e: ZipEntry): Buffer {
  if (e.offset + 30 > buf.length || buf.readUInt32LE(e.offset) !== LOCAL) throw new Error(`a damaged zip archive (local header of ${e.name})`);
  const nameLen = buf.readUInt16LE(e.offset + 26);
  const extraLen = buf.readUInt16LE(e.offset + 28);
  const start = e.offset + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + e.compressedSize);
  if (e.method === 0) return Buffer.from(data);
  if (e.method === 8) return inflateRawSync(data);
  throw new Error(`${e.name} is compressed with method ${e.method}, which is not read`);
}

/** what a PPTX holds: its slides in order, each with whether it carries any text or picture */
export interface DeckContents {
  slides: { n: number; text: boolean; picture: boolean }[];
  /** `<Slides>` from docProps/app.xml when present */
  declared: number | null;
}

/** read a PPTX: the parts a presentation must have, its slides and what each carries */
export function readDeck(buf: Buffer): DeckContents {
  const entries = listZip(buf);
  const byName = new Map(entries.map((e) => [e.name, e]));
  if (!byName.has('[Content_Types].xml') || !byName.has('ppt/presentation.xml')) throw new Error('not a PowerPoint file (no ppt/presentation.xml)');
  const slides = entries
    .map((e) => ({ e, m: /^ppt\/slides\/slide(\d+)\.xml$/.exec(e.name) }))
    .filter((x): x is { e: ZipEntry; m: RegExpExecArray } => !!x.m)
    .map((x) => ({ e: x.e, n: Number(x.m[1]) }))
    .sort((a, b) => a.n - b.n)
    .map(({ e, n }) => {
      const xml = readZipEntry(buf, e).toString('utf8');
      return { n, text: /<a:t>[^<]*\S[^<]*<\/a:t>/.test(xml), picture: /<p:pic\b|<a:blip\b/.test(xml) };
    });
  const app = byName.get('docProps/app.xml');
  const declared = app ? Number(/<Slides>(\d+)<\/Slides>/.exec(readZipEntry(buf, app).toString('utf8'))?.[1] ?? NaN) : NaN;
  return { slides, declared: Number.isFinite(declared) ? declared : null };
}
