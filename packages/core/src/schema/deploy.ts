import { z } from 'zod';

/**
 * where a finished goal is deployed: the web hosts (ADR-0041), a server of the person's own over SSH (ADR-0091), or a
 * platform that runs the whole project — Fly.io, Railway, Render (ADR-0095)
 */
export const DeployProvider = z.enum(['vercel', 'netlify', 'cloudflare', 'server', 'fly', 'railway', 'render']);
export type DeployProvider = z.infer<typeof DeployProvider>;
/** the web hosts: a CLI run here with a token, one project per repository, a web page or an all-in-one web app only */
export const DeployHostProvider = z.enum(['vercel', 'netlify', 'cloudflare']);
export type DeployHostProvider = z.infer<typeof DeployHostProvider>;
/** the platforms (ADR-0095): the whole project from its Dockerfile or its stack, a preview app or environment beside production */
export const DeployPaasProvider = z.enum(['fly', 'railway', 'render']);
export type DeployPaasProvider = z.infer<typeof DeployPaasProvider>;

/** which of a provider's places a deploy went to, when it has several: a server from Settings, by its id and the name it had then */
export const DeployTarget = z.object({ id: z.string(), label: z.string() });
export type DeployTarget = z.infer<typeof DeployTarget>;

const Item = z.object({ file: z.string(), caption: z.string() });

/** One milestone script tried against a deployed address: what it showed there (ADR-0058). */
export const SmokeScript = z.object({
  script: z.string(),
  /** the task whose feature the script shows */
  taskId: z.string().nullable().default(null),
  status: z.enum(['pass', 'fail']),
  error: z.string().nullable().default(null),
  summary: z.string().default(''),
  /** files under the goal's screenshots folder: a video per test, the captioned screenshots, what an API answered, the runner's log */
  clips: z.array(Item).default([]),
  shots: z.array(Item).default([]),
  outputs: z.array(Item).default([]),
  log: z.string().nullable().default(null),
});
export type SmokeScript = z.infer<typeof SmokeScript>;

/** The smoke of one deploy: the goal's milestone scripts run against the deployed address once the deploy ended live. */
export const DeploySmoke = z.object({
  status: z.enum(['running', 'pass', 'fail', 'skipped']),
  /** in words: what passed and what failed, or why nothing ran */
  detail: z.string().default(''),
  scripts: z.array(SmokeScript).default([]),
  at: z.string(),
  endedAt: z.string().nullable().default(null),
});
export type DeploySmoke = z.infer<typeof DeploySmoke>;

/** One deploy of a goal: where, preview or production, how it went, the address it got, and its smoke. */
export const Deployment = z.object({
  provider: DeployProvider,
  /** the server it went to (ADR-0091); absent on the hosts, and on deploys written before servers existed */
  target: DeployTarget.nullable().optional(),
  production: z.boolean(),
  status: z.enum(['running', 'live', 'failed']),
  /** the deployed address; null while it runs, when it failed, or when a server deploy publishes no port and the server has no public address */
  url: z.string().nullable(),
  /** why it failed, in words */
  reason: z.string().nullable(),
  /** the commit deployed */
  ref: z.string().nullable(),
  framework: z.string().nullable(),
  at: z.string(),
  endedAt: z.string().nullable(),
  /** the milestone scripts tried against the address afterwards (ADR-0058); absent when none was asked for */
  smoke: DeploySmoke.nullable().optional(),
});
export type Deployment = z.infer<typeof Deployment>;

/**
 * One item of a readiness check (ADR-0091): something a deploy to this place needs, whether it is there, and where to
 * do it when it is not — a Settings section, a command the person runs themselves, or a page to open.
 */
export const ReadinessItem = z.object({
  id: z.string(),
  label: z.string(),
  ok: z.boolean(),
  /** error: the deploy waits for it; warn: told, never blocks (the front door on 80/443, the public address answering) */
  severity: z.enum(['error', 'warn']).default('error'),
  /** what was found, in words: a version, the error's own last line, or why it was not tried */
  detail: z.string().default(''),
  fix: z
    .object({
      /** the section of the Settings page (its anchor, `git`) */
      settings: z.string().optional(),
      /** a command the person runs themselves, on their own computer or on the server */
      command: z.string().optional(),
      url: z.string().optional(),
      /** a server recipe (ADR-0092) that puts it right, run from the card after the person reads and confirms it */
      recipe: z.string().optional(),
      /** the recipe's inputs as this project would fill them (the domain, the port, the project's name) */
      recipeParams: z.record(z.string(), z.string()).optional(),
    })
    .nullable()
    .default(null),
});
export type ReadinessItem = z.infer<typeof ReadinessItem>;

/** one input of a server recipe (ADR-0092): an environment variable the script reads; a secret one is never recorded */
export const RecipeParam = z.object({ name: z.string(), label: z.string(), default: z.string().nullable(), secret: z.boolean() });
export type RecipeParam = z.infer<typeof RecipeParam>;
/**
 * A server recipe (ADR-0092): a shell script that sets a server up — Docker, nginx with HTTPS in front of the project,
 * Node and PM2, PostgreSQL, Redis — bundled with Foundry, or the person's own under the data folder. Its header says
 * what it changes; the person reads the whole script before it runs, as root, over ssh.
 */
export const ServerRecipe = z.object({
  id: z.string(),
  title: z.string(),
  /** runs as root (sudo); every bundled one does */
  root: z.boolean(),
  /** the readiness item it puts right (`docker`, `front`, `runtime`), if one */
  fixes: z.string().nullable(),
  params: z.array(RecipeParam),
  /** what it changes on the server, one line each, from the header */
  changes: z.array(z.string()),
  source: z.enum(['bundled', 'own']),
  file: z.string(),
  text: z.string(),
});
export type ServerRecipe = z.infer<typeof ServerRecipe>;
/** one run of a recipe on a server, from the activity */
export const RecipeRun = z.object({
  serverId: z.string(),
  recipe: z.string(),
  title: z.string(),
  status: z.enum(['running', 'ok', 'failed']),
  exitCode: z.number().nullable(),
  reason: z.string().nullable(),
  outputTail: z.string(),
  at: z.string(),
  endedAt: z.string().nullable(),
});
export type RecipeRun = z.infer<typeof RecipeRun>;

/** Whether a deploy to one place can start: every item it needs, checked now; `ok` when every error-severity item is */
export const DeployReadiness = z.object({ ok: z.boolean(), items: z.array(ReadinessItem), at: z.string() });
export type DeployReadiness = z.infer<typeof DeployReadiness>;
