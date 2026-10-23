# While it runs

> English · [中文](./while-it-runs.zh.md)

## Provider-aware reporting

Codex task details and activity mark dollar costs, model-turn counts and skill telemetry as unavailable. Its live tool logs, saved transcripts and Foundry sessions remain visible. **Agents** also shows recent external Claude and Codex sessions, labelled by coding agent. External Codex history is read-only and bounded to recent records; **status unknown** means Foundry cannot verify that external process's liveness. It does not mean idle or finished. Native read failures appear as warnings, and external sessions cannot be stopped here.

A Codex goal's **Codex models** card shows the saved role table, goal-wide overrides and fallback order. Other captured goal-type tables can also be inspected. Later changes to Settings never rewrite this snapshot; legacy goals without a snapshot are labelled explicitly.


After you approve the Brief, Foundry works on its own. You can close the browser; the work continues on your computer. This page explains the goal page, so you can follow along when you want to.

![The Goals page: what needs you hangs as yellow signs at the top, the goals at work sit on a board below](images/goals.png)

## The Goals page

**Goals**, the first page, sorts your goals by what they need from you.

- **Needs you**: every goal that waits for you hangs as a yellow sign at the top, the longest waiting first. Its largest words say what to do: **Review brief**, **Answer questions**, **Have a look**, **Open Inbox** or **See why**. Press the sign to go there. Under the action are the goal's title, how long it has waited, one sentence on what is needed, and its coding agent, tasks, cost and time.
- **Working**: the goals Foundry is working on that need nothing from you. Each row shows the title, the coding agent and the project folder; the goal's five stages (Clarify, Brief, Run, Review, Deliver) as small leaning segments with its state under them; its tasks as small squares; its cost and time against their limits; and when it last changed.
- **Finished**: done, over-delivered, failed and cancelled goals, newest first, 10 per page by default. Choose 20 or 50 per page below the board (remembered in this browser). The page number is kept in the address.

The squares and segments mean the same everywhere in Foundry: green is done, moving blue stripes are under way, yellow waits for you, red failed, an outline has not started. A goal and its follow-ups are one entry on its board (see [Continue with a follow-up](./getting-the-result.md#continue-with-a-follow-up)), and delegated goals fold under their main goal (see [Delegated goals](#delegated-goals)).

![A goal page while tasks run: its state, title and facts, the cost and time meters, the five stages, and the task graph](images/goal-running.png)

## The goal page at a glance

Open a goal from **Goals** (the first page, also in the top bar). At the top of its page:

- The goal's state on a plate in its colour: blue while Foundry works (**running**, a blue tint while it clarifies), violet while it is **reviewing**, green once **done**, yellow while it waits for you (**approve brief**, **have a look**, **blocked**), red when it **failed**. Beside it, how many tasks are done or running and how long Foundry has worked.
- The title, and under it the goal's facts: the project folder (with **copy** for its path), the branches (the one the goal started from → the goal's own branch), the coding agent (**Claude Code**, **Codex** or **Antigravity**), the workflow suite, **pace fast** if the goal runs in fast mode, and its delivery.
- **Time** in minutes against the limit; Claude also shows **cost** against its USD budget. A yellow dot after it means some sessions ended before Claude Code reported a cost (a timeout, a kill, a crash): hold the pointer over it, or tap it on a phone, for how many and about what they cost. That estimate (≈) prices their tokens at the rate the same model cost in sessions that did report it; it is never added to the total and never counts against the budget. Codex dollar cost is unavailable.
- **Open ▾**: open the project or the progress folder on your computer (see [The progress folder](#the-progress-folder)), or in **VS Code (web)**: VS Code in a browser tab, which also opens on your phone over Tailscale. It starts on first use (install it once under [Settings → Tools & keys](./settings.md#tools--keys)), runs on this computer only, and stops after two idle hours. Its sign-in page asks for a password, which the menu shows with a copy button; a browser remembers it. A folder the coding agents wrote opens in restricted mode until you choose to trust it. Edits there are real edits: while the goal runs, the menu warns that changes in its folders can clash with the coding agents' and go into their next commit.
- One main button that changes with the state: **Review brief →** while the Brief waits, **Cancel** while it runs, **Deliver…**, **Delivering…** or **Delivery** when it is done.
- **⋯** (More actions): **Restart…**, **Re-run Clarify**, **Cancel goal**, **Delete goal…**, whichever apply.

Under the header the five stages run across the page: **Clarify**, **Brief**, **Run**, **Review** and **Deliver**. A finished stage is framed in ink, its tick on a green tile. The current one is outlined, in blue while Foundry works on it, with **Now** above it, or turns yellow with **You** when it waits for you and red with **Failed**. On a phone or a small tablet the stages are slim segments, green when done, with the current one's name and note in a line under them; Ledger and Classic draw them as a numbered line of steps. Each stage says how it went in a few words, for example "approved", "3 of 4 tasks" or "a pull request". While the goal runs, the Run stage carries a bar of its tasks. In Expert view, press a stage to open where its work shows: the Activity tab for Clarify and Review, the Brief page, the Tasks tab for Run, the Delivery tab for Deliver.

Below that, cards appear only when they matter: the milestone card when the goal waits for your look, the interview while Foundry asks questions, and **Goal review…** with a live log while the final review runs.

If a coding agent reaches its usage limit, the banner identifies it and the retry time. Only that coding agent’s new sessions pause. Without a reported reset, Foundry retries after a delay; the retry does not guarantee recovered quota. When another account of that coding agent is free, the banner also offers **Switch to *account* and continue**. See [Costs and usage](./costs-and-usage.md) and [Several accounts](./costs-and-usage.md#several-accounts).

## Simple view: progress

In Simple view the goal page shows:

- One sentence about what is happening, for example "Working." or "Paused — something needs you (see below)."
- **Needs you**: anything waiting for you, with the buttons to answer it.
- **Progress**: a bar with **N/M pieces** done, and the tasks in progress right now: **in progress**, **checking**, or **combining with the rest**.
- **Preview** and **Milestones**, once the Brief is approved: the same cards as in Expert view, to try the result and watch each milestone's walkthrough.
- **Cost**: what was spent against the limit, and how long Foundry has worked. Waiting for you does not count. Codex does not show an enforceable USD cap.
- **Result**, when the goal is done: where the work is, **Open ▾**, and **Deliver…**, and the goal review's verdict.
- At the end, what you asked for and a link to the Brief.

**Simple | Expert** in the goal's header switches views; it stays in the same place in both. **Expert** shows everything else.

![Simple view of a running goal: one sentence on what is happening, the progress bar with the task in progress, and the cost so far](images/goal-simple.png)

## Expert view tabs

The row of tabs stays at the top of the page while you scroll, so another tab is always one click away; the tab you switch to opens at its top.

| Tab | What it shows |
|---|---|
| **Overview** | Where the goal stands, what needs you, the progress folder, the preview, acceptance checks. A number on the tab means something waits for you. |
| **Tasks** | The tasks as a graph of which waits for which, or as a list. Shows **done/total · N running**. |
| **Timeline** | When each step ran and how long it took, the goal and its delegated goals on one time axis. |
| **Activity** | Everything that happened, newest first. |
| **Diff** | Every change compared with where the goal started. |
| **Delivery** | What happens to the result, and its progress. See [Getting the result](./getting-the-result.md#the-delivery-tab). |

## Overview

![The Overview tab of a finished goal: the Brief, the goal, the goal review's verdict, the progress folder, and all acceptance checks passing](images/goal-overview.png)

From top to bottom:

- **Brief**: one line, for example **Brief APPROVED · 36 tasks · 11/11 assumptions accepted · 9/12 questions answered · est. $380 / 1500 min**. Click it to open the Brief, where the Understanding and everything else the Clarifier wrote are.
- **What needs you**: the same cards as in the Inbox, with their buttons.
- **goal**: your original description. **Open full**, the icon with two diagonal arrows in its corner, reads it in a larger window.
- **Goal review**: right under the goal once the final review ran: one line with the verdict (**passed**, **over-delivered** or **failed**) and the start of the reviewer's notes; **reviewer notes** unfolds them, and the **Open full** icon reads them in a larger window.
- **Attachments**: right under the goal, as on the New goal form. You can add more at any time; new sessions receive them.
- **Workspace & preview**: where the goal's work is, and starting it to try it. See [The progress folder](#the-progress-folder) and [Preview](#preview).
- **Milestones**: one row per feature, in the plan's order, with what to look at and a label: **shown**, **unverified · fake data**, **failed**, **recording…** or **not reached yet**. The title counts the ones shown, for example **Milestones (4/6 shown)**. Each row also says when the milestone landed, whether the goal paused for it, and your answer.
  - Click a row to see its latest recording as same-size tiles, plus what an API answered, the script, and the **runner log** when it failed. Each row opens and closes on its own, so you can compare two milestones. A tile opens large in a window; the arrows under it, **←** / **→**, or a swipe left or right on a phone go through them.
  - **Rerun** records one milestone again; **Rerun all** records every milestone that landed. See [Milestones](#milestones).
  - Above the rows, **Final walkthrough** says whether every script passed once all tasks were done.
- **Model fallback**: only if a model was unavailable and Foundry switched to another one.
- **Project skills**: skills Foundry added for your project's technology, grouped as Frontend, Backend, Database, Testing and Tooling, with how many there are. They never reach your commits.
- **Completion**: one row each for the audit, the documents, the graph refresh and media files, with how it went. See [Completion extras](./getting-the-result.md#completion-extras).
- **Acceptance** (on the right): every **must** and **stretch** check with its latest result, for example **3/4 passed**. Click a check to open it in a window: what it checks (the command, or the reviewer's rubric), every run it had, newest first (click one to see its output), then the output of the chosen run. A command's output shows as numbered lines, a reviewer's verdict as Markdown with **Preview** and **Raw**, and output that is JSON as a tree. A line above it says whether you see what Foundry kept (a long output is cut to its start, its end and its errors, or summarised when it failed) or everything: **Show the whole output** loads everything the run printed, **Show the summary** goes back. Below them, the **Self-check** switch and its latest result (see [Self-check](#self-check)), and **Have a look: pause at milestones** when the goal has milestones (see [Milestones](#milestones)).

## Tasks

The **Tasks** tab shows the plan two ways; **Graph | List** at the top right of the tab switches between them, and this browser remembers your choice for every goal.

**Graph** draws the plan as a graph. Each card is a task with its state, its attempts so far out of those allowed (for example 2/3), what the task has cost so far, all attempts together, its difficulty (**simple**, **standard** or **complex**, which picks the model from the preset) and the model its latest attempt ran on. Arrows show which task waits for which. On a phone the graph becomes a list by step.

![The Tasks tab: the plan as a graph, with one task done, two side by side (one still running) and one waiting for both](images/goal-tasks.png)

**List** shows one row per task, numbered **T1**, **T2**… in the order they were planned. Each row has the task's square (see [The Goals page](#the-goals-page)), its title, its state, attempt and model, the tasks it waits for (**after T1, T2**), how far it is through **Work**, **Review** and **Merge** (**Review ↺1** when a review sent it back once), and its time and cost. Press a row to open the task, as you would a card in the graph.

### Task states

A task moves from **pending** (waiting for other tasks) to **ready**, **running**, **observing** (its checks and review run), **merging** (joining the goal's branch) and **done**. A task can also be **blocked** (it needs you), **failed** or **skipped**.

What each state and message means, and which ones need nothing from you, is in [When Foundry needs you](./when-foundry-needs-you.md#task-states).

### Delegated goals

A task of kind **goal** is not done by a worker: a *delegated goal* of its own does it (see [Delegated goals](./your-first-goal.md#delegated-goals) on the New goal form). Its card has a dashed border and a **delegated goal** chip, and once that goal exists it shows the goal's state, how many of its tasks are done, **needs you** when it waits for you, and **Open goal →** to its page. Opened, the task says **Done by a delegated goal**, with the same link, and once the goal has landed, **what it delivered**: what it set out to do, its tasks, the decisions made there, its review, what it left open and the files it put under `artifacts/`. The tasks that depend on it read that too.

While the delegated goal needs you — an interview question, a Brief to approve, a milestone, an Inbox item — this goal shows **blocked** with the reason *waiting for the delegated goal …*; answer in the delegated goal (its page, or the Inbox) and this goal goes on by itself. When the delegated goal fails, its failed tasks are run again, as often as the task's attempts allow, with a note on why; then an Inbox item on this goal's task offers **Retry** (its failed tasks run again, with your hint) or **Skip**. **Restart from here** on a goal task starts a fresh delegated goal; the old one stays as a goal of its own.

Once a delegated goal has landed, the planner reads what it delivered and may touch up the tasks after it that have not started yet: their spec, start files and deliverables, never the plan's shape or its checks. A task touched up says **Touched up after a step landed** under its spec, with the reason; the Activity tab has the line too.

The goals list folds delegated goals under their main goal: a line **▸ 2 delegated goals** under the main goal opens them, indented. A delegated goal's own page says **Delegated from: …** under its title (a link to the main goal's task), and the main goal's page lists its **Delegated goals**. If the main goal is deleted, the delegated goal stays in the list on its own and says whose it was. A goal and its follow-ups fold into one entry in the same list (see [Continue with a follow-up](./getting-the-result.md#continue-with-a-follow-up)).

### Inside a task

![A task opened full screen: its spec, the attempt that passed with its cost and turns, and the live log of the session — reading the code, writing the files, running the tests](images/task-drawer.png)

Click a task to open it over the goal page (Escape, × or a click beside it closes it). The panel always fills the window's height; on a wide screen the left column and the attempt beside it scroll separately, so a long list of files never scrolls the live log away. You see:

- Its title, state, tags and, once done, its commit. Click the commit line to read the whole commit message.
- **Task total**: attempts, cost (split into worker and reviewer), turns and minutes so far. A session that ended before its cost was reported shows an estimate in the attempt's session list (**≈$1.20**), or **unknown** when its model has no session with a reported cost yet; the total adds what can be estimated as **+ ≈$… est.**
- **spec** and, if you gave one, the **human hint** right under it (the **Open full** icon reads either in a larger window), its **Checks** with their latest result, and **Relevant files** (click one to open it; a grey one exists nowhere yet, usually a file the plan meant the task to create).
- **Deliverables**: the files the task promised to the tasks after it. Each is a must check when the task lands; click one to open it once it exists.
- **Files**: what the task added or changed (**Files so far** while it runs). Images show as thumbnails. Click any file to see it in the page (← and →, or the arrows at the top of the window, go to the previous or next file of the same list, **Relevant files** too; for a picture or a clip the arrows are under it, and a swipe steps on a phone): pictures, PDFs, video and audio play right there, and code (coloured by language, with line numbers), Markdown and JSON are shown formatted. You need no editor on the computer Foundry runs on, so this works from a phone or over [remote access](../operate/remote-access.md) too. A finished task's files are read from its commit in your repository, so they stay after delivery removes the task's folders; images and video of an image or video goal, which are never committed, are listed with the task that made them.
- **This task is waiting for you**, if it is blocked, with the buttons to answer.
- One chip per attempt: **#1**, **#2** … with its result and cost. **↻1** means the session was resumed once instead of starting over, preserving its context.
- For the chosen attempt: the result, the worker model, turns, cost, start time, duration, and which skills it used, then every session that ran for it.
- Buttons: **Restart from here** (this task and everything after it run again), **Open worktree** (the task's own folder while it runs), and **Resolve manually** if a merge conflict needs you.
- When a task looks stuck, a button gets it going again without restarting Foundry. **Start now** appears on a **ready** task of a running goal that nothing holds back but that has not started, and also on one held back only by the scheduler's caution (every slot taken, running alone, files another task is changing): then a dialog says what starting it costs first. **Stop and retry** appears on a running task that has had no live session for three minutes: after you confirm it in a dialog, it stops what the task was doing and puts it back to **ready**; a session that had started resumes where it left off, and the attempt is not counted otherwise. A ready task that waits for a reason says it under the attempts, for example *not started yet: every slot is taken*.

### Live logs

Inside a task, **Live log** shows what the worker is doing right now: what it says, the tools it uses (⚙), their results, and a line per session. At the end of a session, the `■` line also shows the worker's final message.

Every entry is one line, cut off at the edge of the box. Click a line (or Tab to it and press Enter) to read the whole message in a window. **Preview** shows it formatted and **Raw** shows the exact text; **Copy** copies all of it. Messages and thinking open as **Preview**; tool calls, tool results and errors open as **Raw**. The log itself shortens long thinking and tool results, so the window reads the full text from the session's saved transcript.

A tool call, and any result that is JSON, opens as a **Tree**: every object and list folds, **Expand all** and **Collapse all** open or close them all, and the search box marks every key and value that contains your words and opens the branches that hold them. **Text** shows it as plain text. A file path in the tree has an **open** button: the file opens in the same viewer as a task's **Files**. After a task merged, its own folder is removed, so the file is shown as it is now in the progress folder; once delivery has removed that folder too, it is read from the task's commit. The window says which.

![An image a task made, opened from the task's Files: the preview shows it in the page, with its path, copy, open in a new tab and download](images/file-preview.png)

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

The top of the **Workspace & preview** card on the Overview tab says which branch the workers commit to and the latest commit, with **Open ▾**. **Run it yourself** unfolds ready-to-copy commands to open a terminal there and start the project. Once the folder is cleaned up after a merge, this part disappears and the preview line below says where the preview runs instead.

Note: because this folder *is* the goal's branch, you cannot also switch to that branch in your own folder. To get the result into your folder, see [Getting the result](./getting-the-result.md#getting-the-result-into-your-own-folder).

### The Open menu

**Open ▾** (on the goal page and on the Workspace & preview card) lists two places: **Repository** (your own folder) and **Goal workspace** (the progress folder). For each it offers the editors, file managers and terminals it found on your computer, for example VS Code, Cursor, Finder, Terminal. Click one to open that place in it. **path** copies the path.

## Preview

The lower part of the **Workspace & preview** card starts the result so you can try it in your browser.

- **Start preview** runs the project's start command in the progress folder. The card shows which command, and whether it comes from the Brief's **How to run it** or from `package.json`. If the project's dependencies are not installed yet (a `package.json` without `node_modules`), Foundry installs them first; the output shows the install too.
- **Running on port N**, then **Open preview** opens it. **Stop** stops it. Other servers the command started appear under **Also serving** (see [Where it runs](#where-it-runs)).
- **▸ server output** shows what the server prints.

If the card says **Nothing to run yet**, there is no start command yet. It appears once a task adds one, or you can set one on the Brief under **How to run it**.

### Several apps

A repository can hold several apps you run side by side, for example a web app, an admin and an API. Foundry finds them in the workspaces of `package.json`, or the Brief lists them under **How to run it**. The card then shows one row per app, the first one at the top:

- a small square (solid: answering, striped: starting, red: the last run failed, hollow: stopped), the app's name and its folder;
- **Open** while it runs, and its own **Start** or **Stop**;
- **▸ output** shows what that app prints.

**Start all** starts every app that is not running; **Stop all** stops them all. Each app gets its own port, and the addresses of the other apps in its environment as `FOUNDRY_APP_<KEY>_URL`, for example `FOUNDRY_APP_API_URL`, so the web app can find the API.

An app keeps the port it uses when you run it yourself, while that port is free, so the addresses your `.env` files name still reach it. Foundry reads that port from the start script (`next dev -p 3001`), `PORT` in the app's `.env` files, a default in its server code (`process.env.PORT ?? 4000`) or the framework's default (Next 3000, Vite 5173). When the port is taken (your own dev server is on it, say), the app gets one from **Settings → Preview** instead, and every variable that points at `localhost:<usual port>` is pointed at the new port in the apps' environment; your files are not changed. The app's row says so: **Usually on port 3000, which was taken; runs on 4200**, and **Pointed at the ports the apps got** with the variable names. In Docker the apps always get ports from the range, since only it is published, and the variables are pointed there.

### Services

If the repository has a Docker Compose file with services the apps need (a database such as Postgres, file storage such as MinIO), the card shows a **Services** section with each service, its ports and its state. Starting the preview starts the services first. **Start services** and **Stop services** act on all of them; each service also has its own **Start** or **Stop**.

- Services are shared by every goal of the same repository, so two goals never start two databases on the same port.
- If a service's port is already in use on your computer (your own Postgres, for example), it shows **in use elsewhere**: Foundry does not start it, and the apps use the one that is already running.
- Services keep running when the preview stops, so their data is kept. **Stop services** stops them; the data is still kept.
- Docker must be installed. Without it, or when Foundry itself runs inside Docker, the card shows the command to start the services yourself, with **copy**.

Foundry also starts the preview by itself at a milestone, restarts it after each task lands if it is running, and stops it when nobody opened it for a while (60 minutes by default). When the goal ends, Foundry stops the previews it started itself; one you started, for example to look at a finished goal, keeps running until it is idle. The card then says why Foundry stopped it.

### Where it runs

The top of the card says which branch runs and where. While the goal is being worked on, the preview runs the goal's own copy of the repository (its progress folder, on the goal's branch), **not your checkout**, so you see the goal's work, not what is in your own folder. **copy** copies that folder's path.

Once the goal is finished, the branch is a menu, with a line under it saying what the chosen branch is (the goal's folder, the base branch with the merged work…). Pick the goal branch, the base branch (for example `main`) or another local branch of yours; stop the preview first to change it. After a merge Foundry cleans up the goal's folder and deletes its branch; the preview then runs the base branch, which holds the merged work, and a line in bold says so.

Beside the branch, a second menu picks where a branch other than the goal's runs:

- **(auto)**, the default: in your checkout when it is on that branch already, so its installed dependencies and `.env` files are used; otherwise in Foundry's preview folder, and a line says which branch your checkout is on.
- **your checkout**: your own folder as it is, on whatever branch it is on, including changes you have not committed. The branch menu goes away.
- **Foundry's preview folder**: Foundry's own folder, checked out at the branch's latest commit.

Foundry never switches, resets or pulls your checkout for a preview. Stop the preview before changing either menu.

When the start command launches more servers than the one Foundry gave a port to (a demo script that starts the web app, an admin and an API, or `turbo dev`), Foundry finds the ports they listen on and lists the ones that answer web requests under **Also serving**, each named after its package (or the folder it runs in), with its own link. Every port it uses is kept away from other goals' previews.

### When it fails

If an app stops on its own, the card says **The last run failed** with the reason (for example `exited with code 1`) and the last lines the app printed, such as the error message, without opening the output. If it runs but does not answer within 90 seconds, a line in bold says so: it may still be starting, or its command ignores the port Foundry gave it (`{port}` in the Brief's **How to run it** fixes that). If installing dependencies failed, that shows too. When it stopped because its port was in use (`EADDRINUSE`), the card names what holds that port, with **Stop & release** when it can be freed and a link to [Ports](./ports.md).

### Environment

Apps often need settings and keys, such as an API key or a bot token, that a project keeps in `.env` files outside git, so the goal's folder does not have them. The **Environment** line of the card says how many are set and how many example files ask for; **Edit…** opens them in a window, one row per variable, name on the left, value on the right:

- Under each name, a note says what it is and where to get it: the comment written for it in the example file (such as `.env.example`), a hint for names many projects use (a database address, a bot token from @BotFather, an API key from a dashboard), the example value, and the files that read it. For a secret any random string will do, **Generate** fills one in.
- **Set for this repository** lists the saved variables. Saved values are never shown again: the field says **saved · type to replace**. Leave it empty to keep the value; type to replace it; **×** removes the variable. To rename one, remove it and add it again with its value.
- **Listed in example files, not set** lists what example files mention but nothing provides, those without an example value first. Fill in the ones you need; empty ones are not saved. Not every one is needed: example files list optional settings too, and some start scripts write their own.
- **Add variable** adds one by name. **Save** stores them for the repository, so every goal of it gets them; apps get them the next time they start.
- If your own repository folder has `.env` files that git ignores (`.env`, `.env.development`, `.env.local`, `.env.development.local`), **Import from your checkout** copies the variables that are not set here yet. Nothing is read from your folder unless you press it.

The values stay on this computer. They are passed to the preview's processes only, never written into the goal's folder where the coding agents work, and hidden as `••••` in the preview's output and the self-check's report. The preview runs the goal's code, so that code can still read them. They take precedence over the project's own `.env` files. Foundry's own `PORT` and `FOUNDRY_APP_<KEY>_URL` always win.

### Self-check

**Self-check after each task** is a switch in the Overview's **Acceptance** card, below the checks, and on the Brief's **How to run it** section before you approve. When on, after every task lands Foundry opens the preview in a hidden browser, takes a screenshot and checks for errors. Errors fail a must check, so they get fixed. The card shows the latest run: passed or failed, how many errors (the first few listed), and a link to the screenshot. No AI is involved, so it costs nothing.

It only helps goals whose result runs in a browser, and it needs a one-time download (**Install Chromium** in [Settings → Preview & self-check](./settings.md#preview--self-check)). It is off by default.

It is not the same as a milestone's look: the self-check is a quick automatic smoke test after every task, of the first page only, that never shows you anything or pauses; a failure makes Foundry fix the errors, which is where any cost comes from. **Have a look** is for you: at a milestone Foundry records a walkthrough of what to look at and, if the switch is on, waits for you.

## Milestones

The Brief gives every feature you can see or try a milestone, on the task that finishes it. A feature with a web page or an API also has a **milestone script**: a Playwright script in the repository (`e2e/milestones/<feature>.spec.ts`) that walks through the feature and takes a captioned screenshot at each state worth seeing (an empty list, a filled form, an error, a phone width), or calls the API and keeps its answers.

**With a script:**

- **The task writes it, and it must pass.** It is one of the task's must checks, so the feature cannot land unless what the script shows works. It runs with the project's own Playwright config, which starts everything the feature needs on a bare checkout: the app, its backend, Docker services, seed data. Each run gets two free ports, `PORT` and `API_PORT`, so it never lands on the preview or another task.
- **When it lands, Foundry runs it again on the goal branch** and records what it shows: a video of each test, its screenshots, and the API's answers. The goal does not pause; the recording appears in the **Milestones** card and in your notification channels.
- **When it fails there**, Foundry adds one task that repairs it: the app, how the config starts it, or the script, never by weakening what it checks. When the repair has landed and the script still fails, the goal pauses at that milestone with the failing recording and its runner log.
- **Once every task is done, the final walkthrough runs every script again** on the finished branch, so a later task that broke an earlier feature shows. A script that fails there gets its repair task too. Then the goal pauses once more for a look at the end.

**Without a script** (documents, older goals): when the milestone task lands, the goal pauses and Foundry records a walkthrough of the preview, described below.

**Files instead of an app** (a CAD model, images, video): the milestone shows what the task itself produced under `artifacts/`, its snapshots or images whole and up to four clips, the ones the milestone names first, and links the models and drawings it exported; there is no walkthrough, since there is no app to walk.

**Rerun** on a row of the **Milestones** card records that milestone again at any time: a script runs once more, a walkthrough replays the steps it recorded last time instead of planning new ones, and a milestone of files shows the task's files as they are now. **Rerun all** does this for every milestone that landed.

**Have a look: pause at milestones** decides whether the goal pauses for the final walkthrough and at milestones without a script. It is on by default ([Settings](./settings.md)); each goal has its own switch on the Brief's **How to run it** section and in the Overview's **Acceptance** card, which applies from the next milestone. With it off, the goal goes on, and the note below and its recording are sent to your notification channels instead.

When the goal pauses, its badge reads **have a look**, the Inbox shows **Have a look**, and at the top of the goal page appears a card: **Have a look — task name**, or **Have a look — the final walkthrough** with every feature's recording, failing ones first.

![The Have a look card with what to look at, the running preview and the self-check's screenshots](images/milestone.png)

The card shows:

- What to look at, as written in the Brief.
- **What Foundry saw**: a recording of the preview and screenshots, so you can look without starting anything. While the card opens it says **Recording a walkthrough of the preview…**: a small model plans a few steps from what to look at and the page's controls (clicking, filling in sample values, opening pages; never signing in, paying or deleting), and a hidden browser follows them, recording a video and taking a screenshot at each point worth seeing. A step that cannot be done is skipped; when no walkthrough can be planned, one screenshot of the page is kept, and a line in bold says why. It needs Playwright's Chromium, the same as the self-check.
  - With several apps, the walkthrough opens the one whose folder holds the task's files.
  - Before the apps start, Docker is opened if it is installed but not running (Docker Desktop, OrbStack, Rancher Desktop or colima), and variables the app's example env files ask for are taken from your checkout's env files when only they have them.
  - A screenshot of an error page (an HTTP error, a "could not be found" page, a blank page) shows nothing of the milestone: it is left out, and the line in bold says how many.
  - When the app does not answer, or shows only error pages, Foundry walks the same app again with its mock command, against fake data: the **Mock command** in **How to run it**, or a `dev:mock`, `start:mock` or `mock` script in the app's `package.json`. The summary then starts with *With mock data*, and the milestone reads **unverified · fake data**: it does not count as shown. Workers on a screen with a milestone without a script are asked to add such a script when the app needs a backend, Docker or secrets to run.
- The preview, already starting, with **Open preview**.
- **What the self-check saw**: its latest screenshots, if the self-check is on.
- **Artifacts**: images and files produced so far, for media and CAD goals (a CAD goal's exports and the snapshots that show them). On a milestone of files the card already shows that task's files above, so this list becomes **Other artifacts**: only the goal's files those do not include.
- The code so far is on the **Diff** tab; the folder is under **Open ▾**.

Then either press **Continue**, or write what you saw and press **Turn into a plan**. How that works, step by step, is in [When Foundry needs you](./when-foundry-needs-you.md#a-milestone-is-ready-to-look-at).

The same screenshots and videos are sent to your notification channels in a second message, **📸 What the milestone looks like** (**⚠️ A milestone did not show** when a script failed), whether or not the goal pauses; the final walkthrough sends one message for every feature, and stay in the Overview's **Milestones** card to watch again later. A video too large for the channel (50 MB on Telegram, 10 MB on Discord) stays on the goal page, and the message says so.

### Likeness to the pictures

When the Brief has [Subjects with pictures](./approving-the-brief.md#looks-like), every milestone recording except the final walkthrough's is put next to them: a short review opens the recording's screenshots (a milestone of files' images, frames of its clips) and the pictures, and says for each Subject how close it is out of 10, what already matches and what differs. It shows under the recording as **Likeness to the pictures**, with the differences someone who knows the subject would notice at a glance first, in red. The milestone's row shows **likeness N/10**, the lowest Subject's score.

![Likeness to the pictures under a milestone's recording: the mascot at 6/10 beside its pictures, one major difference in red, one minor, and what already matches](images/likeness.png)

When the review finds such major differences while the goal still runs, Foundry adds one task, **match … to its pictures**, with the differences and both sets of pictures. Once it lands, the milestone is recorded and compared again, and that second review only reports. Your notification channels hear **🔍 Not like the pictures yet** when the task is added. A review costs about as much as a task review.

## Timeline

When each step ran and how long it took, on one time axis, so the step that took longest shows at a glance.

**Where the time went** starts with how long the goal took from start to end (or until now), how much of that it waited for you, and how long its delivery took. Below that is the time spent in sessions by kind (**Work**, **Reviews**, **Clarify**, **Landing**, **Other sessions**). Sessions run side by side, so together they can take longer than the goal did. **The longest steps** names the longest waits, sessions and delegated goals.

The chart below has one row for the goal, with its phases: Clarify, waits for you, running, goal review and delivery. Then come a row with Foundry's own sessions (Clarify, the planner, reviews, docs), and one row per task: each attempt, its review and its landing. A delegated goal sits under the task it does, with rows of its own. Waits for you are striped in yellow, and a step still going is hatched. Hold the pointer over a bar for its duration and cost.

A goal that ran for hours keeps its steps readable: a stretch in which nothing ran (no session, no wait for you, no delegated goal) folds into a short hatched gap labelled with how long it lasted, for example **⋯ 2h 40m**, and the rest keeps its scale. The chart reads like a Gantt chart: the rows' names stay on the left, and the chart beside them slides sideways. It fits the whole goal in the width unless the steps would get too thin to read (a long goal, a phone); then it keeps a readable scale and slides, and a rail under it shows the whole goal in miniature with the part in view framed: drag the frame, or press anywhere on the rail, to go there. **+** and **−** next to the colours zoom in and out, and **fit** shows the whole goal again.

Click a bar, or a row's name, for what it was: its start and end, its duration and cost, with **Open task**, which opens the task over the timeline, and **Open delegated goal** on a step a delegated goal did.

![The Timeline tab: where the time went, the longest steps, and every step of the goal and its delegated goal on one time axis](images/goal-timeline.png)

## Activity

Everything that happened to the goal, newest first, one line each: stages, tasks starting and finishing, checks, decisions, delivery steps. **important only** hides routine lines; **show bookkeeping events** shows even more. A line ending in **…** shows only the start of a longer text, such as a worker message, a check result or a note; click it to read all of it.

![The Activity tab with important only ticked: the goal passing its review, every check, each task merging, newest first](images/goal-activity.png)

## Diff

Every file the goal changed compared with where it started, with how many lines it added and removed. This is exactly what would go into a pull request.

Click a file to open its changes in a window: the code coloured by language, added lines green (+) and removed ones red (−), with their line numbers in the old and the new file. **Whole file** shows the file as it is now with the goal's lines tinted (while the goal's folder exists). The arrows at the top, or ← and →, move to the previous or next file.

![The Diff tab: every file the goal changed, with the lines it added and removed](images/goal-diff.png)

## Cancelling, restarting, deleting

| You want to | Do this |
|---|---|
| Stop the goal now | **Cancel** at the top. Running sessions stop. The work done so far stays on the goal's branch. |
| Run it again after it stopped | **⋯ → Restart…**. Pick **All tasks from the beginning** or one task; that task and everything after it run again with fresh attempts. Earlier tasks keep their results, and restarted tasks build on the work already there. Available once a goal is blocked, done, over-delivered, failed or cancelled. |
| Redo one task | Open it on the **Tasks** tab and press **Restart from here**. |
| Plan again before approving | **⋯ → Re-run Clarify** (also on the Brief page). |
| Remove the goal | **⋯ → Delete goal…**. Running sessions stop. The progress folder, the task folders and the goal's stacked delivery branches are deleted for good; attachments go to the trash. The goal leaves the list; its event history is kept. Tick **Also delete the branch** to delete the goal's branch too; if you never pushed it, that work is gone. |

## The Agents page

![Claude Code and Codex sessions — demonstration data](images/agents.png)

The buttons above the list (**all**, **Claude Code**, **Codex**, each with its count in the last 24 hours) filter by coding agent, **live only** keeps the sessions working or waiting for input, and the search box matches titles, goal names, tasks, models, folders and session IDs. **expand all** and **collapse all** open or fold every card. On the right, **Overview** counts the sessions by state, by coding agent (Foundry's and yours) and by model; on a phone, **overview** shows it. The list refreshes every five seconds; external sessions remain read-only.

A live count on the corner of **Agents** in the top bar (a blue number with a ring pulsing behind it) says how many sessions are working right now; it is gone while none is. **Agents** combines Foundry-owned sessions with recent native Claude Code and Codex history. Each row identifies its coding agent; retrieval is bounded, so this is not an inventory of every conversation ever created.

- **Foundry agents**: sessions Foundry started for your goals, one card per goal. Each card's heading shows the goal, its coding agent, its project folder, how many sessions it has and how many are working; **Open goal →** goes to the goal page. Click a heading to collapse or expand the card. A card starts expanded while one of its sessions is working or idle (or when it is the only one); Foundry remembers your choice in this browser, and a search expands every card. A running session can be stopped with its red **Stop** button, after you confirm. A row names the task the session worked on, with a **work** or **merge** chip and its attempt number; **merge** sessions bring a branch up to date during integration or delivery.
- **Your sessions**: sessions you opened yourself (in a terminal, in VS Code), one card per folder, folding the same way. Foundry only watches them, never touches them.

Each row stacks what the session is (its title, and for your own sessions its folder and branch), what runs it (the coding agent's icon — orange for Claude Code, blue for Codex — the model and context usage when available) and when (last activity, and how long it ran or where it was opened). Helper agents appear indented under the session that started them, each with its description, type, status, model, context usage, last activity and how long it ran. They fold under the session's **N subagents** button: open while one of them runs, folded otherwise, and Foundry remembers your choice in this browser. Click a row to follow its conversation: like a task's live log, every message is one line, and clicking a line opens the whole message in a window. The header counts sessions **working**, **idle**, **finished** and **unknown** in the last 24 hours. External Codex sessions and their children have unknown process status; they do not increase the known-busy count. While any session is working, a small **N busy** pill in the top bar says how many.

A session that is **idle** for a long time while its goal says running is worth a look; the task's live log usually says why.
