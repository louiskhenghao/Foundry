# Foundry 什么时候需要你

> [English](./when-foundry-needs-you.md) · 中文

Brief 一经批准，Foundry 就会自己往下做。只有本页列出的情况才会停下来问你。每一种都会出现在 **Inbox**（顶栏上的数字）和 goal 页面上。如果你设置了通知，还会收到 Telegram 或 Discord 消息：**Needs you** 开关管 Inbox 里的所有事项，**Interview round**、**Goal finished**、**Delivery**、**Usage pause** 和 **New version** 各有自己的开关。见 [Settings → Notifications](./settings.zh.md#notifications)。

goal 运行时你看到的其它信息都属正常，不需要你做什么。本页后半部分解释这些信息。

## Foundry 停下来的八种原因

### 某一部分做不完

**Inbox：** *Retries exhausted* ——"used N of M attempts; Must checks still failing"。

Foundry 把一个任务试了好几次，验收检查仍然没过。你可以：

- **Suggest a hint** —— Foundry 读任务、失败的检查和上一次尝试，用大白话说明原因，并填好一条提示。你看过后按 **Retry with hint**。
- **Let AI handle it** —— 同上，但如果结论是"带着这条提示重试"，就直接执行。
- 自己 **Retry with hint** —— 写下要换的做法（"用现有的日期工具函数""测试文件在 tests/ 不在 spec/"），并选择再给几次尝试。
- **Skip task (dependents continue)** —— 跳过它继续。依赖它的任务照样运行，最终审查会评估整体结果。
- **Abort goal** —— 停掉整个 goal。它会以 failed 结束；目前的工作留在它的分支上。

一个任务允许两次或更多尝试时，它的最后一次尝试会用预设里的 **Complex tasks** 模型来跑。你额外给的每一次重试也一样。Settings 可以关掉这一点：[最后一次尝试换用 Complex tasks 模型](./settings.zh.md#最后一次尝试换用-complex-tasks-模型)。

同样的卡片上如果写着 "The engine itself hit an error (not the model)"，说明 Foundry 自己的代码在这个任务上连续出错了三次。这不是 AI 的错。把原因修好后再重试，或者跳过这个任务。

### 两个部分改了同一段代码

**Inbox：** *Retries exhausted*，带一个 **merge conflict** 标签 —— 列出文件和每次合并失败的原因。

两个任务改了同一段代码，Foundry 没能自动合在一起。按 **Resolve manually →** 查看每个文件的两边：选一边、编辑结果或用你的编辑器打开，然后按 **Finish merge**。也可以 *Retry with hint*（"两边都保留，新字段放在旧字段后面"）、*Skip task (dependents continue)* 或 *Abort goal*。

### 最终审查没通过

**Inbox：** *Retries exhausted*，不带任务名 —— 列出没通过的检查和审查意见。

全部都做完了，但审查发现合在一起的结果仍不满足某些验收检查，而且它自己的修复轮也没解决。

- **Retry with hint** 把审查意见变成修复任务（附上你的提示），跑完后再审查一次。
- **Accept as-is (finish goal)** 放弃这些检查，直接完成 goal。
- **Abort goal** 停掉这个 goal；它会以 failed 结束。

### 它想在你电脑以外做事

**Inbox：** *Wants to leave the workspace*。

某个会话想推送代码、创建或合并 pull request、发布版本、发布包、部署、修改 git 远端，或者运行 `terraform apply`、`kubectl apply`、`docker push`、`aws s3` 这类云工具，被 Foundry 拦下了。**Approve & run once** 替它把这条命令执行一次；**Deny** 继续拦着。（推送和开 PR 通常由 Foundry 在交付时按你选的策略自己完成 —— 见 [拿到结果](./getting-the-result.zh.md)。）

### 某个工具被拒绝了

**Inbox：** *Tool denied* ——"Claude refused one of the tools it needed."

一个任务用完了所有尝试，而且 Claude Code 拒绝了这个任务需要的某个工具（不是上面那些命令）。照原样再试，还会以同样的方式失败。你可以像上面一样用 **Suggest a hint** 或 **Let AI handle it**，也可以 **Retry with hint**（比如"不用网页搜索也能做"）、**Skip task (dependents continue)** 或 **Abort goal**。

### 预算用完了

**Inbox：** *Budget exceeded*。

goal 达到了你设的费用或时间上限。按 **Raise budget**（留空就翻倍）或 **Abort goal**。

### 交付停下来了

**Inbox：** *Delivery stopped* —— 停在哪一步、为什么，并写出失败的检查，比如 "Deploy preview — Deployment was blocked"，每个都附链接。

工作已经做完，但推送或合并 pull request 没有成功。先修好原因（链接里有说明），然后：

- **Retry delivery** 从第一个还没合并的 pull request 重新交付：已合并的跳过，还开着的继续用，修复 CI 的次数重新计算。
- 如果你自己完成了交付，就按 **Mark as delivered**。Foundry 会先读 pull request：已经合并的，就按合并完成（更新你自己的文件夹并清理 goal）；否则只记为由你完成。

如果你自己在 GitHub 上合并了 pull request，Foundry 会在几分钟内（或你打开 goal 时）发现，并关掉这一项。不是 Foundry 能读取日志的 CI 检查 —— 比如部署集成的状态 —— 不会派修复任务去"修"；Foundry 会停下来告诉你是哪个检查。常见原因：部署集成只接受其团队成员的提交。见 [Settings → Git & delivery](./settings.zh.md#git--delivery) 里的 **Commit author**。

### 里程碑可以看了

**Inbox：** *Have a look*，带 **Continue** 和 **Look & give feedback →**（打开 goal 页面）。**goal 页面：** 一张 *Have a look — task name* 卡片，写着要看什么，并带正在运行的预览。

Brief 把这个任务标成了里程碑，所以它完成后 goal 会暂停。你回应之前不会开始别的任务。goal 页面上有预览（启动、停止、打开）、开了自检时的截图，以及目前生成的文件。

- 看着没问题就按 **Continue**。
- 或者写下你看到的，按 **Turn into a plan**。Foundry 会提议这段话变成什么 —— 后续任务的*提示*、针对缺失或错误之处的*修复任务*（修完这个里程碑会再停一次让你检查），或者之后每个任务都必须遵守的*决定*。它猜错了就改一下类型，然后按 **Confirm & continue**。

一个里程碑最多停两次。第二次时卡片标题是 **Second look — task name**；这时你写的内容都会作为提示，goal 也不会再在这里暂停。

### 开始之前：Brief 上的问题

**位置：** Brief 页面，goal 开始之前。它们不会进入 Inbox。

计划里有个问题没法从你的仓库里找到答案。选一个建议答案（第一个是 Foundry 的推荐），或者自己填。如果你的回答改变了计划，批准前先按 **Revise with answers**。

### goal 页面上还有：访谈轮

Brief 出来之前，goal 页面可能显示 **Round N — K questions**。这不是出问题：Foundry 在规划之前问只有你能决定的事。选一个选项（第一个是推荐）或自己填；**Accept all recommended** 一键答完这一轮；**Enough — write the Brief** 停止提问。见 [回答访谈](./answering-the-interview.zh.md)。

## 不需要你处理的信息

### 任务的实时日志

| 你看到 | 意思 |
|---|---|
| `● session 1a2b3c4d · claude-…` | 一个会话开始了。同一次尝试里出现第二个 `●` 表示会话被续接（*continuation*），比重新开始便宜。 |
| 工作完成后出现 `[reviewer] …` | 任务审查员在检查改动。 |
| `[reviewer] ✗ Output does not match required schema …` | 审查员的结论格式不对，会重新发送。无害。 |
| `■ error_max_turns`、`■ error_max_budget_usd`、`■ killed_timeout` | 会话碰到了上限。Foundry 会给它新的额度续接，最多两次，然后才开新的尝试。 |
| `⏳ rate limit rejected` | 你的 Claude 套餐用量到了上限。Foundry 会暂停，额度重置后继续。不会丢任何东西。 |
| `⏱ sub-agent still working · 3m 30s` | 一个助手（比如规划器）还在忙。这一行在更新时，日志长时间没动静是正常的。 |
| `[claude-code:unrecognized_model] …` | 你的 Claude Code 比你选的模型旧。会话照常工作；更新 Claude Code 就不会再出现。 |

### 任务状态

任务依次经过 **pending**（等它依赖的任务）→ **ready** → **running** → **observing**（检查和审查）→ **merging**（并入 goal 的分支）→ **done**。一次尝试失败后，任务会从 **observing** 回到 **ready**，准备下一次尝试。

| 你看到 | 意思 |
|---|---|
| *ready · "X is not parallelizable; it starts when Y finishes"* | Brief 说这个任务必须单独跑。它在等。 |
| *ready · "X waits for Y: both touch …"* | 两个任务声明了同样的文件；这个在等，免得互相冲突。 |
| *ready · "retry 2/3"* | 上一次失败后的正常新尝试。很快就会开始运行。 |
| *running · "continuation 1: …"* | 同一个会话在碰到上限或检查仍未通过后被续接。不算重试。 |
| 长时间 *merging* | Foundry 正在把任务并入 goal 并重跑检查。 |
| *done · "no changes to commit"* | 这些改动已经在 goal 的分支上了。 |
| *blocked* | 有事需要你 —— 看 Inbox。 |
| *skipped* | 你跳过了它；后面的任务继续。 |
| *failed · "dependency failed"* | 它依赖的某个任务失败了，所以它没法运行。 |

### 尝试标记

| 你看到 | 意思 |
|---|---|
| `#3 ↻1` | 第 3 次尝试，续接过一次。费用和轮数是累计的。 |
| `interrupted` | 尝试期间 Foundry 重启了；它会自己续接，不占用重试次数。 |
| `passed` 但任务仍在 merging | 工作已通过检查，正在并入 goal。 |

## 只有人能发现的问题

- **各自都对、合起来不对的改动。** 两边各自的测试都过了，但组合起来是错的。最终审查和它的修复任务通常能发现；发现不了的话，里程碑的检查或最终结果会暴露出来。
- **任务改了它没声明的文件。** Foundry 事先看不到这种重叠；如果自动合并失败，这个冲突会作为合并冲突交给你。
- **本来就失败的测试套件。** 任务照样能并入，但套件不通过 goal 就完成不了 —— 最终审查会建修复任务，或者由你来修。
