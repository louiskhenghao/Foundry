# Your first goal

> English · [中文](./your-first-goal.zh.md)

![Agent accounts — demonstration accounts](images/accounts.png)

![New Codex goal](images/new-goal-codex.png)

![New goal role assignments](images/codex-new-goal-presets.png)


![Codex setup — demonstration data](images/codex-setup.png)

## Agent accounts and coding agent

Open **Accounts** in the header to see Claude Code, Codex and Antigravity separately. Antigravity signs in from a terminal: run `agy` once (it opens the browser), then **Refresh status**. **Sign in to Codex** uses ChatGPT device authorization: the window shows a one-time code with a copy button and OpenAI's device page; enter the code there and approve. The code lasts 15 minutes, and the window waits as long. **Sign in to Claude Code** uses Claude's native login. Credentials belong to the local CLI: signing out here also signs out that CLI, but does not sign out the other provider. Foundry refuses sign-in and sign-out while work is active, including requests from the CLI. Codex supports ChatGPT sign-in only; API-key login is not used. The account card shows the native email and plan when available. Installing a CLI while Foundry is running is detected on the next account check; Setup and Accounts use the current executable. Changes to a configured binary path or native home still require a restart. Claude Code and Codex can hold several of your accounts, and adding one is allowed while work runs: see [Several accounts](./costs-and-usage.md#several-accounts).

Use **Refresh status** at the top of Accounts to recheck both native accounts. The existing cards stay visible during the check; the reserved status row reports loading or an error without replacing the page.

On **New goal**, choose **Coding agent** before creating the goal. All three coding agents can run in one Foundry instance. The selected coding agent stays fixed through clarification, workers, retries, reviews and delivery assistance; sessions never resume on another provider. Each coding agent has independent model presets under **Models**. Codex captures the preset's role models, reasoning efforts and fallback order when you create the goal.

For Codex, budget presets cover time, attempts and concurrency. No USD budget is available. **Accounts** lists the current integration limits before you start.


This page walks through the **New goal** form from top to bottom. Most fields can stay as they are. The only things you must fill in are what you want done and the project folder.

## Before you start

### Check the Setup page

Open the ⚙ menu at the right of the top bar and choose **Setup** (a red dot on ⚙ means something is still missing). Select **Claude Code** or **Codex** on Setup. The checks, sign-in, fixes and recommended skill installation all target that coding agent; **Create your first goal** preserves the selection. Foundry shows a green or red line for each:

| Check | What it is | If it is red |
|---|---|---|
| **Claude Code CLI** / **Codex CLI** | The selected coding agent’s program. | Press **Install**: Claude Code's own installer, or Codex through Homebrew, npm or its release download; no npm needed. Or copy the command shown. |
| **Claude login** / **Codex login** | The selected coding agent’s account. | Press **Sign in**. |
| **git** | Keeps every version of your files. | Copy the command shown. |
| **Bun runtime** | What Foundry itself runs on. | Copy the command shown. |
| **Required: …** | Skills Foundry's sessions need. | Press **Install**. |
| **GitHub CLI (optional)** | Only needed if Foundry should open pull requests for you. | Can stay yellow. When it says *not logged in*, **Sign in** opens a window with a one-time code: copy it, open GitHub's page, paste it and approve. |

When everything needed is in place the page says **Everything is in place** and offers **Create your first goal →**. **Re-run** checks again. If something is missing later, a red **Setup incomplete** banner appears with **Fix in Setup →**. It covers the default coding agent and any other agent an unfinished goal runs on, naming the agent when there are two. For Codex, Setup also checks that the CLI supports hooks, which Foundry's sessions need.

The card **Development workflow — Matt Pocock's engineering skills** lists the skills Foundry's workers follow (for example writing tests first). If some are missing, press **Install N missing**. The bundle contains eight current upstream skills. The removed `resolving-merge-conflicts` skill is no longer requested; Foundry’s built-in Merger instructions still handle conflicts.

The card **Workflow suite — pstack** installs the second suite a goal can run on (see [Workflow suite](#workflow-suite)): Foundry's own copy of one pinned release of the pstack plugin, without its hooks, as one unit. Its skills then show on Extensions as one source, **pstack suite**.

The card **3D models — text-to-cad (CAD)** installs the plugin behind **CAD** goals: its skills (parts and assemblies, drawings, DXF, robot files, printability and manufacturability checks, headless slicing) and a `cad` viewer server, from earthtojake/text-to-cad (MIT). The install adds the plugin for the selected coding agent, allows its server for sessions and downloads the CAD runtime once (Python 3.13 and OpenCASCADE, a few hundred MB, through uv), with the progress shown under the card; it runs in the background, so the page can be left meanwhile. The **CAD tools** check above says whether uv is on this computer and which slicer or printer apps were found; hand-offs to those apps stay off until **Settings → Safety → Desktop apps & printers** is on. Foundry's sessions run cadgen with usage statistics and update checks off; your own use of text-to-cad keeps its settings.

### Pick a repository folder

Foundry works in a *repository*: a project folder that git keeps history for. You do not need to know git. What matters:

- Any folder works. If it is not a repository yet, Foundry offers **Initialize git here** and does it for you.
- Foundry never changes the files in your folder while it works. It works in a copy next to it, the progress folder (see [While it runs](./while-it-runs.md#the-progress-folder)).
- If you have unsaved changes in the folder ("uncommitted changes"), that is fine. The Brief will ask about them.

## The New goal form

Press **New goal** in the top bar. The four numbered steps at the top right (**Goal**, **Repository**, **Budget**, **Delivery**) show how far you are. **Goal** turns green once you describe the goal, **Repository** once a ready folder is picked. **Budget** and **Delivery** are always green: their defaults work. The form starts with two cards of choices; the numbered cards **1** to **4** follow.

Several choices start from [Settings → New goal defaults](./settings.md#new-goal-defaults): the view, **Fast mode**, TDD, Ponytail, the workflow suite, and the delivery mode and granularity. You can change them for this goal.

Picking a ready repository folder fills untouched **Workflow suite**, **TDD** and **Ponytail** from the newest goal by creation time in that exact folder path. Goals that are still imported history are excluded. The values come from the goal's current saved choices, including any later Ponytail change. Each field you change on this page keeps your choice. In Expert view, a muted note under **Powered by** names the source: `from the last goal in this folder: <title>`. It stays while at least one of the three fields still inherits from that goal.

Picking another folder immediately resets untouched fields to Settings defaults and hides the old note. They stay at Settings defaults while validation is pending, if the folder is invalid or has no commits, or if it has no earlier goal. Successful validation applies that folder's latest values; revalidating after a pull or initialization refreshes them too.

A **Follow-up** opened from a goal page prefills all three fields from the chosen earlier goal instead, even if the folder has a newer goal. Later Settings or folder validation responses do not replace them, and the folder source note is hidden. You can still change them before creating the goal. The on-page **Follows** picker only links goals. Simple view keeps the inherited suite and Ponytail but submits **preferred** TDD; **Fast mode** omits TDD, so the engine defaults it to **off**.

If the Follow-up draft arrives after you edit **TDD** or **Ponytail**, those edits stay. Its **Workflow suite** replaces the current suite when the draft arrives.

![The New goal form with the shared Coding agent selector](images/new-goal.png)

### What kind of goal is this

Pick what the goal produces. If you are not sure, leave it on **Auto**.

| Option | For |
|---|---|
| **Auto** | Foundry reads your description and decides. |
| **Code** | Software: features, fixes, whole apps. |
| **Documents** | Proposals, contracts, tutorials, articles. |
| **Research** | An investigation ending in a report with sources. |
| **Images** | Posters, logos, illustrations. |
| **Video** | Generated video or narrated presentations. |
| **CAD** | 3D parts and assemblies (STEP, and STL, 3MF or GLB on request), engineering drawings, DXF cut profiles, URDF/SRDF/SDF robot files. Needs text-to-cad, installed on the Setup page. |

Picking **Documents**, **Research**, **Images** or **Video** switches the view to **Simple**. Picking **Images** or **Video** also ticks **Fast mode**, unless you already changed it yourself. **CAD** keeps your defaults: it is code work with a geometry kernel, so the Brief's checks matter; its TDD mandate is *preferred* (the geometry checks are written before the model) and Ponytail applies.

For **Images**, **Video** and **CAD** a field appears: **Output folder**. When the goal finishes, the finished files are copied there. Press **Choose…** to pick a folder. It is optional; without it the files stay in the progress folder. Image goals also need an image key, see [Costs and usage](./costs-and-usage.md#image-goals-need-an-image-key).

A **CAD** goal needs the text-to-cad plugin for the coding agent you picked. The tile says when it is missing; the goal still saves, and waits on its page, with an **Install text-to-cad** button, until the plugin is in (the Setup page has the same install, with uv and slicer detection). Without the plugin, **Auto** never judges a goal to be CAD: it is treated as code work.

### How much do you want to see

| View | What you get |
|---|---|
| **Simple** | One plain-language Brief. You answer its questions and approve. Afterwards you see a progress bar and what needs you. |
| **Expert** | Every control: Areas, the task graph, acceptance checks, attempt logs, merge resolution. |

The one picked at first comes from Settings (**Default goal view**). The work underneath is the same. You can switch any goal to the other view later with one click. This guide shows both.

### Fast mode

Ticked: once you approve the Brief, Foundry skips its own extra AI reviews. The acceptance checks you approved still run. Good for images, video and quick jobs. It also costs less.

Unticked (the default for code, unless Settings sets the pace to fast): Foundry reviews each task and the whole result on top of your checks, and can add fix tasks.

### Interview depth

How deep Foundry questions you before it writes the Brief: **Skip**, then **1** to **5**. It sets how thoroughly Foundry probes, not a number of rounds; each round still asks only what your project cannot answer.

- **Skip**: no questions; Foundry writes the Brief straight away.
- **1**: only what a wrong guess would waste the goal over. **2** adds the scope trade-offs.
- **3** (the default): the decisions that shape the result; small details become assumptions you can correct on the Brief. Small goals often get no questions.
- **4**: at least one round, and edge cases, error and empty states and data rules too.
- **5**: to the bottom: every area's behaviour, screens, edge cases, data, permissions, performance and security, round after round, until nothing is left to decide or you press **Enough — write the Brief**.

Deeper interviews take more of your time and cost a little more. Settings can change this default (see [Settings explained](./settings.md#new-goal-defaults)). More in [Answering the interview](./answering-the-interview.md).

### Delegated goals

Two switches, both off by default. Tick **Delegated goals** and the planner may hand a step that is a project of its own — research that must come first, a 3D model or a video next to the code, a part too large for one plan — to a goal of its own: a *delegated goal* with its own Clarify, Brief and plan. It starts from this goal's branch and lands its result back on it, as that step's commit, before the tasks that need it start; the tasks after it are told what it delivered. Such steps appear on the Brief as tasks of kind **goal**, and you can change them like any other task. Delegated goals run side by side when nothing orders them, as many at a time as the goal's parallel limit allows (Budget → *parallel*), each with a share of the budget; they never delegate again, and what they cost counts on this goal.

Tick **Approve delegated goals' Briefs for me** and their Briefs are approved as soon as they are written, unless a question is left that only you can answer. Off, this goal pauses until you approve each delegated goal's Brief yourself. Either way, while a delegated goal needs you — a question, a milestone, an Inbox item — this goal waits as **blocked** and goes on by itself afterwards. What you see while they run is in [Delegated goals](./while-it-runs.md#delegated-goals).

### Effort

How hard sessions of this goal think. An explicit value overrides every role. For Codex, **Default** uses the selected preset's role efforts; **none**, **minimal** and **ultra** are also available when supported by the chosen models. The form starts with the effort configured in Settings; selecting **Default** explicitly restores the Codex role settings. A known incompatible model/effort combination must be corrected before creating the goal.

| Choice | When |
|---|---|
| **Default** | Codex: each role's preset effort. Claude: the effort level set in Settings. |
| **low** | Small, obvious changes that need less reasoning. |
| **medium**, **high** | In between. |
| **xhigh**, **max** | More reasoning for hard work that touches many parts of the project. Model support varies. |

### Models

Which model preset this goal uses: [Claude presets](./settings.md#presets) or [Codex presets](./settings.md#codex-presets-and-models), depending on **Coding agent** (an Antigravity goal has [one model and effort](./settings.md#antigravity-model) instead). **Default** uses the preset Settings picks for code, documents or media goals; the name after it, for example **Default · Production**, is that preset. It changes with the kind of goal. Pick **Max**, **Production**, **Balanced**, **Economy** or your own preset to override it for this goal. Switching providers preserves each one's selection.

For Codex, **View … role assignments** shows the model and effort each role will use. **Use one model for every role in this goal** enables an optional all-role model override; leaving it unticked preserves the preset's individual models. Choose a model from the local catalog or **Custom model ID…**. **CLI default model** in the override follows native Codex configuration. Without an override, preset entries set to **Default model · from Settings** use **Default Codex model** from Settings. The override keeps role efforts unless you also choose a goal-wide effort.

Codex goals retain these settings after creation; later preset edits and deletion do not change them. If a follow-up refers to a deleted preset, the form asks you to choose an available preset. Codex preset names describe reasoning profiles, not USD prices or guaranteed account access.

For **Auto** goals, **Default · By goal type** captures the configured defaults for Code, Docs & research and Media. The role preview initially shows Code; classification switches to the captured table for the inferred type. An explicitly selected preset stays selected regardless of classification.

### Workflow suite

The selector appears only in Expert view. **pstack** is available once the Setup page has installed it (the card **Workflow suite — pstack** installs Foundry's own copy of one pinned release, without the plugin's hooks; Claude loads it per session, Codex gets its skills linked into the goal's workspace). Until then the option is greyed out; a pstack selection inherited from a folder or Follow-up is kept, with installation guidance and the engine's existing fallback rules. **Powered by** picks whose skills the roles follow for this goal: **mattpocock** (the initial Settings default: Matt Pocock's suite — tests first for features, diagnose first for bugs, code review at the end), **pstack** (pstack's suite, with Matt Pocock's skills where pstack has none) or **plain** (no rules: sessions only hear which skills are installed). The choice is fixed when the goal is created; a goal-page Follow-up starts from the chosen earlier goal's choice, and a delegated goal takes its main goal's. Simple view uses the same suite inheritance as Expert view, with Settings as the fallback. For an older goal with no saved suite, the inherited suite comes from current Settings. The goal page and the Brief show it as a **Powered by** chip.

### Engineering discipline (TDD)

Only in Expert view. TDD means writing a test first, then the code that makes it pass.

| Choice | Meaning |
|---|---|
| **required** | Workers must follow it. Claude supplies skill-invocation evidence; Codex is reviewed from the work and tests. The initial Settings default; folder and Follow-up inheritance can replace it. |
| **preferred** | Suggested only. Simple view submits this unless Fast mode is on. |
| **off** | Never mentioned. |

Docs, infra, research, image and video tasks never get a TDD rule, and a single task can switch it off in the Brief. With **Fast mode** ticked, TDD is off.

### Ponytail: less code

The switch appears only in Expert view. The initial Settings default is on; the form uses the inheritance rules above. Ponytail is "the lazy senior dev": before writing, a worker checks whether the code needs to exist at all, whether the repository, the standard library, the platform or an installed dependency already has it, and only then writes the smallest change that fully solves the task, callers, tests and fixtures included. The planner plans the same way, and `ponytail-review` reviews each task and the whole goal: it reads the code a change touches, not only the diff, and only its *must fix* findings (a bug, a security hole, data loss, breaking under the expected load) block; the rest goes into the review notes and the pull request. TDD still decides how tests are written. Work that is not code (documents, research, media) never sees it, and the switch can be changed later on the goal page, from the goal's next session. It needs the Ponytail skills, installed from the Setup page.

### What do you want done

The big text box, **1 · What do you want done?** Describe the goal as you would to a senior colleague: what you want, for whom, and anything that must or must not happen. Foundry will turn it into acceptance checks and a plan for you to approve, so you do not need to be complete.

### From a GitHub issue

Above the text box, **From a GitHub issue** takes an issue link (`https://github.com/owner/name/issues/12`), `owner/name#12`, or just `#12` once the repository folder below is chosen and has a GitHub remote. Press **Read issue**: the issue's title and description fill the title and the text box (text you already wrote is kept), and the whole thread, description and comments as they are at that moment, is attached as a link with its text, so every session of the goal reads it. A chip names the issue; its **×** unlinks it and drops the thread, keeping your words.

Reading an issue needs the GitHub CLI connected (the Setup page, or Settings → Git & delivery). When the goal is delivered with **Open a PR** or **PR + auto-merge**, the pull request's description starts with `Closes #12`, so GitHub closes the issue when the pull request merges; with one PR per task, the last one closes it. Foundry writes nothing to the issue itself. The goal page shows **From issue** under the title, and the goal list a `#12` tag. From the command line, `foundry goal new --issue <link> --repo <path>` does the same.

### Attachments

Below the text box: **Attach screenshots, PDFs, files or links — or drop / paste them here.** Use **Files** to pick files, or **Link** to add a web address, then **Add**. You can also paste a screenshot straight into the page.

Every session of the goal can read the attachments. They are never added to your project. Documents are converted to text in the background; a small tag shows when that is done. You can add more attachments later from the goal page.

### Reference

**+ add a reference** names shipped software the goal should learn from: a website, an app on this computer (`/Applications/Notes.app`), a package or an extracted app, and which feature to look at. Before Clarify, REA, a reverse-engineering server you install once from **Extensions → MCP servers**, studies each reference and writes a report with its evidence: how the feature works, what could not be verified, what to build. Every session of the goal reads the report, it is committed as `docs/reference/<name>.md` on the goal branch, and the Brief page shows it with **Investigate again**. Up to five references; the investigation has a cost and time cap in Settings.

Only software you are allowed to examine. The goal builds its own version from the evidence, never a copy; the sessions are told the same. Websites, JavaScript and Electron apps, .NET and Android packages need nothing else; native apps and binaries need Hopper, Ghidra or IDA on this computer, which the Setup page checks. Without REA the investigation is skipped and Clarify goes on. A goal that skips Clarify (**Skip Clarify (advanced)**) takes no reference: the investigation runs before Clarify.

### Title

Optional. Without it, the first line of your description becomes the title. The title also names the progress folder.

### Repository

**2 · Repository.** Press **Select folder…** and pick the project folder, or type a path. **New folder** in the picker makes an empty folder where you are browsing, for a project that does not exist yet. **Choose with Finder…** opens the macOS folder dialog; it is left out when you opened Foundry from another device, where that dialog would appear on Foundry's computer.

Foundry then shows what it found: the branch, whether there are uncommitted changes, the last saved version, the online copy (remote) if any, and who commits are made as. If the online copy has newer work than your folder, the card says where the goal will start from (normally the newer work), and **pull into my checkout** brings your own folder up to date too.

If the folder is not a repository, press **Initialize git here**. If you picked a folder inside a repository, Foundry offers the repository's top folder instead.

When earlier goals ran in this folder, a line under the card says how many [Learnings](./learnings.md) Foundry has for it: what those goals taught about the project. The plan is written with them.

### Also change: companion folders

A goal that must change more than one repository — a backend and the frontend that calls it, a library and the app that uses it — names the other folders under **Also change these folders**, under the Repository card once the main folder is ready. Each is checked like the main one (a git repository on a branch). The planner then gives every such folder its part as a task of kind **goal** bound to it, done by a [delegated goal](#delegated-goals) of its own in that repository (Delegated goals is switched on for you), starting from that folder's current branch. That delegated goal reads the main repository for the interface the parts share, lands nothing on this goal's branch — its summary is what the tasks after it read — and keeps its result on its own branch there until this goal is delivered, when it is delivered the same way: one pull request per repository, each saying which goal it is part of (see [Companion repositories](./getting-the-result.md#companion-repositories)). The main folder's own preview, checks and screenshots do not cover the companions; each delegated goal has its own. From the command line: `--also <path>`, once per folder.

### Follows

Under the repository, when it already has finished goals: **Follows** picks the earlier goal this one continues (or **Nothing — a new line of work**). The Clarifier then gets what that goal asked for, what was decided and how it ended, so you do not have to explain it again. Changing this picker leaves **Workflow suite**, **TDD** and **Ponytail** unchanged.

The card below the picker says where the new goal starts. If the earlier goal's work is already on your base branch (its pull request was merged), it starts from there. If not (a Local only goal, an unmerged pull request, a failed goal), it starts from the earlier goal's branch, and those changes go along in this goal's pull request. **Start from** switches between the two. Tick or untick **Bring its attachments** and **Keep its style direction** to take them along or leave them.

**Continue with a follow-up…** on a finished goal opens this form already filled in, including that goal's **Workflow suite**, **TDD** and current saved **Ponytail**. These take precedence over the folder defaults; see [Continue with a follow-up](./getting-the-result.md#continue-with-a-follow-up).

### Budget

**3 · Budget.** Limits the goal runs within. Reaching a limit pauses the goal and asks you; it never fails silently. The dollar figures and **Max cost (USD est.)** field below apply only to Claude. Codex uses the same time, concurrency and attempt limits, with dollar controls hidden.

| Preset | Limits |
|---|---|
| **Auto** (default) | No limit while Foundry plans. The Brief estimates cost and time and proposes a budget; you confirm it when you approve. |
| **Quick** | $3 · 30 min · 2 parallel · 2 attempts per task. For a small fix or a question about the code. |
| **Thorough** | $25 · 8 h · 3 parallel · 4 attempts per task. A feature with tests and review. |
| **Unlimited** | No cost or time limit. Attempts per task and parallel sessions still apply. |
| **Custom** | Set **Max cost (USD est.)**, **Max minutes**, **Parallel sessions** and **Attempts per task** yourself. |

If you are unsure, keep **Auto**. More in [Costs and usage](./costs-and-usage.md).

### Delivery

**4 · Delivery — what may the engine do with the result?** It starts from Settings → New goal defaults: **Local only** unless someone changed it there. **Local only** keeps the work on your computer. The other choices let Foundry push the work or open a pull request when the goal is done. Everything about this is in [Getting the result](./getting-the-result.md). You can change it later on the goal page.

### Advanced: skip Clarify

A link under the form. It runs the goal as one task with command checks you type (for example `bun test`), with no interview and no Brief. For people who know exactly which commands prove the work is done. You can ignore it.

### Not on the form: self-check

The self-check (Foundry opens the running result in a hidden browser and takes screenshots) is set in [Settings → Preview & self-check](./settings.md#preview--self-check) and can be switched on per goal on the Brief page (**How to run it**) or later on the goal page. See [While it runs](./while-it-runs.md#self-check).

### Schedule it

**Schedule…** next to the create button saves the form as a [Schedule](./schedules.md) instead of making a goal: every day, week or month Foundry makes a goal from it and runs it by itself. Uploaded files, references and an issue are not kept by a schedule; links are.

## After you press the create button

The button says **Create & clarify** (or **Create & run** if you skipped Clarify). If it is greyed out, the text next to it names the first thing missing: **Describe the goal**, **Select a repository folder**, **Repository is not ready (see above)**, **Sign in to Claude Code first: see Accounts** (or Codex, whichever coding agent you chose), **Choose a model preset (see above)**, or a Codex model that does not support the chosen reasoning.

This browser remembers the kind of goal, the budget and the finer delivery options (such as the merge method and the CI switches), so the next goal starts with them. The view, **Fast mode**, and the delivery mode and granularity start from Settings → New goal defaults. **Workflow suite**, **TDD** and **Ponytail** follow the folder and Follow-up rules above; the browser does not remember them as defaults.

Then you land on the goal's Brief page, and Foundry starts reading your project:

- If it has questions, you see **Round 1 — N questions**. Answer them: [Answering the interview](./answering-the-interview.md).
- If not, you see **Reading the repository…** with a live log of what it is reading (**Clarifying…** if Settings turned the interview off). This usually takes a few minutes. The page updates by itself when the Brief is ready.

Then read and approve the Brief: [Approving the Brief](./approving-the-brief.md). Nothing is built until you do.
