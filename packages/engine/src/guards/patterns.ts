/**
 * JS mirror of the patterns in packages/runner/hooks/boundary-guard.sh.
 * Used to tell "denied because of the boundary" apart from "denied by permission mode"
 * when evaluating Escalation trigger 5.
 */
export const BOUNDARY_RE =
  /git\s+push|gh\s+pr\s+create|gh\s+pr\s+merge|gh\s+release|npm\s+publish|bun\s+publish|yarn\s+publish|pnpm\s+publish|cargo\s+publish|vercel\s+deploy|vercel\s+--prod|netlify\s+deploy|flyctl\s+deploy|fly\s+deploy|wrangler\s+deploy|terraform\s+apply|pulumi\s+up|kubectl\s+apply|kubectl\s+delete|docker\s+push|aws\s+s3\s+(cp|sync|rm)|gcloud\s+.*deploy|git\s+remote\s+(add|set-url)/;

export function isBoundaryCommand(cmd: unknown): boolean {
  return typeof cmd === 'string' && BOUNDARY_RE.test(cmd);
}
