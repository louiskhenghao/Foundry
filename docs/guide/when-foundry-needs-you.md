# When Foundry needs you

> English · [中文](./when-foundry-needs-you.zh.md)

Once you approve the Brief, Foundry works on its own. It stops and asks you only in the situations on this page. Each one shows up in the **Inbox** (the number in the top bar) and on the goal's page. If you set up notifications, you also get a Telegram or Discord message: the **Needs you** switch covers everything in the Inbox, and **Interview round**, **Goal finished**, **Delivery**, **Usage pause** and **New version** have their own switches. See [Settings → Notifications](./settings.md#notifications).

Everything else you see while a goal runs is normal and needs nothing from you. The second half of this page explains those messages.

## The seven reasons Foundry stops

### A piece could not be finished

**Inbox:** *Retries exhausted* — "used N of M attempts; Must checks still failing".

Foundry tried a task several times and its acceptance checks still fail. You can:

- **Suggest a hint** — Foundry reads the task, the failing checks and the last attempt, explains the cause in plain words and fills in a hint. You read it and press **Retry with hint**.
- **Let AI handle it** — the same, but when the answer is "retry with this hint" it is applied straight away.
- **Retry with hint** yourself — write what to do differently ("use the existing date helper", "the test file is in tests/, not spec/") and choose how many more attempts to allow.
- **Skip task (dependents continue)** — move on without it. Tasks that depended on it still run; the final review judges the whole.
- **Abort goal** — stop the whole goal. It ends as failed; the work so far stays on its branch.

When a task is allowed two or more attempts, its last attempt runs on the preset's **Complex tasks** model. So does every retry you grant. Settings can turn this off: [Last attempt on the Complex-task model](./settings.md#last-attempt-on-the-complex-task-model).

The same card with the line "The engine itself hit an error (not the model)" means Foundry's own code failed three times in a row on this task. It is not the AI's fault. Retry once the cause is fixed, or skip the task.

### Two pieces changed the same lines

**Inbox:** *Retries exhausted* with a **merge conflict** tag — lists the files and why each merge attempt failed.

Two tasks edited the same code and Foundry could not combine them automatically. Press **Resolve manually →** to see both sides of each file, take one side, edit the result or open it in your editor, then **Finish merge**. You can also *Retry with hint* ("keep both, the new field goes after the old one"), *Skip task (dependents continue)* or *Abort goal*.

### The final review failed

**Inbox:** *Retries exhausted*, with no task named — lists the failing checks and the reviewer's notes.

Everything was built, but the reviewer found acceptance checks that the combined result does not meet, even after its own fix round.

- **Retry with hint** turns the reviewer's findings into fix tasks (your hint goes with them), runs them, then reviews again.
- **Accept as-is (finish goal)** finishes the goal with those checks waived.
- **Abort goal** stops the goal; it ends as failed.

### It wants to do something outside your computer

**Inbox:** *Wants to leave the workspace*.

A session tried to push, create or merge a pull request, make a release, publish a package, deploy, change the git remote, or run cloud tools such as `terraform apply`, `kubectl apply`, `docker push` or `aws s3`. Foundry blocked it. **Approve & run once** runs that one command for it; **Deny** keeps it blocked. (Pushing and opening pull requests are normally done by Foundry itself at delivery, following the policy you chose — see [Getting the result](./getting-the-result.md).)

### A tool was denied

**Inbox:** *Tool denied* — "Claude refused one of the tools it needed."

A task used all its attempts, and Claude Code refused a tool the task needed (not one of the commands above). Trying again the same way would fail the same way. You can **Suggest a hint** or **Let AI handle it** as above, **Retry with hint** (for example "do it without the web search"), **Skip task (dependents continue)** or **Abort goal**.

### The budget ran out

**Inbox:** *Budget exceeded*.

The goal reached the cost or time limit you set. **Raise budget** (empty fields double it) or **Abort goal**.

### A milestone is ready to look at

**Inbox:** *Have a look*, with **Continue** and **Look & give feedback →** (which opens the goal page). **Goal page:** a card *Have a look — task name* with what to look at and the running preview.

The Brief marked this task as a milestone, so the goal paused after it landed. Nothing else starts until you respond. On the goal page you find the preview (start, stop, open), the self-check's screenshots if it is on, and any files produced so far.

- **Continue** if it looks right.
- Or write what you saw and press **Turn into a plan**. Foundry proposes what your note becomes — a *hint* for the remaining tasks, *fix tasks* for what is missing or wrong (the milestone then opens once more so you can check), or a *decision* every later task must follow. Change the kind if it guessed wrong, then **Confirm & continue**.

A milestone pauses at most twice. The second time the card reads **Second look — task name**; anything you write then becomes a hint, and the goal does not pause there again.

### Before it starts: questions on the Brief

**Where:** the Brief page, before the goal starts. These are not Inbox items.

The plan has a question it could not settle from your repository. Pick one of the suggested answers (the first is Foundry's recommendation) or type your own. If your answer changes the plan, press **Revise with answers** before approving.

### Also on the goal page: interview rounds

Before the Brief exists, the goal page may show **Round N — K questions**. This is not a problem: Foundry is asking what only you can decide before it plans. Pick an option (the first is recommended) or type your own; **Accept all recommended** answers the round in one click; **Enough — write the Brief** stops the questions. See [Answering the interview](./answering-the-interview.md).

## Messages that need nothing from you

### In a task's live log

| You see | What it means |
|---|---|
| `● session 1a2b3c4d · claude-…` | A session started. A second `●` in the same attempt means the session was resumed (a *continuation*), which is cheaper than starting over. |
| `[reviewer] …` after the work finished | The task reviewer is checking the change. |
| `[reviewer] ✗ Output does not match required schema …` | The reviewer sent its verdict in the wrong shape and resends it. Harmless. |
| `■ error_max_turns`, `■ error_max_budget_usd`, `■ killed_timeout` | The session hit a limit. Foundry resumes it with a fresh allowance, up to twice, before starting a new attempt. |
| `⏳ rate limit rejected` | Your Claude plan's usage limit was reached. Foundry pauses and continues when it resets. Nothing is lost. |
| `⏱ sub-agent still working · 3m 30s` | A helper (for example the planner) is still busy. Long pauses in the log are normal while this line updates. |
| `[claude-code:unrecognized_model] …` | Your Claude Code is older than the model you picked. The session works; updating Claude Code removes the line. |

### Task states

A task moves through **pending** (waiting for the tasks it depends on) → **ready** → **running** → **observing** (checks and review) → **merging** (joining the goal's branch) → **done**. After a failed attempt, a task goes from **observing** back to **ready** for its next try.

| You see | What it means |
|---|---|
| *ready · "X is not parallelizable; it starts when Y finishes"* | The Brief said this task must run alone. It waits. |
| *ready · "X waits for Y: both touch …"* | Two tasks declared the same files; this one waits so they do not collide. |
| *ready · "retry 2/3"* | A normal new attempt after a failed one. It starts running shortly. |
| *running · "continuation 1: …"* | The same session resumed after hitting a limit or with checks still failing. Not a retry. |
| *merging* for a while | Foundry is joining the task into the goal and re-running its checks. |
| *done · "no changes to commit"* | The work was already on the goal's branch. |
| *blocked* | Something needs you — see the Inbox. |
| *skipped* | You skipped it; tasks after it continue. |
| *failed · "dependency failed"* | A task it depends on failed, so this one cannot run. |

### Attempt markers

| You see | What it means |
|---|---|
| `#3 ↻1` | Attempt 3, resumed once. Cost and turns add up across the resumptions. |
| `interrupted` | Foundry restarted during the attempt; it resumes by itself without using up a retry. |
| `passed` but the task is still merging | The work passed its checks and is being joined into the goal. |

## Things only a person can catch

- **Changes that each work but not together.** Both sides pass their own tests but the combination is wrong. The final review and its fix tasks usually catch this; if not, a milestone look or the result itself will show it.
- **A task that edits a file it did not mention.** Foundry cannot see the overlap in advance; the resulting conflict comes to you as a merge conflict if its automatic attempts fail.
- **A test suite that was already failing.** Tasks still land, but the goal cannot finish until the suite passes — the final review creates a fix task, or you fix it.
