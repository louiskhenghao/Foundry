import { expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Zap } from 'lucide-react';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { siTelegram } from 'simple-icons';
import { PlaceCard } from '../src/pages/settings/PlaceCard.tsx';
import { SETTING_INDEX, searchSettings } from '../src/pages/settings/search-index.ts';
import { SettingsSearch } from '../src/pages/settings/SettingsSearch.tsx';
import { SETTING_TEXT } from '../src/pages/settings/texts.ts';
import { CheckRow } from '../src/ui.tsx';

/** every page source under pages/, as one text */
const pages = (() => {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f)) out.push(readFileSync(p, 'utf8'));
    }
  };
  walk(join(import.meta.dir, '../src/pages'));
  return out.join('\n');
})();
const labels = (hits: { label: string }[]) => hits.map((h) => h.label);

test('every worded setting is in the index under a section, and every part the index names is on the page', () => {
  const indexed = new Set(SETTING_INDEX.map((h) => h.target));
  const lost = Object.keys(SETTING_TEXT).filter((p) => !indexed.has(p));
  expect(lost).toEqual([]);
  // a part or a section is found by its element's id; a setting by the data-setting its control carries
  const missing = SETTING_INDEX.filter((h) => !(h.target in SETTING_TEXT) && !pages.includes(`id="${h.target}"`)).map((h) => h.target);
  expect(missing).toEqual([]);
  expect(SETTING_INDEX.length).toBeGreaterThan(120);
});

test('a setting is found by its label first, then by its other words, its environment variable or its help', () => {
  expect(labels(searchSettings('telegram'))[0]).toBe('Telegram bot token');
  expect(labels(searchSettings('port')).slice(0, 2)).toEqual(['Port', 'First port']);
  expect(labels(searchSettings('cost cap'))[0]).toBe('Claude cost cap per session (USD)');
  // the environment variable is not in the words of the page: the page adds it per setting
  expect(labels(searchSettings('FOUNDRY_PORT', (target) => (target === 'engine.port' ? 'FOUNDRY_PORT' : '')))).toEqual(['Port']);
  expect(labels(searchSettings('FOUNDRY_PORT'))).toEqual([]);
  // chromium is in the self-check's help and among Playwright's words
  const chromium = labels(searchSettings('chromium'));
  expect(chromium).toContain('Self-check new goals by default');
  expect(chromium).toContain("Playwright's Chromium");
  // a section by its name, every word of a query somewhere, nothing for a word the page never says
  expect(searchSettings('beta').some((h) => h.target === 'beta')).toBe(true);
  expect(searchSettings('telegram discord')).toEqual([]);
  expect(searchSettings('zzzz')).toEqual([]);
  expect(searchSettings('   ')).toEqual([]);
  expect(searchSettings('a').length).toBeLessThanOrEqual(12);
});

test('a setting inside a closed place card is still in the page, hidden, so the search can open its card', () => {
  const closed = renderToStaticMarkup(
    <PlaceCard id="telegram" logo={siTelegram} name="Telegram" tagline="Messages from a bot" status="unset" open={false} onToggle={() => {}}>
      <label data-setting="notifications.telegramBotToken">token</label>
    </PlaceCard>,
  );
  expect(closed).toContain('data-place="telegram"');
  expect(closed).toMatch(/<div id="place-telegram" hidden="">.*data-setting="notifications.telegramBotToken"/);
  expect(closed).toContain('Not set up');
  // open without a tool or an access step: the fields alone, no numbered steps
  const open = renderToStaticMarkup(
    <PlaceCard id="tailscale" logo={{ Icon: Zap, hex: 'F55036', title: 'Tailscale' }} name="Tailscale" tagline="Links" status="set" statusWord="Auto" open onToggle={() => {}}>
      <label>name</label>
    </PlaceCard>,
  );
  expect(open).not.toContain('<ol');
  expect(open).toContain('>Auto<');
  expect(open).toContain('aria-label="Tailscale"');
  // with an access step, the steps are numbered from one and the fields are the last
  const steps = renderToStaticMarkup(
    <PlaceCard id="gemini" logo={siTelegram} name="Gemini" tagline="Pictures" status="partial" open onToggle={() => {}} access={<span>where</span>}>
      <label>key</label>
    </PlaceCard>,
  );
  expect(steps).toContain('<ol');
  expect(steps).toMatch(/>1<.*Access.*>2<.*What Foundry keeps/s);
  expect(steps).not.toContain('The tool');
});

test('a check row puts the box in a column of its own, level with the first line, with the help under the words', () => {
  const h = renderToStaticMarkup(<CheckRow checked onChange={() => {}} label="Review every task" help="Run the reviewer" aside={<b>saved</b>} setting="reviews.alwaysReviewTasks" />);
  expect(h).toMatch(/^<label class="grid grid-cols-\[1rem_minmax\(0,1fr\)\][^"]*" data-setting="reviews.alwaysReviewTasks"><input type="checkbox" class="m-0 size-4 self-start"/);
  expect(h).toMatch(/Review every task.*saved.*<span class="col-start-2[^"]*">Run the reviewer/);
});

test('the search box is a combobox that lists nothing until something is typed', () => {
  const h = renderToStaticMarkup(<SettingsSearch onPick={() => {}} />);
  expect(h).toContain('role="combobox"');
  expect(h).toContain('aria-expanded="false"');
  expect(h).not.toContain('role="listbox"');
});
