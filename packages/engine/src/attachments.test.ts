import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { AttachmentError, attachmentAbsPath, claimStaged, copyAttachment, linkAttachment, committedDesignReferences, renderAttachments, renderDesignReferences, safeName, stageFile, sweepStaging, trashAttachment } from './attachments.ts';

const data = () => mkdtempSync(join(tmpdir(), 'att-'));

describe('attachments', () => {
  test('stage → claim moves the file under the goal and rewrites the path', () => {
    const d = data();
    const a = stageFile(d, { name: '../evil/mock.png', mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) });
    expect(a.name).toBe('mock.png');
    expect(a.path!.startsWith('attachments/_staging/')).toBe(true);
    const [c] = claimStaged(d, 'g_1', [a]);
    expect(c!.path).toBe(`attachments/g_1/${a.id}/mock.png`);
    expect(existsSync(join(d, c!.path!))).toBe(true);
    expect(attachmentAbsPath(d, 'g_1', c!)).toBe(join(d, c!.path!));
    // claiming again is idempotent
    expect(claimStaged(d, 'g_1', [c!])[0]!.path).toBe(c!.path);
    // another goal cannot read it by path
    expect(attachmentAbsPath(d, 'g_2', c!)).toBeNull();
  });

  test('limits: size, count, bad names, bad urls', () => {
    const d = data();
    expect(() => stageFile(d, { name: 'x.bin', mime: null, bytes: new Uint8Array(11) }, { maxBytes: 10 })).toThrow(AttachmentError);
    expect(() => safeName('...')).toThrow(/invalid/);
    expect(() => linkAttachment('ftp://x')).toThrow(/http/);
    expect(() => linkAttachment('nope')).toThrow(/valid URL/);
    const link = linkAttachment('https://example.com/docs/api', { note: 'API docs' });
    expect(link.name).toBe('example.com/docs/api');
    expect(() => claimStaged(d, 'g', new Array(21).fill(link))).toThrow(/at most/);
    expect(() => claimStaged(d, 'g', [{ ...stageFile(d, { name: 'a', mime: null, bytes: new Uint8Array(1) }), id: 'att_missing', path: 'attachments/_staging/att_missing/a' }])).toThrow(/no longer available/);
  });

  test('trash moves, sweep removes only old staged dirs', () => {
    const d = data();
    const a = claimStaged(d, 'g_1', [stageFile(d, { name: 'a.txt', mime: 'text/plain', bytes: new Uint8Array([65]) })])[0]!;
    trashAttachment(d, 'g_1', a);
    expect(existsSync(join(d, a.path!))).toBe(false);
    expect(existsSync(join(d, 'attachments/_trash', `g_1-${a.id}`))).toBe(true);

    const fresh = stageFile(d, { name: 'f.txt', mime: null, bytes: new Uint8Array(1) });
    const old = stageFile(d, { name: 'o.txt', mime: null, bytes: new Uint8Array(1) });
    const oldDir = join(d, 'attachments/_staging', old.id);
    const past = new Date(Date.now() - 48 * 3600_000);
    utimesSync(oldDir, past, past);
    expect(sweepStaging(d)).toBe(1);
    expect(existsSync(oldDir)).toBe(false);
    expect(existsSync(join(d, 'attachments/_staging', fresh.id))).toBe(true);
  });

  test('renderAttachments lists kinds with how-to-read and absolute paths', () => {
    const d = data();
    const img = claimStaged(d, 'g_1', [stageFile(d, { name: 'mock.png', mime: 'image/png', bytes: new Uint8Array(2048) })])[0]!;
    const pdf = claimStaged(d, 'g_1', [stageFile(d, { name: 'spec.pdf', mime: 'application/pdf', bytes: new Uint8Array(10) })])[0]!;
    const link = linkAttachment('https://example.com/x', { note: 'ref' });
    const s = renderAttachments({ id: 'g_1', attachments: [img, pdf, link] }, d);
    expect(s).toContain('# Attachments from the user');
    expect(s).toContain(`[image] mock.png (image/png, 2 KB) → ${join(d, img.path!)}`);
    expect(s).toContain('[pdf] spec.pdf');
    expect(s).toContain('`pages` parameter');
    expect(s).toContain('[link] https://example.com/x — "ref". Fetch it with WebFetch');
    expect(renderAttachments({ id: 'g', attachments: [] }, d)).toBe('');
  });
});

describe('markdown renditions', () => {
  test('claimStaged moves a staged .md with the file and a link snapshot dir, rewriting markdown.path', async () => {
    const { markdownFileName, conversionTmpPath, markdownAbsPath } = await import('./attachments.ts');
    const { mkdirSync: mk, writeFileSync: wf, renameSync: rn } = await import('node:fs');
    const d = data();
    const f = stageFile(d, { name: 'spec.pdf', mime: 'application/pdf', bytes: new Uint8Array(3) });
    const mdRel = `attachments/_staging/${f.id}/${markdownFileName(f)}`;
    wf(join(d, mdRel), '# spec');
    const staged = { ...f, markdown: { status: 'ready' as const, path: mdRel, bytes: 6, tool: 'markitdown', error: null, at: 'now' } };
    const link = linkAttachment('https://example.com/a');
    mk(join(d, 'attachments/_staging', link.id), { recursive: true });
    wf(join(d, 'attachments/_staging', link.id, 'snapshot.md'), '# page');
    const stagedLink = { ...link, markdown: { status: 'ready' as const, path: `attachments/_staging/${link.id}/snapshot.md`, bytes: 6, tool: 'markitdown', error: null, at: 'now' } };
    const [cf, cl] = claimStaged(d, 'g_9', [staged, stagedLink]);
    expect(cf!.markdown!.path).toBe(`attachments/g_9/${f.id}/spec.pdf.md`);
    expect(markdownAbsPath(d, 'g_9', cf!)).toBe(join(d, cf!.markdown!.path!));
    expect(cl!.path).toBeNull();
    expect(cl!.markdown!.path).toBe(`attachments/g_9/${link.id}/snapshot.md`);
    expect(existsSync(join(d, cl!.markdown!.path!))).toBe(true);
    // scratch path lives outside staging
    expect(conversionTmpPath(d, 'att_x')).toBe(join(d, 'attachments/_tmp/att_x.md'));
    void rn;
  });

  test('renderAttachments prefers the markdown rendition and flags nearly-empty output', async () => {
    const { markitdownHint } = await import('./attachments.ts');
    const d = data();
    const pdf = claimStaged(d, 'g_1', [stageFile(d, { name: 'spec.pdf', mime: 'application/pdf', bytes: new Uint8Array(10) })])[0]!;
    const mdRel = `attachments/g_1/${pdf.id}/spec.pdf.md`;
    const { writeFileSync: wf } = await import('node:fs');
    wf(join(d, mdRel), '# spec\n'.repeat(40));
    const ready = { ...pdf, markdown: { status: 'ready' as const, path: mdRel, bytes: 280, tool: 'markitdown 0.1', error: null, at: '2026-08-21T00:00:00Z' } };
    const s = renderAttachments({ id: 'g_1', attachments: [ready] }, d);
    expect(s).toContain(`converted to markdown (280 B): ${join(d, mdRel)}`);
    expect(s).toContain('Read the markdown first');
    const tiny = { ...ready, markdown: { ...ready.markdown, bytes: 40 } };
    expect(renderAttachments({ id: 'g_1', attachments: [tiny] }, d)).toContain('nearly empty');
    const failed = { ...ready, markdown: { ...ready.markdown, status: 'failed' as const, path: null } };
    expect(renderAttachments({ id: 'g_1', attachments: [failed] }, d)).toContain('`pages` parameter');
    const link = { ...linkAttachment('https://example.com/x'), markdown: { status: 'ready' as const, path: `attachments/g_1/att_l/snapshot.md`, bytes: 900, tool: null, error: null, at: '2026-08-21T00:00:00Z' } };
    const { mkdirSync: mk } = await import('node:fs');
    mk(join(d, 'attachments/g_1/att_l'), { recursive: true });
    wf(join(d, 'attachments/g_1/att_l/snapshot.md'), 'x');
    expect(renderAttachments({ id: 'g_1', attachments: [link] }, d)).toContain('markdown snapshot (900 B, fetched 2026-08-21)');
    expect(markitdownHint(false)).toBe('');
    expect(markitdownHint(true, '/x/markitdown')).toContain('/x/markitdown <file>');
  });
});

describe('design references (ADR-0093)', () => {
  const zip = () => zipSync({ 'index.html': strToU8('<html></html>'), 'assets/app.css': strToU8('body{}'), '__MACOSX/._index.html': strToU8('junk'), '../escape.txt': strToU8('no'), '.DS_Store': strToU8('x'), 'assets/': new Uint8Array() });
  test('a zip is unpacked when staged (junk and escaping entries skipped), its folder moves with the claim and a copy, and index.html is the entry', () => {
    const d = data();
    const a = stageFile(d, { name: 'Landing export.zip', mime: 'application/zip', bytes: zip() });
    expect(a.extracted).toEqual({ dir: `attachments/_staging/${a.id}/Landing export`, files: 2, entry: 'index.html' });
    expect(existsSync(join(d, a.extracted!.dir, 'assets/app.css'))).toBe(true);
    expect(existsSync(join(d, a.extracted!.dir, '__MACOSX'))).toBe(false);
    expect(existsSync(join(d, 'attachments/_staging/escape.txt'))).toBe(false);
    expect(existsSync(join(d, 'attachments/escape.txt'))).toBe(false);
    const [c] = claimStaged(d, 'g_1', [a]);
    expect(c!.extracted!.dir).toBe(`attachments/g_1/${a.id}/Landing export`);
    expect(existsSync(join(d, c!.extracted!.dir, 'index.html'))).toBe(true);
    expect(claimStaged(d, 'g_1', [c!])[0]!.extracted).toEqual(c!.extracted);
    const copy = copyAttachment(d, 'g_2', c!);
    expect(copy.extracted!.dir).toBe(`attachments/g_2/${copy.id}/Landing export`);
    expect(existsSync(join(d, copy.extracted!.dir, 'assets/app.css'))).toBe(true);
  });
  test('bytes that are not a zip stay a plain file; a zip with no page has no entry', () => {
    const d = data();
    expect(stageFile(d, { name: 'x.zip', mime: 'application/zip', bytes: new Uint8Array([1, 2, 3, 4]) }).extracted).toBeNull();
    const pics = stageFile(d, { name: 'shots.zip', mime: null, bytes: zipSync({ 'home.png': new Uint8Array(4), 'about.png': new Uint8Array(4) }) });
    expect(pics.extracted).toEqual({ dir: `attachments/_staging/${pics.id}/shots`, files: 2, entry: null });
    expect(stageFile(d, { name: 'notes.txt', mime: 'text/plain', bytes: new Uint8Array(4) }).extracted).toBeNull();
  });
  test('renderAttachments puts the design references first, as the law, and the other files under Attachments from the user', () => {
    const d = data();
    const img = { ...claimStaged(d, 'g_1', [stageFile(d, { name: 'home.png', mime: 'image/png', bytes: new Uint8Array(10) })])[0]!, design: true };
    const html = { ...claimStaged(d, 'g_1', [stageFile(d, { name: 'home.html', mime: 'text/html', bytes: strToU8('<html></html>') })])[0]!, design: true };
    const archive = { ...claimStaged(d, 'g_1', [stageFile(d, { name: 'export.zip', mime: 'application/zip', bytes: zip() })])[0]!, design: true };
    const pdf = claimStaged(d, 'g_1', [stageFile(d, { name: 'spec.pdf', mime: 'application/pdf', bytes: new Uint8Array(10) })])[0]!;
    const s = renderAttachments({ id: 'g_1', attachments: [pdf, img, html, archive] }, d);
    expect(s.indexOf('# Design reference')).toBe(0);
    expect(s.indexOf('# Design reference')).toBeLessThan(s.indexOf('# Attachments from the user'));
    expect(s).toContain('What the design shows is made as it shows it');
    expect(s).toContain('the design wins');
    expect(s).toContain(`- [image] home.png → ${join(d, img.path!)}. Open it with the Read tool before writing any markup or styles.`);
    expect(s).toContain(`- [html] home.html → ${join(d, html.path!)}. It is source material: read its markup, styles and tokens and port them into this codebase.`);
    expect(s).toContain(`- [zip] export.zip → ${join(d, archive.extracted!.dir)} (2 files; open index.html first). Its HTML, CSS and pictures are source material: read the markup, styles and tokens and port them into this codebase.`);
    expect(s.indexOf('[pdf] spec.pdf')).toBeGreaterThan(s.indexOf('# Attachments from the user'));
    // the design section alone, for the worker prompt; nothing without a design
    expect(renderDesignReferences({ id: 'g_1', attachments: [pdf, img] }, d)).toContain('# Design reference');
    expect(renderDesignReferences({ id: 'g_1', attachments: [pdf] }, d)).toBe('');
    expect(renderAttachments({ id: 'g_1', attachments: [pdf] }, d)).not.toContain('# Design reference');
    // an unpacked zip that is not the design is still listed with its folder
    const plain = renderAttachments({ id: 'g_1', attachments: [{ ...archive, design: false }] }, d);
    expect(plain).not.toContain('# Design reference');
    expect(plain).toContain(`- [zip] export.zip → ${join(d, archive.extracted!.dir)} (2 files; open index.html first). Read the files with the Read tool.`);
  });
  test('a link into a design tool behind a sign-in is listed as one no session can open', () => {
    const d = data();
    const s = renderAttachments({ id: 'g', attachments: [linkAttachment('https://claude.ai/public/artifacts/abc')] }, d);
    expect(s).toContain('- [link] https://claude.ai/public/artifacts/abc — a Claude page: it needs a sign-in, so no session can open it. Treat it as a design that was not supplied; the person was asked to attach an export (HTML, a zip or screenshots) instead.');
    expect(s).not.toContain('WebFetch');
  });
});

describe('committedDesignReferences (ADR-0093)', () => {
  test('finds a committed copy of a design file by content, not by name; a port and a same-named script are not matches', async () => {
    const d = data();
    const repo = mkdtempSync(join(tmpdir(), 'design-ref-repo-'));
    const git = (...args: string[]) => Bun.spawnSync(['git', '-C', repo, ...args], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } });
    git('init', '-q', '-b', 'main');
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4, 5, 6]);
    const html = strToU8('<html><body>design</body></html>');
    writeFileSync(join(repo, 'docs-mockup.png'), png); // the picture, copied in under another name
    writeFileSync(join(repo, 'relay-landing.spec.ts'), strToU8('test("page", () => {})')); // named after the design, not a copy
    writeFileSync(join(repo, 'index.html'), strToU8('<html><body>ported</body></html>')); // a port
    mkdirSync(join(repo, 'assets'), { recursive: true });
    writeFileSync(join(repo, 'assets/app.css'), strToU8('body{}')); // byte-identical to a file inside the zip
    git('add', '-A');
    git('commit', '-q', '-m', 'files');
    const pic = { ...claimStaged(d, 'g_1', [stageFile(d, { name: 'home.png', mime: 'image/png', bytes: png })])[0]!, design: true };
    const page = { ...claimStaged(d, 'g_1', [stageFile(d, { name: 'home.html', mime: 'text/html', bytes: html })])[0]!, design: true };
    const archive = { ...claimStaged(d, 'g_1', [stageFile(d, { name: 'export.zip', mime: 'application/zip', bytes: zipSync({ 'index.html': html, 'assets/app.css': strToU8('body{}') }) })])[0]!, design: true };
    expect(await committedDesignReferences({ id: 'g_1', attachments: [pic, page, archive] }, d, repo, 'main')).toEqual(['assets/app.css', 'docs-mockup.png']);
    expect(await committedDesignReferences({ id: 'g_1', attachments: [{ ...pic, design: false }] }, d, repo, 'main')).toEqual([]);
    rmSync(repo, { recursive: true, force: true });
  });
});
