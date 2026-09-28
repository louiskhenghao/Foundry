import { Link } from 'react-router-dom';

/** A skill whose sessions lack an API key it needs: which key, what is lost, and where to set it. */
export function KeyMissing({ keys, envFor }: { keys: string[]; envFor?: string | null }) {
  if (!keys.length) return null;
  // "A|B" in the catalog means any one of them
  const names = keys.map((k) => k.split('|').join(' or ')).join(', ');
  return (
    <Link to="/settings#tools" className="block text-[11px] text-amber-300/90 hover:text-amber-200" title="Set it in Settings → Tools & keys">
      ⚠ key missing: <span className="mono">{names}</span> — {envFor ? `works, but without ${envFor}` : 'can only advise, not generate'}
    </Link>
  );
}
