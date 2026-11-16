import { sectionOf } from './section-of.ts';
import { SECTIONS } from './sections.tsx';
import { SETTING_TEXT, wordsOf, type SettingKey } from './texts.ts';

/**
 * One thing the Settings search can land on: a setting (named by its path, which its control carries as data-setting),
 * a part of a section that is not one setting (named by its element's id), or a section itself (its card's id).
 */
export interface SettingHit {
  target: string;
  label: string;
  help?: string;
  /** the section (a card's id) it is in */
  section: string;
  /** words people ask for it by that are in neither the label nor the help */
  words?: string;
}

/**
 * The parts of the page that are not one worded setting: a section's own card, and what a component of its own edits
 * (the model presets, the installs, the data folder, the themes, the access tokens). Their ids are on the page.
 */
const PARTS: SettingHit[] = [
  { target: 'models-claude', label: 'Model presets for Claude Code', section: 'models', help: 'Which model each role runs on, per kind of goal; presets of your own.', words: 'preset role worker reviewer clarifier planner opus sonnet haiku fable' },
  { target: 'models-codex', label: 'Codex models and presets', section: 'models', help: 'The model, reasoning effort and fallbacks of each role on Codex.', words: 'preset gpt' },
  { target: 'models-agy', label: 'Antigravity model and effort', section: 'models', help: 'The one model and reasoning effort every role of an Antigravity goal runs on.', words: 'agy gemini' },
  { target: 'deploy-places', label: 'Deploy — where a finished goal goes', section: 'git', help: 'The web hosts, platforms and stores as cards: Vercel, Netlify, Cloudflare Pages, Fly.io, Railway, Render, Expo EAS, App Store Connect, Google Play.', words: 'host platform store token' },
  { target: 'delivery-timings', label: 'Delivery timings (advanced)', section: 'git', help: 'How often a pull request is polled, the grace before "no checks", the checks timeout, the auto-merge wait, the store watch.' },
  { target: 'code-server', label: 'VS Code in the browser (code-server)', section: 'tools', help: 'What Open ▾ → VS Code (web) starts; installed once into ~/.local, no root.', words: 'editor install vscode' },
  { target: 'playwright', label: "Playwright's Chromium", section: 'preview', help: 'The hidden browser of the self-check and the design shots, downloaded once.', words: 'install browser headless' },
  { target: 'notify-test', label: 'Send test message', section: 'notifications', help: 'A test message to every channel that is set up, with the values on the page, saved or not.' },
  { target: 'data-folder', label: 'Data folder', section: 'engine', help: 'Where this Foundry keeps everything: the goals and their history, Settings, access tokens, templates, themes. Another folder, then a restart.', words: 'directory disk move FOUNDRY_DATA_DIR' },
  { target: 'appearance', label: 'Theme', section: 'appearance', help: 'The built-in themes, light or dark, for this browser only.', words: 'colour color dark light mode wayfinding ledger classic' },
  { target: 'own-theme', label: 'Make your own theme', section: 'appearance', help: 'A copy of a theme as a file you edit, imported and exported.' },
  { target: 'access', label: 'Access from other devices', section: 'access', help: 'A token for each person who may open this Foundry from elsewhere; revoke one here.', words: 'password share phone login people' },
  { target: 'about', label: 'Foundry version and updates', section: 'about', help: 'The version running, whether a newer one is out, Check now, and the open source credits.', words: 'upgrade release changelog' },
];

const SECTION_LABEL: Record<string, string> = Object.fromEntries(SECTIONS.map((s) => [s.id, s.label]));
const SECTION_ORDER: Record<string, number> = Object.fromEntries(SECTIONS.map((s, i) => [s.id, i]));

/** everything the search knows: every worded setting in its section, the parts above, and the sections themselves */
export const SETTING_INDEX: SettingHit[] = [
  ...(Object.keys(SETTING_TEXT) as SettingKey[]).flatMap((path) => {
    const section = sectionOf(path);
    return section ? [{ target: path, section, ...wordsOf(path) }] : [];
  }),
  ...PARTS,
  ...SECTIONS.map((s) => ({ target: s.id, label: s.label, section: s.id })),
];

/** the name of a section, for a hit's plate */
export const sectionLabel = (id: string): string => SECTION_LABEL[id] ?? id;

const fold = (s: string) => s.toLowerCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** how well one word of the query fits a hit: at the start of its label best, then at a word of it, in it, in its other words, in its help; 0 = not at all */
function fit(hit: SettingHit, word: string, extra: string): number {
  const label = fold(hit.label);
  if (label.startsWith(word)) return 5;
  if (new RegExp(`(^|[^a-z0-9])${escapeRe(word)}`).test(label)) return 4;
  if (label.includes(word)) return 3;
  if (fold(hit.words ?? '').includes(word) || fold(extra).includes(word) || fold(sectionLabel(hit.section)).includes(word)) return 2;
  if (fold(hit.help ?? '').includes(word)) return 1;
  return 0;
}

/**
 * The hits for a query, best first: every word of the query must fit the hit somewhere (its label, its other words, its
 * section's name, the words `extraWords` adds for it — the environment variable that seeds it — or its help), and the
 * hits whose labels fit best come first, ties in the page's order. At most `limit`.
 */
export function searchSettings(query: string, extraWords: (target: string) => string = () => '', limit = 12): SettingHit[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored: { hit: SettingHit; score: number; at: number }[] = [];
  SETTING_INDEX.forEach((hit, at) => {
    let score = 0;
    const extra = extraWords(hit.target);
    for (const w of words) {
      const f = fit(hit, w, extra);
      if (!f) return;
      score += f;
    }
    scored.push({ hit, score, at });
  });
  scored.sort((a, b) => b.score - a.score || (SECTION_ORDER[a.hit.section] ?? 99) - (SECTION_ORDER[b.hit.section] ?? 99) || a.at - b.at);
  return scored.slice(0, limit).map((s) => s.hit);
}
