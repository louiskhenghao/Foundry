# ADR-0005 — Scenario-selected skills, exclusive design packs, per-goal autoskills, and a settings file

Status: accepted · 2026-08-22

## Context

ADR-0004 made the engine mandate Matt Pocock's workflow skills by *task kind* (feature → tdd, bug → diagnosing-bugs…). Two gaps remained:

1. Nothing selected skills by *what area* a task works in. UI work got at most a passive mention of Anthropic's `frontend-design` in the "other installed skills" tail; backend, data or infra work got nothing specific. Users wanted a choice of design skill sets (ui-ux-pro-max, impeccable, bencium, garden, frontend-design) and stack-specific skills (autoskills) applied automatically "per goal scenario".
2. Every knob lived in `process.env` read once at startup; there was no way to change concurrency, models, caps or delivery defaults without restarting with different variables.

## Decisions

1. **Scenario is a task label, set by the Clarifier.** `Task.scenario ∈ frontend | backend | fullstack | data | mobile | infra | docs | general` (default `general`, replay-safe). Catalog workflow rules and entries may carry `scenarios`; `applicableRules` filters on them, the "other installed skills" tail too. Only the worker passes the task's scenario; the task reviewer uses the task's, the goal reviewer the goal's dominant one (`goalScenario`). The Clarifier is told a UI task must never be left `general`.

2. **Design skills are a mutually exclusive pack.** Catalog entries declare `pack: "design"` + `packOption`; Settings `workflow.designPack` chooses one option. Entries of unchosen options are invisible to sessions even when installed (no half-measures: two design systems in one prompt contradict each other). `none` is a valid choice. Default `ui-ux-pro-max`. The pack model is generic so other exclusive packs can be added later.

3. **Plugin sources are first-class.** A new catalog source `type: "plugin"` (marketplace repo + id + plugin name) lets the engine install Claude Code marketplace plugins with the official CLI (`claude plugin marketplace add` + `claude plugin install`), streamed like other tool installs. Detection comes from the existing plugin scanner.

4. **autoskills runs per goal, in the goal workspace, and is cleaned up.** After the Brief is approved (workspace exists, repo has a stack manifest, Node ≥ 22) the engine runs `npx -y autoskills@latest -y --agent claude-code` there, then restores `CLAUDE.md` (autoskills' generated summary is redundant with the SKILL.md files), appends the new `.claude/skills/<name>/` dirs and `skills-lock.json` to the repository's `.git/info/exclude`, and records `goal.autoskills`. Task worktrees receive a copy of the skills. Workers are told which project skills are loaded. Trade-off accepted: `.git/info/exclude` is shared by all worktrees of the repository, including the user's own checkout — documented; the alternative (committing the skills into every PR) was worse. Tasks wait up to three minutes for the run before their first attempt.

5. **Settings file over env over defaults.** `data/settings.json` stores only the leaves the user changed (`SettingsPatch`); `resolveSettings` layers file > env > default per leaf and reports the source of each. At boot only file-sourced leaves are pushed onto the env-built config, so code overrides (tests) keep winning. At runtime `engine.updateSettings` validates, persists, mutates `config` and performs the few side effects that need more than a field write (runner concurrency, context provider, markitdown). `engine.port/host/claudeBin/claudeHome` are restart-only; the file value is kept and reported as `restartNeeded` until the next boot. Every change is an audit event (`settings.changed`, keys only).

## Consequences

- Prompts gain `Scenario: frontend.` and a design MUST line only for UI tasks; backend prompts are unchanged apart from the scenario line.
- `FOUNDRY_*` variables remain as initial values / CI overrides; the Settings page is the normal way to change things. New variables: `FOUNDRY_HOST`, `FOUNDRY_DESIGN_PACK`, `FOUNDRY_AUTOSKILLS`.
- autoskills is CC BY-NC 4.0 and talks to the network (npm + its registry); it can be switched off in Settings.
