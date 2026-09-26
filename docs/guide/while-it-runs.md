# While it runs

> English · [中文](./while-it-runs.zh.md)

After you approve the Brief, Foundry works on its own. You can close the browser; the work continues on your computer. This page explains the goal page, so you can follow along when you want to.

![A goal page while tasks run: cost and time meters, the stage timeline, and the task graph](images/goal-running.png)

## The goal page at a glance

Open a goal from **Goals** (the list in the top bar). At the top of its page:

- The title, a state badge (for example **running**, **have a look**, **reviewing**, **done**), and a **fast** chip if the goal runs in fast mode.
- The project folder (with **copy** for its path) and the branches: the one the goal started from → the goal's own branch.
- Two meters: **cost** spent against the budget, and **time** in minutes against the time limit.
- **Open ▾**: open the project or the progress folder on your computer (see [The progress folder](#the-progress-folder)).
- One main button that changes with the state: **Review brief →** while the Brief waits, **Cancel** while it runs, **Deliver…**, **Delivering…** or **Delivery** when it is done.
- **⋯** (More actions): **Restart…**, **Re-run Clarify**, **Cancel goal**, **Delete goal…**, whichever apply.

Below that, cards appear only when they matter: the milestone card when the goal waits for your look, the interview while Foundry asks questions, and **Goal review…** with a live log while the final review runs.

If a usage limit of your Claude plan is reached, a yellow banner says **Usage limit reached — paused until …**. Everything resumes by itself. See [Costs and usage](./costs-and-usage.md).

## Simple view: progress

In Simple view the goal page shows:

- One sentence about what is happening, for example "Working." or "Paused — something needs you (see below)."
- **Needs you**: anything waiting for you, with the buttons to answer it.
- **Progress**: a bar with **N/M pieces** done, and the tasks in progress right now: **in progress**, **checking**, or **combining with the rest**.
- **Cost**: spent so far, the limit, and how long it has been running.
- **Result**, when the goal is done: where the work is, **Open ▾**, and **Deliver…**.

**Expert view** at the top right shows everything else. **Simple view** on the tab bar switches back.

## Expert view tabs

| Tab | What it shows |
|---|---|
| **Overview** | Where the goal stands, what needs you, the progress folder, the preview, acceptance checks. A number on the tab means something waits for you. |
| **Tasks** | The task graph with each task's state. Shows **done/total · N running**. |
| **Activity** | Everything that happened, newest first. |
| **Diff** | Every change compared with where the goal started. |
| **Delivery** | What happens to the result, and its progress. See [Getting the result](./getting-the-result.md#the-delivery-tab). |

## Overview

From top to bottom:

- **The timeline**: **Clarify → Brief → Run → Review → Done** (or **Over-delivered**), plus **Deliver · mode** if the goal pushes or opens a pull request. The current stage pulses. Click a stage to jump to where its work is shown.
- **What needs you**: the same cards as in the Inbox, with their buttons.
- **goal**: your original description.
- **Try the work in progress**: the progress folder. See [below](#the-progress-folder).
- **Preview**: start and open the running result. See [Preview](#preview).
- **Model fallback**: only if a model was unavailable and Foundry switched to another one.
- **Project skills (autoskills)**: skills Foundry added for your project's technology. They never reach your commits.
- **Completion**: documents and graph refresh you chose on the Brief, and their status.
- **Attachments**: you can add more at any time; new sessions receive them.
- **Brief**: a summary of what you approved, with **open** to read it in full.
- **Goal review**: the final reviewer's verdict and notes, once it ran.
- **Acceptance** (on the right): every **must** and **stretch** check with its latest result, for example **3/4 passing**. Click a check to see its output.

## Tasks

The **Tasks** tab draws the plan as a graph. Each card is a task with its state, its attempts so far out of those allowed (for example 2/3) and what the task has cost so far, all attempts together. Arrows show which task waits for which. On a phone the graph becomes a list.

### Task states

A task moves from **pending** (waiting for other tasks) to **ready**, **running**, **observing** (its checks and review run), **merging** (joining the goal's branch) and **done**. A task can also be **blocked** (it needs you), **failed** or **skipped**.

What each state and message means, and which ones need nothing from you, is in [When Foundry needs you](./when-foundry-needs-you.md#task-states).

### Inside a task

Click a task to open it full screen (Escape or × closes it). You see:

- Its title, state, tags and, once done, its commit. Click the commit line to read the whole commit message.
- **Task total**: attempts, cost (split into worker and reviewer), turns and minutes so far.
- **spec**, its **Checks** with their latest result, and **Relevant files**.
- **This task is waiting for you**, if it is blocked, with the buttons to answer.
- One chip per attempt: **#1**, **#2** … with its result and cost. **↻1** means the session was resumed once instead of starting over, which is cheaper.
- For the chosen attempt: the result, the worker model, turns, cost, start time, duration, and which skills it used, then every session that ran for it.
- Buttons: **Restart from here** (this task and everything after it run again), **Open worktree** (the task's own folder while it runs), and **Resolve manually** if a merge conflict needs you.

### Live logs

Inside a task, **Live log** shows what the worker is doing right now: what it says, the tools it uses (⚙), their results, and a line per session. At the end of a session, the `■` line also shows the worker's final message.

Every entry is one line, cut off at the edge of the box. Click a line (or Tab to it and press Enter) to read the whole message in a window. **Preview** shows it formatted and **Raw** shows the exact text; **Copy** copies all of it. Messages and thinking open as **Preview**; tool calls, tool results and errors open as **Raw**. The log itself shortens long thinking and tool results, so the window reads the full text from the session's saved transcript.

**Observation** shows the summary handed to the next attempt. **Prompt** shows exactly what the worker was told.

The meaning of the lines you will see (`●`, `■ error_max_turns`, `⏱ sub-agent still working` …) is in [When Foundry needs you](./when-foundry-needs-you.md#in-a-tasks-live-log). Most of them need nothing from you.

## The progress folder

Foundry never works in your own project folder. It works in a separate folder next to it:

```
Projects/
  my-app/                 ← your folder, never touched
  my-app-foundry/
    Add dark mode-a1b2c3/ ← the progress folder of one goal
```

The progress folder is named after the goal's title (up to its first punctuation mark, at most 40 characters) plus the last 6 characters of the goal's id. It contains your whole project with the goal's work so far: the goal's branch, checked out. Open it, run it, read it, at any time. Tasks that run in parallel work in their own hidden folders and are merged in here when their checks pass. You can move where progress folders are created in [Settings → Engine (install)](./settings.md#engine-install).

The **Try the work in progress** card on the Overview tab shows the folder's path with **copy**, the latest commit, and ready-to-copy commands to open a terminal there and start the project.

Note: because this folder *is* the goal's branch, you cannot also switch to that branch in your own folder. To get the result into your folder, see [Getting the result](./getting-the-result.md#getting-the-result-into-your-own-folder).

### The Open menu

**Open ▾** (on the goal page and on the Try the work in progress card) lists two places: **Repository** (your own folder) and **Goal workspace** (the progress folder). For each it offers the editors, file managers and terminals it found on your computer, for example VS Code, Cursor, Finder, Terminal. Click one to open that place in it. **path** copies the path.

## Preview

The **Preview** card starts the result so you can try it in your browser.

- **Start preview** runs the project's start command in the progress folder. The card shows which command, and whether it comes from the Brief's **How to run it** or from `package.json`.
- **Running on port N**, then **Open preview** opens it. **Stop** stops it.
- **▸ server output** shows what the server prints.

If the card says **Nothing to run yet**, there is no start command yet. It appears once a task adds one, or you can set one on the Brief under **How to run it**.

Foundry also starts the preview by itself at a milestone, restarts it after each task lands if it is running, and stops it when nobody opened it for a while (60 minutes by default) or when the goal ends.

### Self-check

**Self-check after each task (screenshot + console errors)** is a switch on the Preview card, and on the Brief's **How to run it** section before you approve. When on, after every task lands Foundry opens the preview in a hidden browser, takes a screenshot and checks for errors. Errors fail a must check, so they get fixed. No AI is involved, so it costs nothing.

It only helps goals whose result runs in a browser, and it needs a one-time download (**Install Chromium** in [Settings → Preview & self-check](./settings.md#preview--self-check)). It is off by default.

## Milestones

When a milestone task lands, the goal pauses. Its badge reads **have a look**, the Inbox shows **Have a look**, and at the top of the goal page appears a card: **Have a look — task name**.

![The Have a look card with what to look at, the running preview and the self-check's screenshots](images/milestone.png)

The card shows:

- What to look at, as written in the Brief.
- The preview, already starting, with **Open preview**.
- **What the self-check saw**: its latest screenshots, if the self-check is on.
- **Artifacts**: images and files produced so far, for media goals.
- The code so far is on the **Diff** tab; the folder is under **Open ▾**.

Then either press **Continue**, or write what you saw and press **Turn into a plan**. How that works, step by step, is in [When Foundry needs you](./when-foundry-needs-you.md#a-milestone-is-ready-to-look-at).

## Activity

Everything that happened to the goal, newest first, one line each: stages, tasks starting and finishing, checks, decisions, delivery steps. **important only** hides routine lines; **show bookkeeping events** shows even more. A line ending in **…** shows only the start of a longer text, such as a worker message, a check result or a note; click it to read all of it.

## Diff

Every file the goal changed compared with where it started, with lines added (green, +) and removed (red, −). Click a file to open or close it; **expand all** opens them all. This is exactly what would go into a pull request.

## Cancelling, restarting, deleting

| You want to | Do this |
|---|---|
| Stop the goal now | **Cancel** at the top. Running sessions stop. The work done so far stays on the goal's branch. |
| Run it again after it stopped | **⋯ → Restart…**. Pick **All tasks from the beginning** or one task; that task and everything after it run again with fresh attempts. Earlier tasks keep their results, and restarted tasks build on the work already there. Available once a goal is blocked, done, over-delivered, failed or cancelled. |
| Redo one task | Open it on the **Tasks** tab and press **Restart from here**. |
| Plan again before approving | **⋯ → Re-run Clarify** (also on the Brief page). |
| Remove the goal | **⋯ → Delete goal…**. Running sessions stop. The progress folder, the task folders and the goal's stacked delivery branches are deleted for good; attachments go to the trash. The goal leaves the list; its event history is kept. Tick **Also delete the branch** to delete the goal's branch too; if you never pushed it, that work is gone. |

## The Agents page

**Agents** in the top bar shows every Claude Code session on this computer, live, whether Foundry started it or you did.

- **Foundry agents**: sessions Foundry started for your goals, with the goal they belong to. These can be stopped with the ■ button.
- **Your sessions**: sessions you opened yourself (in a terminal, in VS Code). Foundry only watches them, never touches them.

Each row shows the model, how full its context is, when it was last active and in which folder. Helper agents appear indented under the session that started them. Click a row to follow its conversation. The header counts sessions **working**, **idle** and **finished** in the last 24 hours. While any session is working, a small **N busy** pill in the top bar says how many.

A session that is **idle** for a long time while its goal says running is worth a look; the task's live log usually says why.
