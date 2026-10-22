import { useEffect, useState } from 'react';
import { api } from './api.ts';
import { hasUnsaved } from './unsaved.ts';
import { Button } from './ui.tsx';

/** the entry script this page was loaded with (/assets/index-<hash>.js); none under the Vite dev server */
export const ownBuild = (): string | null => document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')?.getAttribute('src')?.split('/').pop() ?? null;

/** what to do when the server serves another build than this page's: reload, unless something is being edited */
export function onServerBuild(own: string | null, served: string | null | undefined, unsaved: boolean): 'stay' | 'reload' | 'ask' {
  if (!own || !served || own === served) return 'stay';
  return unsaved ? 'ask' : 'reload';
}

/**
 * After an update the server serves a new build, and an open page kept the old one until someone reloaded it. The page
 * now asks which build is served when its connection comes back (the server restarted), every minute and when its tab is
 * shown again, and reloads into a new one by itself; with an edit not yet saved it asks first, in a banner.
 */
export function BuildWatch({ connected }: { connected: boolean }) {
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    const own = ownBuild();
    if (!own) return;
    const check = () =>
      api
        .health()
        .then((h) => {
          const next = onServerBuild(own, h.webBuild, hasUnsaved());
          if (next === 'reload') location.reload();
          else setWaiting(next === 'ask');
        })
        .catch(() => {});
    if (connected) check();
    const every = setInterval(check, 60_000);
    const shown = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', shown);
    return () => {
      clearInterval(every);
      document.removeEventListener('visibilitychange', shown);
    };
  }, [connected]);
  if (!waiting) return null;
  return (
    <div role="status" className="fixed bottom-3 left-1/2 z-[70] flex w-[calc(100vw-1.5rem)] max-w-md -translate-x-1/2 items-center gap-3 rounded-lg border border-work/40 bg-panel px-3 py-2 text-xs text-ink shadow-xl">
      <span className="min-w-0 flex-1">Foundry has a new version. Save what you are editing, then reload; it reloads by itself once nothing is unsaved.</span>
      <Button size="sm" variant="primary" onClick={() => location.reload()}>
        Reload
      </Button>
    </div>
  );
}
