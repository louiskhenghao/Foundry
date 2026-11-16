import { Search } from 'lucide-react';
import { useMemo, useState, type KeyboardEvent } from 'react';
import { cn } from '../../ui.tsx';
import { searchSettings, sectionLabel, type SettingHit } from './search-index.ts';
import { SECTION_STYLE } from './sections.tsx';

/**
 * The search box of the Settings page: as you type, the settings whose words fit drop down under it, each with the name
 * of its section; a click, or ↓ ↑ and Enter, hands the hit to `onPick`, which opens its section and scrolls to it.
 * `extraWords` adds words to a hit that its label and help do not say (the environment variable that seeds a setting).
 */
export function SettingsSearch({ onPick, extraWords, className }: { onPick: (hit: SettingHit) => void; extraWords?: (target: string) => string; className?: string }) {
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const hits = useMemo(() => searchSettings(q, extraWords), [q, extraWords]);
  const open = focused && q.trim() !== '';
  const pick = (hit: SettingHit) => {
    setQ('');
    setActive(0);
    onPick(hit);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && hits.length) {
      e.preventDefault();
      setActive((a) => (a + 1) % hits.length);
    } else if (e.key === 'ArrowUp' && hits.length) {
      e.preventDefault();
      setActive((a) => (a - 1 + hits.length) % hits.length);
    } else if (e.key === 'Enter' && open && hits[active]) {
      e.preventDefault();
      pick(hits[active]);
    } else if (e.key === 'Escape') {
      setQ('');
      setActive(0);
    }
  };
  const current = hits[Math.min(active, hits.length - 1)];
  return (
    <div className={cn('relative', className)}>
      <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
      <input
        type="search"
        role="combobox"
        aria-label="Search settings"
        aria-expanded={open}
        aria-controls="settings-search-hits"
        aria-activedescendant={open && current ? `settings-hit-${hits.indexOf(current)}` : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
        placeholder="Search settings…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={onKey}
        className="w-full rounded-md border border-line-strong bg-panel py-1 pl-8 pr-2 text-xs text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none [&::-webkit-search-cancel-button]:appearance-none"
      />
      {open && (
        <ul id="settings-search-hits" role="listbox" aria-label="Settings found" className="absolute left-0 top-full z-30 mt-1 max-h-80 w-[min(26rem,calc(100vw-2rem))] overflow-auto rounded-lg border border-line bg-panel p-1 shadow-[var(--surface-shadow)]">
          {hits.length === 0 && <li className="px-2.5 py-2 text-xs text-ink-faint">Nothing is called that. Try another word, or the name of a section.</li>}
          {hits.map((hit, i) => (
            // the mouse-down is swallowed so the box keeps its focus and the list stays for the click
            <li key={hit.target} id={`settings-hit-${i}`} role="option" aria-selected={hit === current} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => pick(hit)} className={cn('flex cursor-pointer items-start gap-3 rounded-md px-2.5 py-1.5', hit === current && 'bg-sunken')}>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-ink">{hit.label}</span>
                {hit.help && <span className="block truncate text-[11px] text-ink-faint">{hit.help}</span>}
              </span>
              <span className="mt-0.5 inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] text-ink-soft">
                <span className={cn('h-2 w-2 shrink-0 rounded-[2px]', SECTION_STYLE[hit.section]?.dot ?? 'bg-line-strong')} aria-hidden="true" />
                {sectionLabel(hit.section)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
