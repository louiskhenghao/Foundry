# Schedules

> English · [中文](./schedules.zh.md)

Some goals are the same every time: upgrade the dependencies and run the tests, audit the repository, refresh the docs. A **Schedule** is the New goal form saved with a time: every day, one weekday a week, or one day a month, Foundry makes a goal from it and runs it, with nobody at the keyboard. The **Schedules** page in the ⚙ menu lists them.

![The Schedules page: a weekly upgrade that approves its own Briefs, when it fires next, and what its last run came to](images/schedules.png)

## Making one

Fill in the New goal form as you would for a goal: the description, the folder, the coding agent, the workflow switches, the delivery, the budget. Then press **Schedule…** instead of **Create & clarify**:

- **Name**: each run is a goal titled after it, with the day it ran.
- **When**: **every day**, **every week** on a weekday, or **every month** on a day (1 to 28, so every month has it), at a time of this computer's clock.
- **Approve each run's Brief for me** (on by default): the interview is skipped, milestones do not pause, and Foundry approves the Brief itself once it is written, with the budget the Brief proposes when the budget is **Auto**. Off: each run is an ordinary goal, and its interview and Brief wait for you.

**Save schedule** keeps the form as the schedule's recipe. Links among the attachments are attached to every run; uploaded files, references and an issue are not kept, since they can only be given once.

Start with a **Quick** or a fixed budget: a schedule spends money while you are away, and the budget is what stops a run that grows. See [Costs and usage](./costs-and-usage.md).

## What a run is

A run is a goal like any other: it has a Brief, tasks, checks, a review and a delivery, and it is told what earlier goals in the folder learned ([Learnings](./learnings.md)). The goal's page says **From schedule** under the title; the goal list shows a ⏰ tag. When a run needs you, it lands in the Inbox and on your channels like any goal; a Brief with a question only you can answer waits for you even when the schedule approves its Briefs.

One run at a time: while the previous run is still going, the schedule skips its turn and says so on the page. A run Foundry missed while it was off fires once when it is back, late, and the next counts from then.

## The Schedules page

Each schedule shows when it fires next and what its last run came to, with a link to that goal. **Run now** fires it at once (refused while the previous run still goes). **Edit** opens the New goal form filled with the recipe; **Save schedule** writes it back, and the cadence counts from the edit. **Turn off** stops it from firing; **Turn on** counts from then. **Delete** removes the schedule and leaves the goals it made.

The **Schedule fired** switch in [Settings → Notifications](./settings.md#notifications) sends a message when a schedule fires: the goal it made, or why none was made. From the command line, `foundry schedules` lists them and `foundry schedules run <id>` fires one.

Schedules belong to this computer: [Transfer](./moving-to-a-new-computer.md) does not carry them.
