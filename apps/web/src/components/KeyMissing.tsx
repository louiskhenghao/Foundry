import { KeyRound } from 'lucide-react';
import { Link } from 'react-router-dom';

/**
 * A skill whose sessions lack an API key it needs: which key, what is lost, and where to set it. Only you can set it,
 * so it is a small plate in the yellow tint.
 */
export function KeyMissing({ keys, envFor }: { keys: string[]; envFor?: string | null }) {
  if (!keys.length) return null;
  // "A|B" in the catalog means any one of them
  const names = keys.map((k) => k.split('|').join(' or ')).join(', ');
  return (
    // a link a thumb can hit on a phone (32px tall); its long key names break rather than run out of the plate
    <Link to="/settings#tools" className="flex min-h-8 w-fit max-w-full items-center gap-1.5 rounded-md bg-you/10 px-2 py-1 text-xs leading-snug text-ink-soft ring-1 ring-inset ring-you/45 hover:text-ink hover:ring-you sm:min-h-0 sm:items-start" title="Set it in Settings → Tools & keys">
      <span className="grid h-4 w-4 shrink-0 place-items-center rounded-[3px] bg-you text-on-you sm:mt-px" aria-hidden="true">
        <KeyRound size={10} strokeWidth={2.75} />
      </span>
      <span className="min-w-0 break-words">
        key missing: <span className="mono text-ink">{names}</span> — {envFor ? `works, but without ${envFor}` : 'can only advise, not generate'}
      </span>
    </Link>
  );
}
