# 费用与用量

> [English](./costs-and-usage.md) · 中文

Foundry 用的是你的 Claude 订阅或 API 账户。只有在 Claude 会话运行时才花钱。它在 git 里做的事、跑你的测试、准备文件夹、读取检查结果都是免费的 —— 只花时间，不花钱。

## 哪些要花钱

| 会话 | 每个会话的上限 |
|---|---|
| Clarify（探索你的仓库、访谈、写 Brief） | 每个 Clarify 会话 $6。每一轮访谈、每一次修补 Brief，都是单独的会话。 |
| Draft with AI（一个任务或一个 Area） | $2 |
| Revise with answers | $3 |
| 任务尝试 | 默认 $10（Settings → Models & limits），且不超过 goal 剩余的预算 |
| 任务审查 | $0.80；需要再要一次结论时，最多再加 $0.20 |
| 合并尝试（合并两个改了同一段代码的任务） | $2 |
| 最终 goal 审查 | 至少 $6，最多到任务尝试的上限；需要再要一次结论时，最多再加 $2 |
| 完成文档（仅在你开启时） | $3 |
| 风格样图（一张图） | 每次 $2，每个方向最多 8 张 |
| Suggest a hint（Inbox） | $1 |
| 里程碑反馈（"Turn into a plan"） | $0.50 |
| 杂活：判断 goal 属于哪一类（类型选 **Auto** 时），或总结一段很长的检查输出 | 每次 $0.10 |
| Settings 里的 **Sync models** 和 **Test**（每个模型一个很小的会话） | 每个模型 $0.50 |
| Usage 页面上的 **Refresh signal** | $0.05 |

这些会话各用哪个模型 —— 也就决定了实际花多少 —— 由 goal 的**模型预设**决定。见 [设置说明](./settings.zh.md#models--limits)。

## 怎样少花钱

- **选更便宜的预设。** Balanced 或 Economy 只要 Max 的一小部分。可以在 New goal 表单里按 goal 选，也可以在 Settings 里按 goal 类型选。
- 常规 goal 用 **fast pace**。它跳过 Foundry 自己额外的审查；你批准的检查照常运行。
- 简单的 goal 在 New goal 表单里**调低 effort**。
- **设预算。** goal 达到费用或时间上限时会停下来问你。
- 续接的会话比新的尝试便宜，因为它复用已经读过的内容。所以 Foundry 会优先续接。

## 在哪里看花了多少

- **每个 goal** 页面顶部显示它目前的费用，每个任务也显示自己的。
- **Usage**（顶栏）按时间、会话类型和模型显示花费。对你套餐的每个用量窗口，它显示状态（**allowed**，或者快到上限时的警告）和重置时间，而不是百分比；想看确切的百分比，在 Claude Code 里运行 `/usage`。**Refresh signal** 会运行一个很小的会话来更新这个状态。
- 用量到了上限时，Foundry 会暂停所有 goal，额度重置后继续。横幅会告诉你什么时候。

## 图片类 goal 需要图片 key

只有 Foundry 有图片 API key 时才能生成图片：OpenAI 兼容的 key，或 Gemini key。在 **Settings → Tools & keys** 里添加；下一个会话就生效，不用重启。没有 key 时，图片任务只能做出手绘的 SVG 或 HTML 渲染，质量低很多 —— Brief 会在你批准前告诉你。
