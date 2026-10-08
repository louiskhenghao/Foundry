# Troubleshooting

This page is for the person who runs Foundry: native accounts, Docker problems, engine log lines, restarts and media-tool keys.
What the messages on a goal mean for the person running it (task states, Inbox notices) is in
[docs/guide/when-foundry-needs-you.md](../guide/when-foundry-needs-you.md); costs are in
[docs/guide/costs-and-usage.md](../guide/costs-and-usage.md).

Where to look:

- **Setup** page, or `doctor` on the command line: is the machine ready?
- **Server output**: the terminal running `bun run serve`, `docker logs foundry`, or your service log. Lines in
  brackets, such as `[settings] …` or `[update] …`, only appear here.
- **Engine notes**: short messages the engine records in its event log. Notes about a goal appear in that goal's
  timeline.
- `GET /api/health`: is the engine busy, paused or waiting for a restart?

---

## Setup and Accounts disagree about an installed CLI

Older versions captured the CLI path when Foundry started. A later CLI installation could make Setup pass while Accounts still reported `codex CLI not installed` (or the Claude equivalent), even after a forced account refresh. Accounts now resolves the binary again for status, sign-in and sign-out and invalidates its cached result when the resolved path changes.

Update Foundry and restart when idle. On an older version, an idle restart is also a workaround; reinstalling the CLI or clearing credentials is unnecessary. If it persists, compare **Settings → Engine (install)** with the environment that launches the server: an explicit binary override takes precedence over PATH, and Setup/Accounts must use the same configured native home. A change to PATH in another terminal does not change an already-running server’s environment.

## A recommended skill path no longer exists

`resolving-merge-conflicts` was removed by Matt Pocock upstream. The current **Development workflow — Matt Pocock's engineering skills** bundle has eight entries and no longer requests it; built-in Merger instructions cover conflicts. Update Foundry and retry the bundle. For other missing paths, inspect the install log and current upstream layout. Foundry will not silently substitute another agent’s same-named skill. See [skill compatibility](../guide/settings.md#skill-compatibility).

## Doctor checks

```bash
bun run cli doctor --provider codex                   # use claude for Claude Code
bun run cli doctor                                    # local install; without the server it skips the markitdown, Models and Notifications checks
docker exec foundry bun apps/cli/src/main.ts doctor   # Docker
```

`✘` is an error and makes `doctor` exit with 1. `⚠` is optional. The **Setup** page shows the same list with fix
buttons.

| Check | What it tests | Fix |
|---|---|---|
| Claude Code CLI | `claude` is on the `PATH` (or at **Settings → Engine (install) → claude binary**) and runs | `npm install -g @anthropic-ai/claude-code` |
| Claude login | Claude Code is signed in | **Sign in** on the Setup page, or `claude auth login` |
| Codex CLI | selected executable supports native execution and required hooks | install/update `@openai/codex`, or use the pinned Docker build |
| Codex login | the configured native home is signed in with ChatGPT | **Sign in** for Codex on Setup, or `codex login`; API-key inference is unsupported |
| git | `git` is on the `PATH` | install git (`xcode-select --install` on macOS) |
| Bun runtime | `bun` is on the `PATH` | `curl -fsSL https://bun.sh/install \| bash` |
| Required: graphify | the graphify CLI is installed | **Install** on the Setup page, or `uv tool install graphifyy && graphify install --platform claude` |
| `<skill> backend` (⚠) | an installed image skill has the API key it needs | see [Image-generation keys](#image-generation-keys) |
| GitHub CLI (optional) (⚠) | `gh` is installed and logged in to github.com | **Sign in** on the Setup page, or `gh auth login --web`; only needed for push / PR / auto-merge delivery |
| markitdown (optional) (⚠) | the document converter is installed | **Install markitdown** on the Setup page, or `uv tool install --python 3.12 'markitdown[all]'` |
| Models (presets in use) (⚠) | every model named in the presets in use has resolved on this machine and did not fail last time | test the model in **Settings → Models & limits**, or pick another |
| Notifications (optional) (⚠) | Telegram or Discord is configured | [notifications.md](./notifications.md) |
| Stale skill copies (⚠) | no loose copy in `~/.claude/skills` hides a newer plugin skill of the same name | **Trash N stale copies** on the Setup page (goes to the skills trash, restorable) |
| Skill updates (⚠) | installed skill sources are up to date | open the **Extensions** page (Skills tab) |
| Skills directory writable | Foundry can write to the selected backend’s user skill directory | fix the folder's permissions |
| settings.json (⚠) | Claude Code's `settings.json` parses and its hook commands exist | fix the file; a missing hook command makes every session log hook errors |

---

## Common Docker problems

| What you see | Why | Fix |
|---|---|---|
| `no configuration file provided: not found` | `docker compose` ran in a folder without `docker-compose.yml` | fetch it from the image ([install.md](./install.md#with-docker-compose)), or use `docker run` |
| `Not logged in · Please run /login` | `claude login` is not a command | `claude auth login`, with `-it` |
| **Sign in** on the Setup page shows a link and asks for a code | normal in Docker: there is no browser in the container | Claude: paste its returned code into Foundry’s dialog. Codex: enter the displayed device code on the linked OpenAI page |
| *not a git repository* under **New goal → Repository** | you typed a host path | type the container path, for example `/repos/acme-app` |
| `Permission denied` in the repository, or worktrees fail (Linux) | your files are not owned by uid 1000 | use the `--user "$(id -u):$(id -g)"` recipe ([install.md](./install.md#5-linux-if-your-user-id-is-not-1000)) |
| `port is already allocated` | something else uses 4111 on the host | publish another host port, for example `-p 127.0.0.1:4112:4111`, and open that |
| Setup: *markitdown not installed* | image older than 0.2.1; since then markitdown is in the image (the in-container install cannot write to the root-owned tool folders) | `docker pull imlouiskhenghao/foundry:latest` and re-create the container |
| `git worktree list` in your repository shows worktrees that do not exist on the host | worktrees were registered with container paths | `git worktree prune` in that repository |
| The update dialog shows commands instead of an **Update** button | no sidecar: the container was started with `docker run`, is not named `foundry`, or lacks `FOUNDRY_WATCHTOWER_URL` / `FOUNDRY_WATCHTOWER_TOKEN` | run the commands shown, or switch to the shipped compose file ([updates-and-backup.md](./updates-and-backup.md#self-update)) |
| A preview link does not open from the host (`Empty reply from server`, connection reset) | the preview port range is not published, or published under other host port numbers, or the image is 0.4.1 or older (its previews listened only inside the container) | publish `127.0.0.1:4200-4299:4200-4299`, same numbers both sides ([install.md](./install.md#6-previews-from-the-host)); pull the newest image. For a Brief run command, make its server listen on `0.0.0.0` |
| The self-check stops working after an update | Chromium was downloaded into the container's own file system, and the update re-created the container | keep `/home/node/.cache/ms-playwright` in a volume (the shipped compose file does), then **Settings → Preview & self-check → Install Chromium** once more |
| *Chromium could not start … error while loading shared libraries: libglib-2.0.so.0* | image 0.4.1 or older: it had no system libraries for Chromium, and they cannot be installed as the container's user | pull the newest image and re-create the container |
| `gh` is logged out after an update | `/home/node/.config/gh` is not in a volume | log in again and add a volume for it ([install.md](./install.md#7-github-for-delivery-optional)) |

---

## Codex account and compatibility problems

Choose **Coding agent → Codex** in Setup, Settings, Extensions or Usage before diagnosing the native account. The backend switch filters that page; it does not move existing goals or sign out the other account.

| What you see | What to do |
|---|---|
| Required hooks or hook canary unavailable | Update to a CLI supporting `SessionStart` and `PreToolUse` (Docker pins 0.160.0). Foundry deliberately refuses to start an unguarded session. |
| Sandbox initialization fails in Docker | Check host/kernel sandbox support and container configuration. Foundry does not retry with unrestricted access. |
| API-key login detected / ChatGPT sign-in required | Sign in through Setup’s Codex account or `codex login`. Media-tool keys in Settings do not authenticate Codex inference. |
| Only a weekly quota appears | This is supported. Foundry shows windows the native account actually returns; a missing five-hour window is not an error. |
| Quota or plugin inventory unavailable | Verify the configured binary/home and native sign-in, then Refresh. Unknown data is not an empty inventory or unlimited usage. |
| A discovered model cannot run | Discovery describes CLI capabilities, not account entitlement. Test the model and effort under the correct account; invalid effort/auth/quota errors do not trigger model fallback. |
| MCP tool denied | Open the goal’s Inbox and allow that server for Codex only if intended. Claude’s allowlist is separate; plugin installation does not grant permission. |
| Account or extension change returns `409` | Wait for Foundry’s active sessions/goals to finish, then retry. Native account changes affect the shared CLI home. |
| Data directory belongs to another backend | Keep the original launch profile and choose Codex per goal, or use a distinct `FOUNDRY_DATA_DIR`. Do not erase the ownership marker to force a migration. |

See [Codex setup and limits](codex.md) and [mixed-provider upgrades](updates-and-backup.md#upgrading-to-mixed-provider-goals).

## Engine log lines and notes

### Restarts and recovery

| Line or note | Meaning | What to do |
|---|---|---|
| *attempt … was interrupted by an engine restart; its session will be resumed* | A session was cut by a restart. It is resumed with its context kept (a continuation). No retry is used up. | Nothing. |
| *attempt … was orphaned by an engine restart* | The attempt could not be resumed: no session had started yet, its continuations were used up, or it was not a work session (a merge, for example). A fresh attempt runs; for a work attempt the lost attempt is given back. | Nothing. |
| delivery failed: *engine restarted during delivery — run Deliver again (every step is idempotent)* | The engine stopped in the middle of a delivery. | Press **Deliver** again. Next time, check `busy.delivering` before restarting. |
| `[update] watchtower accepted the trigger but this container was never replaced` | A Docker self-update was requested, but the container was still running five minutes later. Foundry takes work again. | Check the `foundry-watchtower` logs (`docker logs foundry-watchtower`). |

### Settings and models

| Line or note | Meaning | What to do |
|---|---|---|
| `[settings] ignoring env value for <key>: …` or `ignoring file value …` | An environment variable or a saved value is invalid. The next layer (variable, then default) is used instead. | Fix the variable or the value. Valid values: [configuration.md](./configuration.md). |
| `[settings] FOUNDRY_MODEL_STRONG is set but no longer does anything: models come from presets (Settings → Models & limits)` (also `FOUNDRY_MODEL_WORKER`, `FOUNDRY_GOAL_REVIEWER`) | The old model tiers are gone. Only the housekeeping model (`FOUNDRY_MODEL_CHEAP`) is still read. | Remove the variable, for example from an old `docker-compose.yml`. Choose models in **Settings → Models & limits**. |
| *Models now come from presets: Code = Production, Docs & research = Balanced, Media = Balanced …* | One-time move of an older install's saved model tiers to presets. The note lists the old tiers. | Pick other presets in **Settings → Models & limits** if you prefer. |
| *model X is unavailable (…); … sessions of this goal now use Y* | A model alias or id did not resolve (deprecated, retired, typo). The session re-ran with the next model in **Fallbacks**. | Check the model in **Settings → Models & limits**. |
| `[claude-code:unrecognized_model] {"model":"claude-fable-5-1",…}` in a live log | Your Claude Code is older than the model (Fable 5.1 needs 2.1.259). The request still goes through. | Update Claude Code: `npm install -g @anthropic-ai/claude-code`. In Docker, pull the newest image. |
| `[models] sync: N id(s) in the Claude Code binary; fable → …, opus → …` | Foundry read the model ids your Claude Code knows and resolved the family aliases. Runs on demand and when the Claude Code version changes. | Nothing. |

### Usage limits

| Line or note | Meaning | What to do |
|---|---|---|
| `rate_limit.paused` | New sessions for the event’s backend wait; the other backend continues. The pause survives restart. Its retry time comes from a reported reset or a short backoff when none is known. | Check `pausedUntilByProvider` on `/api/health` or the matching Usage page. |
| `rate_limit.resumed` | The retry time was reached; unfinished goals for that backend are woken. It does not prove the account limit has reset. | A renewed rejection can pause that backend again. |

### Git and merges

| Line or note | Meaning | What to do |
|---|---|---|
| *baseline at abc1234: N must check(s) already failing on the goal branch …* | The goal's own checks already fail before the merge. Merges are judged on regressions only, so a correct merge is not blocked. | Nothing now. The goal cannot finish until the checks pass. |
| *merge attempt N for …: N must check(s) fail but already failed on the goal branch before the merge — accepted* | The rule above, applied to a merge. | Nothing. |
| *catch-up: merged N goal-branch commit(s) into … before …* | A task's worktree was brought up to date with the goal branch. | Nothing. |
| *catch-up: … has an unfinished merge with conflicts in …; leaving it for the worker* | An earlier session left a merge open. The next session is told to finish it. | Nothing. |
| *pull --ff-only … in …: …* | Result of the *pull into my checkout* button on the Repository card. Uncommitted changes or diverged branches mean your checkout was not moved. | Commit or stash in your checkout, then try again. |

### Skills and tools

| Line or note | Meaning | What to do |
|---|---|---|
| *N skill(s) installed for this stack (content in …)* | `npx autoskills` installed project skills into the goal workspace. They are git-excluded. | Nothing. Turn off in **Settings → Skills** (*autoskills per goal*). |
| *…; N stale tracked link(s) removed from the index* | An older run let skill links into git. They were removed from the index; the files stay on disk. | Inspect the diff and remove only Foundry-created stale links from tracking; preserve intentional project skills. Codex autoskills uses `.agents/skills`. |
| *no stack manifest (package.json, pyproject.toml, go.mod, …) in the repository yet — retried after each task until one appears* | Empty repository: nothing to detect yet. The install runs once a task creates a manifest. | Nothing. |
| *tool install …*, *markitdown install …*, *playwright install …* `exited N` | Result of an install started from the Setup or Settings page. | On a non-zero exit, read the install log on that page. |

### Previews, self-check and completion

| Line or note | Meaning | What to do |
|---|---|---|
| `[preview] … did not answer within 90s — the server may still be starting` | The dev server started but nothing listened on the port in time (slow install, wrong port flag). | Look at the server output on the goal's Preview card. Set the run command in the Brief (use `{port}`). |
| *self-check could not run: …* | The goal has the self-check on, but there is no run command, or Chromium is missing or cannot start. The check counts as an error, not a failure. | **Settings → Preview & self-check → Install Chromium**; or set the run command; or turn the goal's self-check off. |
| *graph refresh: pull ok, graphify ok, gitnexus skipped* | After delivery (or at done for local goals) the code graph was refreshed. For delivered goals Foundry first tries to fast-forward your checkout (`pull`); `pull skipped` means it had uncommitted changes or had diverged. A tool marked `skipped` is not on the `PATH`. | Nothing. Fast-forward your checkout yourself if `pull` was skipped. |
| *docs generation failed: …* | The documentation session failed. The goal still finishes. | Write the docs by hand if you need them. |
| *N artifact(s) delivered to …* | A media goal's files were copied to its output folder. | Nothing. |
| *artifact delivery to … failed: …* | Copying to the output folder failed (permissions, missing disk). The goal still finishes; the files stay in the goal workspace. | Fix the folder and copy the files by hand. |
| `[artifacts] …: N file(s) copied to the goal workspace` | A media task's files were saved into the goal workspace before its worktree was removed. | Nothing. |
| *notification via telegram (or discord) failed after 3 tries: …* | A notification could not be sent and was dropped. | See [notifications.md](./notifications.md#troubleshooting). |

---

## Restarting safely

**Prefer the built-in update to a manual restart** ([updates-and-backup.md](./updates-and-backup.md#self-update)). It
waits for running work by itself.

If you restart by hand:

1. **Check that nothing is running.**

   ```bash
   curl -s http://127.0.0.1:4111/api/health
   ```

   ```json
   {"ok":true,"active":0,"busy":{"sessions":0,"attempts":0,"clarifying":0,"reviewing":0,"delivering":0,"total":0},
    "events":1234,"pausedUntil":null,"pausedUntilByProvider":{"claude":null,"codex":null},"restartNeeded":[],"version":"0.4.0","updateAvailable":false,"updating":false}
   ```

   | Field | Meaning |
   |---|---|
   | `active` | same as `busy.total`: everything a restart would interrupt. It should be `0`. |
   | `busy.sessions` | owned agent sessions across both backends |
   | `busy.attempts` | task attempts in flight, including between two sessions |
   | `busy.clarifying`, `busy.reviewing` | Clarify and goal-review runs |
   | `busy.delivering` | deliveries in progress. **Never restart while this is not `0`.** |
   | `pausedUntil` | legacy launch-profile retry time, or `null` |
   | `pausedUntilByProvider` | separate `claude` and `codex` retry times; absent pauses are `null` |
   | `restartNeeded` | settings changed since start that only apply after a restart: `engine.port`, `engine.host`, `engine.claudeBin`, `engine.claudeHome`, `engine.codexBin`, `engine.codexHome` |
   | `updating` | a self-update is draining or running |

   A goal's state does not matter. A running goal with `active: 0` (waiting on a serial task, or paused by a usage
   limit) is safe to restart.

2. **If `active` is not `0`,** a restart still loses little: a work session that already has a session id resumes as a
   continuation, but replaying the segment consumes additional account usage. A merge session, or a session that had not started yet,
   is orphaned and costs a fresh attempt. A delivery is marked failed and must be started again.

3. **Stop the right process.** Local install:

   ```bash
   pgrep -f "^bun apps/cli/src/main.ts serve"
   ```

   Never use `lsof -ti :4111 | head -1`: that can be your browser. Under launchd or systemd, restart through the
   service manager instead (`launchctl kickstart -k gui/$(id -u)/com.foundry.serve`, `systemctl --user restart foundry`).
   In Docker: `docker restart foundry`.

### Checking the event log with `replay`

Foundry's event log is the source of truth; the tables the UI reads are rebuilt from it. `replay` rebuilds those tables
from the log and compares them with what was there before. Run it with the engine stopped:

```bash
# local install
bun apps/cli/src/main.ts replay --verify

# Docker (Compose or docker run): stop the container, then run a one-off container on the same volumes
docker stop foundry
docker run --rm --init --volumes-from foundry <same-image-tag-as-foundry> bun apps/cli/src/main.ts replay --verify
docker start foundry
```

Use the same `FOUNDRY_PROVIDER` and `FOUNDRY_DATA_DIR` as the server for both commands; `--volumes-from` does not copy environment variables. Never use an older image to replay mixed-provider data.

With the uid ≠ 1000 recipe, add the same `--user` and `-e HOME` flags to the one-off container.

It prints `replayed N events; read models identical ✔`. When they differ, it prints `DIFFER ✘`, lists the tables and
(with `--verify`) exits with 1. Either way the rebuilt tables are kept.

After an update that adds new fields with defaults, run `replay` once and then `replay --verify`. The second run must
print *identical*.

---

## Image-generation keys

Claude uses its native login and Codex uses ChatGPT login only. Image/media skills are separate tools and may need their own generation API keys; these keys do not enable Codex API inference.

| Image pack (**Settings → Skills → Image skills**) | Needs |
|---|---|
| `gpt-image-2` (default) | `OPENAI_API_KEY` (any OpenAI-compatible endpoint; `OPENAI_BASE_URL` changes the host) |
| `claude-image-gen` | `GEMINI_API_KEY` by default (its OpenAI mode uses the OpenAI key) |

Set the key in **Settings → Tools & keys** (*OpenAI-compatible API key*, *OpenAI-compatible base URL*,
*Gemini API key*, *Kimi (Moonshot) API key*). It is stored in `settings.json` in the configured data directory and applies to the next session,
without a restart. A local install can also put it in `.env` at the root of the Foundry checkout (git-ignored; Bun
loads it when the engine starts). In Docker, use the Settings page or `-e`.

Every session inherits the key, so every session can see it.

Without a key, the skill runs in advisory mode and workers hand-author SVG or HTML renders instead, which look much
worse. You notice it three ways: the doctor warns (*gpt-image-2 backend*), the worker's prompt carries a ⚠ note, and
the Clarifier records an assumption on image goals that you can reject before approving the Brief.
