import { Bot, Inbox, ListTodo, Menu, Moon, Plus, Puzzle, Radio, Settings2, Sun, Wrench, X, HelpCircle } from 'lucide-react';
import { HelpPage } from './pages/HelpPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { AgentsPage } from './pages/AgentsPage.tsx';
import { AgentsPill } from './pages/agents/AgentsPill.tsx';
import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api.ts';
import { AccountMenu } from './components/AccountMenu.tsx';
import { UpdatePill } from './components/UpdateDialog.tsx';
import { BriefPage } from './pages/BriefPage.tsx';
import { MergeResolvePage } from './pages/MergeResolvePage.tsx';
import { GoalPage } from './pages/GoalPage.tsx';
import { GoalsPage } from './pages/GoalsPage.tsx';
import { InboxPage } from './pages/InboxPage.tsx';
import { NewGoalPage } from './pages/NewGoalPage.tsx';
import { SetupPage } from './pages/SetupPage.tsx';
import { SkillsPage } from './pages/SkillsPage.tsx';
import { UsagePage, UsagePill } from './pages/UsagePage.tsx';
import { useLive } from './store.ts';
import { Button, cn } from './ui.tsx';

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

  const link = ({ isActive }: { isActive: boolean }) => cn('flex items-center gap-2 px-3 py-2 md:py-1.5 rounded-md text-sm', isActive ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900');
  // between md and lg the header only fits the icons; the dropdown (below md) always shows labels
  const label = 'md:hidden lg:inline';
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
      <NavLink to="/skills" className={link} title="Skills">
        <Puzzle size={15} /> <span className={label}>Skills</span>
      </NavLink>
      <NavLink to="/setup" className={link} title="Setup">
        <Wrench size={15} /> <span className={label}>Setup</span>
        {setupBad && <span className="ml-1 h-2 w-2 rounded-full bg-rose-500 inline-block" />}
      </NavLink>
      <NavLink to="/settings" className={link} title="Settings">
        <Settings2 size={15} /> <span className={label}>Settings</span>
      </NavLink>
      <NavLink to="/help" className={link} title="Guide — how to use Foundry">
        <HelpCircle size={15} /> <span className={label}>Help</span>
      </NavLink>
    </>
  );
  return (
    <div className="h-full flex flex-col">
      <header className="surface-card relative flex items-center gap-2 md:gap-4 px-3 md:px-4 h-12 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-0 z-20">
        <button className="md:hidden p-1.5 -ml-1 rounded text-zinc-300 hover:bg-zinc-900" aria-label="menu" onClick={() => setMenu(!menu)}>
          {menu ? <X size={18} /> : <Menu size={18} />}
        </button>
        <NavLink to="/" className="font-semibold tracking-tight text-zinc-100 flex items-center gap-2">
          Foundry
          {(open > 0 || setupBad) && <span className={cn('md:hidden h-2 w-2 rounded-full', open > 0 ? 'bg-orange-500' : 'bg-rose-500')} />}
        </NavLink>
        <nav className="hidden md:flex items-center gap-1">{links}</nav>
        <div className="ml-auto flex items-center gap-2 md:gap-3 text-xs text-zinc-500 min-w-0">
          {/* the one action that starts work lives here, not in the nav, so a narrow header keeps it */}
          <Link to="/goals/new" className="shrink-0">
            <Button size="sm" variant="primary" title="Start a new goal">
              <Plus size={14} /> <span className="hidden sm:inline">New goal</span>
            </Button>
          </Link>
          <UpdatePill />
          <AgentsPill />
          <UsagePill />
          <AccountMenu />
          <span className="hidden sm:flex items-center gap-1.5">
            <Radio size={13} className={connected ? 'text-emerald-400' : 'text-rose-400'} /> {connected ? 'live' : 'reconnecting…'}
          </span>
          <Radio size={13} className={cn('sm:hidden', connected ? 'text-emerald-400' : 'text-rose-400')} />
          <ThemeToggle />
        </div>
        {menu && (
          <nav className="md:hidden absolute left-0 right-0 top-12 border-b border-zinc-800 bg-zinc-950 p-2 flex flex-col gap-0.5 shadow-xl" onClick={() => setMenu(false)}>
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
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/usage" element={<UsagePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="/help/:slug" element={<HelpPage />} />
        </Routes>
      </main>
    </div>
  );
}

/** Light/dark toggle; the choice is remembered, first visit follows the system (see index.html). */
function ThemeToggle() {
  const [light, setLight] = useState(() => document.documentElement.classList.contains('light'));
  const toggle = () => {
    const next = !light;
    setLight(next);
    document.documentElement.classList.toggle('light', next);
    try {
      localStorage.setItem('foundry.theme', next ? 'light' : 'dark');
    } catch {}
  };
  return (
    <button onClick={toggle} className="p-1.5 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900" title={light ? 'Switch to dark mode' : 'Switch to light mode'}>
      {light ? <Moon size={14} /> : <Sun size={14} />}
    </button>
  );
}
