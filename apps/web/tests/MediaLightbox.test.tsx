import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MediaLightbox } from '../src/components/MediaLightbox.tsx';

const items = [
  { kind: 'image' as const, src: '/a.png', caption: 'front', link: { href: 'https://example.com/a', label: 'found on example.com' } },
  { kind: 'video' as const, src: '/b.webm', caption: 'the walk' },
];

test('the lightbox shows one item with its arrows, its place and its link underneath', () => {
  const html = renderToStaticMarkup(<MediaLightbox items={items} index={0} onIndex={() => {}} onClose={() => {}} title="Pictures" />);
  expect(html).toContain('src="/a.png"');
  // the arrows and the place come after the picture, where a thumb reaches them
  expect(html.indexOf('src="/a.png"')).toBeLessThan(html.indexOf('aria-label="previous"'));
  expect(html).toMatch(/aria-label="previous"[^>]*disabled=""|disabled=""[^>]*aria-label="previous"/);
  expect(html).toContain('1 / 2');
  expect(html).toContain('href="https://example.com/a"');
  // swiping on a touch screen: the media box leaves vertical panning to the page
  expect(html).toContain('touch-pan-y');
});

test('a clip plays inline, and an item that cannot be shown says why', () => {
  const html = renderToStaticMarkup(<MediaLightbox items={items} index={1} onIndex={() => {}} onClose={() => {}} />);
  expect(html).toContain('<video');
  // a phone plays it in the page, not full screen
  expect(html).toContain('playsinline=""');
  const gone = renderToStaticMarkup(<MediaLightbox items={items} index={0} onIndex={() => {}} onClose={() => {}} unavailable={() => 'Not on this computer'} />);
  expect(gone).toContain('Not on this computer');
  expect(gone).not.toContain('src="/a.png"');
});
