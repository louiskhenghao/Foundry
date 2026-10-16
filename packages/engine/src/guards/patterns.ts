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

/**
 * Commands that open a desktop app or hand a file to a printer on this computer (text-to-cad's Bambu and OrcaSlicer
 * hand-offs), as the ERE the boundary hook greps when Settings → Safety → Desktop apps & printers is off. Headless
 * slicing (`orca-slicer … --slice`) is not in it: only the openers are.
 */
export const DESKTOP_APPS_PATTERNS = 'open[[:space:]]+-a[[:space:]]|open[[:space:]]+[^[:space:]]+\\.(3mf|stl|step|stp|gcode|dxf|obj)([[:space:]\\\\"]|$)|xdg-open[[:space:]]|Start-Process|bambu-connect://|bambu-studio[[:space:]]|BambuStudio|Bambu[[:space:]]+(Connect|Studio)';
