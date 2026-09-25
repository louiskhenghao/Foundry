/** The CLI's help text — also the source of docs/operate/cli.md (scripts/gen-docs.ts). */
export const help = `foundry — drive the host Claude Code to over-deliver on goals

  serve                                   start engine + server (http://127.0.0.1:4111)
  goal new "<prompt>" --repo <path>       create a goal (Clarify → Brief → approve in UI or via \`brief\`)
       [--title t] [--base branch] [--preset auto|quick|thorough|unlimited|custom] [--max-cost 5|none] [--max-min 120|none] [--concurrency 3] [--attempts 3]
       [--auto-approve --check "<cmd>"]... [--stretch "<cmd>"]...   skip Clarify: one task + command checks
       [--models max|production|balanced|economy|<your preset>]   model preset (default: Settings' preset for the goal type)
       [--nature auto|code|docs|research|image|video] [--pace thorough|fast] [--interview auto|always|never]
       [--effort low|medium|high|xhigh|max] [--self-check]
       [--follows <goalId> [--start-from base|previous] [--no-attachments] [--no-style]]
                                          a Follow-up of a finished goal: its repository and settings are the defaults,
                                          Clarify gets its prompt, Brief and outcomes; starts from its branch unless merged
       [--follow]                         tail the goal's live stream after creating it
       [--deliver push|pr|pr-automerge [--remote origin] [--remote-url URL]]   delivery policy (default local)
  status [goalId]                         list goals, or show one goal's tasks/attempts/checks
  brief <goalId> [--approve]              print the brief; --approve approves it as-is
  escalations                             list open escalations
  answer <escalationId> <action> [--hint "..."] [--attempts N] [--max-cost N] [--max-min N]
  watch <goalId>                          tail live stream + events for a goal
  diff <goalId>                           print the goal branch diff
  cancel <goalId>
  replay --verify                         rebuild read models from the event log and compare
  doctor [--json]                         environment check: claude, login, git, bun, required skills
  skills list [--scope user|plugin|project|all] [--repo <path>] [--json]
  skills catalog                          required / recommended / optional skills and their status
  skills install <id|name> [--force]      install from the catalog into ~/.claude/skills
  skills install --tier required|recommended
  skills uninstall <name> [--force]       move to trash (reversible)
  skills restore <name> · skills update [name] · skills trash
  deliver <goalId> [--mode push|pr|pr-automerge ...]   deliver a finished goal (no --mode: print the plan)
  github [status|login]                   GitHub CLI status / device-flow login (needed for PR modes)
  auth [status|login|logout]              Claude account: who is logged in; login/logout hand over to \`claude auth\`
  usage [--json] [--probe]                Claude usage as seen by foundry (5h / 7d windows, rate-limit signal); --probe spends ~$0.02 to refresh

(doctor and skills work without the server running.)
`;
