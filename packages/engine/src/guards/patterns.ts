/**
 * JS mirror of the patterns in packages/runner/hooks/boundary-guard.sh.
 * Used to tell "denied because of the boundary" apart from "denied by permission mode"
 * when evaluating Escalation trigger 5.
 */
export const BOUNDARY_RE =
  /git\s+push|gh\s+pr\s+create|gh\s+pr\s+merge|gh\s+release|npm\s+publish|bun\s+publish|yarn\s+publish|pnpm\s+publish|cargo\s+publish|vercel(@[^\s"]*)?\s+(deploy|--prod|promote|redeploy|rollback|alias|remove|rm)|netlify(-cli)?(@[^\s"]*)?\s+(deploy|sites:create|sites:delete|env:set|api)|flyctl\s+deploy|fly\s+deploy|wrangler(@[^\s"]*)?\s+(deploy|publish|delete|pages\s+(deploy|publish|project\s+(create|delete))|versions\s+deploy|secret\s+put)|terraform\s+apply|pulumi\s+up|kubectl\s+apply|kubectl\s+delete|docker\s+push|aws\s+s3\s+(cp|sync|rm)|gcloud\s+.*deploy|git\s+remote\s+(add|set-url)/;

/** a bare `vercel` deploys: the program with nothing after it but flags, directly or through a package runner (one command of a line) */
export const BARE_VERCEL_RE =
  /^\s*(([A-Za-z_][A-Za-z0-9_]*=\S*|env|sudo|exec|command|npx|bunx|pnpx|(pnpm|yarn)\s+dlx)\s+(-\S+\s+)*)*(\S*\/)?vercel(@\S*)?(\s+(--?(token|scope|team|cwd|local-config|global-config|env|build-env|meta|regions|archive|target|[tSAebm])[\s=]+\S+|-\S+))*\s*$/;

export function isBoundaryCommand(cmd: unknown): boolean {
  if (typeof cmd !== 'string') return false;
  return BOUNDARY_RE.test(cmd) || cmd.split(/&&|\|\||[;|\n]/).some((part) => BARE_VERCEL_RE.test(part));
}

/**
 * A command position inside the Bash command as the hook sees it (JSON-escaped): the start of the string, a separator
 * (`;`, `&`, `|`, `(`) or an escaped newline. `grep open`, `--open` and prose that names an app never sit there.
 */
const AT = '(^|[;&|(]|\\\\n)[[:space:]]*';
/** what may stand before a program at command position: variable assignments, env/nohup/sudo/exec/command/time, and the program's own path */
const PRE = '(([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*|env|nohup|sudo|exec|command|time)[[:space:]]+)*([^[:space:]]*/)?';
/**
 * Commands that open a desktop app or hand a file to a printer on this computer (text-to-cad's Bambu and OrcaSlicer
 * hand-offs), as the ERE the boundary hook greps over a Bash command while Settings → Safety → Desktop apps & printers
 * is off: macOS `open` with any argument (it always brings an app up; Bambu Connect's import link is opened this way),
 * `xdg-open`, `osascript`, Windows' `Start-Process`, and `xargs` feeding an opener, each also by path or behind env,
 * sudo and the like. The hook greps the command alone, never the call's other fields (cwd, description).
 */
export const DESKTOP_APPS_PATTERNS = `${AT}${PRE}(open|xdg-open|osascript|Start-Process)[[:space:]]+[^[:space:]]|xargs[[:space:]]+(-[^[:space:]]+[[:space:]]+)*([^[:space:]]*/)?(open|xdg-open)([[:space:]]|$)`;
/**
 * The slicers' own programs: a window when given a file, headless with their slicing switches. The hook blocks a command
 * that matches this unless the same command (not another one on the line) also matches SLICER_HEADLESS_PATTERNS.
 */
export const SLICER_APP_PATTERNS = `${AT}${PRE}(orca-slicer|bambu-studio)([[:space:]"\\\\]|$)|MacOS/(OrcaSlicer|BambuStudio|Bambu(\\\\\\\\)?[[:space:]]Studio)([[:space:]"\\\\]|$)`;
/** the switches that make a slicer's program run headless (OrcaSlicer's and Bambu Studio's command line) */
export const SLICER_HEADLESS_PATTERNS = '--(slice|export-[a-z0-9-]+|load-settings|load-filaments|info|outputdir|arrange|orient|help|version)([=[:space:]"\\\\]|$)';
