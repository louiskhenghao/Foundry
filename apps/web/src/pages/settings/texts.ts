/**
 * The words of every setting the Settings page edits, by the setting's path: the label over its control and the help
 * under it. The page's controls (Setting and Toggle in controls.tsx) draw them from here, and the page's search reads
 * the same words, so a setting is found by whatever its control says and the two cannot drift apart. A setting edited
 * by a component of its own (the model presets, a deploy server's fields, the data folder, the themes) keeps its words
 * there; search-index.ts names those parts. The section each path is edited in is in section-of.ts.
 */
export interface SettingWords {
  label: string;
  help?: string;
}

export const SETTING_TEXT = {
  // New goal defaults
  'workflow.defaultMode': { label: 'Default goal view', help: 'What a new goal opens in. Simple: one plain-language Brief and a progress view; Expert: every control. Switchable per goal.' },
  'workflow.defaultPace': { label: 'Pace for new goals', help: 'thorough: the engine runs its own task and goal reviews and can spawn fix tasks · fast: it skips them, so a goal ends as soon as your approved checks pass. Image and video goals start fast whatever this says. Switchable per goal.' },
  'workflow.interviewDepth': { label: 'Interview depth', help: 'How deep the Clarifier questions you before writing the Brief. It sets how thoroughly it probes, not a number of rounds: from 1, only what a wrong guess would waste, to 5, every detail until nothing is left to decide. Switchable per goal when creating it.' },
  'workflow.milestonePause': { label: 'Have a look: pause new goals at milestones', help: 'On: a goal pauses for the final walkthrough once every task is done, and when a milestone without a script lands, so you can look before it goes on. Off: it goes on, and what each milestone shows is sent to your notification channels. Each goal has its own switch on its Brief and its page.' },
  'workflow.effort': { label: 'Effort for new goals', help: 'An explicit level overrides every role\'s effort. Default uses each Codex role\'s preset effort, the Antigravity effort under Models & limits, or the Claude CLI default. Switchable per goal when creating it.' },
  'workflow.tdd': { label: 'TDD for new Expert goals', help: 'required: workers must invoke tdd and the reviewer is told when they skipped it · preferred: suggested only · off: never mentioned. Simple goals start with preferred; each goal and task can override.' },
  'workflow.profile': { label: 'Workflow suite for new goals', help: 'Whose skills the roles follow; each goal fixes its own on the New goal form. mattpocock: Matt Pocock\'s suite (tests first for features, diagnose first for bugs, code review at the end), and Claude sessions report which skills they used. pstack: pstack\'s suite, with Matt Pocock\'s skills where pstack has none. plain: sessions only hear which skills are installed.' },
  'workflow.ponytail': { label: 'Ponytail for new goals', help: 'on: workers write the smallest change that fully solves the task and reuse what the repository already has, the planner plans lean, and ponytail-review reviews tasks and the goal (TDD still decides how tests are written) · off: the Ponytail skills are never mentioned. Each goal has its own switch.' },
  'workflow.audit': { label: 'Audit at the end of new goals', help: 'Once every task is done, ponytail-audit maps the finished branch and ranks what to fix; must-fix findings in the code the goal touched become fix tasks before the final review, the rest is listed for a follow-up. Chosen per goal at Brief approval.' },
  'workflow.designCheck': { label: 'Compare the screens with the attached design', help: 'A frontend task of a goal that follows a design you attached is started from its worktree and photographed at 1440 and 390 px before its review; the task and goal reviewers compare the screens with the design. Off: they judge the design from the diff and the files alone. Needs Chromium for Playwright.' },
  'workflow.qa': { label: 'Browser QA at the end of new goals', help: 'New goals with a web app: once every task is done, one session opens the finished app in Chromium and tries each acceptance check with Playwright; a must check that fails becomes a fix task before the final review. Chosen per goal at Brief approval; needs Chromium for Playwright.' },
  'workflow.learnings': { label: 'Learn from finished goals', help: 'When a goal ends, a short session on the housekeeping model adds what it taught about the project to that folder\'s Learnings, which later goals there are given. Off: nothing is learned automatically; the Learnings you keep are still used.' },
  'workflow.briefSecondOpinion': { label: 'Second opinion on every Brief', help: 'Once a goal\'s Brief is ready for your approval, a reviewer that did not write it reads it against the repository and proposes what to change, on the goal reviewer\'s model — a checklist on the Brief page you apply or not. Off: the Brief page still has the button.' },
  'workflow.learningsSkill': { label: 'Share Learnings with your own sessions', help: 'Writes each folder\'s Learnings into the repository as a project skill (foundry-learnings, kept out of git) that your own coding-agent sessions there read; rewritten whenever the Learnings change. Off: the file is removed.' },
  'reviews.maxFixCycles': { label: 'Goal-level fix cycles', help: 'How many review → fix-task rounds before the goal escalates to you (thorough pace only).' },
  'reviews.smallGoalLines': { label: 'Small goal (diff lines)', help: 'A goal whose whole diff is this many lines or fewer is reviewed by the Task reviewer model, without review skills or sub-agents. 0 = never.' },
  'reviews.alwaysReviewTasks': { label: 'Review every task', help: 'Run the lightweight task reviewer even when the Brief defined no reviewer check for the task (thorough pace only).' },
  'delivery.defaultMode': { label: 'Mode for new goals' },
  'delivery.defaultUnit': { label: 'Granularity' },
  'delivery.defaultRemote': { label: 'Remote' },
  // Models & limits
  'models.cheap': { label: 'Housekeeping model', help: 'One-turn engine chores: classifying a goal, summarising logs, the rate-limit probe. Cents per goal.' },
  'models.fallbacks': { label: 'Fallbacks (in order)', help: 'When a session\'s model is unavailable (deprecated alias, retired id, typo) the engine re-runs it with the next of these and remembers the replacement for that goal; only when all fail does it ask you.' },
  'models.escalateLastAttempt': { label: 'Last attempt on the Complex-task model', help: 'When a task has 2 or more attempts, its last one — and every retry you grant from the Inbox — runs on the Complex-task model of its preset before the task comes back to you. The timeline says when it happens.' },
  'sessions.limitScale': { label: 'Session limits', help: 'How far a new goal\'s sessions may go past their own dollar caps (an attempt\'s, a review\'s, the planner\'s…). Auto follows the goal\'s preset: Max ×3, Production ×2, Balanced and Economy ×1, and ×1.5 more at xhigh or max effort. Within the goal\'s own budget, Claude Code only. Each goal keeps its own; the New goal form can change it.' },
  'sessions.attemptMaxCostUsd': { label: 'Claude cost cap per session (USD)', help: 'The real guard: a worker session stops at this spend (also bounded by the goal\'s remaining budget).' },
  'sessions.attemptTimeoutMin': { label: 'Attempt timeout (minutes)', help: 'A session killed at this mark keeps what it committed; the attempt then continues or restarts.' },
  'workflow.investigationMaxCostUsd': { label: 'Reference investigation: cost cap', help: 'The session that studies a goal\'s reference app or site with REA before Clarify stops at this cost and writes up what it found so far.' },
  'workflow.investigationMaxMinutes': { label: 'Reference investigation: minutes', help: 'Its time cap.' },
  'sessions.maxContinuations': { label: 'Continuations per attempt', help: 'How often one attempt may resume its own session (after a restart, a turn/cost cap, a timeout, or failing checks with progress) before a fresh attempt is started. Resuming keeps the session\'s context — far cheaper than starting over. 0 = always start fresh.' },
  'sessions.attemptMaxTurns': { label: 'Turn cap per session', help: 'Claude: model turns. Codex: tool calls. Antigravity: three tool calls per turn. Keep it generous; wall-clock timeout remains the hard stop.' },
  'engine.concurrency': { label: 'Concurrency', help: 'Fixed: at most Concurrent agent sessions at once. Auto: worked out from this computer — half its cores and one session per 2 GB of memory beyond 4, at most 16 — and halved while it is busier than its cores can carry; a coding agent whose 5-hour window is 90% used runs one task at a time until it resets. Applies immediately.' },
  'engine.maxConcurrent': { label: 'Concurrent agent sessions', help: 'Global cap across all goals (workers, reviewers, clarify) — the throughput knob, and the one that decides how fast the bill grows. Used while Concurrency is Fixed. Applies immediately.' },
  // Skills
  'workflow.settingSources': { label: 'Setting sources', help: '`--setting-sources` for sessions, comma-separated (user, project, local); empty = inherit everything. Without `user`, your own skills never load.' },
  'workflow.mcpDynamicTools': { label: 'MCP tools that run or change things', help: 'Let sessions use the tools of allowed MCP servers that run or change things — for REA: launching the target app, attaching a debugger, touching a connected Android device. Off: static analysis only (binaries, apps, packages, websites, captures).' },
  'workflow.leanSessions': { label: 'Lean sessions', help: 'Claude Code sessions load only what Foundry gives them: the MCP servers they may use and no other, no claude.ai connector (Gmail, Drive…) unless you allowed one, and none of your own skills that Foundry did not install. Every turn reads less. Your settings, sign-in, CLAUDE.md, plugins and hooks stay. Applies to the next session.' },
  'workflow.autoskills': { label: 'autoskills per goal', help: 'After the Brief is approved, run `npx autoskills` in the goal workspace to install skills matching the repository’s stack (needs Node ≥ 22). Uses .claude/skills for Claude and .agents/skills for Codex and Antigravity. The generated CLAUDE.md is restored and the skills are git-excluded.' },
  // Git & delivery
  'sync.fetchBeforeGoal': { label: 'Fetch the base branch before a goal starts', help: 'Only remote-tracking refs are updated — your checkout is never touched. The Clarifier explores, and the goal branch starts from, the freshest tip.' },
  'sync.startFrom': { label: 'Where the goal branch starts', help: 'auto: from <remote>/<base> when your local base is behind it (and not ahead); local: always from your local branch.' },
  'delivery.commitAuthor': { label: 'Commit author', help: 'Who Foundry\'s commits are written by. Your identity comes from the repository\'s git config, else the global one, else your GitHub account (gh). Deploy integrations such as Vercel teams refuse commits by an unknown author. Applies to commits made from now on.' },
  'sync.refreshBetweenTasks': { label: 'Refresh between tasks', help: 'When nothing is running, fetch again and merge a moved base branch into the goal branch (conflicts go to a Merge Attempt). Useful for long goals on busy repositories; off by default because mid-goal merges can surprise workers.' },
  'delivery.updateLocalBase': { label: 'Update my local base branch after a merge', help: 'When a pull request merges, Foundry fetches and fast-forwards your local base branch (only when that is safe: no uncommitted changes, no commits of your own on it), then removes the goal\'s progress folder, worktrees and local branches. Screenshots and the goal itself stay.' },
  'delivery.vercelToken': { label: 'Vercel token', help: 'A token from the page above, scoped to the team you deploy to.' },
  'delivery.vercelScope': { label: 'Vercel team', help: 'The team\'s slug: the part after vercel.com/. Empty = the token\'s own account.' },
  'delivery.netlifyToken': { label: 'Netlify token', help: 'A personal access token from the page above.' },
  'delivery.netlifyTeam': { label: 'Netlify team', help: 'The slug of the team a new site is made in: the part after app.netlify.com/teams/, not the team\'s name. Empty = your default team.' },
  'delivery.cloudflareToken': { label: 'Cloudflare API token', help: 'A token with the permission Cloudflare Pages: Edit.' },
  'delivery.cloudflareAccountId': { label: 'Cloudflare account id', help: 'On the account\'s overview page, under API.' },
  'delivery.flyToken': { label: 'Fly.io token', help: 'A deploy token (one app) or an organization token.' },
  'delivery.flyOrg': { label: 'Fly.io organization', help: 'The slug of the organization a new app is made in. Empty = your personal organization.' },
  'delivery.flyRegion': { label: 'Fly.io region', help: 'Where a new app\'s machine runs: iad (Virginia), lhr (London), sin (Singapore), nrt (Tokyo), syd (Sydney)… `fly platform regions` lists them.' },
  'delivery.railwayToken': { label: 'Railway token', help: 'An account or workspace token from the page above.' },
  'delivery.railwayWorkspace': { label: 'Railway workspace', help: 'The workspace a new project is made in, when the token reaches several. Empty = the token\'s own.' },
  'delivery.renderApiKey': { label: 'Render API key', help: 'An API key from the page above.' },
  'delivery.renderOwner': { label: 'Render owner', help: 'The workspace id (usr-… or tea-…) a new service is made in; it is in the dashboard\'s address. Empty = the key\'s first workspace.' },
  'delivery.renderRegion': { label: 'Render region', help: 'Where a new service runs.' },
  'delivery.renderPlan': { label: 'Render plan', help: 'What a new service is made as: free sleeps when idle and takes a while to wake; the paid plans are Render\'s.' },
  'delivery.expoToken': { label: 'Expo token', help: 'An access token from the page above.' },
  'delivery.ascKeyId': { label: 'Key id', help: 'The Key ID in the key\'s row.' },
  'delivery.ascIssuerId': { label: 'Issuer id', help: 'Above the list of keys on the same page.' },
  'delivery.ascKey': { label: 'Key (.p8)', help: 'The contents of the downloaded AuthKey_….p8 file, pasted whole; written to a file only while a command runs.' },
  'delivery.playServiceAccount': { label: 'Service account key (JSON)', help: 'The downloaded JSON key, pasted whole; written to a file only while a command runs.' },
  'delivery.pollSec': { label: 'Poll interval (s)' },
  'delivery.noChecksGraceSec': { label: 'Grace before “no checks” (s)' },
  'delivery.checksTimeoutMin': { label: 'Checks timeout (min)' },
  'delivery.automergeWaitMin': { label: 'Auto-merge wait under branch protection (min)' },
  'delivery.storePollMin': { label: 'Store watch (min)', help: 'How often App Store Connect is asked where a submitted build stands.' },
  // Tools & keys
  'tools.useGraphify': { label: 'Use graphify for relevant-file discovery', help: 'When the graphify CLI is installed, sessions get a code-graph based context instead of grep.' },
  'tools.openaiApiKey': { label: 'OpenAI-compatible API key', help: 'Handed to every session as OPENAI_API_KEY — the image pack needs it to actually generate images (without it, image tasks fall back to hand-authored SVG renders). Empty = whatever the engine\'s own environment has.' },
  'tools.openaiBaseUrl': { label: 'OpenAI-compatible base URL', help: 'Handed to sessions as OPENAI_BASE_URL for proxies / compatible providers; empty = the provider\'s default endpoint.' },
  'tools.geminiApiKey': { label: 'Gemini API key', help: 'Handed to sessions as GEMINI_API_KEY — the claude-image-gen image pack option uses Gemini by default (its OpenAI mode uses the key above). Empty = whatever the engine\'s own environment has.' },
  'tools.kimiApiKey': { label: 'Kimi (Moonshot) API key', help: 'Handed to sessions as MOONSHOT_API_KEY and KIMI_API_KEY — used by taste-skill\'s sponsored Kimi models where a skill calls them. Empty = whatever the engine\'s own environment has.' },
  'tools.minimaxApiKey': { label: 'MiniMax API key', help: 'For mmx-cli (video and narration). Foundry saves it where mmx reads it and hands it to sessions as MINIMAX_API_KEY. Empty = the engine\'s own environment, or your own `mmx auth login`.' },
  'tools.elevenlabsApiKey': { label: 'ElevenLabs API key', help: 'Handed to sessions as ELEVENLABS_API_KEY — narration voices for web-video-presentation. Empty = whatever the engine\'s own environment has.' },
  'tools.groqApiKey': { label: 'Groq API key', help: 'Handed to sessions as GROQ_API_KEY — hyperframes transcribes captions locally and falls back to Groq (or the OpenAI key) when the audio is too noisy. Empty = whatever the engine\'s own environment has.' },
  'tools.markitdownBin': { label: 'markitdown binary', help: 'Converts attachments and repository documents to markdown before sessions read them. Empty = auto-detect on PATH and ~/.local/bin.' },
  // Preview & self-check
  'preview.portFrom': { label: 'First port', help: 'Previews take the first free port in this range.' },
  'preview.portTo': { label: 'Last port', help: 'Previews take ports up to this one; when every port in the range is taken, a new preview does not start.' },
  'preview.idleMinutes': { label: 'Idle minutes', help: 'A preview nobody opened for this long is stopped (never while the goal waits for your look).' },
  'checks.selfCheck': { label: 'Self-check new goals by default', help: 'Off by default: it needs Playwright\'s Chromium (below) and only helps goals whose result runs in a browser. Each goal\'s page has its own switch.' },
  // Notifications
  'notifications.telegramBotToken': { label: 'Telegram bot token', help: 'Create a bot with @BotFather in Telegram and paste its token here.' },
  'notifications.telegramChatId': { label: 'Telegram chat id', help: 'Open your bot in Telegram and send it any message, then Detect fills this in.' },
  'notifications.discordWebhookUrl': { label: 'Discord webhook URL', help: 'In your Discord channel: Settings → Integrations → Webhooks → New Webhook, then copy its URL.' },
  'notifications.discordBotToken': { label: 'Discord bot token (buttons)', help: 'Optional, beside the webhook: a bot of yours posts the messages that wait for you in the webhook\'s channel, with buttons that answer. Empty = Discord messages without buttons.' },
  'notifications.baseUrl': { label: 'Link base URL', help: 'Where this UI is reachable from elsewhere (a LAN address, a domain). Empty = links point at this computer (http://localhost); tailnet links are added below.' },
  'notifications.tailscale': { label: 'Tailscale links', help: 'auto: when Tailscale runs on this computer, messages also link to Foundry and the previews on your tailnet, so they open on your phone; Foundry serves those ports with `tailscale serve` (reusing what you already serve) and takes the previews\' down when they stop. off: never.' },
  'notifications.tailscaleHost': { label: 'Tailscale name', help: 'This computer\'s tailnet name. Empty = read from `tailscale status`.' },
  'notifications.telegramActions': { label: 'Answer from Telegram', help: 'Messages about something that waits for you carry buttons (Retry, Skip, Continue, Approve…), and a reply answers in words. Foundry reads the bot\'s messages while this is on, so give each Foundry its own bot. Commands outside the workspace are approved in the Inbox only.' },
  'notifications.onEscalation': { label: 'Needs you', help: 'An escalation was raised — a task or goal is blocked until you answer it on the Inbox page.' },
  'notifications.onInterview': { label: 'Interview round', help: 'The Clarifier asked a round of questions before writing the Brief; the goal waits for your answers.' },
  'notifications.onBriefReady': { label: 'Brief ready', help: 'A Brief waits for your approval. A Brief the engine approves itself (an automatic one, a delegated goal its main goal approves, a scheduled run that approves its own) never notifies.' },
  'notifications.onSchedule': { label: 'Schedule fired', help: 'A schedule fired: the goal it made, or why none was made (its previous run still going).' },
  'notifications.onGoalFinished': { label: 'Goal finished', help: 'A goal ended done, over-delivered, or failed. Cancelling a goal yourself never notifies.' },
  'notifications.onDelivery': { label: 'Delivery', help: 'A pull request was opened or merged, or the delivery failed.' },
  'notifications.onRateLimit': { label: 'Usage pause', help: 'A provider usage limit paused its goals, and when the retry pause lifts.' },
  'notifications.onUpdateAvailable': { label: 'New version', help: 'A Foundry release newer than this instance exists — once per version. Update from the header pill or Settings → About & updates.' },
  // Safety
  'safety.extraBoundaryPatterns': { label: 'Extra boundary patterns', help: 'Additional ERE patterns the boundary hook blocks, \'|\'-separated (e.g. `terraform apply|kubectl`).' },
  'safety.allowedRoots': { label: 'Folder browser roots', help: 'Directories the repository picker may enter, comma-separated; empty = your home and /Volumes.' },
  'safety.desktopApps': { label: 'Desktop apps & printers', help: 'Let sessions open desktop apps and hand files to printers on this computer — text-to-cad\'s Bambu hand-off (Bambu Connect / Bambu Studio), `open …`, `xdg-open`, the slicers\' windows. Off: the boundary guard refuses those commands and the hand-off skill (sessions are not pointed at it either); a refused command comes to your Inbox. Headless slicing and preflight reports stay available.' },
  // Beta
  'beta.conversation': { label: 'Conversation on the goal page', help: 'A bubble at the bottom right of a goal\'s page (and of its Brief page) opens a Conversation: a read-only Explainer, on the preset\'s Conversation model, answers your questions about the goal\'s code and Foundry\'s records of it, and never changes anything. Its answers cost the goal, outside its budget. Off: no bubble and no Conversation tab.' },
  'beta.motionStudio': { label: 'Motion studio video engine', help: 'Video goals get an Engine picker on the New goal form: the motion-studio engine (a deterministic seek(t) renderer with a critique loop) beside the Video skills pack, with its bundled skill in the catalog and its doctor checks for ffmpeg and Chromium. Off: the Video skills pack alone, as before.' },
  'beta.deck': { label: 'Deck goals', help: 'A kind of goal of its own: slide decks as native, editable PPTX files — a pitch, a lecture, a report, a document turned into slides — made by the Deck pack (ppt-master) in a Python environment Foundry keeps, with the Brief standing in for the skill\'s two confirmation stages. When a task lands Foundry counts the slides, runs the skill\'s delivery check and renders the per-slide previews. On: Slides is among the kinds of goal, Deck skills sits under Skills, the CLI takes --nature deck and the doctor checks uv, the environment and Chromium. Off: none of that shows; deck goals made before still open.' },
  'beta.diagram': { label: 'Diagram goals', help: 'A kind of goal of its own: editorial diagrams — architecture, flows, sequences, timelines, charts — one web page with an SVG beside it each, drawn by the Diagram pack (diagram-design) and opened headless by Foundry when a task lands. Document and code goals may carry diagram tasks too. On: Diagrams is among the kinds of goal, Diagram skills sits under Skills, the CLI takes --nature diagram and the doctor checks the tools. Off: none of that shows; diagram goals made before still open.' },
  'beta.figure': { label: 'Figure goals', help: 'A kind of goal of its own: interactive isometric figures of everyday objects and machines, one web page each, drawn by the Figure pack (Colorfigures or iso-glow, bundled with Foundry) and opened headless by Foundry when a task lands. On: Figures is among the kinds of goal, Figure skills sits under Skills, the CLI takes --nature figure and the doctor checks the tools. Off: none of that shows; figure goals made before still open.' },
  'beta.editor': { label: 'Editor on video goals', help: 'A HyperFrames goal\'s page gets an Editor row per project folder — Foundry starts HyperFrames\' browser editor (timeline, inspector, captions, export) as a preview app, while the goal runs and after it finished, reachable over your tailnet like any preview — and a motion-studio goal\'s page a scrubber page per film. A finished HyperFrames goal gets Re-render: the films rendered again after your edits, the earlier result kept, the edits committed, the new files delivered. Off: no Editor rows, no scrubber pages, no Re-render; edits already made stay in the goal\'s folder.' },
  'beta.adjust': { label: 'Adjust the result', help: 'A box on a finished goal\'s page takes your words on its result — what should change, with pictures or files — and the goal carries them out itself: the finished task\'s session resumes with them, or a task is appended, or a failed goal\'s failed tasks run again with them. The checks and reviews run again; the output folder and an open pull request get the new result; the earlier result is kept. It costs the goal, inside its budget. Off: no box; adjustments already made stay on the goal.' },
  // Engine (install)
  'engine.port': { label: 'Port', help: 'HTTP port of the local server and of the boundary hook callback.' },
  'engine.host': { label: 'Host', help: 'Bind address; keep 127.0.0.1 unless you know why.' },
  'engine.codexBin': { label: 'Codex binary', help: 'Empty = codex on PATH.' },
  'engine.codexHome': { label: 'Codex home', help: 'Empty = CODEX_HOME or ~/.codex.' },
  'engine.agyBin': { label: 'Antigravity binary', help: 'Empty = agy on PATH. Needs agy 1.1.15 or newer.' },
  'engine.claudeBin': { label: 'Claude binary', help: 'Path to the Claude Code CLI; empty = first `claude` on PATH.' },
  'engine.claudeHome': { label: 'Claude Code home', help: 'Where skills, plugins and settings.json live; empty = ~/.claude (or CLAUDE_CONFIG_DIR).' },
  'engine.workspacesRoot': { label: 'Progress folders', help: 'Where each goal\'s working folder is created. Empty = next to the repository, as <repo>-foundry/<goal>. A folder here = <folder>/<repo>/<goal>. Applies to goals created from now on.' },
  // headings with a plate of their own: the skill packs (chosen on their own cards) and the deploy servers
  'workflow.designPack': { label: 'Design skills', help: 'Choosing a pack saves immediately; only that pack is shown to sessions working on frontend / fullstack tasks.' },
  'workflow.imagePack': { label: 'Image skills', help: 'Mandated to workers on image tasks (scenario image). The pack only generates when a key is set under Tools & keys.' },
  'workflow.videoPack': { label: 'Video skills', help: 'Mandated to workers on video tasks (scenario video).' },
  'workflow.figurePack': { label: 'Figure skills', help: "Mandated to workers on figure tasks (scenario figure); a goal may pick the other installed style on the New goal form. Both skills are bundled with Foundry: installing copies the snapshot, nothing is downloaded. Colorfigures builds its page with python3 and checks its own shots in a Chrome on this computer; Foundry's own render check needs Playwright's Chromium (Preview & self-check)." },
  'workflow.diagramPack': { label: 'Diagram skills', help: "Mandated to workers on diagram tasks (scenario diagram): in diagram goals, and in document or code goals that carry a diagram task. The skill is installed from its repository at one pinned commit; its SVG export and self-check run with python3 (standard library only), and Foundry's own render check needs Playwright's Chromium (Preview & self-check)." },
  'workflow.deckPack': { label: 'Deck skills', help: "Mandated to workers on deck tasks (scenario deck). Installing clones the skill at one pinned release and makes a Python environment for its scripts with uv (needs uv on PATH; the Setup page's doctor says when it is missing); deck sessions find that Python first. AI pictures in a deck need an image key under Tools & keys; Foundry's slide previews need Playwright's Chromium (Preview & self-check)." },
  'delivery.servers': { label: 'Servers — the whole project on a machine of your own', help: 'A goal with a compose file or a Dockerfile is copied to the server over SSH and started there with docker compose: any backend, with the services beside it. Always production, confirmed each time; the card checks the server first (the key, SSH, Docker, the folder).' },
} satisfies Record<string, SettingWords>;

/** the path of a setting the page words */
export type SettingKey = keyof typeof SETTING_TEXT;

/** a setting's words (the help may be absent) */
export const wordsOf = (path: SettingKey): SettingWords => SETTING_TEXT[path];
