# Foundry 什么时候需要你

> [English](./when-foundry-needs-you.md) · 中文

Brief 一经批准，Foundry 就会自己往下做。只有本页列出的情况才会停下来问你。每一种都会出现在 **Inbox**（顶栏上的数字）、goal 页面上；如果你设置了通知，还会发到 Telegram 或 Discord。

goal 运行时你看到的其它信息都属正常，不需要你做什么。本页后半部分解释这些信息。

## Foundry 停下来的六种原因

### 一个只有你能回答的问题

**位置：** Brief 页面，goal 开始之前。

计划里有个问题没法从你的仓库里找到答案。选一个建议答案（第一个是 Foundry 的推荐），或者自己填。如果你的回答改变了计划，批准前先按 **Revise with answers**。

### 某一部分做不完

**Inbox：** *Retries exhausted* ——"used N of M attempts; Must checks still failing"。

Foundry 把一个任务试了好几次，验收检查仍然没过。你可以：

- **Suggest a hint** —— Foundry 读任务、失败的检查和上一次尝试，用大白话说明原因，并填好一条提示。你看过后按 **Retry with hint**。
- **Let AI handle it** —— 同上，但如果结论是"带着这条提示重试"，就直接执行。
- 自己 **Retry with hint** —— 写下要换的做法（"用现有的日期工具函数""测试文件在 tests/ 不在 spec/"），并选择再给几次尝试。
- **Skip task** —— 跳过它继续。依赖它的任务照样运行，最终审查会评估整体结果。

任务的最后一次尝试，以及你额外给的每一次重试，都会用预设里最强的任务模型来跑。

### 两个部分改了同一段代码

**Inbox：** *Retries exhausted · merge conflict* —— 列出文件和每次合并失败的原因。

两个任务改了同一段代码，Foundry 没能自动合在一起。按 **Resolve manually →** 查看每个文件的两边：选一边、编辑结果或用你的编辑器打开，然后按 **Finish merge**。也可以 *Retry with hint*（"两边都保留，新字段放在旧字段后面"）或 *Skip task*。

### 最终审查没通过

**Inbox：** *Retries exhausted · goal review* —— 列出没通过的检查和审查意见。

全部都做完了，但审查发现合在一起的结果仍不满足某些验收检查，而且它自己的修复轮也没解决。

- **Retry with hint** 把审查意见变成修复任务（附上你的提示），跑完后再审查一次。
- **Accept as-is** 放弃这些检查，直接完成 goal。

### 它想在你电脑以外做事

**Inbox：** *Wants to leave the workspace*。

某个会话想推送代码、部署或调用付费服务，被 Foundry 拦下了。**Approve & run once** 替它把这条命令执行一次；**Deny** 继续拦着。（推送和开 PR 通常由 Foundry 在交付时按你选的策略自己完成 —— 见 [拿到结果](./getting-the-result.zh.md)。）

### 预算用完了

**Inbox：** *Budget exceeded*。

goal 达到了你设的费用或时间上限。按 **Raise budget**（留空就翻倍）或 **Abort goal**。

### 里程碑可以看了

**goal 页面：** *Have a look* —— 要看什么，以及正在运行的预览链接。

Brief 把这个任务标成了里程碑，所以它完成后 goal 会暂停。你回应之前不会开始别的任务。goal 页面上有预览（启动、停止、打开）、开了自检时的截图，以及目前生成的文件。

- 看着没问题就按 **Continue**。
- 或者写下你看到的，按 **Turn into a plan**。Foundry 会提议这段话变成什么 —— 后续任务的*提示*、针对缺失或错误之处的*修复任务*（修完这个里程碑会再停一次让你检查），或者之后每个任务都必须遵守的*决定*。它猜错了就改一下类型，然后按 **Confirm & continue**。

一个里程碑最多停两次。第二次之后你写的内容都会作为提示。

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

任务依次经过 **pending**（等它依赖的任务）→ **ready** → **running** → **observing**（检查和审查）→ **merging**（并入 goal 的分支）→ **done**。

| 你看到 | 意思 |
|---|---|
| *ready · "X is not parallelizable; it starts when Y finishes"* | Brief 说这个任务必须单独跑。它在等。 |
| *ready · "X waits for Y: both touch …"* | 两个任务声明了同样的文件；这个在等，免得互相冲突。 |
| *running · "retry 2/3"* | 上一次失败后的正常新尝试。 |
| *running · "continuation 1: …"* | 同一个会话在碰到上限或检查仍未通过后被续接。不算重试。 |
| 长时间 *merging* | Foundry 正在把任务并入 goal 并重跑检查。 |
| *done · "no changes to commit"* | 这些改动已经在 goal 的分支上了。 |
| *blocked* | 有事需要你 —— 看 Inbox。 |
| *skipped* | 你跳过了它；后面的任务继续。 |

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
