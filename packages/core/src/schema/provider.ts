import { z } from 'zod';

/** the coding agents Foundry drives: Claude Code, Codex CLI, and the Antigravity CLI (`agy`) */
export const AgentProvider = z.enum(['claude', 'codex', 'agy']);
export type AgentProvider = z.infer<typeof AgentProvider>;
export const AGENT_PROVIDERS = AgentProvider.options;
/** the name a person sees */
export const PROVIDER_LABEL: Record<AgentProvider, string> = { claude: 'Claude Code', codex: 'Codex', agy: 'Antigravity' };
/** the short name notes and messages use */
export const PROVIDER_NAME: Record<AgentProvider, string> = { claude: 'Claude', codex: 'Codex', agy: 'Antigravity' };
/** only Claude Code reports what a session cost in dollars; the others report tokens, so no dollar budget can be kept */
export const reportsDollars = (provider: AgentProvider | null | undefined): boolean => (provider ?? 'claude') === 'claude';
/** the project folder an agent reads its skills from: Claude Code `.claude`, the others `.agents` */
export const agentsFolder = (provider: AgentProvider | null | undefined): '.claude' | '.agents' => ((provider ?? 'claude') === 'claude' ? '.claude' : '.agents');
