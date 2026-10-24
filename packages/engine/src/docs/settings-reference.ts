/**
 * The operator configuration reference (docs/operate/configuration.md) is generated from here: every Settings key, where
 * it sits in the web UI, its default, the environment variable that seeds it, and one line on what it does.
 * reference.test.ts fails when a key exists in the schema but not here, or when the generated file is out of date.
 */
import { DEFAULT_SETTINGS, RESTART_SETTINGS } from '@foundry/core';
import { ENV_VARS, SETTING_PATHS } from '../settings.ts';

type Section = 'New goal defaults' | 'Models & limits' | 'Skills' | 'Git & delivery' | 'Tools & keys' | 'Preview & self-check' | 'Notifications' | 'Safety' | 'Beta' | 'Engine (install)';

export const SETTING_DOCS: Record<string, { section: Section; help: string }> = {
  'engine.provider': { section: 'Engine (install)', help: 'Installation default (claude, codex or agy), fixed at launch. Each new goal can select any coding agent; existing goals keep theirs.' },
  'engine.codexBin': { section: 'Engine (install)', help: 'Codex CLI path; empty uses codex on PATH. Requires hooks support.' },
  'engine.agyBin': { section: 'Engine (install)', help: 'Antigravity CLI path; empty uses agy on PATH. Needs 1.1.15 or newer (stream-json input).' },
  'engine.codexHome': { section: 'Engine (install)', help: 'Codex configuration and login directory; empty uses CODEX_HOME or ~/.codex.' },
  'models.codexModel': { section: 'Models & limits', help: 'Base model substituted for codex-default in new Codex goal presets. codex-default leaves model choice to the native CLI; an explicit model ID pins it.' },
  'models.agyModel': { section: 'Models & limits', help: 'The model every role of a new Antigravity goal runs on. agy-default follows the model the CLI itself is set to.' },
  'models.agyEffort': { section: 'Models & limits', help: 'The Antigravity reasoning effort of every role: low, medium, high, xhigh or max.' },
  // New goal defaults
  'workflow.defaultMode': { section: 'New goal defaults', help: 'Which view a new goal opens in: simple (plain-language Brief and progress) or expert (every control).' },
  'workflow.defaultPace': { section: 'New goal defaults', help: 'thorough = the engine adds its own task and goal reviews and can spawn fix tasks; fast = only the checks you approved run. Image and video goals start fast.' },
  'workflow.tdd': { section: 'New goal defaults', help: 'Test-driven discipline for new expert goals: required (observed), preferred (suggested) or off.' },
  'workflow.ponytail': { section: 'New goal defaults', help: 'Ponytail, the lazy senior dev, for new goals: workers write the smallest change that fully solves the task and reuse what exists, the planner plans lean, and ponytail-review reviews. Each goal has its own switch.' },
  'workflow.audit': { section: 'New goal defaults', help: 'New goals run ponytail-audit on the finished branch before the goal review; must-fix findings in the code the goal touched become fix tasks. Chosen per goal at Brief approval.' },
  'workflow.qa': { section: 'New goal defaults', help: 'New goals with a web app test it in a browser once every task is done, before the goal review: one session tries each acceptance check with Playwright and a must check that fails becomes a fix task. Chosen per goal at Brief approval; needs Chromium for Playwright.' },
  'workflow.mcpDynamicTools': { section: 'Skills', help: 'Let sessions use the tools of allowed MCP servers that run or change things: for REA, launching the target app, attaching a debugger, touching a connected Android device. Off = static analysis only.' },
  'workflow.investigationMaxCostUsd': { section: 'Models & limits', help: 'Cost cap of the session that investigates a goal\'s reference with REA before Clarify.' },
  'workflow.investigationMaxMinutes': { section: 'Models & limits', help: 'Time cap of that investigation, in minutes.' },
  'workflow.milestonePause': { section: 'New goal defaults', help: 'New goals pause at their milestones so you can have a look; off = they go on, and what the milestone shows is sent to your notification channels. Switchable per goal.' },
  'workflow.interview': { section: 'New goal defaults', help: 'The older switch for the interview: auto, always (at least one round) or never (one-shot Brief). Interview depth, when set, takes its place.' },
  'workflow.interviewDepth': { section: 'New goal defaults', help: 'How deep Clarify interviews you before writing the Brief: 0 = not at all (one-shot Brief), 1 = only what a wrong guess would waste … 5 = every detail, until nothing is left to decide. Empty = what Interview stands for (auto 3, always 4, never 0). Switchable per goal.' },
  'workflow.effort': { section: 'New goal defaults', help: 'Default goal-wide effort override (low … max). Empty uses each Codex role preset, the Antigravity effort (models.agyEffort) or the Claude CLI default. New goals can override it.' },
  'reviews.alwaysReviewTasks': { section: 'New goal defaults', help: 'Run the task reviewer on every task, not only tasks that ask for a reviewer check (thorough pace).' },
  'reviews.maxFixCycles': { section: 'New goal defaults', help: 'Goal review → fix-task rounds before the goal asks you.' },
  'reviews.smallGoalLines': { section: 'New goal defaults', help: 'A goal whose whole diff is at most this many lines is reviewed by the Task reviewer model without review skills; 0 = never.' },
  'delivery.defaultMode': { section: 'New goal defaults', help: 'Where finished work goes by default: local (branch only), push, pr or pr-automerge.' },
  'delivery.defaultUnit': { section: 'New goal defaults', help: 'One pull request per goal (goal) or a stack of one PR per task (task).' },
  'delivery.defaultRemote': { section: 'New goal defaults', help: 'Git remote that delivery pushes to.' },
  // Models & limits
  'models.codexPresets': { section: 'Models & limits', help: 'Independent Codex presets: model and reasoning effort per role and goal type, including housekeeping. Saved changes affect new Codex goals only.' },
  'models.codexPresetCode': { section: 'Models & limits', help: 'Codex preset for code and unclassified goals; its complete tables are captured when a goal is created.' },
  'models.codexPresetDocs': { section: 'Models & limits', help: 'Codex preset for document and research goals.' },
  'models.codexPresetMedia': { section: 'Models & limits', help: 'Codex preset for image, video and figure goals.' },
  'models.codexFallbacks': { section: 'Models & limits', help: 'Codex fallback model IDs, tried in order only for model-unavailability errors. Captured per new goal; empty pauses for a decision. Does not switch providers or retry authentication and quota errors with another model.' },
  'models.presetCode': { section: 'Models & limits', help: 'Model preset for code goals and goals not yet classified.' },
  'models.presetDocs': { section: 'Models & limits', help: 'Model preset for documents and research goals.' },
  'models.presetMedia': { section: 'Models & limits', help: 'Model preset for image, video and figure goals.' },
  'models.presets': { section: 'Models & limits', help: 'Presets you edited or created (edit them in the Presets editor, not by hand). Built-ins you never touched are not stored.' },
  'models.cheap': { section: 'Models & limits', help: 'Housekeeping model: one-turn engine chores (classifying a goal, summarising logs, the rate-limit probe).' },
  'models.fallbacks': { section: 'Models & limits', help: 'Tried in order when a model is unavailable; the replacement is remembered for that goal.' },
  'models.escalateLastAttempt': { section: 'Models & limits', help: "A task's last attempt (budget ≥ 2) and every retry you grant run on the preset's Complex-task model." },
  'engine.maxConcurrent': { section: 'Models & limits', help: 'Total concurrent agent sessions across Claude and Codex goals. A session a person is waiting for (Clarify and its planner, a Revise, a Draft) may run as one more beyond it, so at most this number plus one run at once.' },
  'sessions.maxContinuations': { section: 'Models & limits', help: 'How often one attempt may resume its session before a fresh attempt starts; 0 = never.' },
  'sessions.attemptMaxTurns': { section: 'Models & limits', help: 'Model-turn cap for a Claude attempt; tool-call cap for a Codex attempt; three tool calls per turn for an Antigravity attempt.' },
  'sessions.attemptMaxCostUsd': { section: 'Models & limits', help: 'Claude-only cost cap (USD) for one attempt session, also bounded by the goal budget. Codex does not report USD costs.' },
  'sessions.attemptTimeoutMin': { section: 'Models & limits', help: 'Wall-clock cap for one attempt session.' },
  // Skills
  'workflow.profile': { section: 'New goal defaults', help: "Workflow suite new goals start with — whose skills the roles follow: mattpocock (Matt Pocock's suite), pstack (with Matt Pocock's skills where it has none) or plain (the installed-skills hint only). Each goal fixes its own on the New goal form." },
  'workflow.suiteReleases': { section: 'Skills', help: "The release each workflow suite was moved to (suite → tag, e.g. `{ \"pstack\": \"v0.9.101\" }`). Set with **Move** under Workflow suites on the Extensions page, after its forecast of the skills that release removes, deprecates and adds. The newer of this and the release Foundry's catalog pins is used, so a Foundry update never moves a suite back; empty = the catalog's pins." },
  'workflow.designPack': { section: 'Skills', help: 'Design skill set for UI tasks.' },
  'workflow.imagePack': { section: 'Skills', help: 'Image-generation skill set for image tasks.' },
  'workflow.videoPack': { section: 'Skills', help: 'Video skill set for video tasks.' },
  'workflow.figurePack': { section: 'Skills', help: 'Figure skill set for figure tasks (beta, ADR-0076): Colorfigures, iso-glow or none. Both are bundled with Foundry; a goal may pick the other installed style on the New goal form.' },
  'workflow.autoskills': { section: 'Skills', help: "Install project skills matched to each goal repository's stack." },
  'workflow.learnings': { section: 'New goal defaults', help: "When a goal ends, a short session on the goal's housekeeping model adds what it taught about the repository to the folder's Learnings. Off = nothing is learned automatically; the Learnings you keep are still given to later goals." },
  'workflow.briefSecondOpinion': { section: 'New goal defaults', help: "Once a new goal's Brief is ready for your approval, a reviewer that did not write it reads it against the repository and proposes what to change, on the goal reviewer's model: a checklist on the Brief page you apply or not. Off = the Brief page still has the button." },
  'workflow.learningsSkill': { section: 'New goal defaults', help: "Write each folder's Learnings into the repository as a project skill (foundry-learnings, under .claude/skills and .agents/skills, kept out of git) for your own sessions there; rewritten whenever the Learnings change. Off = the file is removed." },
  'workflow.settingSources': { section: 'Skills', help: 'Which Claude settings sources sessions load (e.g. user, project, local); empty = all of them.' },
  'workflow.codexMcpAllowed': { section: 'Skills', help: 'Codex MCP servers worker sessions may use, as `mcp__<server>` prefixes. Managed in Extensions → Codex → MCP servers. Independent of the Claude allow list; empty by default.' },
  'workflow.mcpAllowed': { section: 'Skills', help: 'Claude MCP servers worker sessions may use, as tool prefixes (`mcp__<server>`, `mcp__plugin_<plugin>_<server>`, `mcp__claude_ai_<name>`). Set with the switches on the Skills page\'s MCP tab; sessions run without asking, so an unlisted server\'s tools are refused.' },
  // Memory (ADR-0072), set up on the Extensions page's MCP servers tab
  'memory.url': { section: 'Skills', help: 'Address of the Hindsight server that keeps Memory for your folders (http://127.0.0.1:8888 when it runs on this computer). Set from the Hindsight card on the Extensions page, MCP servers tab. Empty = Memory off: nothing is remembered or recalled.' },
  'memory.token': { section: 'Skills', help: "The server's bearer token, when it asks for one (its HINDSIGHT_API_TENANT_API_KEY). Kept by the engine, which calls the server itself; Claude Code gets it in the hindsight server's headers, Codex reads it from HINDSIGHT_API_TOKEN in its sessions." },
  'memory.retainTranscripts': { section: 'Skills', help: "Write each attempt's transcript to the folder's bank when the attempt ends, in compact form: the turns and one line per tool call, without arguments or outputs. Off = only Foundry's own records are written (the goal record, the Learnings, Brief revisions, review verdicts, replan reasons)." },
  'memory.reflectSec': { section: 'Skills', help: "How long a stage waits for the bank's answer (reflect) before it is given the memories themselves (recall, found without a model in well under a second) and goes on. 20 s suits a server with an API-key LLM; one whose LLM is a coding agent's CLI (claude-code, openai-codex) answers in 60–120 s. Set on the Hindsight card." },
  'memory.seedCommits': { section: 'Skills', help: "How many recent commit messages seed a folder's bank the first time Memory is used there, one document per commit (skipped when the bank already holds documents); 0 = none. Set on the Hindsight card." },
  'memory.excludedFolders': { section: 'Skills', help: 'Folders whose goals neither read nor write Memory (absolute paths). Switched from each folder\'s card on the Learnings page.' },
  // Git & delivery
  'sync.fetchBeforeGoal': { section: 'Git & delivery', help: 'Fetch the remote before a goal branch is created.' },
  'sync.startFrom': { section: 'Git & delivery', help: 'Where a goal branch starts: auto (the remote base when the local one is behind it) or local (always the local base).' },
  'sync.refreshBetweenTasks': { section: 'Git & delivery', help: 'Merge a moved base branch into the goal branch between tasks.' },
  'delivery.pollSec': { section: 'Git & delivery', help: 'How often CI status is polled after the first two minutes (during the first two minutes it polls every 10 s).' },
  'delivery.noChecksGraceSec': { section: 'Git & delivery', help: 'How long to wait for CI checks to appear on a PR in a repository that runs CI.' },
  'delivery.checksTimeoutMin': { section: 'Git & delivery', help: 'Give up waiting for pending checks after this long; the PR stays open.' },
  'delivery.automergeWaitMin': { section: 'Git & delivery', help: 'How long to wait for GitHub auto-merge under branch protection before leaving it armed.' },
  'delivery.commitAuthor': { section: 'Git & delivery', help: 'Who the engine\'s commits are written by: you-coauthor (your git identity — the repository\'s, else the global one, else your GitHub account via gh — with a Co-authored-by: Foundry trailer), you (your identity only) or foundry (foundry <foundry@local>; deploy integrations such as Vercel teams may refuse it). Applies to commits made from now on.' },
  'delivery.updateLocalBase': { section: 'Git & delivery', help: 'After a pull request merges, fast-forward your local base branch when it is safe (no uncommitted changes, no diverging commits), then remove the goal\'s progress folder, worktrees and local branches. Off: you pull yourself and delete the goal to tidy up.' },
  'delivery.vercelToken': { section: 'Git & delivery', help: 'A Vercel token for Deploy (a finished web app to Vercel). Kept by the engine only: never handed to a coding session.' },
  'delivery.vercelScope': { section: 'Git & delivery', help: 'The slug of the Vercel team to deploy under (the part after vercel.com/); empty = the token’s own account.' },
  'delivery.netlifyToken': { section: 'Git & delivery', help: 'A Netlify personal access token for Deploy. Kept by the engine only.' },
  'delivery.netlifyTeam': { section: 'Git & delivery', help: 'The slug of the Netlify team a new site is made in (the part after app.netlify.com/teams/, not its name); empty = the token’s default team.' },
  'delivery.cloudflareToken': { section: 'Git & delivery', help: 'A Cloudflare API token (Cloudflare Pages: Edit) for Deploy. Kept by the engine only.' },
  'delivery.cloudflareAccountId': { section: 'Git & delivery', help: 'The Cloudflare account the Pages projects are in (with the token above).' },
  // Tools & keys
  'tools.useGraphify': { section: 'Tools & keys', help: 'Use the graphify code graph for relevant-file discovery when installed.' },
  'tools.markitdownBin': { section: 'Tools & keys', help: 'Path to markitdown (converts attachments to markdown); empty = auto-detect.' },
  'tools.openaiApiKey': { section: 'Tools & keys', help: 'Handed to sessions as OPENAI_API_KEY (image generation).' },
  'tools.openaiBaseUrl': { section: 'Tools & keys', help: 'Handed to sessions as OPENAI_BASE_URL (proxies, compatible providers).' },
  'tools.kimiApiKey': { section: 'Tools & keys', help: 'Handed to sessions as MOONSHOT_API_KEY and KIMI_API_KEY.' },
  'tools.geminiApiKey': { section: 'Tools & keys', help: 'Handed to sessions as GEMINI_API_KEY.' },
  'tools.minimaxApiKey': { section: 'Tools & keys', help: 'MiniMax key for mmx-cli (video and narration). mmx ignores MINIMAX_API_KEY when a session runs it, so Foundry writes the key to data/mmx/config.json (mode 600) and points sessions at it with MMX_CONFIG_DIR; sessions also get MINIMAX_API_KEY. Empty = the engine\'s environment, or your own `mmx auth login`.' },
  'tools.elevenlabsApiKey': { section: 'Tools & keys', help: 'Handed to sessions as ELEVENLABS_API_KEY (narration voices).' },
  'tools.groqApiKey': { section: 'Tools & keys', help: 'Handed to sessions as GROQ_API_KEY (speech-to-text fallback for captions when local transcription struggles).' },
  // Preview & self-check
  'preview.portFrom': { section: 'Preview & self-check', help: 'First port handed to goal previews; an app keeps its usual port (3000 for Next) while that is free.' },
  'preview.portTo': { section: 'Preview & self-check', help: 'Last port handed to goal previews (Docker: publish the range).' },
  'preview.idleMinutes': { section: 'Preview & self-check', help: 'A preview nobody opened for this long is stopped (never while a goal waits for your look).' },
  'checks.selfCheck': { section: 'Preview & self-check', help: 'New goals open their preview in headless Chromium after each task, screenshot it and fail on console or network errors.' },
  // shown under Models & limits, switched on the Accounts page (ADR-0065)
  'accounts.autoSwitchClaude': { section: 'Models & limits', help: 'When the current Claude account\'s usage limit stops a session, new sessions move to the next signed-in Claude account and the stopped session resumes there; off = new sessions pause until the limit resets. Turned on from the Accounts page, which quotes the provider\'s terms first.' },
  'accounts.autoSwitchCodex': { section: 'Models & limits', help: 'The same for Codex accounts.' },
  // Notifications
  'notifications.telegramBotToken': { section: 'Notifications', help: 'Telegram bot token.' },
  'notifications.telegramChatId': { section: 'Notifications', help: 'Telegram chat id (the Detect button finds it).' },
  'notifications.discordWebhookUrl': { section: 'Notifications', help: 'Discord webhook URL.' },
  'notifications.discordBotToken': { section: 'Notifications', help: "A Discord bot's token, beside the webhook: the messages that wait for you are posted by the bot in the webhook's channel, with buttons that answer. Empty = Discord messages without buttons." },
  'notifications.baseUrl': { section: 'Notifications', help: 'Address of this UI as reachable from elsewhere; empty = links point at this computer (http://localhost:<port>).' },
  'notifications.tailscale': { section: 'Notifications', help: 'auto: when Tailscale runs here, messages and the UI also carry tailnet links, and Foundry serves its own and the previews\' ports with `tailscale serve`; off: never.' },
  'notifications.tailscaleHost': { section: 'Notifications', help: "This computer's tailnet name, when it should not be read from `tailscale status`." },
  'notifications.telegramActions': { section: 'Notifications', help: 'Telegram messages about something that waits for you carry buttons (Retry, Skip, Continue, Approve…) and take a reply in words; Foundry reads the bot\'s updates while it is on. One bot per Foundry instance.' },
  'notifications.onEscalation': { section: 'Notifications', help: 'Notify when something needs you (Inbox).' },
  'notifications.onInterview': { section: 'Notifications', help: 'Notify when Clarify asks an interview round.' },
  'notifications.onBriefReady': { section: 'Notifications', help: 'Notify when a Brief waits for your approval (one the engine approves itself never notifies).' },
  'notifications.onSchedule': { section: 'Notifications', help: 'Notify when a Schedule fires: the goal it made, or why none was made (the previous run still going).' },
  'notifications.onGoalFinished': { section: 'Notifications', help: 'Notify when a goal ends done, over-delivered or failed.' },
  'notifications.onDelivery': { section: 'Notifications', help: 'Notify when a PR opens, merges, or delivery fails.' },
  'notifications.onRateLimit': { section: 'Notifications', help: 'Notify when a usage limit pauses the engine and when it resumes.' },
  'notifications.onUpdateAvailable': { section: 'Notifications', help: 'Notify once per new Foundry release.' },
  // Safety
  'safety.extraBoundaryPatterns': { section: 'Safety', help: "Extra command patterns (ERE, '|'-separated) the boundary guard blocks in sessions." },
  'safety.allowedRoots': { section: 'Safety', help: 'Folders the folder browser may enter; empty = home and /Volumes.' },
  'safety.desktopApps': { section: 'Safety', help: 'Let sessions open desktop apps and hand files to printers (text-to-cad\'s Bambu hand-off, `open …`, `xdg-open`, the slicers\' windows). Off: the boundary guard refuses those commands and the hand-off skill; headless slicing stays available.' },
  // Beta (ADR-0073)
  'beta.conversation': { section: 'Beta', help: "The Conversation on a goal's page: a bubble opens a read-only Explainer that answers questions about the goal's code and Foundry's records of it, on the preset's Conversation model. Off = no bubble and no Conversation tab." },
  'beta.figure': { section: 'Beta', help: "Figure goals: a kind of goal of its own — interactive isometric figures of everyday objects and machines, one web page each, drawn by the Figure pack (Colorfigures or iso-glow, bundled with Foundry) and opened headless by Foundry when a task lands. Off = the kind, the Figure skills picker and the CLI's figure nature stay hidden; figure goals made before still open." },
  // Engine (install)
  'engine.port': { section: 'Engine (install)', help: 'Port the UI and API listen on.' },
  'engine.host': { section: 'Engine (install)', help: 'Interface to bind; keep 127.0.0.1 unless the people using it have tokens (Settings → Access).' },
  'engine.claudeBin': { section: 'Engine (install)', help: 'Path to the claude CLI; empty = first on PATH.' },
  'engine.claudeHome': { section: 'Engine (install)', help: 'Claude home (skills, plugins, settings); empty = ~/.claude or CLAUDE_CONFIG_DIR.' },
  'engine.workspacesRoot': { section: 'Engine (install)', help: 'Where progress folders go: empty = next to each repository as <repo>-foundry/, or <root>/<repo>/ under this folder.' },
};

const SECTION_ORDER: Section[] = ['New goal defaults', 'Models & limits', 'Skills', 'Git & delivery', 'Tools & keys', 'Preview & self-check', 'Notifications', 'Safety', 'Beta', 'Engine (install)'];
const get = (o: unknown, p: string): unknown => p.split('.').reduce<unknown>((x, k) => (x as Record<string, unknown> | undefined)?.[k], o);
const show = (v: unknown) => (v === null ? '—' : typeof v === 'object' ? (Array.isArray(v) ? (v.length ? `\`${v.join(', ')}\`` : '—') : Object.keys(v as object).length ? '…' : '—') : `\`${String(v)}\``);

/** Operational variables read outside Settings (install and runtime switches). */
const OPERATIONAL_ENV: { name: string; help: string }[] = [
  { name: 'FOUNDRY_REPOS', help: 'Docker compose only: host folder mounted at /repos.' },
  { name: 'FOUNDRY_SUPERVISED', help: 'Set to 1 under launchd / systemd so a self-update exits and lets the supervisor restart Foundry.' },
  { name: 'FOUNDRY_UPDATE_CHECK', help: 'off = no daily release check.' },
  { name: 'FOUNDRY_ALLOWED_HOSTS', help: 'More names Foundry answers to, comma-separated (a tunnel or proxy domain); * = any. IP addresses, localhost, names without a dot or ending in .local, *.ts.net and the Link base URL\'s host always work; other names are refused against DNS rebinding.' },
  { name: 'FOUNDRY_WATCHTOWER_URL / FOUNDRY_WATCHTOWER_TOKEN', help: 'Docker: the watchtower sidecar that applies one-click updates.' },
  { name: 'FOUNDRY_HOST_REPOS', help: "Docker: the projects folder shared at the same path as on the host; the folder picker starts there (set by the installer)." },
  { name: 'FOUNDRY_HOST_DOCKER / FOUNDRY_CONTAINER', help: "Docker: the host's Docker socket is shared, so preview services start there in this container's network (container name, default foundry). Set by the installer (ADR-0024)." },
  { name: 'FOUNDRY_SKIP_SETUP', help: 'Docker: skip installing the graphify skill into a fresh Claude home on first start.' },
  { name: 'COMPOSE_PROFILES', help: 'Docker compose only: `memory` starts the Hindsight service beside Foundry for Memory (ADR-0072); `install.sh --with hindsight` writes it to .env with HINDSIGHT_API_URL=http://hindsight:8888.' },
  { name: 'HINDSIGHT_API_LLM_PROVIDER / HINDSIGHT_API_LLM_API_KEY / HINDSIGHT_API_LLM_MODEL', help: 'Docker compose only, in hindsight.env beside the compose file (mode 600): the LLM the Hindsight service extracts and answers with; the installer asks for them.' },
  { name: 'CLAUDE_CONFIG_DIR', help: 'Alternative to FOUNDRY_CLAUDE_HOME.' },
];

export function renderConfigurationReference(): string {
  const lines: string[] = [
    '# Configuration reference',
    '',
    '<!-- generated by `bun scripts/gen-docs.ts` from packages/engine/src/docs/settings-reference.ts — do not edit by hand -->',
    '',
    'Every setting lives in **Settings** in the web UI and is saved to `data/settings.json`. A value in the file wins over its environment variable, which wins over the default. Settings marked *restart* take effect after Foundry restarts; everything else applies at once.',
    '',
  ];
  for (const section of SECTION_ORDER) {
    const keys = SETTING_PATHS.filter((p) => SETTING_DOCS[p]?.section === section);
    if (!keys.length) continue;
    lines.push(`## ${section}`, '', '| Setting | Default | Environment variable | What it does |', '|---|---|---|---|');
    for (const k of keys) {
      const env = ENV_VARS[k];
      const restart = (RESTART_SETTINGS as readonly string[]).includes(k) ? ' *(restart)*' : '';
      lines.push(`| \`${k}\`${restart} | ${show(get(DEFAULT_SETTINGS, k))} | ${env ? `\`${env}\`` : '—'} | ${SETTING_DOCS[k]!.help} |`);
    }
    lines.push('');
  }
  lines.push('## Other environment variables', '', '| Variable | What it does |', '|---|---|', ...OPERATIONAL_ENV.map((e) => `| \`${e.name}\` | ${e.help} |`), '');
  return lines.join('\n');
}

export function renderCliReference(help: string): string {
  return ['# CLI reference', '', '<!-- generated by `bun scripts/gen-docs.ts` from apps/cli/src/help.ts — do not edit by hand -->', '', 'Run from the Foundry checkout (`bun apps/cli/src/main.ts <command>`, or `bun run cli <command>`). Commands other than `serve`, `doctor`, `skills` and `replay` talk to a running server on `FOUNDRY_URL` (default `http://127.0.0.1:4111`); `github` and `auth` status fall back to a local check when it is down.', '', '```text', help.trim(), '```', ''].join('\n');
}
