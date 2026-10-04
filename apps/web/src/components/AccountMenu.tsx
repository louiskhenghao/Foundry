import { UserCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';

/** Both provider accounts are available independent of the default backend. */
export function AccountMenu() {
  return <Link to="/accounts" aria-label="Agent accounts" title="Claude and Codex accounts" className="flex items-center gap-1.5 rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-900"><UserCircle2 size={14} /><span className="hidden sm:inline">Accounts</span></Link>;
}
