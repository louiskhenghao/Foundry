import { AccountsPage } from './pages/AccountsPage.tsx';
import { ArrowLeftRight, ArrowUpCircle, BarChart3, Bot, Inbox, ListTodo, LogOut, Menu, Moon, Network, NotebookPen, Palette, Plus, Puzzle, Radio, Settings2, Sun, Wrench, X, HelpCircle, AlarmClock } from 'lucide-react';
import { HelpPage } from './pages/HelpPage.tsx';
import { TransferPage } from './pages/TransferPage.tsx';
import { PortsPage } from './pages/PortsPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { AgentsPage } from './pages/AgentsPage.tsx';
import { useAgentsSummary } from './pages/agents/AgentsPill.tsx';
import { Suspense, lazy, useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, type AccessMe, type UpdateStatusView } from './api.ts';
import { AccountMenu } from './components/AccountMenu.tsx';
import { FilePreviewHost } from './components/FilePreview.tsx';
import { UpdatePill } from './components/UpdateDialog.tsx';
import { BriefPage } from './pages/BriefPage.tsx';
import { MergeResolvePage } from './pages/MergeResolvePage.tsx';
import { GoalPage } from './pages/GoalPage.tsx';
import { GoalsPage } from './pages/GoalsPage.tsx';
import { InboxPage } from './pages/InboxPage.tsx';
import { BuildWatch } from './buildWatch.tsx';
import { LearningsPage } from './pages/LearningsPage.tsx';
import { SchedulesPage } from './pages/SchedulesPage.tsx';
import { NewGoalPage } from './pages/NewGoalPage.tsx';
import { SetupPage } from './pages/SetupPage.tsx';
import { SkillsTabs } from './pages/skills/SkillsTabs.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { ReportsPage } from './pages/ReportsPage.tsx';
import { UsagePage, UsagePill } from './pages/UsagePage.tsx';
import { useLive } from './store.ts';
import { setMode, useLayout, useTheme } from './theme.ts';
import { Button, Menu as DropMenu, MenuItem, cn } from './ui.tsx';

// the credits carry ~270 KB of license texts: loaded when the page is opened, not with the app
const CreditsPage = lazy(() => import('./pages/CreditsPage.tsx').then((m) => ({ default: m.CreditsPage })));

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

  // in the bar: the chosen page's name in full ink with a bar under it; in the phone menu: a filled row
  const link = ({ isActive }: { isActive: boolean }) =>
    cn(
      'relative flex items-center gap-2 px-3 py-2.5 lg:py-0 lg:h-full rounded-md lg:rounded-none text-sm lg:text-[14.5px] font-semibold transition-colors',
      'lg:after:absolute lg:after:inset-x-2.5 lg:after:bottom-0 lg:after:h-[3px] lg:after:rounded-t-[3px]',
      isActive ? 'bg-band-hover lg:bg-transparent text-band-ink lg:after:bg-band-ink' : 'text-band-ink-soft hover:text-band-ink',
    );
  // in a side column (a theme whose navigation is `side`): a row, the chosen one filled with a bar at its left edge
  const sideLink = ({ isActive }: { isActive: boolean }) =>
    cn('relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-semibold transition-colors', isActive ? 'bg-band-hover text-band-ink shadow-[inset_3px_0_0_var(--color-band-ink)]' : 'text-band-ink-soft hover:bg-band-hover hover:text-band-ink');
  const side = useLayout().nav === 'side';
  // how many agent sessions are working: a count on the Agents icon, like the Inbox's
  const agents = useAgentsSummary();
  const busy = agents?.busy ?? 0;
  // `label`: between lg and xl the top bar only fits the icons; the phone menu and a side column always show the names.
  // `corner`: the top bar's links, where a count rides on the link's corner (from lg) instead of taking room in the row
  const navLinks = (cls: typeof link, label: string, corner = false) => (
    <>
      <NavLink to="/" end className={cls} title="Goals">
        <ListTodo size={15} /> <span className={label}>Goals</span>
      </NavLink>
      <NavLink to="/agents" className={cls} title={busy ? `Agents: ${busy} session${busy === 1 ? '' : 's'} working · ${agents?.idle ?? 0} idle` : 'Agents'} aria-label={busy ? `Agents, ${busy} working` : 'Agents'}>
        <Bot size={15} aria-hidden="true" />
        <span className={label}>Agents</span>
        {/* how many sessions are working, live: the count filled in the colour of work (yellow is for what waits for you),
            a ring pinging behind it. On the top bar's corner it takes no room, so the links beside it never move; the
            phone menu and a side column keep it at the row's end, as the Inbox's */}
        {busy > 0 && (
          <span className={cn('mono relative min-w-[1.125rem] h-[1.125rem] rounded-[5px] bg-work px-1 text-center text-[11px] font-bold leading-[1.125rem] text-on-work before:absolute before:inset-0 before:-z-10 before:rounded-[5px] before:bg-work motion-safe:before:animate-ping', corner ? 'ml-auto lg:ml-0 lg:absolute lg:top-2 lg:right-0 lg:translate-x-1/2' : 'ml-auto')}>
            {busy > 99 ? '99+' : busy}
          </span>
        )}
      </NavLink>
      <NavLink to="/skills" className={cls} title="Extensions: skills and MCP servers">
        <Puzzle size={15} /> <span className={label}>Extensions</span>
      </NavLink>
    </>
  );
  const links = navLinks(link, 'lg:hidden xl:inline', true);
  return (
    <div className={cn('h-full flex', side ? 'flex-row' : 'flex-col')}>
      {side && (
        // a theme whose navigation is `side`: from 1280px a column down the left holds what the top bar would, so the
        // page beside it keeps the 1024px the pages are laid out for; narrower screens keep the top bar
        <aside className="theme-band hidden xl:flex w-64 shrink-0 flex-col overflow-y-auto border-r border-band-line bg-band text-band-ink">
          <NavLink to="/" className="flex h-16 shrink-0 items-center gap-2.5 px-5 font-display text-lg font-extrabold tracking-tight text-band-ink">
            <Logo />
            Foundry
          </NavLink>
          <Link to="/goals/new" className="mx-3 flex" title="Start a new goal">
            <Button variant="primary" className="w-full justify-center">
              <Plus size={15} /> New goal
            </Button>
          </Link>
          <nav aria-label="Main" className="mt-5 flex flex-col gap-0.5 px-3">
            {navLinks(sideLink, '')}
            <NavLink to="/inbox" className={sideLink} title={open > 0 ? `Inbox: ${open} waiting for you` : 'Inbox'}>
              <Inbox size={15} /> Inbox
              {open > 0 && <span className="mono ml-auto min-w-[1.25rem] rounded-[5px] bg-you px-1.5 text-center text-[11px] font-bold leading-5 text-on-you">{open > 99 ? '99+' : open}</span>}
            </NavLink>
          </nav>
          <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-band-line px-3 py-3 text-xs text-band-ink-soft">
            <UpdatePill />
            <UsagePill />
            <AccountMenu />
            <span className="ml-auto">
              <AppMenu setupBad={setupBad} connected={connected} />
            </span>
          </div>
        </aside>
      )}
      {/* min-h-0: without it this column grows to its content, the page scrolls instead of <main>, and every side
          panel that stays in view (Settings, Ports, the Brief…) scrolls away with the rest */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* the top bar is a band in the theme's band colours (theme-band): Wayfinding's is graphite in both modes */}
      <header className={cn('theme-band relative flex items-center gap-2 md:gap-4 px-3 md:px-5 h-14 border-b border-band-line bg-band text-band-ink sticky top-0 z-20', side && 'xl:hidden')}>
        <button className="lg:hidden p-1.5 -ml-1 rounded text-band-ink-soft hover:text-band-ink hover:bg-band-hover" aria-label="menu" onClick={() => setMenu(!menu)}>
          {menu ? <X size={18} /> : <Menu size={18} />}
        </button>
        <NavLink to="/" className="flex shrink-0 items-center gap-2.5 text-lg font-extrabold tracking-tight text-band-ink lg:mr-3">
          <Logo />
          Foundry
        </NavLink>
        <nav className="hidden lg:flex items-stretch self-stretch gap-0.5">{links}</nav>
        <div className="ml-auto flex items-center gap-2 md:gap-3 text-xs text-band-ink-soft min-w-0">
          {/* the one action that starts work lives here, not in the nav, so a narrow header keeps it */}
          {/* every control in this row is one height: 32px on a phone (where buttons get a 32px touch height), 28px above */}
          <Link to="/goals/new" className="shrink-0 flex">
            <Button size="sm" variant="primary" className="h-8 sm:h-7" title="Start a new goal">
              <Plus size={14} /> <span className="hidden sm:inline">New goal</span>
            </Button>
          </Link>
          {/* the Inbox beside it: what waits for the person, on every screen width, its count on the icon */}
          <NavLink to="/inbox" title={open > 0 ? `Inbox: ${open} waiting for you` : 'Inbox'} aria-label={open > 0 ? `Inbox, ${open} waiting for you` : 'Inbox'} className={({ isActive }) => cn('relative flex h-8 w-8 sm:h-7 sm:w-7 shrink-0 items-center justify-center rounded-md border', isActive ? 'border-band-ink text-band-ink' : 'border-band-line text-band-ink-soft hover:text-band-ink hover:bg-band-hover')}>
            <Inbox size={15} />
            {/* what waits for you is the one thing in signal yellow */}
            {open > 0 && <span className="mono absolute -top-2 -right-2 min-w-[1.125rem] h-[1.125rem] rounded-[5px] bg-you px-1 text-[11px] font-bold leading-[1.125rem] text-center text-on-you">{open > 99 ? '99+' : open}</span>}
          </NavLink>
          <UpdatePill />
          <UsagePill />
          <AccountMenu />
          <AppMenu setupBad={setupBad} connected={connected} />
        </div>
        {menu && (
          <nav className="lg:hidden absolute left-0 right-0 top-14 border-b border-band-line bg-band p-2 flex flex-col gap-0.5 shadow-xl" onClick={() => setMenu(false)}>
            {links}
          </nav>
        )}
      </header>
      <BuildWatch connected={connected} />
      {/* relative: what is positioned inside the pages (a hidden input, a radio's peer) belongs to this scroller, not to the
          window, which it would otherwise make taller than the screen (the whole app then scrolled past a page's end) */}
      <main className="relative flex-1 overflow-auto">
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
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/transfer" element={<TransferPage />} />
          <Route path="/ports" element={<PortsPage />} />
          <Route path="/learnings" element={<LearningsPage />} />
          <Route path="/schedules" element={<SchedulesPage />} />
          <Route path="/help" element={<HelpPage />} />
          <Route path="/help/:slug" element={<HelpPage />} />
          <Route
            path="/credits"
            element={
              <Suspense fallback={null}>
                <CreditsPage />
              </Suspense>
            }
          />
        </Routes>
      </main>
      </div>
      <FilePreviewHost />
    </div>
  );
}

/**
 * Settings, Setup, Transfer, Help, the light/dark switch, the connection state and the version, behind one button so
 * the header keeps room for what changes (inbox, agents, usage). A dot on the button: Setup is incomplete, the live
 * connection dropped, or a newer Foundry is out.
 */
function AppMenu({ setupBad, connected }: { setupBad: boolean; connected: boolean }) {
  const nav = useNavigate();
  const loc = useLocation();
  const [update, setUpdate] = useState<UpdateStatusView | null>(null);
  // Access (ADR-0061): who this browser is signed in as, when the Foundry asks for tokens
  const [me, setMe] = useState<AccessMe | null>(null);
  useEffect(() => {
    api.accessMe().then(setMe).catch(() => {});
  }, [loc.pathname]);
  useEffect(() => {
    const load = () => api.updateStatus().then(setUpdate).catch(() => {});
    const t = setTimeout(load, 1000);
    const i = setInterval(load, 5 * 60_000);
    return () => (clearTimeout(t), clearInterval(i));
  }, []);
  const light = useTheme((s) => s.light);
  const toggleTheme = () => setMode(light ? 'dark' : 'light');
  const here = ['/settings', '/setup', '/transfer', '/ports', '/learnings', '/schedules', '/reports', '/help', '/credits'].some((p) => loc.pathname.startsWith(p));
  const go = (close: () => void, to: string) => {
    close();
    nav(to);
  };
  return (
    <DropMenu
      width="w-64"
      trigger={({ open, toggle }) => (
        <button onClick={toggle} className={cn('relative h-8 w-8 sm:h-7 sm:w-7 flex items-center justify-center rounded-md text-band-ink-soft hover:text-band-ink hover:bg-band-hover', (open || here) && 'bg-band-hover text-band-ink')} title="Settings, setup, help and theme" aria-label="Settings, setup, help and theme">
          <Settings2 size={16} />
          {(setupBad || !connected || update?.updateAvailable) && <span className={cn('absolute top-0.5 right-0.5 h-2 w-2 rounded-full ring-2 ring-band', setupBad || !connected ? 'bg-bad' : 'bg-work')} />}
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
              Setup {setupBad && <span className="text-[10px] text-bad-ink">incomplete</span>}
            </span>
          </MenuItem>
          <MenuItem icon={<ArrowLeftRight size={13} />} hint="Move to another computer" onClick={() => go(close, '/transfer')}>
            Transfer
          </MenuItem>
          <MenuItem icon={<Network size={13} />} hint="What holds which port" onClick={() => go(close, '/ports')}>
            Ports
          </MenuItem>
          <MenuItem icon={<NotebookPen size={13} />} hint="What Foundry knows about your projects" onClick={() => go(close, '/learnings')}>
            Learnings
          </MenuItem>
          <MenuItem icon={<AlarmClock size={13} />} hint="Goals that run on their own" onClick={() => go(close, '/schedules')}>
            Schedules
          </MenuItem>
          <MenuItem icon={<BarChart3 size={13} />} hint="What it cost, by project and over time" onClick={() => go(close, '/reports')}>
            Reports
          </MenuItem>
          <MenuItem icon={<HelpCircle size={13} />} hint="How to use Foundry" onClick={() => go(close, '/help')}>
            Help
          </MenuItem>
          {me?.enabled && me.person && (
            <MenuItem icon={<LogOut size={13} />} onClick={() => api.accessLogout().catch(() => {}).then(() => location.assign('/login'))} title="Forget this browser's token; sign in again with it or another">
              Sign out ({me.person.name})
            </MenuItem>
          )}
          <div className="my-1 border-t border-line" />
          <MenuItem icon={light ? <Moon size={13} /> : <Sun size={13} />} onClick={toggleTheme}>
            {light ? 'Dark mode' : 'Light mode'}
          </MenuItem>
          <MenuItem icon={<Palette size={13} />} hint="Themes, and how to make your own" onClick={() => go(close, '/settings#appearance')}>
            Appearance
          </MenuItem>
          <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-ink-faint">
            <Radio size={12} className={connected ? 'text-ok-ink' : 'text-bad-ink'} />
            {connected ? 'Live — updates arrive as they happen' : 'Reconnecting…'}
          </div>
          <div className="my-1 border-t border-line" />
          <MenuItem icon={<ArrowUpCircle size={13} className={update?.updateAvailable ? 'text-work-ink' : undefined} />} onClick={() => go(close, '/settings#about')} title="About & updates">
            <span className="flex items-center gap-2">
              Foundry <span className="mono">{update?.current ?? '…'}</span>
              {update?.updateAvailable && (
                <span className="flex items-center gap-1 text-[10px] text-work-ink">
                  <span className="h-1.5 w-1.5 rounded-full bg-work" /> {update.latest} available
                </span>
              )}
            </span>
          </MenuItem>
        </>
      )}
    </DropMenu>
  );
}

/** Foundry's mark in the theme's colours: a tile of the main button's colour with the F in the text drawn on it. */
function Logo() {
  return (
    <svg viewBox="0 0 1024 1024" className="h-7 w-7 shrink-0" aria-hidden="true">
      <rect width="1024" height="1024" rx="224" className="fill-accent" />
      <g className="fill-on-accent stroke-on-accent">
        <path d="M387 299H675M387 299V751M387 537H615" strokeWidth="96" strokeLinecap="round" fill="none" />
        <circle cx="387" cy="299" r="118" stroke="none" />
        <rect x="595" y="219" width="160" height="160" rx="40" stroke="none" />
        <rect x="541" y="463" width="148" height="148" rx="37" stroke="none" />
        <rect x="295" y="659" width="184" height="184" rx="46" stroke="none" />
      </g>
    </svg>
  );
}
