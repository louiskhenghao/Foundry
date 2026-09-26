# Settings explained

> English · [中文](./settings.zh.md)

Open **Settings** in the top bar. The sections are listed on the left; this page follows them in order and explains, in plain words, the controls you might want to touch and when. The exact keys, defaults and environment variables are in the operator reference, [configuration.md](../operate/configuration.md).

## How Settings works

- Change what you want, then press **Save** in the bar at the top (it says **N unsaved**). **Discard** throws your changes away. One exception: choosing a skill pack under [Skills](#skills) saves the moment you click it.
- Most changes apply at once. A few are marked **restart**: they apply after Foundry restarts.
- Each setting has a small badge: **default** (never changed), **saved** (you changed it here) or **env** (set by whoever installed Foundry). The ↺ arrow next to a saved value forgets it and goes back to the default.

## New goal defaults

What a new goal starts with. Most of them can be changed for one goal on the New goal form.

| Setting | Default | What it does |
|---|---|---|
| **Default goal view** | expert | Which view a goal opens in: simple or expert. |
| **Pace for new goals** | thorough | **thorough — engine reviews the work**, or **fast — approved checks only**. Image and video goals always start fast. |
| **Interview before the Brief** | auto | **auto** asks only when something is worth asking; **always** asks at least one round; **never** goes straight to the Brief. |
| **Effort for new goals** | CLI default | How hard sessions think, **low** to **max**. |
| **TDD for new Expert goals** | required | Test-first: **required**, **preferred** or **off**. |
| **Goal-level fix cycles** | 1 | How many times the final review may send fix tasks before asking you. Thorough pace only. |
| **Small goal (diff lines)** | 400 | A goal that changed this many lines or fewer gets a lighter, cheaper final review. 0 = never. |
| **Review every task** | on | A short review of every task, even when the Brief did not ask for one. Thorough pace only. |

Under **Delivery — what happens to the branch when a goal finishes**: **Mode for new goals** (local only), **Granularity** (one PR per goal) and **Remote** (origin). See [Getting the result](./getting-the-result.md).

Good to know: the New goal form starts from these defaults. **Default goal view**, **Pace**, **TDD**, and the delivery **Mode for new goals** and **Granularity** are filled in from here, and the form picks the **Remote** named here when the project has it. A field you change on the form keeps your choice for that goal. **Interview**, **Effort** and the model preset follow Settings whenever the form is left at its default. The form itself remembers, in this browser, the kind of goal, the budget and the finer delivery options (such as the merge method).

When to change: set **Interview before the Brief** to **always** if you like to be asked; set **Effort** lower if most of your goals are small; lower **Goal-level fix cycles** to 0 if you would rather see failed reviews yourself.

## Models & limits

This section decides which Claude model does which job, and how much one session may spend.

![Settings, Models & limits: the Sync models button and one preset per goal type with its model grid](images/settings-models.png)

### Presets

A preset is a table: for each job, which model does it. The jobs are:

| Job | What it is |
|---|---|
| **Clarify** | Reads your project, interviews you, writes the Brief. |
| **Planner** | Splits the goal into tasks while clarifying. |
| **Simple tasks**, **Standard tasks**, **Complex tasks** | The workers, by the difficulty set on the Brief. |
| **Merge attempts** | Combines two tasks that changed the same lines, and resolves conflicts when the base branch has moved. |
| **Goal reviewer** | The final review of the whole result. The most expensive single session. |
| **Task reviewer** | The short review of each task. |
| **Documenter** | Writes the completion documents. |
| **Feedback triage** | Turns what you write at a milestone into a plan. |
| **Suggest a hint** | The AI diagnosis for a blocked task in the Inbox. |
| **Style samples** | The sample images on the Brief. |

Four presets come with Foundry:

| Preset | In short | Code table |
|---|---|---|
| **Max** | The most capable model (Fable) everywhere. Best results, highest cost. | Fable for everything. |
| **Production** | Fable where judgement matters (planning, hard tasks, the final review), Opus for the bulk. | Fable: Clarify, Planner, Complex tasks, Goal reviewer. Sonnet: Simple tasks, Task reviewer, Feedback triage. Opus: the rest. |
| **Balanced** | Opus for planning and hard tasks, Sonnet for most work and reviews, Haiku for small checks. | Opus: Clarify, Planner, Complex tasks. Haiku: Task reviewer, Feedback triage. Sonnet: the rest. |
| **Economy** | Sonnet for planning and most work, Haiku for simple tasks and small checks. Lowest cost. | Haiku: Simple tasks, Task reviewer, Feedback triage. Sonnet: the rest. |

Each preset has three tables, one per kind of goal: **Code**, **Docs & research**, and **Media** (images and video). They differ slightly; Settings shows each one. Presets use family names (Fable, Opus, Sonnet, Haiku), so they follow new model releases by themselves.

### Preset per goal type

Under **Preset per goal type** you pick which preset each kind of goal uses:

| Goal type | Used for | Default |
|---|---|---|
| **Code** | software goals, and goals not yet classified | Production |
| **Docs & research** | documents and cited research reports | Balanced |
| **Media** | image and video goals | Balanced |

Under each choice is a preview grid: every job and the model it will use. Greyed rows are jobs that kind of goal rarely runs. A single goal can use another preset: the **Models** choice on the New goal form.

When to change: pick **Economy** or **Balanced** for Code to spend less (see [Costs and usage](./costs-and-usage.md#ways-to-spend-less)); pick **Max** when quality matters more than cost.

### Editing a preset

Press **Edit preset** next to a goal type, or click a preset's name under **Presets**, to open the editor.

- Pick **Code**, **Docs & research** or **Media**, then change the model of any job. A dot • marks a cell you changed; hover it to see the shipped value.
- **Editing a built-in preset** (Max, Production, Balanced, Economy) marks it **modified**, in the editor and in the dropdowns. **Reset** puts back what Foundry ships. If Foundry later ships a better default for a preset you changed, it says **newer default available**.
- **New from this** creates your own preset, starting as a copy of the one shown ("Production copy"). Give it a **Name** and a description.
- **Your own presets** can be renamed at any time in the **Name** field, and removed with **Delete**. Goals still running on a deleted preset continue on their goal type's preset; goal types that used it go back to their default.

Changes apply when you press **Save**: to new goals, and to running goals from their next session.

### Sync models

**Sync models** asks your Claude Code which models it knows (free) and checks what Fable, Opus, Sonnet and Haiku currently mean, with one tiny session each (about $0.04 in total). The line next to it says when it last ran, with which Claude Code version, and how many models it found.

It also runs by itself when Foundry starts and notices that Claude Code was updated since the last sync. Press it yourself after updating Claude Code if you want to see new models right away.

### Model dropdowns

Every model choice in the preset editor offers:

- **Latest of each family**: Fable, Opus, Sonnet, Haiku. The arrow shows the exact model each name currently means, for example `Opus → claude-opus-…`. These follow new releases. Most people should stay here.
- **Pinned (newest found)**: the exact newest version of each family, found by a sync. Choose one to stay on that version even when a newer one comes out.
- **Older versions**: only when **show all versions** (next to **Sync models**) is ticked.
- **custom id…**: type any model name Claude Code accepts.

### Housekeeping model

**Housekeeping model** (default Haiku) does Foundry's own one-line chores: deciding what kind of goal it is, summarising logs, checking your usage limit. It costs cents per goal. The only model not set by a preset. **Test** runs one tiny session to confirm the model works and shows what it resolves to.

### Fallbacks

**Fallbacks (in order)** (default `opus, sonnet, haiku`): when a model is unavailable (retired, mistyped, not in your plan), Foundry re-runs that session with the next one in this list and remembers the replacement for that goal. Only when all of them fail does it ask you. The goal's Overview shows a **Model fallback** card when this happened.

### Last attempt on the Complex-task model

On by default. When a task is allowed two or more attempts, its last attempt, and every extra attempt you grant from the Inbox, runs on the preset's **Complex tasks** model. A task that failed on a cheaper model gets one more chance on the strongest before it comes back to you. The Activity tab says when it happens. Turn it off only if cost matters more than finishing.

### Limits

**Limits — what one session may spend before the engine stops it**:

| Setting | Default | What it does |
|---|---|---|
| **Cost cap per session (USD)** | 10 | A worker session stops at this spend (and never spends more than the goal has left). |
| **Attempt timeout (minutes)** | 20 | A session running longer is stopped. What it committed stays; Foundry resumes or retries. |
| **Continuations per attempt** | 2 | How often a stopped session is resumed (cheaper, it keeps what it read) before a fresh attempt starts. |
| **Turn cap per session** | 150 | Only stops runaway loops. Keep it generous. |
| **Concurrent Claude sessions** | 3 | How many sessions run at once across all goals. Higher is faster, and spends faster. |

When to change: raise the cost cap or timeout if big tasks keep getting cut off; lower **Concurrent Claude sessions** if you hit your plan's usage limit often.

## Skills

Skills are packaged instructions Claude Code can follow. Here you choose which ones Foundry hands to its sessions.

- **Profile**: **mattpocock (mandated + observed)** (default) tells workers which working method to follow (tests first for features, diagnose first for bugs) and records whether they did. **plain (hint only)** only mentions them.
- **Setting sources**: which Claude Code settings sessions load. Leave empty.
- **autoskills per goal** (on): after you approve a Brief, adds skills matching your project's technology (React, Tailwind…) to the goal's folder. They never reach your commits.
- **Design skills**, **Image skills**, **Video skills**: pick one pack for each; only that pack is given to frontend, image or video tasks. A pack shows **installed** or **N missing** with an **Install** button. Choosing a pack saves immediately. Image packs only produce real images with a key under [Tools & keys](#tools--keys).

The **Skills** page in the top bar shows everything installed and can update it. Each skill has a state: **outdated** (a newer version is out — press **Update**), **unreleased** (a plugin's author changed it upstream without raising the version number, so the CLI has nothing new to install yet), **modified** (your copy was edited) or **up to date** (a difference in a README or changelog alone does not count). A command-line tool such as ffmpeg counts as installed as soon as its command is found. A plugin's skills can only be removed together, with **Uninstall plugin**. A copy you installed by hand offers **Adopt** when Foundry can install that skill itself: the copy is replaced by one Foundry keeps up to date. Every install, update, adoption or uninstall you start there opens a tab in the **Operations** bar at the bottom of the page, with its own log; several can run side by side. A finished tab stays until you close it, and the bar folds down to a line with counts.

## Git & delivery

How Foundry keeps up with the online copy of your project, and how long delivery waits.

- **Fetch the base branch before a goal starts** (on): Foundry looks at the newest version online before it plans. Your own folder is never changed.
- **Where the goal branch starts**: **auto — remote tip when local is behind** (default) starts from the newer online version when your folder is behind; **always the local branch** starts from exactly what is in your folder.
- **Refresh between tasks** (off): on long goals in busy projects, brings in newer work from the base branch between tasks. Off by default because mid-goal changes can surprise the workers.
- **Commit author**: who Foundry's commits are written by. **you, with Foundry as co-author** (default) uses your git identity — the project's, else your global one, else your GitHub account — and adds a `Co-authored-by: Foundry` line; **you only** leaves that line out; **Foundry only** writes them as `foundry`. Deploy integrations such as Vercel teams refuse commits by an author who is not a member, so keep one of the "you" options if you use one. It applies to commits made from now on.
- **Update my local base branch after a merge** (on): when a pull request merges, Foundry fast-forwards your own base branch when that is safe, then removes the goal's progress folder, worktrees and local branches. Off: you pull yourself, and the folders stay until you delete the goal. See [Getting the result](./getting-the-result.md#after-a-pull-request-merged).
- **Delivery timings (advanced)**: how often Foundry checks a pull request (**Poll interval (s)**, 30), how long it waits for CI to appear (**Grace before "no checks" (s)**, 90) and to finish (**Checks timeout (min)**, 30), and how long it waits for auto-merge when the branch is protected (**Auto-merge wait under branch protection (min)**, 10). Raise **Checks timeout** if your CI takes longer than half an hour.

## Tools & keys

- **Use graphify for relevant-file discovery** (on): uses a code map to find the relevant files, when that tool is installed.
- **OpenAI-compatible API key**: needed for image goals to produce real images. Without it, image tasks fall back to hand-drawn SVG renders. **OpenAI-compatible base URL**: only for a proxy or another compatible provider.
- **Gemini API key**: an alternative for one of the image packs.
- **Kimi (Moonshot) API key**: used by one design pack's models, where a skill calls them.
- **markitdown binary**: the converter that turns attached documents into text. Leave empty.

Keys apply to the next session, no restart. More in [Costs and usage](./costs-and-usage.md#image-goals-need-an-image-key).

## Preview & self-check

The preview is the goal's result running, so you can try it (see [While it runs](./while-it-runs.md#preview)).

- **First port** and **Last port** (4200 to 4299): previews use the first free port in this range.
- **Idle minutes** (60): a preview nobody opened for this long is stopped. Never while a milestone waits for you.
- **Self-check new goals by default** (off): switch the self-check on for every new goal. Each goal also has its own switch, on the Brief's **How to run it** section and on its Preview card.
- **Install Chromium**: the self-check needs a hidden browser, downloaded once (a few hundred MB). The line says **Chromium installed** when it is there.

When to change: turn the self-check on by default if most of your goals are web apps.

## Notifications

Foundry can message you on Telegram or Discord when something happens, so you do not have to watch the page. Setting up the bot or webhook is in [notifications.md](../operate/notifications.md); after that, press **Send test message**.

**Link base URL**: the address where you open Foundry from your phone. With it, messages carry a link straight to the goal. Without it they carry no link. See [remote-access.md](../operate/remote-access.md).

The six switches, all on by default:

| Switch | You get a message when | What to do |
|---|---|---|
| **Needs you** | A goal or task is waiting for you: a failed task, a blocked command, a budget reached, a milestone to look at. | Open the Inbox or the goal and answer. Until you do, that part waits. See [When Foundry needs you](./when-foundry-needs-you.md). |
| **Interview round** | Foundry asks a round of questions before writing the Brief. | Answer them; the goal waits for you. |
| **Goal finished** | A goal ended done, over-delivered or failed. Never when you cancelled it yourself. | Look at the result, or at what failed. |
| **Delivery** | A pull request was opened or merged, or the delivery failed. | Review the pull request, or look at the Delivery tab. |
| **Usage pause** | Your Claude plan's usage limit paused all work, and again when it resumes. | Nothing. Work resumes by itself. |
| **New version** | A newer Foundry version is out (once per version). | Update when convenient, see [About & updates](#about--updates). |

Turn off what you do not want. The switches apply to every channel alike.

## Safety

- **Extra boundary patterns**: commands Foundry must never let a session run on its own, on top of the built-in ones (pushes, pull requests, releases, publishing, deploys, cloud tools), for example `terraform apply|kubectl`. A blocked command comes to your Inbox for approval.
- **Folder browser roots**: which folders the **Select folder…** picker may open. Empty means your home folder and external drives.

## Engine (install)

Settings for whoever installed Foundry. Leave them unless you know why.

- **Port** (4111) and **Host** (127.0.0.1): where Foundry is reachable. Keep 127.0.0.1 unless you set up remote access. Restart needed.
- **claude binary** and **Claude Code home**: where Claude Code and its skills live. Empty finds them. Restart needed.
- **Progress folders**: where each goal's folder is created. Empty puts it next to your project as `<project>-foundry/<goal>`. A folder here gives `<folder>/<project>/<goal>` instead. Applies to goals created from now on.

## About & updates

Shows the version you run and how it is installed. **Check now** asks whether a newer version exists (Foundry also checks once a day). When one exists, the button **Update to X** appears, with what changed, and a pill in the top bar.

The update dialog:

- **Update**: new sessions stop, running ones finish, then Foundry updates and restarts. The page reloads by itself. If anything fails, it rolls back and the old version keeps running.
- **Update immediately without waiting — interrupts running agents**: tick only if you cannot wait.
- **Not now** closes it.
- If this install cannot update itself, the dialog shows the commands to run instead.

Details for operators: [updates-and-backup.md](../operate/updates-and-backup.md).
