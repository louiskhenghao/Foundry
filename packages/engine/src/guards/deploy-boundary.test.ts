import { describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import { isBoundaryCommand } from './patterns.ts';

const hook = join(resolve(import.meta.dir, '../../../runner'), 'hooks', 'boundary-guard.sh');
async function blocked(command: string): Promise<boolean> {
  const proc = Bun.spawn(['sh', hook], { env: { PATH: process.env.PATH ?? '', FOUNDRY_CALLBACK: '' }, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  proc.stdin.write(JSON.stringify({ tool_name: 'Bash', tool_input: { command } }));
  proc.stdin.end();
  return (await proc.exited) === 2;
}

/** a coding session never deploys by itself: Deploy is the person's, run by the engine (ADR-0041) */
const DEPLOYS = [
  'vercel',
  'vercel --yes',
  'vercel --prod',
  'npx vercel',
  'npx --yes vercel@64 --token abc --scope team-x',
  'cd apps/web && vercel -y',
  'pnpm dlx vercel deploy',
  'npx vercel@latest deploy --prebuilt',
  './node_modules/.bin/vercel',
  'vercel promote https://x.vercel.app',
  'vercel alias set a b',
  'netlify deploy --prod',
  'npx netlify-cli@27 deploy --json',
  'netlify sites:create --name x',
  'npx wrangler@4 pages deploy dist --project-name x',
  'wrangler pages project create x',
  'wrangler deploy',
  'wrangler versions deploy',
  'wrangler secret put KEY',
  // the stores, the PaaS and a server of the person's own (ADR-0090): the same rule, however they are reached
  'eas build --platform ios --non-interactive',
  'npx eas-cli submit -p android --latest',
  'eas update --branch production --message "fix"',
  'npx --yes eas-cli@16 build -p all',
  'eas credentials',
  'eas device:create',
  'fastlane deliver',
  'fastlane pilot upload',
  'fastlane supply --track production',
  'fly launch --now',
  'flyctl secrets set KEY=v',
  'railway up --ci',
  'railway init -n app',
  'railway variable set KEY=v',
  'render deploys create srv-123 --confirm',
  'render services create --repo https://github.com/x/y',
  "ssh deploy@box 'cd ~/apps/x && docker compose up -d --build'",
  'ssh -i key box docker-compose pull',
];
const LOCAL = ['eas build:list --json', 'eas whoami', 'fastlane test', 'fly status', 'fly logs', 'railway logs', 'railway status', 'render services list', 'docker compose up -d', 'docker compose -f compose.yaml up --build', 'ssh box ls -la', 'ssh box "docker ps"', 'vercel dev', 'vercel build', 'vercel env pull .env.local', 'vercel link --yes --project x', 'cat vercel.json', 'echo vercel', 'npm run vercel-build', 'wrangler dev', 'wrangler pages dev dist', 'netlify dev', 'netlify build', 'bun test'];

describe('deploys stay the person’s', () => {
  test('every way of deploying to the hosts is blocked by the hook and named by its mirror', async () => {
    for (const c of DEPLOYS) {
      expect({ c, hook: await blocked(c) }).toEqual({ c, hook: true });
      expect({ c, mirror: isBoundaryCommand(c) }).toEqual({ c, mirror: true });
    }
  });
  test('local work with the same tools is not', async () => {
    for (const c of LOCAL) {
      expect({ c, hook: await blocked(c) }).toEqual({ c, hook: false });
      expect({ c, mirror: isBoundaryCommand(c) }).toEqual({ c, mirror: false });
    }
  });
});
