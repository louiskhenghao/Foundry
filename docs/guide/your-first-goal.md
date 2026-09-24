# Your first goal

> English · [中文](./your-first-goal.zh.md)

This page walks through the **New goal** form from top to bottom. Most fields can stay as they are. The only things you must fill in are what you want done and the project folder.

## Before you start

### Check the Setup page

Open **Setup** in the top bar. Foundry checks what it needs on this computer and shows a green or red line for each:

| Check | What it is | If it is red |
|---|---|---|
| **Claude Code CLI** | The program Foundry drives. | Copy the install command shown and run it, or ask whoever installed Foundry. |
| **Claude login** | Your Claude account. | Press **Sign in**. |
| **git** | Keeps every version of your files. | Copy the command shown. |
| **Bun runtime** | What Foundry itself runs on. | Copy the command shown. |
| **Required: …** | Skills Foundry's sessions need. | Press **Install**. |
| **GitHub CLI (optional)** | Only needed if Foundry should open pull requests for you. | Can stay yellow. |

When everything needed is in place the page says **Everything is in place** and offers **Create your first goal →**. **Re-run** checks again. If something is missing later, a red **Setup incomplete** banner appears with **Fix in Setup →**.

The card **Development workflow — Matt Pocock's engineering skills** lists the skills Foundry's workers follow (for example writing tests first). If some are missing, press **Install N missing**.

### Pick a repository folder

Foundry works in a *repository*: a project folder that git keeps history for. You do not need to know git. What matters:

- Any folder works. If it is not a repository yet, Foundry offers **Initialize git here** and does it for you.
- Foundry never changes the files in your folder while it works. It works in a copy next to it, the progress folder (see [While it runs](./while-it-runs.md#the-progress-folder)).
- If you have unsaved changes in the folder ("uncommitted changes"), that is fine. The Brief will ask about them.

## The New goal form

Press **New goal** in the top bar. The four numbered steps at the top right (**Goal**, **Repository**, **Budget**, **Delivery**) show how far you are. **Goal** turns green once you describe the goal, **Repository** once a ready folder is picked. **Budget** and **Delivery** are always green: their defaults work. The form starts with two cards of choices; the numbered cards **1** to **4** follow.

Several choices start from [Settings → New goal defaults](./settings.md#new-goal-defaults): the view, **Fast mode**, TDD, and the delivery mode and granularity. Change any of them here for this goal. A field you change on the page keeps your choice.

![The New goal form, with a goal described and a repository selected](images/new-goal.png)

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

Picking **Documents**, **Research**, **Images** or **Video** switches the view to **Simple**. Picking **Images** or **Video** also ticks **Fast mode**, unless you already changed it yourself.

For **Images** and **Video** a field appears: **Output folder**. When the goal finishes, the finished files are copied there. Press **Choose…** to pick a folder. It is optional; without it the files stay in the progress folder. Image goals also need an image key, see [Costs and usage](./costs-and-usage.md#image-goals-need-an-image-key).

### How much do you want to see

| View | What you get |
|---|---|
| **Simple** | One plain-language Brief. You answer its questions and approve. Afterwards you see a progress bar and what needs you. |
| **Expert** | Every control: Areas, the task graph, acceptance checks, attempt logs, merge resolution. |

The one picked at first comes from Settings (**Default goal view**). The work underneath is the same. You can switch any goal to the other view later with one click. This guide shows both.

### Fast mode

Ticked: once you approve the Brief, Foundry skips its own extra AI reviews. The acceptance checks you approved still run. Good for images, video and quick jobs. It also costs less.

Unticked (the default for code, unless Settings sets the pace to fast): Foundry reviews each task and the whole result on top of your checks, and can add fix tasks.

### Interview me before planning

Ticked: Foundry asks you at least one round of questions before it writes the Brief, unless nothing is left for you to decide.

Unticked: it asks only when your project cannot answer something, and goes straight to the Brief for small goals. Settings can change this default (see [Settings explained](./settings.md#new-goal-defaults)). More in [Answering the interview](./answering-the-interview.md).

### Effort

How hard every Claude session of this goal thinks. Press one of the buttons; hover a button for a short hint where there is one.

| Choice | When |
|---|---|
| **Default** | Most of the time. Uses the effort level set in Settings. |
| **low** | Small, obvious changes. Fast and cheap. |
| **medium**, **high** | In between. |
| **xhigh**, **max** | Hard work that touches many parts of the project. Slower and more expensive. |

### Models

Which [model preset](./settings.md#presets) this goal uses. **Default** uses the preset Settings picks for code, documents or media goals; the name after it, for example **Default · Production**, is that preset. It changes when you change the kind of goal. Pick **Max**, **Production**, **Balanced**, **Economy** (or one of your own) to override it for this goal only. Cheaper presets cost a fraction of Max.

### Engineering discipline (TDD)

Only in Expert view. TDD means writing a test first, then the code that makes it pass.

| Choice | Meaning |
|---|---|
| **required** | Workers must follow it, and the reviewer is told when they did not. The default, unless Settings says otherwise. |
| **preferred** | Suggested only. Simple view goals always use this. |
| **off** | Never mentioned. |

Docs, infra, research, image and video tasks never get a TDD rule, and a single task can switch it off in the Brief. With **Fast mode** ticked, TDD is off.

### What do you want done

The big text box, **1 · What do you want done?** Describe the goal as you would to a senior colleague: what you want, for whom, and anything that must or must not happen. Foundry will turn it into acceptance checks and a plan for you to approve, so you do not need to be complete.

### Attachments

Below the text box: **Attach screenshots, PDFs, files or links — or drop / paste them here.** Use **Files** to pick files, or **Link** to add a web address, then **Add**. You can also paste a screenshot straight into the page.

Every session of the goal can read the attachments. They are never added to your project. Documents are converted to text in the background; a small tag shows when that is done. You can add more attachments later from the goal page.

### Title

Optional. Without it, the first line of your description becomes the title. The title also names the progress folder.

### Repository

**2 · Repository.** Press **Select folder…** and pick the project folder, or type a path.

Foundry then shows what it found: the branch, whether there are uncommitted changes, the last saved version, the online copy (remote) if any, and who commits are made as. If the online copy has newer work than your folder, the card says where the goal will start from (normally the newer work), and **pull into my checkout** brings your own folder up to date too.

If the folder is not a repository, press **Initialize git here**. If you picked a folder inside a repository, Foundry offers the repository's top folder instead.

### Budget

**3 · Budget.** Limits the goal runs within. Reaching a limit pauses the goal and asks you; it never fails silently.

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

## After you press the create button

The button says **Create & clarify** (or **Create & run** if you skipped Clarify). If it is greyed out, the text next to it says why: **Describe the goal**, **Select a repository folder**, or **Repository is not ready (see above)**.

This browser remembers the kind of goal, the budget and the finer delivery options (such as the merge method and the CI switches), so the next goal starts with them. The view, Fast mode, TDD, and the delivery mode and granularity start from Settings → New goal defaults every time.

Then you land on the goal's Brief page, and Foundry starts reading your project:

- If it has questions, you see **Round 1 — N questions**. Answer them: [Answering the interview](./answering-the-interview.md).
- If not, you see **Reading the repository…** with a live log of what it is reading (**Clarifying…** if Settings turned the interview off). This usually takes a few minutes. The page updates by itself when the Brief is ready.

Then read and approve the Brief: [Approving the Brief](./approving-the-brief.md). Nothing is built until you do.
