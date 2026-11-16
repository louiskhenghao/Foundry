import { Bell, Cpu, FlaskConical, GitBranch, Info, KeyRound, LayoutTemplate, MonitorPlay, Palette, Server, Shield, Target, WandSparkles, Wrench, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn, code } from '../../ui.tsx';

/** a section's category colour (ADR-0067): its icon's ink and the square before its name in the side list */
const hue = (i: number) => {
  const c = code(i);
  return { ink: c.ink, dot: c.dot };
};

/**
 * The sections of the Settings page, in its order, one open at a time: the left-hand menu (a row of chips on a phone or
 * a tablet) opens one, and the URL's hash names it (`/settings#models`), so a link opens its section and the browser's
 * back button returns to the one before. The ids are the cards' ids on the page; the search names a section by them.
 */
export const SECTIONS: { id: string; label: string }[] = [
  { id: 'goals', label: 'New goal defaults' },
  { id: 'models', label: 'Models & limits' },
  { id: 'skills', label: 'Skills' },
  { id: 'git', label: 'Git & delivery' },
  { id: 'tools', label: 'Tools & keys' },
  { id: 'preview', label: 'Preview & self-check' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'access', label: 'Access' },
  { id: 'safety', label: 'Safety' },
  { id: 'beta', label: 'Beta' },
  { id: 'engine', label: 'Engine (install)' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'about', label: 'About & updates' },
];

/**
 * Each section of the Settings page (by its card's id) with an icon and a category colour of its own, as the Brief's
 * sections have: fixed per section, never by place in what is shown, and no two neighbours in the page's order share
 * one. Machine set-up (tools, engine) shares teal. SECTIONS above holds the names and the order.
 */
export const SECTION_STYLE: Record<string, { Icon: LucideIcon; ink: string; dot: string }> = {
  goals: { Icon: Target, ...hue(0) },
  models: { Icon: Cpu, ...hue(2) },
  skills: { Icon: WandSparkles, ...hue(6) },
  git: { Icon: GitBranch, ...hue(3) },
  tools: { Icon: Wrench, ...hue(5) },
  preview: { Icon: MonitorPlay, ...hue(1) },
  notifications: { Icon: Bell, ...hue(7) },
  access: { Icon: KeyRound, ...hue(0) },
  safety: { Icon: Shield, ...hue(4) },
  beta: { Icon: FlaskConical, ...hue(3) },
  engine: { Icon: Server, ...hue(5) },
  appearance: { Icon: Palette, ...hue(6) },
  about: { Icon: Info, ...hue(1) },
};

/**
 * a card title led by an icon in a category colour (`ink`), the words (and a guide's "?") in the case of the card's
 * head: the Settings sections, Setup's bundles, Transfer's two ways
 */
export function IconTitle({ icon: Icon, ink, children }: { icon: LucideIcon; ink: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 caps">
      <Icon size={14} strokeWidth={2.25} className={cn('shrink-0', ink)} aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}

/** a Settings card's title: the section's icon in its colour, then the words */
export function SettingsTitle({ id, children }: { id: string; children: ReactNode }) {
  const s = SECTION_STYLE[id];
  return s ? <IconTitle icon={s.Icon} ink={s.ink}>{children}</IconTitle> : <>{children}</>;
}
