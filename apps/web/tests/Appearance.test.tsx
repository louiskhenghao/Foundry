import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BUILTIN_THEMES } from '@foundry/core/browser';
import { Appearance } from '../src/pages/settings/AppearanceCard.tsx';

test('Appearance offers every theme, says which is in use, and how to make your own', () => {
  const mine = { id: 'night-shift', builtIn: false, file: '/data/themes/night-shift.json', theme: { ...BUILTIN_THEMES[0]!.theme, name: 'Night shift', description: 'Mine.' } };
  const html = renderToStaticMarkup(<Appearance themes={[...BUILTIN_THEMES, mine]} problems={[{ file: 'broken.json', error: 'light.page: a colour is written #rgb or #rrggbb, e.g. #1f2933' }]} dir="/data/themes" id="night-shift" mode="system" light />);
  for (const name of ['Wayfinding', 'Classic', 'Night shift']) expect(html).toContain(name);
  // the theme in use is the custom one; its file is named where a built-in theme says "built in"
  expect(html).toContain('aria-label="Night shift, in use"');
  expect(html).toContain('night-shift.json');
  expect(html.match(/built in/g)).toHaveLength(2);
  expect(html).toContain('Same as this computer');
  expect(html).toContain('Make your own theme');
  expect(html).toContain('/data/themes');
  expect(html).toContain('broken.json');
  expect(html).toContain('href="/help/themes"');
});
