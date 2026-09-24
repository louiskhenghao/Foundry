# Approving the Brief

> English · [中文](./approving-the-brief.zh.md)

The Brief is the plan. Foundry writes it after reading your project and hearing your answers. Nothing is built until you approve it, and after you approve, Foundry works on its own.

You can edit almost everything on the Brief. Take five minutes: this is the cheapest moment to change your mind.

![The Brief page in Expert view: Understanding, Decisions, Areas and the plan](images/brief.png)

## Simple view and Expert view

The Brief opens in the view you chose on the New goal form. Switch with **Expert view** or **Simple view** at the top; the choice is remembered for this goal in this browser.

- **Simple view** shows what you need to decide: what Foundry understood, its questions, its assumptions, what you will get, and the price. See [The Simple view of the Brief](#the-simple-view-of-the-brief) at the end of this page.
- **Expert view** shows everything, in this order: the header, **Understanding**, **Questions**, **Assumptions**, **Decisions**, **Areas**, **Plan**, **Goal acceptance**, **How to run it**, **Completion**, the estimate and budget, and the buttons. The rest of this page follows that order.

## The top of the page

- **← Goal** goes to the goal's page.
- The badge next to the title reads **approve brief** while the Brief waits for you.
- Under the title: the project folder, the branch the goal starts from, and the goal's own branch.
- A small line says which version of your project Foundry read, for example "Explored origin/main (your local main was 3 behind)". If it warns that the remote was not fetched and you know others changed the project since, press **Re-run Clarify**.
- **Re-run Clarify** throws this Brief away, fetches the latest version of your project and plans again. Attachments, budget and delivery settings are kept. Your decisions are handed to the new Clarify as text: it plans with them and does not ask again, but they do not come back as items in the **Decisions** card. You land on the goal page while it works.
- The **goal** panel shows your original description.

## Understanding

What Foundry understood, in its own words. Read this first: if it is wrong, everything after it is too.

- **pull request title**: one line that names the whole goal, in the form `feat(scope): what this goal adds`. It becomes the title of the pull request if you deliver one. You can leave it.
- The text box on the left is editable; the right side shows how it reads.

## Questions

**Questions (N blocking unanswered)** lists what Foundry could not settle from your project or the interview. For each:

- Click one of the suggested answers. The first one, marked **★**, is Foundry's recommendation.
- Or type your own answer in the box.
- A question marked **blocking** must be answered before you can approve.

Answering a question makes it a Decision (see [Decisions](#decisions) below).

### Style directions

For goals with a look (a web page, an app, a poster, a video), one question may show **style cards** instead of plain answers. Each card is one visual direction: a colour strip, the typefaces, a few keywords and a short description. The first carries **★ recommended**.

- **Pick a card** by clicking it. That is your answer to the question.

### Generate a sample

Once a card is picked, **Generate a sample (~$1)** makes one real image in that style so you can see it before anything expensive happens. It takes a minute or two. Press **Regenerate (~$1) — earlier ones are kept** for another; all samples stay. A direction can have at most 8 samples.

### Set the reference image

Click a sample to see it large, then press **Use as the reference image**. Every worker must then match that image. **Unpick reference image** undoes it. The card says **reference image set — workers will match it**.

Whatever direction you pick binds every task that produces something visible. Tasks with no look (server code, data, documentation) ignore it.

## Assumptions

**Assumptions (accepted unless you uncheck)**: things Foundry will take as true unless you say otherwise, for example "the existing login stays as it is". Leaving one ticked means you agree. Untick one that is wrong; it is crossed out and becomes a Decision ("assumption rejected").

## Decisions

**Decisions (N)** lists every answer you gave and every assumption you rejected, including your interview answers. Every worker, reviewer and pull request receives them word for word.

A green dot means the plan already takes the decision into account. An amber dot means you decided it after the plan was written, so the tasks and checks below may not reflect it yet. The card says how many are **not yet applied to the plan**.

### Revise with answers

Press **Revise with answers** to have Foundry re-read the Brief and your project in the light of your decisions. It proposes changes: tasks added, changed or dropped, checks, Areas, a new understanding. This takes a few minutes and costs up to $3. You can add **notes for the AI (optional)** first.

The proposal appears as a list. Accept each item with ✓, discard it with ✗, or press **Accept all**. Nothing changes until you accept. If Foundry finds nothing to change, press **OK, mark applied**.

### No changes needed

If the plan already fits your decisions, press **No changes needed** to stop the amber warning.

You can also approve with decisions not applied. Workers still receive them; the plan just was not rewritten for them.

## Areas

**Areas (N)** are the parts of the product this goal covers: a role or app ("student portal", "teacher portal") or the shared groundwork they all need. Every task belongs to one Area.

- Rename an Area or change its one-line description in place.
- **Add Area** adds one.
- The trash icon deletes one. Its tasks become unassigned, and its questions are removed.
- An Area with no tasks is outlined in red: that part would not be built. Press **Draft tasks for this Area** to have Foundry propose one to six tasks for it, or delete the Area.

## Plan

**Plan (N tasks · M stages)** is the work, task by task.

### Stages and the graph

At the top is a graph of the tasks, coloured by Area, with arrows for "this waits for that". Below it the tasks are listed by **Stage**. Tasks in one stage do not depend on each other and can run at the same time (**Stage 2 · 3 in parallel · after the previous stage**). The stages are a way to read the plan: in fact a task starts as soon as the tasks it waits for are done, as far as the goal's parallel limit allows.

With several Areas, the chips above the list filter it (**all Areas** shows everything). A very large goal gets a yellow note suggesting you split it into one goal per Area.

### A task

Each row shows the task's number and title, small tags for its kind and scenario (and its difficulty, unless it is standard), its Area, and how many checks it has. **After** and **Next** show which tasks it waits for and which wait for it. Click a row to open the task; **Add task** adds one; the trash icon removes a task and its checks.

Inside a task you can change:

| Field | What it is |
|---|---|
| Title | What the task does, as a short instruction ("add teacher dashboard"). |
| **Area** | Which part of the product it belongs to. |
| **Kind** | See below. |
| **Scenario** | See below. |
| **difficulty** | See below. |
| **TDD** | **inherit** follows the goal's setting; **off** switches test-first off for this task. |
| **Commit scope** | The word in brackets of its commit message, `feat(scope): …`. Blank uses the Area's short name. |
| **Spec** | What to change, where, and how to know it is done. |
| start files | Files the worker should look at first, separated by commas. Optional. |

### Kind

| Kind | Use for |
|---|---|
| **feature** | Something new. |
| **bug** | A fix. The worker reproduces the problem first. |
| **refactor** | Restructuring without changing behaviour. |
| **research** | Finding something out. |
| **chore** | Setup, dependencies, housekeeping. |

The kind decides which working method the worker follows (for example tests first for features).

### Scenario

Where the work happens: **frontend**, **backend**, **fullstack**, **data**, **mobile**, **infra**, **docs**, **research**, **image**, **video** or **general**. It decides which specialist skills the worker gets: design skills for frontend and fullstack work, image skills for image work, and so on.

### Difficulty

Difficulty picks which model does the task, from the goal's [model preset](./settings.md#presets). Foundry rates each task; you can change it.

| Difficulty | Examples | Model used |
|---|---|---|
| **simple — config, copy, small component** | a setting, text changes, a file from a template, one small component | the preset's **Simple tasks** model (usually the cheapest) |
| **standard — typical feature work** | a new page with its form, an API endpoint with tests, most tasks | the **Standard tasks** model |
| **complex — cross-cutting, risky** | changes across many parts, architecture, data migrations, concurrency, large refactors | the **Complex tasks** model (usually the strongest) |

Raising a task to complex makes it more likely to succeed on the first try, and more expensive. The last attempt of a task that keeps failing runs on the Complex model anyway, when the task is allowed two or more attempts (see [Settings](./settings.md#last-attempt-on-the-complex-task-model)).

### Milestones

Tick **milestone** on a task after which there is something to see or try for the first time: the first screen that opens, the first playable round. Foundry marks one to three per goal; you can add or remove them.

A text box appears for **what to look at**: what to open, try and judge when this lands, for example "open the game, play one round, try the revive button". That text is shown to you when the goal pauses.

When a milestone task lands, Foundry starts nothing new, lets running tasks finish, starts the preview and waits for you. What to do then is in [When Foundry needs you](./when-foundry-needs-you.md#a-milestone-is-ready-to-look-at).

### Parallel and runs after

- **runs after …** (or **runs first (no dependencies)**) opens a list: tick the tasks this one must wait for. A loop ("A after B, B after A") is accepted, but the graph flags it and **Approve & run** stays greyed out ("task graph has a cycle") until you remove it.
- **parallel**: ticked means the task may run at the same time as other ready tasks. Untick it for a task that must not start while others run: it waits until nothing else of the goal is running. Once it has started, parallel tasks can start beside it.

### Draft with AI

Wrote only a title? Press **Draft with AI** next to **Spec**. Foundry writes the spec, fills the fields and proposes acceptance checks, from the title, the Brief and your project. If the task already has a spec, the button is **Suggest acceptance** and only proposes checks; your text is never overwritten. Either way it costs up to $2, and you accept each proposed item with ✓ or all at once with **Accept all**.

### Acceptance for a task

**Acceptance for this task** lists checks that run after every attempt at this task. The task is done when its Must checks pass. **Add check** adds a command check or a reviewer check (explained below). The arrow icon moves a check up to goal level, where it is judged on the combined result.

## Goal acceptance

**Goal acceptance (N)** lists the checks judged on the whole result, once every task is done. This is how "finished" is defined.

### Must and Stretch

Each check has a badge. Click it to switch.

- **must**: something you asked for. All must checks pass → the goal is **done**.
- **stretch**: an extra Foundry proposed. Must and stretch pass → **over-delivered**.

Foundry never adds scope on its own: a stretch check exists only because it is in the Brief you approved. Delete any you do not want.

### Command and Reviewer checks

| Type | How it is judged | Good for |
|---|---|---|
| **Command** | A command runs in the project; it passes when the command succeeds. Example: `bun test`. | Anything a test or build can prove. |
| **Reviewer** | A Claude session reads the change and judges it against the rule you write. Example: "the settings page has a dark mode switch that persists". | Things a test cannot easily prove: wording, layout, completeness. |

With several Areas, a goal-level check can belong to one Area or to **all Areas**. **whole goal** means it is judged on the combined result; picking a task instead moves it into that task. A check without a name, command or rule is outlined in red and blocks approval.

## How to run it

**How to run it** tells Foundry how to start the result, for the preview at milestones and for the self-check. Leave it empty for most projects: Foundry reads the start script from `package.json`.

| Field | What it is |
|---|---|
| **Platform** | **nothing to start**, **web (browser)**, or **expo (React Native via Expo web)**. |
| **Install** | The install command, for example `npm install`. |
| **Start command** | For example `npm run dev -- --port {port}`. `{port}` is where Foundry puts the port. |
| **URL** | Where the result opens, for example `http://localhost:{port}`. |

**Use package.json** forgets these fields and goes back to reading `package.json`.

## Completion

**Completion** (Expert view only) says what runs by itself when the goal finishes. The defaults follow the kind of work; change them here.

- **Refresh the knowledge graph**: updates the code map some tools use, after delivery.
- Document chips: **PRD** (what was asked and what was built), **README update**, **Changelog**, **Confirmation sheet** (for someone else to confirm the decisions). Click a chip to switch it on or off.

Documents are written after the final review passes and saved on the goal's branch, so they ship with the work. They cost up to $3. More in [Getting the result](./getting-the-result.md#completion-extras).

## Estimate and budget

The card shows **Estimated cost** and **Estimated time**, with your budget next to them.

With the **Auto** budget, the card is titled **Estimate → proposed budget**: Foundry proposes twice the estimate as the limit, rounded up, and never less than $3 and 30 minutes. Edit **max cost $** and **max minutes**, press **Keep unlimited** for no limit, or **Use estimate ×2** to go back to the proposal. With a budget you set yourself, the card warns in yellow if the estimate is higher. The change is applied when you approve.

Reaching a limit never destroys work: the goal pauses and asks you. See [When Foundry needs you](./when-foundry-needs-you.md#the-budget-ran-out).

## Delivery is not on this page

What happens to the result (keep it local, push it, open a pull request) was chosen on the New goal form. To change it, use the **Delivery** tab of the goal page, before or after the goal finishes. See [Getting the result](./getting-the-result.md).

## Approve

At the bottom:

- **Approve & run** starts the work. If you changed the budget, the button shows the new one. It is greyed out while something blocks approval; the grey text next to it says what (for example "1 blocking question unanswered", "task graph has a cycle", "2 incomplete checks").
- **Save edits** keeps your edits without approving, so you can come back later.
- **Cancel goal** gives up on the goal.

Yellow text warns about Areas with no tasks and decisions not applied. You can approve anyway.

After you approve, the Brief can no longer be edited, and you go to the goal page: [While it runs](./while-it-runs.md).

## The Simple view of the Brief

The Simple view shows the same Brief in plain words:

| Card | What to do |
|---|---|
| **What I understood** | Read it. If it is wrong, answer the questions accordingly or switch to Expert view to edit it. |
| **Please answer (N)** or **Questions** | Pick an answer (★ is recommended) or type your own. Questions marked **needed** must be answered. Style cards work as above. |
| **I will assume… (untick anything that is wrong)** | Untick what is wrong. |
| **What you will get (N pieces of work)** | The tasks, grouped by Area. To change them, open **Expert view**. |
| **Price** | The estimate. Type the dollar amount at which Foundry should stop and ask you (blank means no limit). |

Then press **Looks good — go** to approve, **Save** to come back later, or **Cancel** to give up. If your answers change what should be built, open **Expert view** and press **Revise with answers** first.
