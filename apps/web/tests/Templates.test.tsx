import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { TemplateEntry, TemplateVersionView } from '@foundry/core/browser';
import { TemplateCard, TemplateGallery, TemplateInputField } from '../src/components/Templates.tsx';
import { Templates } from '../src/pages/TemplatesPage.tsx';

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

test('Settings → Templates lists yours and Foundry\'s with what each can have done, the folder and the files that cannot be used', () => {
  const html = route(<Templates templates={[reel, mine]} problems={[{ file: 'broken.md', error: 'frontmatter line 2: indent with spaces, not tabs' }]} dir="/data/templates" editors={[{ id: 'vscode', label: 'VS Code', kind: 'editor', available: true, via: 'vscode' } as never]} lang="en" onLang={() => {}} error={null} onError={() => {}} onChanged={() => {}} />);
  expect(html).toContain('Yours');
  expect(html).toContain('Weekly digest');
  expect(html).toContain('Open in VS Code');
  expect(html).toContain('Edit');
  expect(html).toContain('New template');
  expect(html).toContain('Import a file');
  expect(html).toContain('Product reel');
  expect(html).toContain('Make a copy');
  expect(html).toContain('/goals/new?template=video-product-reel');
  expect(html).toContain('/templates/weekly-digest');
  expect(html).toContain('/data/templates');
  expect(html).toContain('broken.md');
  expect(html).toContain('indent with spaces, not tabs');
  expect(html).toContain('href="/help/templates"');
  // a built-in template is viewed and copied, never opened as a file
  expect(html.match(/Open in VS Code/g)).toHaveLength(1);
});
