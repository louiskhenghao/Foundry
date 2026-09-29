import { Bot, Inbox, ListTodo, Menu, Moon, Plus, Puzzle, Radio, Settings2, Sun, Wrench, X, HelpCircle } from 'lucide-react';
import { HelpPage } from './pages/HelpPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { AgentsPage } from './pages/AgentsPage.tsx';
import { AgentsPill } from './pages/agents/AgentsPill.tsx';
import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api.ts';
import { AccountMenu } from './components/AccountMenu.tsx';
import { FilePreviewHost } from './components/FilePreview.tsx';
import { UpdatePill } from './components/UpdateDialog.tsx';
import { BriefPage } from './pages/BriefPage.tsx';
import { MergeResolvePage } from './pages/MergeResolvePage.tsx';
import { GoalPage } from './pages/GoalPage.tsx';
import { GoalsPage } from './pages/GoalsPage.tsx';
import { InboxPage } from './pages/InboxPage.tsx';
import { NewGoalPage } from './pages/NewGoalPage.tsx';
import { SetupPage } from './pages/SetupPage.tsx';
import { SkillsTabs } from './pages/skills/SkillsTabs.tsx';
import { UsagePage, UsagePill } from './pages/UsagePage.tsx';
import { useLive } from './store.ts';
import { Button, Menu as DropMenu, MenuItem, cn } from './ui.tsx';

export function App() {
  const connected = useLive((s) => s.connected);
  const version = useLive((s) => s.globalVersion);
  const [open, setOpen] = useState(0);
  const [setupBad, setSetupBad] = useState(false);
  const [menu, setMenu] = useState(false);
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    api.escalations(true).then((l) => setOpen(l.length)).catch(() => {});
  }, [version]);

  // close the mobile menu on navigation
  useEffect(() => setMenu(false), [loc.pathname]);

  // first run: environment incomplete and no goals yet → land on Setup
  useEffect(() => {
    Promise.all([api.doctor(), api.goals()])
      .then(([d, goals]) => {
        setSetupBad(!d.ok);
        if (!d.ok && goals.length === 0 && loc.pathname === '/') nav('/setup', { replace: true });
      })
      .catch(() => {});
  }, []);

  const link = ({ isActive }: { isActive: boolean }) => cn('flex items-center gap-2 px-3 py-2 lg:py-1.5 rounded-md text-sm', isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900');
  // between lg and xl the header only fits the icons; the dropdown (below lg) always shows labels
  const label = 'lg:hidden xl:inline';
  const links = (
    <>
      <NavLink to="/" end className={link} title="Goals">
        <ListTodo size={15} /> <span className={label}>Goals</span>
      </NavLink>
      <NavLink to="/inbox" className={link} title="Inbox">
        <Inbox size={15} /> <span className={label}>Inbox</span>
        {open > 0 && <span className="ml-1 rounded-full bg-orange-500 text-zinc-950 text-[10px] px-1.5 font-bold">{open}</span>}
      </NavLink>
      <NavLink to="/agents" className={link} title="Agents">
        <Bot size={15} /> <span className={label}>Agents</span>
      </NavLink>
      <NavLink to="/skills" className={link} title="Extensions: skills and MCP servers">
        <Puzzle size={15} /> <span className={label}>Extensions</span>
      </NavLink>
    </>
  );
  return (
    <div className="h-full flex flex-col">
      <header className="surface-card relative flex items-center gap-2 md:gap-4 px-3 md:px-4 h-12 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-0 z-20">
        <button className="lg:hidden p-1.5 -ml-1 rounded text-zinc-300 hover:bg-zinc-900" aria-label="menu" onClick={() => setMenu(!menu)}>
          {menu ? <X size={18} /> : <Menu size={18} />}
        </button>
        <NavLink to="/" className="font-semibold tracking-tight text-zinc-100 flex items-center gap-2">
          Foundry
          {open > 0 && <span className="lg:hidden h-2 w-2 rounded-full bg-orange-500" />}
        </NavLink>
        <nav className="hidden lg:flex items-center gap-1">{links}</nav>
        <div className="ml-auto flex items-center gap-2 md:gap-3 text-xs text-zinc-500 min-w-0">
          {/* the one action that starts work lives here, not in the nav, so a narrow header keeps it */}
          <Link to="/goals/new" className="shrink-0">
            <Button size="sm" variant="primary" title="Start a new goal">
              <Plus size={14} /> <span className="hidden sm:inline">New goal</span>
            </Button>
          </Link>
          <UpdatePill />
          {/* Agents is in the phone menu; the pill would push the header past the screen edge */}
          <span className="hidden sm:contents">
            <AgentsPill />
          </span>
          <UsagePill />
          <AccountMenu />
          <AppMenu setupBad={setupBad} connected={connected} />
        </div>
        {menu && (
          <nav className="lg:hidden absolute left-0 right-0 top-12 border-b border-zinc-800 bg-zinc-950 p-2 flex flex-col gap-0.5 shadow-xl" onClick={() => setMenu(false)}>
            {links}
          </nav>
        )}
      </header>
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<GoalsPage />} />
          <Route path="/goals/new" element={<NewGoalPage />} />
          <Route path="/goals/:id/brief" element={<BriefPage />} />
          <Route path="/goals/:id/resolve/:taskId" element={<MergeResolvePage />} />
          <Route path="/goals/:id" element={<GoalPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/skills" element={<SkillsTabs />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/usage" element={<UsagePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="/help/:slug" element={<HelpPage />} />
        </Routes>
      </main>
      <FilePreviewHost />
    </div>
  );
}

/**
 * Settings, Setup, Help, the light/dark switch and the connection state, behind one button so the header keeps room
 * for what changes (inbox, agents, usage). A dot on the button: Setup is incomplete, or the live connection dropped.
 */
function AppMenu({ setupBad, connected }: { setupBad: boolean; connected: boolean }) {
  const nav = useNavigate();
  const loc = useLocation();
  const [light, setLight] = useState(() => document.documentElement.classList.contains('light'));
  const toggleTheme = () => {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle('light', next);
    try {
      localStorage.setItem('foundry.theme', next ? 'light' : 'dark');
    } catch {}
  };
  const here = ['/settings', '/setup', '/help'].some((p) => loc.pathname.startsWith(p));
  const go = (close: () => void, to: string) => {
    close();
    nav(to);
  };
  return (
    <DropMenu
      width="w-60"
      trigger={({ open, toggle }) => (
        <button onClick={toggle} className={cn('relative p-1.5 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900', (open || here) && 'bg-zinc-900 text-zinc-100')} title="Settings, setup, help and theme" aria-label="Settings, setup, help and theme">
          <Settings2 size={16} />
          {(setupBad || !connected) && <span className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-zinc-950" />}
        </button>
      )}
    >
      {(close) => (
        <>
          <MenuItem icon={<Settings2 size={13} />} onClick={() => go(close, '/settings')}>
            Settings
          </MenuItem>
          <MenuItem icon={<Wrench size={13} />} onClick={() => go(close, '/setup')}>
            <span className="flex items-center gap-2">
              Setup {setupBad && <span className="text-[10px] text-rose-400">incomplete</span>}
            </span>
          </MenuItem>
          <MenuItem icon={<HelpCircle size={13} />} onClick={() => go(close, '/help')}>
            Help — how to use Foundry
          </MenuItem>
          <div className="my-1 border-t border-zinc-800" />
          <MenuItem icon={light ? <Moon size={13} /> : <Sun size={13} />} onClick={toggleTheme}>
            {light ? 'Dark mode' : 'Light mode'}
          </MenuItem>
          <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-zinc-500">
            <Radio size={12} className={connected ? 'text-emerald-400' : 'text-rose-400'} />
            {connected ? 'Live — updates arrive as they happen' : 'Reconnecting…'}
          </div>
        </>
      )}
    </DropMenu>
  );
}
