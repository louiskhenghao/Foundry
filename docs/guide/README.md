# What Foundry does

> English · [中文](./README.zh.md)

## In five lines

Foundry is a web app that runs on your own computer, at <http://127.0.0.1:4111>.
You describe a goal in plain words: a feature, a fix, a document, a report, some images.
Foundry reads your project, asks what only you can decide, and writes a plan called the **Brief**.
Once you approve the Brief, it drives your chosen coding agent, Claude Code or Codex, to do the work, checks it and reviews it.
You get the finished work on a separate branch, and Foundry only pushes or publishes it under the delivery policy you chose.

![The Goals page: six goals, one in each state, each with its tasks and its cost against the budget](images/goals.png)

## The life of a goal

1. **You describe it.** Press **New goal**, write what you want, pick the project folder, press **Create & clarify**. See [Your first goal](./your-first-goal.md).
2. **Foundry asks.** It reads the project first. If something is open that only you can decide, it asks in short rounds of questions, each with a recommended answer. Small, clear goals skip this. See [Answering the interview](./answering-the-interview.md).
3. **You approve the Brief.** The Brief says what Foundry understood, what it will build, how it will check the result, and its time estimate (plus a cost estimate for Claude). Change what you want, then approve. See [Approving the Brief](./approving-the-brief.md).
4. **It works.** Foundry splits the goal into tasks and runs them, several at once when they do not depend on each other. Each task is checked and reviewed before it joins the rest. See [While it runs](./while-it-runs.md).
5. **Milestones pause for a look.** If the Brief marked a task as a milestone, Foundry stops after it and shows you the result running. You press **Continue**, or say what to change.
6. **Final review.** When every task is done, a reviewer checks the whole result against the acceptance checks you approved. It fixes what it can.
7. **You get the result.** The work is on its own branch in your project, and in a folder you can open. If you chose it, Foundry also pushes it or opens a pull request. See [Getting the result](./getting-the-result.md).

Between steps 3 and 7 Foundry only stops for a short list of reasons. They are all in [When Foundry needs you](./when-foundry-needs-you.md).

## Words you will meet

| Word | What it means |
|---|---|
| **Coding agent** | Claude Code or Codex, chosen when creating a goal and fixed for its lifetime. Accounts and permissions are independent. |
| **Goal** | One thing you want done, written in plain words, in one project folder. |
| **Brief** | The plan Foundry writes and you approve before any work starts. |
| **Area** | A part of the product the goal touches, for example "student portal", "teacher portal", or "shared groundwork". Every task belongs to one. |
| **Task** | One piece of work in the plan. A goal usually has a handful. |
| **Milestone** | A task after which there is something to see or try for the first time. The goal pauses there so you can look. |
| **Inbox** | The list of things waiting for you, with a number in the top bar. |
| **Progress folder** | The folder where the work happens, next to your project: `<project>-foundry/<goal>/`, or under the folder set in Settings. It is named after the goal's title (up to its first punctuation mark, at most 40 characters) plus the last 6 characters of the goal's id. You can open it at any time. |
| **Model preset** | Which model does each job (planning, tasks, reviews). Each coding agent has its own Max, Production, Balanced and Economy presets. Codex also captures each role’s reasoning effort. |

The full glossary, for the curious, is `CONTEXT.md` in the Foundry repository.

## The pages of this guide

1. [What Foundry does](./README.md): this page.
2. [Your first goal](./your-first-goal.md): the Setup page, and the New goal form from top to bottom.
3. [Answering the interview](./answering-the-interview.md): the questions Foundry asks before it plans.
4. [Approving the Brief](./approving-the-brief.md): every part of the plan, and what you can change.
5. [While it runs](./while-it-runs.md): the goal page, tasks, logs, the progress folder, previews and milestones.
6. [When Foundry needs you](./when-foundry-needs-you.md): the only reasons it stops, and what to press.
7. [Getting the result](./getting-the-result.md): branches, pushes and pull requests, and media files.
8. [Settings explained](./settings.md): every Settings section in plain words.
9. [Costs and usage](./costs-and-usage.md): what costs money and how to spend less.
10. [Moving to a new computer](./moving-to-a-new-computer.md): carrying settings, keys and goals to another Foundry.
11. [FAQ](./faq.md): short answers to common questions.

**Help** in the ⚙ menu at the right of the top bar shows this guide inside Foundry. The same menu holds **Settings**, **Setup**, **Transfer**, the light or dark mode, and the version you run: a red dot on the ⚙ button marks a newer one, and pressing the version opens **About & updates**.
