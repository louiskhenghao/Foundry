import { z } from 'zod';

/** the hosts a finished goal's web app is deployed to (ADR-0041) */
export const DeployProvider = z.enum(['vercel', 'netlify', 'cloudflare']);
export type DeployProvider = z.infer<typeof DeployProvider>;

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

/** One deploy of a goal's web app: where, preview or production, how it went, the address it got, and its smoke. */
export const Deployment = z.object({
  provider: DeployProvider,
  production: z.boolean(),
  status: z.enum(['running', 'live', 'failed']),
  /** the deployed address; null while it runs or when it failed */
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
