// Browser-safe: imported by the web app via `@foundry/engine/mcp-types` — no node imports here.
import { z } from 'zod';

/** where a server is configured: user scope (~/.claude.json), a Claude plugin, or a claude.ai connector */
export type McpSource = 'user' | 'plugin' | 'connector';

export interface McpServerRow {
  /** as Claude Code names it: "context7", "media-pipeline", "claude.ai Gmail" */
  name: string;
  source: McpSource;
  /** the plugin that ships it (plugin source only), e.g. "media-pipeline@media-pipeline-marketplace" */
  plugin: string | null;
  /** tool prefix sessions are allowed with, e.g. "mcp__context7" (ADR-0016) */
  prefix: string;
  transport: 'stdio' | 'http' | 'sse' | null;
  /** the command line or URL; never its environment or headers (keys live there) */
  target: string | null;
  /** allowed in goals: worker sessions may call its tools */
  allowed: boolean;
  /** the catalog entry it was installed from, when its name matches one */
  catalogId: string | null;
}

export const McpKey = z.object({
  /** environment variable the server reads, e.g. EXA_API_KEY */
  name: z.string(),
  label: z.string(),
  /** where to get one */
  url: z.string().optional(),
});
export type McpKey = z.infer<typeof McpKey>;

export const McpCatalogEntry = z.object({
  id: z.string(),
  /** the server name it is installed under */
  name: z.string(),
  summary: z.string(),
  why: z.string(),
  /** recommended: Setup warns while it is missing; optional: listed only */
  tier: z.enum(['recommended', 'optional']),
  /** goal kinds it helps: code, docs, research, image, video */
  suits: z.array(z.string()).default([]),
  homepage: z.string().optional(),
  /** entries sharing a pack are alternatives (e.g. web search): install one */
  pack: z.string().optional(),
  /** what `claude mcp add-json` gets, without keys: { type, command, args } or { type, url } */
  config: z.record(z.string(), z.unknown()),
  /** keys asked for at install, handed to the server as its environment */
  keys: z.array(McpKey).default([]),
});
export type McpCatalogEntry = z.infer<typeof McpCatalogEntry>;
export const McpCatalog = z.object({ version: z.literal(1), entries: z.array(McpCatalogEntry) });
export type McpCatalog = z.infer<typeof McpCatalog>;

export interface McpCatalogStatus {
  entry: McpCatalogEntry;
  installed: boolean;
}

export interface McpView {
  servers: McpServerRow[];
  catalog: McpCatalogStatus[];
}

/** one line of `claude mcp list` (the on-demand health check) */
export interface McpHealth {
  name: string;
  status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'unknown';
  detail: string;
}

/** `claude mcp login` for one server, driven from the MCP tab */
export interface McpLoginSession {
  id: string;
  name: string;
  /** a claude.ai connector: the CLI only prints a claude.ai link and exits; authorizing there is the whole job */
  connector: boolean;
  url: string | null;
  lines: string[];
  /** the CLI waits for the address the browser was redirected to (it also finishes by itself when a browser here completes) */
  needsCode: boolean;
  /** the same sign-in typed into a terminal, for when it cannot finish here */
  command: string;
  done: boolean;
  ok: boolean | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}
