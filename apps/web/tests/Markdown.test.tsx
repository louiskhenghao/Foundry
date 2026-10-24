import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../src/components/Markdown.tsx';

describe('Markdown (words from models and people)', () => {
  test('words in angle brackets are shown as written, not swallowed as HTML', () => {
    const html = renderToStaticMarkup(<Markdown source={'An English <p>, then a <p lang="zh-Hans"> under it; the page <title> too.'} />);
    expect(html).toContain('An English &lt;p&gt;, then a &lt;p lang=&quot;zh-Hans&quot;&gt; under it; the page &lt;title&gt; too.');
  });
  test('a block of HTML on its own lines is shown as text, never rendered', () => {
    const html = renderToStaticMarkup(<Markdown source={'Before.\n\n<div class="x">inside <script>alert(1)</script></div>\n\nAfter.'} />);
    expect(html).toContain('&lt;div class=&quot;x&quot;&gt;inside &lt;script&gt;alert(1)&lt;/script&gt;&lt;/div&gt;');
    expect(html).not.toContain('<div class="x">');
    expect(html).not.toContain('<script>');
  });
  test('an HTML comment stays hidden, and code spans still render as code', () => {
    const html = renderToStaticMarkup(<Markdown source={'<!-- for the tooling -->\nUse `<title>` here.'} />);
    expect(html).not.toContain('for the tooling');
    expect(html).toContain('<code>&lt;title&gt;</code>');
  });
});
