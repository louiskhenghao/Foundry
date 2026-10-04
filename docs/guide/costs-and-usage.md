# Costs and usage

> English · [中文](./costs-and-usage.zh.md)

![Codex weekly-only quota — demonstration data](images/usage-codex.png)

## Codex accounting

**Codex account quota** reads the signed-in ChatGPT account through the native CLI, separately from local activity totals. It shows every returned quota group with used percentage, window duration and reported reset time. **Refresh quota** reads metadata without inference; ordinary polling uses a 60-second cache. **Reported ordinary usage allowance** is the CLI's explicit allowed/blocked/unknown signal. Percentages and past reset times do not prove recovery. Missing quota or reset data stays unknown; a read failure is shown rather than replaced with zero. Accounts also shows the email and plan when the native CLI supplies them.

There is no fixed five-hour/weekly pair. A weekly-only account shows only **Weekly limit**; accounts that report both windows show **5-hour limit** and **Weekly limit**. Names come from the reported duration, regardless of whether Codex calls the slot primary or secondary. Other durations are shown as returned; unknown duration stays unknown. Absent windows are not shown or filled with zero. Multiple quota groups remain separate. The header uses these same account windows and never assumes `5h`; if several groups are all weekly it shows **2 weekly limits**, for example.

Use the **Usage backend** selector to view each provider independently. Counts include only Foundry sessions. **Foundry activity · last 7 days** is a local reporting period, separate from the account limits. It has no quota status or reset countdown. Dollar cost, turn count and skill-invocation telemetry are unavailable in this adapter; unavailable never means free or unused.

Codex USD caps are removed on creation, Brief approval and budget increases. Timeouts, tool-call allowance, attempts and concurrency remain effective. Its turn-cap setting counts tool calls, not model turns. A detected usage-limit error pauses only that provider; without a reset signal Foundry retries after five minutes, which is not a claim that the account quota has reset.


Foundry runs on your Claude subscription (Pro or Max). It spends only when a Claude session runs. Everything it does in git, running your tests, preparing folders and reading check results is free — it costs time, not money.

## What costs money

| Session | Limit per session |
|---|---|
| Clarify (exploring your repository, the interview, writing the Brief) | $6 per Clarify session. Each interview round, and each repair of the Brief, is its own session. |
| Draft with AI (one task or area) | $2 |
| Revise with answers | $3 |
| Task attempt | $10 by default (Settings → Models & limits), and never more than what is left of the goal's budget |
| Task review | $0.80, plus up to $0.20 when its verdict has to be asked for again |
| Merge attempt (combining two tasks that touched the same lines) | $2 |
| Final goal review | at least $6, up to the task-attempt limit, plus up to $2 when its verdict has to be asked for again |
| Completion docs (only if you turned them on) | $3 |
| Style sample (one image) | $2 per click, at most 8 per direction |
| Suggest a hint (Inbox) | $1 |
| Milestone feedback ("Turn into a plan") | $0.50 |
| Housekeeping: deciding what kind of goal it is (when set to **Auto**), or summarising a very long check output | $0.10 each |
| **Sync models** and **Test** in Settings (one tiny session per model) | $0.50 per model |
| **Refresh signal** on the Usage page | $0.05 |

Which model each of these uses — and so how much it really costs — is set by the goal's **model preset**. See [Settings explained](./settings.md#models--limits).

## Ways to spend less

- **Pick a cheaper preset.** Balanced or Economy costs a fraction of Max. You can choose per goal on the New goal form, or per goal type in Settings.
- **Use fast pace** for routine goals. It skips Foundry's own extra reviews; the checks you approved still run.
- **Lower the effort** on the New goal form for simple goals.
- **Set a budget.** A goal stops and asks you when it reaches its cost or time limit.
- Resumed sessions are cheaper than new attempts, because they reuse what the session already read. Foundry resumes first for that reason.

## Where to see what was spent

- **Each goal** shows its running cost at the top of its page, and each task shows its own.
- **Usage** (top bar) shows spending over time, by kind of session and by model. For each of your plan's usage windows it shows its status (**allowed**, or a warning when it gets close to the limit) and when it resets, not a percentage; for exact percentages, run `/usage` in Claude Code. **Refresh signal** runs one tiny session to update that status.
- When a usage limit is reached, Foundry pauses every goal and continues when the limit resets. A banner says when.
- **MiniMax** (video and narration through mmx) has its own card at the bottom of **Usage**, read when the page opens: what is left of each model's window and week on a Token Plan, or the balance of a pay-as-you-go key. **Refresh** reads it again. When under 10% of a window is left, or the balance is under 1, the usage pill in the top bar shows an amber dot. The card only appears when mmx is installed.

## Image goals need an image key

Image generation only works when Foundry has an image API key: an OpenAI-compatible key, or a Gemini key. Add it in **Settings → Tools & keys**; it applies to the next session, no restart. Without a key, image tasks produce hand-drawn SVG or HTML renders of much lower quality — the Brief tells you so before you approve.
