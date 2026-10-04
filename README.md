<div align="center">

# Foundry

**Write the goal in one sentence. Get back finished, checked, reviewed work.**

Foundry runs on your own computer and drives your Claude Code or Codex CLI from a web page:<br>
it asks what only you can decide, shows you the plan once, then builds, tests, reviews and delivers on its own.

English · [中文](./README.zh.md)

[Quick start](#quick-start) · [How it works](#how-it-works) · [User guide](docs/guide/) · [Docs](docs/)

<br>

<img src="docs/guide/images/goals.png" alt="Foundry goals across Claude Code and Codex: progress, backend, and the controls available for each goal" width="900">

</div>

## Why Foundry

Claude Code and Codex can carry out a request. Keeping a real piece of work on track is the part left to you: saying what
you actually mean, splitting it up, checking every step, noticing when it drifts, and not letting it burn your plan.
Foundry does that part.

- **One sentence in**  
  *"Add CSV export to the orders page."* *"A landing page for our studio."* *"Posters for the new drink."*
- **It asks before it plans**  
  It reads your repository first and asks only what the code can't answer — each question with a recommended answer.
- **One plan to approve**  
  The Brief: what it understood, the tasks, how the result will be checked, what it may cost. Edit anything, then approve.
- **You see it before it's done**  
  At milestones it pauses, starts a live preview and waits for your look.
- **Checked, not guessed**  
  Every task has acceptance checks; the whole result is reviewed against them before it is handed over.
- **Your code stays yours**  
  Foundry runs locally and uses the selected CLI's account: Claude login or ChatGPT sign-in for Codex. Agent inference needs no API key. Work happens on its own branch; your checkout stays unchanged while it runs.
- **You control the spend**  
  Independent model presets pick which model does each job. Time, attempt and concurrency limits apply to both backends; USD cost caps apply only to Claude.

## How it works

One workflow for **Claude Code and Codex**. Connect the native accounts independently in **Accounts**, then choose the backend for each new goal. The screenshots below use demonstration data.

<table>
<tr>
<td width="50%" valign="top">

**[1 · Describe it](docs/guide/your-first-goal.md#the-new-goal-form)**<br>
Press **New goal**, choose **Claude Code** or **Codex**, select its model preset, and describe the result. Pick a project folder when you are ready to start.

<img src="docs/guide/images/new-goal.png" alt="New goal with the shared backend selector, Codex selected, goal types and view options">

</td>
<td width="50%" valign="top">

**[2 · Answer a few questions](docs/guide/answering-the-interview.md)**<br>
Only what the repository can't settle, each with the reason and a recommendation. Or press **Accept all recommended**.

<img src="docs/guide/images/interview.png" alt="Round 1 of the interview: three questions about a dark mode toggle, each with a recommended option and the reason">

</td>
</tr>
<tr>
<td width="50%" valign="top">

**[3 · Approve the Brief](docs/guide/approving-the-brief.md)**<br>
Review the plan, tasks and acceptance checks. Change what you want, then **Approve & run**. Codex uses time and attempt limits; Claude also supports USD budgets.

<img src="docs/guide/images/brief.png" alt="A Codex goal’s Brief with its understanding, pull request title and approval controls">

</td>
<td width="50%" valign="top">

**[4 · Have a look at milestones](docs/guide/while-it-runs.md#milestones)**<br>
The goal pauses, the preview is already running. Press **Continue**, or say what to change.

<img src="docs/guide/images/milestone.png" alt="A milestone: the preview runs on port 4200, with a box for feedback and a Continue button">

</td>
</tr>
<tr>
<td width="50%" valign="top">

**[5 · Let it run](docs/guide/while-it-runs.md)**<br>
Tasks run in parallel when they can, each checked before it joins the rest. **Agents** brings both engines’ sessions together; **Usage** keeps their limits separate.

<img src="docs/guide/images/goal-running.png" alt="A running goal: Clarify and Brief done, Run in progress, acceptance checks and the folder where the work is">

</td>
<td width="50%" valign="top">

**[6 · Only interrupted when it matters](docs/guide/when-foundry-needs-you.md)**<br>
A blocked task, a conflict, a budget reached: it lands in the **Inbox** with the buttons to fix it — also on Telegram or Discord.

<img src="docs/guide/images/inbox.png" alt="The Inbox with a task that used all its attempts, and the Suggest a hint and Retry with hint buttons">

</td>
</tr>
</table>

When it is done you get the work on its own branch, and — if you chose it — pushed, or as a pull request. See [Getting the result](docs/guide/getting-the-result.md).

## Codex backend

Use your Codex CLI with ChatGPT sign-in:

```sh
codex login
bun install --frozen-lockfile && bun run web:build
bun run serve:codex
```

The Codex launch profile defaults to `data-codex/`; the Claude profile defaults to `data/`. Either instance can run both backends: choose **Agent backend** on each new goal. The data directory belongs to the instance, not to each goal. Accounts, presets and MCP permissions stay independent. Codex supports ChatGPT sign-in only, and its quota display follows the account's actual windows, including weekly-only accounts.

Install a hooks-capable Codex CLI before these commands; the Docker build pins 0.160.0. See [Codex setup and differences](docs/operate/codex.md) for prerequisites, Docker and current limits. Before upgrading an existing instance, read [backup and rollback](docs/operate/updates-and-backup.md#upgrading-to-mixed-provider-goals). The Claude quick start follows below.

## Quick start

The commands below use Claude login and git. For ChatGPT sign-in, use the [Codex setup](docs/operate/codex.md). This branch's Codex support must be built from source until a release containing it is published; an existing `latest` image is not evidence that it includes these changes.

**With Docker** — every tool is in the image:

```bash
mkdir -p ~/foundry && cd ~/foundry
docker run --rm imlouiskhenghao/foundry cat /app/docker-compose.yml > docker-compose.yml
FOUNDRY_REPOS=~/code docker compose up -d      # your repositories, mounted at /repos
```

**From source** — needs [Bun](https://bun.sh), [Claude Code](https://docs.anthropic.com/en/docs/claude-code) signed in
(`claude` on your PATH) and [graphify](https://github.com/safishamsi/graphify):

```bash
git clone https://github.com/louiskhenghao/Foundry.git foundry && cd foundry
bun install && bun run web:build
bun run serve                 # then open http://127.0.0.1:4111
```

Open <http://127.0.0.1:4111>, press **New goal**, point it at a repository and describe what you want. The
[Setup](docs/guide/your-first-goal.md#check-the-setup-page) page checks that everything is in place. Full steps, Claude sign-in in Docker and
remote access from your phone: [Install](docs/operate/install.md).

## Learn more

| I want to… | Read |
|---|---|
| **use Foundry** — goals, the interview, the Brief, the Inbox, costs | [User guide](docs/guide/) · [中文](docs/guide/README.zh.md) |
| **install and run it** — Docker, remote access, notifications, updates, every setting | [Operator docs](docs/operate/) |
| **change its code** — architecture, roles, testing, releasing, design decisions | [Contributor docs](docs/develop/) · [CONTRIBUTING](CONTRIBUTING.md) |

The words Foundry uses (Goal, Brief, Milestone, Model Preset …) are defined in the [glossary](CONTEXT.md).
