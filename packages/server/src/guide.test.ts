import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { headingAnchor } from '@foundry/core';
import { GUIDE_ORDER, guideFile, listGuide, readGuide } from './guide.ts';

const ROOT = resolve(import.meta.dir, '../../..');
const GUIDE = join(ROOT, 'docs/guide');
const read = (p: string) => readFileSync(p, 'utf8');
const pages = readdirSync(GUIDE).filter((f) => f.endsWith('.md'));
const enPages = pages.filter((f) => !f.endsWith('.zh.md'));

/** the markdown outside fenced code blocks */
const prose = (md: string) => md.replace(/^```[\s\S]*?^```/gm, '');
/** h1–h3 only: those are the headings the Help page gives an id */
const headings = (md: string) => [...prose(md).matchAll(/^(#{1,3})\s+(.+?)\s*$/gm)].map((m) => ({ level: m[1]!.length, text: m[2]! }));
const anchors = (file: string) => new Set(headings(read(file)).map((h) => headingAnchor(h.text.replace(/[*_`]/g, ''))));
const links = (md: string) => [...prose(md).matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]!);
const images = (md: string) => [...prose(md).matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]!);

describe('user guide (docs/guide)', () => {
  test('every page in the reading order exists, in English and 中文', () => {
    for (const slug of GUIDE_ORDER) {
      expect(existsSync(join(GUIDE, `${guideFile(slug)}.md`)), `${guideFile(slug)}.md`).toBe(true);
      expect(existsSync(join(GUIDE, `${guideFile(slug)}.zh.md`)), `${guideFile(slug)}.zh.md`).toBe(true);
    }
  });

  test('every English page has a 中文 page with the same sections and screenshots', () => {
    for (const en of enPages) {
      const zh = en.replace(/\.md$/, '.zh.md');
      expect(existsSync(join(GUIDE, zh)), zh).toBe(true);
      const [a, b] = [read(join(GUIDE, en)), read(join(GUIDE, zh))];
      expect(headings(b).map((h) => h.level), `${zh} headings`).toEqual(headings(a).map((h) => h.level));
      expect(images(b), `${zh} images`).toEqual(images(a));
    }
    for (const zh of pages.filter((f) => f.endsWith('.zh.md'))) expect(existsSync(join(GUIDE, zh.replace(/\.zh\.md$/, '.md'))), zh).toBe(true);
  });

  test('every relative link points to a file that exists, and to a heading that exists', () => {
    const broken: string[] = [];
    for (const page of pages) {
      for (const href of links(read(join(GUIDE, page)))) {
        if (/^[a-z]+:/i.test(href)) continue;
        const [path, hash] = href.split('#') as [string, string | undefined];
        const target = path ? resolve(GUIDE, path) : join(GUIDE, page);
        if (!existsSync(target)) broken.push(`${page}: ${href} (no such file)`);
        else if (hash && target.endsWith('.md') && !anchors(target).has(hash)) broken.push(`${page}: ${href} (no such heading)`);
      }
    }
    expect(broken).toEqual([]);
  });

  test('every screenshot a page shows is in docs/guide/images', () => {
    const missing: string[] = [];
    for (const page of pages) for (const src of images(read(join(GUIDE, page)))) if (!existsSync(resolve(GUIDE, src))) missing.push(`${page}: ${src}`);
    expect(missing).toEqual([]);
    // the Docker image and the Help page serve only these; keep them flat PNGs
    for (const src of pages.flatMap((p) => images(read(join(GUIDE, p))))) expect(src).toMatch(/^(\.\/)?images\/[\w-]+\.png$/);
  });

  test('Settings explained has a section for every section of the Settings page', () => {
    const sections = read(join(ROOT, 'apps/web/src/pages/SettingsPage.tsx')).match(/const SECTIONS[^=]*=\s*\[([\s\S]*?)\];/)?.[1] ?? '';
    const labels = [...sections.matchAll(/label: '([^']+)'/g)].map((m) => m[1]!);
    expect(labels.length).toBeGreaterThan(5);
    for (const file of ['settings.md', 'settings.zh.md']) {
      const texts = headings(read(join(GUIDE, file))).map((h) => h.text);
      // UI labels stay in English in both languages, so the same "?" anchor works for both
      expect(labels.filter((l) => !texts.includes(l)), file).toEqual([]);
    }
  });

  test('every "?" link in the app opens a page and heading that exist, in both languages', () => {
    const web = join(ROOT, 'apps/web/src');
    const files = readdirSync(web, { recursive: true }).map(String).filter((f) => f.endsWith('.tsx'));
    const targets = files.flatMap((f) => [...read(join(web, f)).matchAll(/<HelpLink[^>]*\bto="([^"]+)"/g)].map((m) => ({ file: f, to: m[1]! })));
    expect(targets.length).toBeGreaterThan(0);
    const broken: string[] = [];
    for (const { file, to } of targets) {
      const [slug, hash] = to.split('#') as [string, string | undefined];
      for (const page of [`${guideFile(slug)}.md`, `${guideFile(slug)}.zh.md`]) {
        const path = join(GUIDE, page);
        if (!existsSync(path)) broken.push(`${file}: ${to} (no ${page})`);
        else if (hash && !anchors(path).has(hash)) broken.push(`${file}: ${to} (no heading in ${page})`);
      }
    }
    expect(broken).toEqual([]);
  });
});

describe('guide pages served to the Help page', () => {
  test('lists pages in reading order, with their English and 中文 titles', () => {
    const list = listGuide(GUIDE);
    expect(list.map((p) => p.slug).slice(0, GUIDE_ORDER.length)).toEqual(GUIDE_ORDER);
    expect(list.every((p) => p.title && p.zh)).toBe(true);
    expect(list.find((p) => p.slug === 'faq')?.zh).toMatch(/[\u4e00-\u9fff]/);
  });
  test('falls back to English and refuses paths outside the guide', () => {
    expect(readGuide(GUIDE, 'index', 'zh')?.lang).toBe('zh');
    expect(readGuide(GUIDE, 'index', 'en')?.lang).toBe('en');
    expect(readGuide(GUIDE, 'README', 'en')).toBeNull();
    expect(readGuide(GUIDE, '../README', 'en')).toBeNull();
    expect(readGuide(GUIDE, 'no-such-page', 'en')).toBeNull();
  });
});
