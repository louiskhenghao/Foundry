/**
 * The operator configuration reference (docs/operate/configuration.md) is generated from here: every Settings key, where
 * it sits in the web UI, its default, the environment variable that seeds it, and one line on what it does.
 * reference.test.ts fails when a key exists in the schema but not here, or when the generated file is out of date.
 */
import { DEFAULT_SETTINGS, RESTART_SETTINGS } from '@foundry/core';
import { ENV_VARS, SETTING_PATHS } from '../settings.ts';

type Section = 'New goal defaults' | 'Models & limits' | 'Skills' | 'Git & delivery' | 'Tools & keys' | 'Preview & self-check' | 'Notifications' | 'Safety' | 'Engine (install)';

export const SETTING_DOCS: Record<string, { section: Section; help: string }> = {
  // New goal defaults
  'workflow.defaultMode': { section: 'New goal defaults', help: 'Which view a new goal opens in: simple (plain-language Brief and progress) or expert (every control).' },
  'workflow.defaultPace': { section: 'New goal defaults', help: 'thorough = the engine adds its own task and goal reviews and can spawn fix tasks; fast = only the checks you approved run. Image and video goals start fast.' },
  'workflow.tdd': { section: 'New goal defaults', help: 'Test-driven discipline for new expert goals: required (observed), preferred (suggested) or off.' },
  'workflow.interview': { section: 'New goal defaults', help: 'Whether Clarify interviews you before writing the Brief: auto (when something is worth asking), always (at least one round), never (one-shot Brief).' },
  'workflow.effort': { section: 'New goal defaults', help: 'Effort level handed to every session of new goals (low … max); empty = the CLI default.' },
  'reviews.alwaysReviewTasks': { section: 'New goal defaults', help: 'Run the task reviewer on every task, not only tasks that ask for a reviewer check (thorough pace).' },
  'reviews.maxFixCycles': { section: 'New goal defaults', help: 'Goal review → fix-task rounds before the goal asks you.' },
  'reviews.smallGoalLines': { section: 'New goal defaults', help: 'A goal whose whole diff is at most this many lines is reviewed by the Task reviewer model without review skills; 0 = never.' },
  'delivery.defaultMode': { section: 'New goal defaults', help: 'Where finished work goes by default: local (branch only), push, pr or pr-automerge.' },
  'delivery.defaultUnit': { section: 'New goal defaults', help: 'One pull request per goal (goal) or a stack of one PR per task (task).' },
  'delivery.defaultRemote': { section: 'New goal defaults', help: 'Git remote that delivery pushes to.' },
  // Models & limits
  'models.presetCode': { section: 'Models & limits', help: 'Model preset for code goals and goals not yet classified.' },
  'models.presetDocs': { section: 'Models & limits', help: 'Model preset for documents and research goals.' },
  'models.presetMedia': { section: 'Models & limits', help: 'Model preset for image and video goals.' },
  'models.presets': { section: 'Models & limits', help: 'Presets you edited or created (edit them in the Presets editor, not by hand). Built-ins you never touched are not stored.' },
  'models.cheap': { section: 'Models & limits', help: 'Housekeeping model: one-turn engine chores (classifying a goal, summarising logs, the rate-limit probe).' },
  'models.fallbacks': { section: 'Models & limits', help: 'Tried in order when a model is unavailable; the replacement is remembered for that goal.' },
  'models.escalateLastAttempt': { section: 'Models & limits', help: "A task's last attempt (budget ≥ 2) and every retry you grant run on the preset's Complex-task model." },
  'engine.maxConcurrent': { section: 'Models & limits', help: 'Claude sessions running at the same time, across all goals.' },
  'sessions.maxContinuations': { section: 'Models & limits', help: 'How often one attempt may resume its session before a fresh attempt starts; 0 = never.' },
  'sessions.attemptMaxTurns': { section: 'Models & limits', help: 'Turn cap for one attempt session.' },
  'sessions.attemptMaxCostUsd': { section: 'Models & limits', help: 'Cost cap (USD) for one attempt session, also bounded by what is left of the goal budget.' },
  'sessions.attemptTimeoutMin': { section: 'Models & limits', help: 'Wall-clock cap for one attempt session.' },
  // Skills
  'workflow.profile': { section: 'Skills', help: 'Workflow skill set sessions are told to follow: mattpocock (TDD, diagnosing bugs, code review …) or plain.' },
  'workflow.designPack': { section: 'Skills', help: 'Design skill set for UI tasks.' },
  'workflow.imagePack': { section: 'Skills', help: 'Image-generation skill set for image tasks.' },
  'workflow.videoPack': { section: 'Skills', help: 'Video skill set for video tasks.' },
  'workflow.autoskills': { section: 'Skills', help: "Install project skills matched to each goal repository's stack." },
  'workflow.settingSources': { section: 'Skills', help: 'Which Claude settings sources sessions load (e.g. user, project, local); empty = all of them.' },
  // Git & delivery
  'sync.fetchBeforeGoal': { section: 'Git & delivery', help: 'Fetch the remote before a goal branch is created.' },
  'sync.startFrom': { section: 'Git & delivery', help: 'Where a goal branch starts: auto (the remote base when the local one is behind it) or local (always the local base).' },
  'sync.refreshBetweenTasks': { section: 'Git & delivery', help: 'Merge a moved base branch into the goal branch between tasks.' },
  'delivery.pollSec': { section: 'Git & delivery', help: 'How often CI status is polled after the first two minutes (the first two poll every 10 s).' },
  'delivery.noChecksGraceSec': { section: 'Git & delivery', help: 'How long to wait for CI checks to appear on a PR in a repository that runs CI.' },
  'delivery.checksTimeoutMin': { section: 'Git & delivery', help: 'Give up waiting for pending checks after this long; the PR stays open.' },
  'delivery.automergeWaitMin': { section: 'Git & delivery', help: 'How long to wait for GitHub auto-merge under branch protection before leaving it armed.' },
  // Tools & keys
  'tools.useGraphify': { section: 'Tools & keys', help: 'Use the graphify code graph for relevant-file discovery when installed.' },
  'tools.markitdownBin': { section: 'Tools & keys', help: 'Path to markitdown (converts attachments to markdown); empty = auto-detect.' },
  'tools.openaiApiKey': { section: 'Tools & keys', help: 'Handed to sessions as OPENAI_API_KEY (image generation).' },
  'tools.openaiBaseUrl': { section: 'Tools & keys', help: 'Handed to sessions as OPENAI_BASE_URL (proxies, compatible providers).' },
  'tools.kimiApiKey': { section: 'Tools & keys', help: 'Handed to sessions as MOONSHOT_API_KEY and KIMI_API_KEY.' },
  'tools.geminiApiKey': { section: 'Tools & keys', help: 'Handed to sessions as GEMINI_API_KEY.' },
  // Preview & self-check
  'preview.portFrom': { section: 'Preview & self-check', help: 'First port handed to goal previews.' },
  'preview.portTo': { section: 'Preview & self-check', help: 'Last port handed to goal previews (Docker: publish the range).' },
  'preview.idleMinutes': { section: 'Preview & self-check', help: 'A preview nobody opened for this long is stopped (never while a goal waits for your look).' },
  'checks.selfCheck': { section: 'Preview & self-check', help: 'New goals open their preview in headless Chromium after each task, screenshot it and fail on console or network errors.' },
  // Notifications
  'notifications.telegramBotToken': { section: 'Notifications', help: 'Telegram bot token.' },
  'notifications.telegramChatId': { section: 'Notifications', help: 'Telegram chat id (the Detect button finds it).' },
  'notifications.discordWebhookUrl': { section: 'Notifications', help: 'Discord webhook URL.' },
  'notifications.baseUrl': { section: 'Notifications', help: 'Address of this UI as reachable from your phone; messages link to it.' },
  'notifications.onEscalation': { section: 'Notifications', help: 'Notify when something needs you (Inbox).' },
  'notifications.onInterview': { section: 'Notifications', help: 'Notify when Clarify asks an interview round.' },
  'notifications.onGoalFinished': { section: 'Notifications', help: 'Notify when a goal ends done, over-delivered or failed.' },
  'notifications.onDelivery': { section: 'Notifications', help: 'Notify when a PR opens, merges, or delivery fails.' },
  'notifications.onRateLimit': { section: 'Notifications', help: 'Notify when a usage limit pauses the engine and when it resumes.' },
  'notifications.onUpdateAvailable': { section: 'Notifications', help: 'Notify once per new Foundry release.' },
  // Safety
  'safety.extraBoundaryPatterns': { section: 'Safety', help: "Extra command patterns (ERE, '|'-separated) the boundary guard blocks in sessions." },
  'safety.allowedRoots': { section: 'Safety', help: 'Folders the folder browser may enter; empty = home and /Volumes.' },
  // Engine (install)
  'engine.port': { section: 'Engine (install)', help: 'Port the UI and API listen on.' },
  'engine.host': { section: 'Engine (install)', help: 'Interface to bind; keep 127.0.0.1 (the UI has no login).' },
  'engine.claudeBin': { section: 'Engine (install)', help: 'Path to the claude CLI; empty = first on PATH.' },
  'engine.claudeHome': { section: 'Engine (install)', help: 'Claude home (skills, plugins, settings); empty = ~/.claude or CLAUDE_CONFIG_DIR.' },
  'engine.workspacesRoot': { section: 'Engine (install)', help: 'Where progress folders go: empty = next to each repository as <repo>-foundry/, or <root>/<repo>/ under this folder.' },
};

const SECTION_ORDER: Section[] = ['New goal defaults', 'Models & limits', 'Skills', 'Git & delivery', 'Tools & keys', 'Preview & self-check', 'Notifications', 'Safety', 'Engine (install)'];
const get = (o: unknown, p: string): unknown => p.split('.').reduce<unknown>((x, k) => (x as Record<string, unknown> | undefined)?.[k], o);
const show = (v: unknown) => (v === null ? '—' : typeof v === 'object' ? (Array.isArray(v) ? (v.length ? `\`${v.join(', ')}\`` : '—') : Object.keys(v as object).length ? '…' : '—') : `\`${String(v)}\``);

/** Operational variables read outside Settings (install and runtime switches). */
const OPERATIONAL_ENV: { name: string; help: string }[] = [
  { name: 'FOUNDRY_REPOS', help: 'Docker compose only: host folder mounted at /repos.' },
  { name: 'FOUNDRY_SUPERVISED', help: 'Set to 1 under launchd / systemd so a self-update exits and lets the supervisor restart Foundry.' },
  { name: 'FOUNDRY_UPDATE_CHECK', help: 'off = no daily release check.' },
  { name: 'FOUNDRY_WATCHTOWER_URL / FOUNDRY_WATCHTOWER_TOKEN', help: 'Docker: the watchtower sidecar that applies one-click updates.' },
  { name: 'FOUNDRY_SKIP_SETUP', help: 'Docker: skip installing the graphify skill into a fresh Claude home on first start.' },
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
  return ['# CLI reference', '', '<!-- generated by `bun scripts/gen-docs.ts` from apps/cli/src/help.ts — do not edit by hand -->', '', 'Run from the Foundry checkout (`bun apps/cli/src/main.ts <command>`, or `bun run cli <command>`). Commands other than `serve`, `doctor` and `replay` talk to a running server on `FOUNDRY_URL` (default `http://127.0.0.1:4111`).', '', '```text', help.trim(), '```', ''].join('\n');
}
