# Costs and usage

> English · [中文](./costs-and-usage.zh.md)

Foundry runs on your Claude subscription or API account. It spends only when a Claude session runs. Everything it does in git, running your tests, preparing folders and reviewing check results is free — it costs time, not money.

## What costs money

| Session | Limit per session |
|---|---|
| Clarify (exploring your repository, the interview, writing the Brief) | $6 per turn |
| Draft with AI (one task or area) | $2 |
| Revise with answers | $3 |
| Task attempt | $10 by default (Settings → Models & limits), and never more than what is left of the goal's budget |
| Task review | $0.80 |
| Merge attempt (combining two tasks that touched the same lines) | $2 |
| Final goal review | at least $6, up to the task-attempt limit |
| Completion docs (only if you turned them on) | $3 |
| Style sample (one image) | $2 per click, at most 8 per direction |
| Suggest a hint (Inbox) | $1 |
| Milestone feedback ("Turn into a plan") | $0.50 |

Which model each of these uses — and so how much it really costs — is set by the goal's **model preset**. See [Settings explained](./settings.md#models--limits).

## Ways to spend less

- **Pick a cheaper preset.** Balanced or Economy costs a fraction of Max. You can choose per goal on the New goal form, or per goal type in Settings.
- **Use fast pace** for routine goals. It skips Foundry's own extra reviews; the checks you approved still run.
- **Lower the effort** on the New goal form for simple goals.
- **Set a budget.** A goal stops and asks you when it reaches its cost or time limit.
- Resumed sessions are cheaper than new attempts, because they reuse what the session already read. Foundry resumes first for that reason.

## Where to see what was spent

- **Each goal** shows its running cost at the top of its page, and each task shows its own.
- **Usage** (top bar) shows spending over time, by kind of session and by model, and how close you are to your plan's limits.
- When a usage limit is reached, Foundry pauses every goal and continues when the limit resets. A banner says when.

## Image goals need an image key

Image generation only works when Foundry has an image API key: an OpenAI-compatible key, or a Gemini key. Add it in **Settings → Tools & keys**; it applies to the next session, no restart. Without a key, image tasks produce hand-drawn SVG or HTML renders of much lower quality — the Brief tells you so before you approve.
