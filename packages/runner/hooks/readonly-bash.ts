#!/usr/bin/env bun
/**
 * foundry read-only shell guard — PreToolUse hook (matcher: Bash), run with bun.
 *
 * The Explainer of a Conversation (ADR-0073) explains; it never changes anything. Claude Code's and Antigravity's
 * read-only tool sets still hand the session a shell, and a shell writes as easily as it reads. This hook keeps the
 * shell to reading: an allowlist of programs (git's read-only subcommands, rg, grep, cat, head, tail, ls, find…), no
 * redirection into a file, no command or process substitution, and each command of a pipeline or an `&&` chain judged
 * on its own. Anything else is denied (exit 2), with a line that says what to use instead. Codex needs none of this:
 * its sandbox is read-only on its own.
 */

export interface ShellVerdict {
  allow: boolean;
  reason: string;
}

export const READ_ONLY_SHELL_MESSAGE = 'BLOCKED by foundry: this Conversation is read-only, and this command could write or run something. Read with git log / show / diff / blame / grep, rg, grep, cat, head, tail, ls, find, wc, jq and the like, and do not retry it.';

/** programs that only read what they are given (writing needs a redirection, which is refused apart) */
const READERS = new Set([
  'rg', 'grep', 'egrep', 'fgrep', 'ag', 'ack', 'fd', 'fdfind', 'ls', 'tree', 'cat', 'bat', 'head', 'tail', 'less', 'more', 'wc', 'sort', 'uniq', 'cut', 'tr', 'awk', 'jq', 'yq',
  'basename', 'dirname', 'realpath', 'readlink', 'pwd', 'echo', 'printf', 'date', 'which', 'whereis', 'type', 'command', 'file', 'stat', 'du', 'df', 'diff', 'cmp', 'comm', 'column',
  'nl', 'tac', 'rev', 'od', 'xxd', 'hexdump', 'strings', 'true', 'false', 'test', '[', 'md5', 'md5sum', 'shasum', 'sha1sum', 'sha256sum', 'paste', 'fold', 'fmt', 'expand', 'seq', 'cd', 'export', 'set', 'unset', 'exit',
]);
/** git subcommands that read the repository; the ones with writing forms are judged on their arguments below */
const GIT_READERS = new Set(['log', 'show', 'diff', 'blame', 'grep', 'ls-files', 'ls-tree', 'status', 'rev-parse', 'rev-list', 'describe', 'shortlog', 'for-each-ref', 'cat-file', 'name-rev', 'merge-base', 'whatchanged', 'range-diff', 'cherry', 'count-objects', 'check-ignore', 'check-attr', 'symbolic-ref', 'var', 'version', 'help', 'show-ref', 'diff-tree', 'diff-index', 'diff-files', 'ls-remote', 'show-branch', 'annotate', 'bisect', 'log-tree', 'rerere']);
/** git global options that take a value (`git -C dir log`) */
const GIT_VALUED = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix']);
/** programs whose version a reader may ask for, and nothing else */
const VERSIONED = /^(node|bun|npm|pnpm|yarn|npx|python3?|pip3?|go|rustc|cargo|java|ruby|php|deno|gh|docker|claude|codex|agy|make|tsc)$/;

/** quoted strings as one word each, so a `|` or a `>` inside a pattern is not read as the shell's */
const unquote = (s: string) => s.replace(/'[^']*'/g, 'Q').replace(/"(?:[^"\\]|\\.)*"/g, 'Q');

/** one simple command of the line: its words after the leading `VAR=value` assignments */
function words(segment: string): string[] {
  const out = segment.trim().split(/\s+/).filter(Boolean);
  while (out.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(out[0]!)) out.shift();
  return out;
}

function judgeGit(args: string[]): ShellVerdict {
  // global options before the subcommand
  let i = 0;
  while (i < args.length && args[i]!.startsWith('-')) {
    const opt = args[i]!;
    if (GIT_VALUED.has(opt)) i += 2;
    else i += 1;
  }
  const sub = args[i];
  const rest = args.slice(i + 1);
  if (!sub) return { allow: false, reason: 'git without a subcommand' };
  if (GIT_READERS.has(sub)) return { allow: true, reason: `git ${sub} reads` };
  const flags = rest.filter((a) => a.startsWith('-'));
  const plain = rest.filter((a) => !a.startsWith('-'));
  switch (sub) {
    case 'branch':
    case 'tag': {
      // listing only: a bare name would make one
      const listing = flags.some((f) => f === '-l' || f === '--list' || f === '-a' || f === '-r' || f === '-v' || f === '-vv' || f.startsWith('--contains') || f.startsWith('--merged') || f.startsWith('--no-merged') || f.startsWith('--format') || f.startsWith('--sort') || f.startsWith('--points-at'));
      const writing = flags.some((f) => /^-[dDmMcCu]$/.test(f) || /^--(delete|move|copy|set-upstream-to|unset-upstream|edit-description|force|annotate|sign|message|file)\b/.test(f) || f === '-f' || f === '-s' || f === '-e' || f === '-F');
      if (writing) return { allow: false, reason: `git ${sub} with a writing option` };
      if (plain.length && !listing) return { allow: false, reason: `git ${sub} <name> makes one; list with --list` };
      return { allow: true, reason: `git ${sub} lists` };
    }
    case 'stash':
      return rest[0] === 'list' || rest[0] === 'show' ? { allow: true, reason: 'git stash lists' } : { allow: false, reason: 'git stash changes the worktree' };
    case 'worktree':
      return rest[0] === 'list' ? { allow: true, reason: 'git worktree list' } : { allow: false, reason: 'git worktree changes worktrees' };
    case 'remote':
      return !plain.length || plain[0] === 'show' || plain[0] === 'get-url' ? { allow: true, reason: 'git remote reads' } : { allow: false, reason: 'git remote changes the remotes' };
    case 'reflog':
      return !rest.length || rest[0] === 'show' || rest[0]!.startsWith('-') ? { allow: true, reason: 'git reflog shows' } : { allow: false, reason: 'git reflog changes the log' };
    case 'config':
      return flags.some((f) => f === '-l' || f === '--list' || f.startsWith('--get')) ? { allow: true, reason: 'git config reads' } : { allow: false, reason: 'git config without --get or --list writes' };
    case 'notes':
      return rest[0] === 'list' || rest[0] === 'show' ? { allow: true, reason: 'git notes lists' } : { allow: false, reason: 'git notes writes' };
    default:
      return { allow: false, reason: `git ${sub} may change the repository` };
  }
}

/** Pure decision so the tests drive it directly; the hook body below wires stdin and the exit code. */
export function judgeReadOnlyShell(command: string): ShellVerdict {
  const raw = command ?? '';
  if (!raw.trim()) return { allow: true, reason: 'nothing to run' };
  // what would run something the words do not show
  if (/`|\$\(|<\(|>\(/.test(raw)) return { allow: false, reason: 'command or process substitution' };
  const stripped = unquote(raw);
  // redirections into a file write it: only the ones to /dev/null or to the other standard stream stay
  const redirections = stripped.replace(/\d?>{1,2}\s*&\d/g, '').replace(/&?\d?>{1,2}\s*\/dev\/null/g, '');
  if (/>/.test(redirections)) return { allow: false, reason: 'a redirection into a file' };
  for (const segment of stripped.split(/\|\||&&|[;|\n]/)) {
    const w = words(segment);
    if (!w.length) continue;
    const program = w[0]!.replace(/^.*\//, '');
    const args = w.slice(1);
    if (program === 'git') {
      const v = judgeGit(args);
      if (!v.allow) return v;
      continue;
    }
    if (program === 'sed') {
      if (args.some((a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith('--in-place'))) return { allow: false, reason: 'sed -i edits the file' };
      continue;
    }
    if (program === 'find') {
      const acting = args.find((a) => /^-(delete|exec|execdir|ok|okdir|fprint|fprintf|fls|fprint0)$/.test(a));
      if (acting) return { allow: false, reason: `find ${acting} acts on what it finds` };
      continue;
    }
    if (VERSIONED.test(program) && args.length === 1 && /^(-v|-V|--version|version)$/.test(args[0]!)) continue;
    if (READERS.has(program)) continue;
    return { allow: false, reason: `${program} is not a reading command` };
  }
  return { allow: true, reason: 'every command reads' };
}

if (import.meta.main) {
  const input = await new Response(Bun.stdin.stream()).text();
  let j: { tool_name?: string; tool_input?: { command?: string } } = {};
  try {
    j = JSON.parse(input);
  } catch {
    process.exit(0);
  }
  if (j.tool_name && j.tool_name !== 'Bash') process.exit(0);
  const v = judgeReadOnlyShell(j.tool_input?.command ?? '');
  if (!v.allow) {
    console.error(`${READ_ONLY_SHELL_MESSAGE} (${v.reason})`);
    process.exit(2);
  }
  process.exit(0);
}
