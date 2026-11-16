import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { TemplateEntry, TemplateVersionView } from '@foundry/core/browser';
import { TemplateCard, TemplateGallery, TemplateInputField, TemplatePreview } from '../src/components/Templates.tsx';
import { Templates, UseTemplateDialog } from '../src/pages/TemplatesPage.tsx';

const version = (over: Partial<TemplateVersionView> = {}): TemplateVersionView => ({ lang: 'en', name: 'Product reel', summary: 'A short film that shows a product off.', nature: 'video', settings: {}, inputs: [{ key: 'product', type: 'text', other: false }, { key: 'duration', type: 'choice', other: false, options: ['30 s', '60 s'], default: '30 s' }], body: 'A {{duration}} reel for {{product}}.', file: null, warnings: [], ...over });
const reel: TemplateEntry = { id: 'video-product-reel', builtIn: true, nature: 'video', settings: { videoPack: 'motion-studio' }, en: version(), zh: version({ lang: 'zh', name: '产品 reel' }) };
const mine: TemplateEntry = { id: 'weekly-digest', builtIn: false, nature: 'docs', settings: {}, en: version({ name: 'Weekly digest', nature: 'docs', summary: 'Every Monday.', inputs: [{ key: 'week', type: 'text', other: false }], body: 'The {{week}} digest.', file: '/data/templates/weekly-digest.md' }), zh: null };
const route = (el: React.ReactElement) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);

test('a template card names the template in the language shown, its kind and what it asks', () => {
  const en = renderToStaticMarkup(<TemplateCard entry={reel} lang="en" onChoose={() => {}} />);
  expect(en).toContain('Product reel');
  expect(en).toContain('A short film that shows a product off.');
  expect(en).toContain('Video');
  expect(en).toContain('2 inputs');
  expect(en).toContain('(1 required)');
  expect(en).toContain('EN · 中文');
  expect(en).not.toContain('yours');
  const zh = renderToStaticMarkup(<TemplateCard entry={reel} lang="zh" onChoose={() => {}} chosen />);
  expect(zh).toContain('产品 reel');
  expect(zh).toContain('aria-pressed="true"');
  expect(renderToStaticMarkup(<TemplateCard entry={mine} lang="zh" onChoose={() => {}} />)).toContain('yours');
  // a template with one language shows that one whatever the switch says
  expect(renderToStaticMarkup(<TemplateCard entry={mine} lang="zh" onChoose={() => {}} />)).toContain('Weekly digest');
});

test('the gallery opens on the kind of goal the form has, every kind while it says Auto, with a search and the language switch', () => {
  const all = route(<TemplateGallery open templates={[reel, mine]} lang="en" onLang={() => {}} onClose={() => {}} onChoose={() => {}} chosen={null} initialKind="auto" />);
  expect(all).toContain('Product reel');
  expect(all).toContain('Weekly digest');
  expect(all).toContain('Search templates');
  expect(all).toContain('aria-selected="true"');
  const video = route(<TemplateGallery open templates={[reel, mine]} lang="en" onLang={() => {}} onClose={() => {}} onChoose={() => {}} chosen={reel} initialKind="video" />);
  expect(video).toContain('Product reel');
  expect(video).not.toContain('Weekly digest');
  expect(video).toContain('aria-pressed="true"');
  expect(route(<TemplateGallery open={false} templates={[reel]} lang="en" onLang={() => {}} onClose={() => {}} onChoose={() => {}} chosen={null} initialKind="auto" />)).toBe('');
});

test('an input field is a line, a paragraph or a choice, marked when required and still empty', () => {
  const text = renderToStaticMarkup(<TemplateInputField input={{ key: 'product_name', type: 'text', other: false, help: 'In a line.' }} value="" onChange={() => {}} missing />);
  expect(text).toContain('Product name');
  expect(text).toContain('In a line.');
  expect(text).toContain('*');
  expect(text).toContain('<input');
  const choice = renderToStaticMarkup(<TemplateInputField input={{ key: 'duration', type: 'choice', other: true, options: ['30 s', '60 s'], default: '30 s' }} value="30 s" onChange={() => {}} />);
  expect(choice).toContain('<select');
  expect(choice).toContain('Something else…');
  expect(choice).not.toContain('>*<');
  const para = renderToStaticMarkup(<TemplateInputField input={{ key: 'brand', type: 'textarea', other: false, required: false }} value="" onChange={() => {}} />);
  expect(para).toContain('<textarea');
});

test('a template read in the dialog shows its words with the blanks named, offers a new goal, a copy and (for yours) the editor', () => {
  const built = route(<TemplatePreview entry={reel} lang="en" onLang={() => {}} onClose={() => {}} onCopy={() => {}} />);
  expect(built).toContain('Product reel');
  expect(built).toContain('［Duration］');
  expect(built).toContain('［Product］');
  expect(built).toContain('Use on a new goal');
  expect(built).toContain('Make a copy');
  expect(built).not.toContain('>Edit<');
  expect(built).toContain('With blanks');
  expect(built).toContain('Filled in');
  expect(built).toContain('brings: engine motion-studio');
  // asked to hand Use back (the Templates page confirms first), the dialog's Use is a button, not the form's link
  const handed = route(<TemplatePreview entry={reel} lang="en" onLang={() => {}} onClose={() => {}} onCopy={() => {}} onUse={() => {}} />);
  expect(handed).toContain('Use on a new goal');
  expect(handed).not.toContain('/goals/new?template=');
  const own = route(<TemplatePreview entry={mine} lang="en" onLang={() => {}} onClose={() => {}} onCopy={() => {}} />);
  expect(own).toContain('Edit');
  expect(own).toContain('/templates/weekly-digest');
  expect(route(<TemplatePreview entry={null} lang="en" onLang={() => {}} onClose={() => {}} onCopy={() => {}} />)).toBe('');
});

test('the Templates page is a gallery: the kinds as tabs, your shelf, then Foundry\'s by kind, each card with what can be done, and the folder', () => {
  const html = route(<Templates templates={[reel, mine]} problems={[{ file: 'broken.md', error: 'frontmatter line 2: indent with spaces, not tabs' }]} dir="/data/templates" editors={[{ id: 'vscode', label: 'VS Code', kind: 'editor', available: true, via: 'vscode' } as never]} lang="en" onLang={() => {}} error={null} onError={() => {}} onChanged={() => {}} />);
  // the tabs: All, then every kind a template exists for, in the kinds' order
  expect(html.match(/role="tab"/g)).toHaveLength(3);
  expect(html).toMatch(/role="tab" aria-selected="true"[^>]*>All</);
  expect(html.indexOf('>Documents<')).toBeLessThan(html.indexOf('>Video<'));
  // the shelves: Yours first, then one per kind of Foundry's
  expect(html.indexOf('>Yours<')).toBeLessThan(html.indexOf('Foundry&#x27;s — Films'));
  expect(html).toContain('Weekly digest');
  expect(html).toContain('Product reel');
  expect(html).toContain('A short film that shows a product off.');
  expect(html).toContain('New template');
  expect(html).toContain('Import a file');
  // every card: Use (asks first, so no link yet) and View; Make a copy on Foundry's, Edit on yours; the ⋯ menu
  expect(html.match(/>Use</g)).toHaveLength(2);
  expect(html.match(/>View</g)).toHaveLength(2);
  expect(html).not.toContain('/goals/new?template=');
  expect(html.match(/Make a copy/g)).toHaveLength(1);
  expect(html).toContain('/templates/weekly-digest');
  expect(html).toContain('aria-label="More for Weekly digest"');
  // a shelf of two or fewer pages has no arrows
  expect(html).not.toContain('aria-label="Next page"');
  expect(html).toContain('/data/templates');
  expect(html).toContain('broken.md');
  expect(html).toContain('indent with spaces, not tabs');
  expect(html).toContain('href="/help/templates"');
});

test('a shelf with more than eight templates pages them, with arrows and a dot per page', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ ...reel, id: `reel-${i}`, en: version({ name: `Reel ${i}` }), zh: null }));
  const html = route(<Templates templates={many} problems={[]} dir={null} editors={[]} lang="en" onLang={() => {}} error={null} onError={() => {}} onChanged={() => {}} />);
  expect(html).toContain('Reel 7');
  expect(html).not.toContain('Reel 8');
  expect(html).toContain('aria-label="Next page"');
  expect(html).toContain('page 1 of 2');
});

test('Use asks first: the dialog names the template, what it asks for and what it brings', () => {
  const html = route(<UseTemplateDialog entry={reel} lang="en" onClose={() => {}} onConfirm={() => {}} />);
  expect(html).toContain('Use “Product reel” for a new goal?');
  expect(html).toContain('2 blanks to fill (1 required)');
  expect(html).toContain('brings engine motion-studio');
  expect(html).toContain('Nothing starts until you submit the form.');
  expect(route(<UseTemplateDialog entry={null} lang="en" onClose={() => {}} onConfirm={() => {}} />)).toBe('');
});

test('the AI\'s values are listed in the template\'s order under its labels, then any key it does not know', async () => {
  const { draftRows } = await import('../src/components/Templates.tsx');
  const inputs = [{ key: 'object', label: 'The device', type: 'text' as const, other: false }, { key: 'live', label: 'What is live', type: 'textarea' as const, other: false }, { key: 'accent', type: 'choice' as const, other: false, options: ['ember', 'cyan'] }];
  expect(draftRows({ accent: 'cyan', live: 'the screen', object: 'a tape deck', stray: 'x' }, inputs)).toEqual([
    ['object', 'The device', 'a tape deck'],
    ['live', 'What is live', 'the screen'],
    ['accent', 'Accent', 'cyan'],
    ['stray', 'Stray', 'x'],
  ]);
});

