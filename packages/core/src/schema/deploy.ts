import { z } from 'zod';

/** the hosts a finished goal's web app is deployed to (ADR-0041) */
export const DeployProvider = z.enum(['vercel', 'netlify', 'cloudflare']);
export type DeployProvider = z.infer<typeof DeployProvider>;

/** One deploy of a goal's web app: where, preview or production, how it went, and the address it got. */
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
});
export type Deployment = z.infer<typeof Deployment>;
