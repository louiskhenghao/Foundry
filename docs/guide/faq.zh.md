# 常见问题

> [English](./faq.md) · 中文

## 为什么停下来了？

goal 运行起来后，Foundry 只在少数几种情况下停下来问你：一个失败了好几次的任务、两个改了同一段代码的任务、最终审查没通过、一条会离开你电脑的命令、一个被拒绝的工具、预算用完，或者一个里程碑要看。每一种都会出现在 **Inbox**（顶栏上的数字）里，带着继续用的按钮。只有你能回答的问题来得更早，在 Brief 页面上。

![只有一项的 Inbox：一个用完了所有尝试次数的任务，带 Suggest a hint 和 Retry with hint](images/inbox.png)

每一种是什么意思、该按什么：[Foundry 什么时候需要你](./when-foundry-needs-you.zh.md)。如果 Inbox 里没有这个 goal，但什么都没在动，看下一个问题。

## 看起来卡住了。真的卡住了吗？

多半没有。按这个顺序检查：

1. **有黄色横幅 "Usage limit reached" 吗？** 你的 Claude 套餐到了上限。额度重置后一切会自己恢复；横幅会告诉你什么时候。
2. **Inbox。** 顶栏上有数字，说明有事在等你。
3. **任务的实时日志**（goal 页面 → **Tasks** → 点正在运行的任务）。像 `⏱ sub-agent still working · 5m 10s` 这样一直在计时的行，说明它在工作。规划常常要 2 到 8 分钟，期间输出很少。
4. **Agents 页面。** 标着 working 的会话就是在工作。
5. **顶栏**显示 **live**。如果显示 **reconnecting…**，说明页面和 Foundry 失去了联系；刷新页面，并检查 Foundry 是否还在运行。

看似卡住的任务尝试默认 20 分钟后会被停止并续接（Settings 里的 **Attempt timeout**），所以真正的卡死不会一直持续。Clarify 会话 15 分钟后停止，最终审查 30 分钟后停止。

## 批准后还能改计划吗？

Brief 本身不能改：一经批准就固定了。但你可以调整方向：

- **在里程碑时**，写下你想改的，按 **Turn into a plan**。它会变成一条提示、修复任务或一个新决定。
- **任务 blocked 时**，**Retry with hint** 告诉它换个做法。
- 在 Overview 标签上**添加附件**；新会话会收到。
- 从选定的任务 **Restart…** 一个已停止的 goal。
- 如果真要换方向，取消这个 goal，新建一个。已经做完的工作留在它的分支上。

批准之前，一切都可以改：[批准 Brief](./approving-the-brief.zh.md)。

## 怎样更省钱？

- 选 **Economy** 或 **Balanced** 模型预设（New goal 表单上的 **Models**，或 [Settings → Models & limits](./settings.zh.md#preset-per-goal-type)）。
- 常规 goal 勾选 **Fast mode**。
- 小 goal 把 **Effort** 设为 **low**。
- 在 Brief 上把简单任务标成 **simple**；它们用预设里的 **Simple tasks** 模型运行（在 Production 里是 Sonnet 而不是 Opus；Balanced 的代码类 goal 里，它和 Standard 是同一个模型）。
- 设预算；达到时 goal 会停下来问你。

更多见 [费用与用量](./costs-and-usage.zh.md#怎样少花钱)。

## 我的文件在哪里？

- **你自己的项目文件夹**在 goal 运行期间从不改动。
- **工作成果**在它旁边的进度文件夹 `<project>-foundry/<goal>/` 里，也在你项目里一个名为 `goal/…` 的分支上。在 goal 页面上用 **Open ▾** 打开。
- **图片和视频**放在你选的输出文件夹里，或者留在进度文件夹的 `artifacts` 文件夹里。
- **附件**由 Foundry 自己保存，从不放进你的项目。

见 [拿到结果](./getting-the-result.zh.md)。

## 我不懂 git 怎么办？

不需要懂。git 的活全由 Foundry 来做。你需要知道的是：

- 你的文件夹保持原样。结果是一个单独的文件夹，你可以打开、使用、从中复制。
- 如果 Foundry 请求 **Initialize git here**，同意就好。它只是开始为这个文件夹记录历史。
- 交付方式保持 **Local only**，直到有用 GitHub 的人和你一起设置。

## 它会不问就推送吗？

不会。默认的 **Local only** 下，什么都不会离开你的电脑。只有你选了 **Push branch**、**Open a PR** 或 **PR + auto-merge**，它才会推送或开 pull request，而且严格按 Delivery 标签上显示的步骤来。做任务的 AI 完全不能推送或部署：它要是试图这样做，Foundry 会拦下并在 Inbox 里问你。见 [拿到结果](./getting-the-result.zh.md#交付方式)。

## 怎么撤销？

- **批准之前**：**Cancel goal**。什么都还没做。
- **运行中或结束后**：你自己的文件夹从没被改过，所以那里没什么要撤销的。删除 goal（**⋯ → Delete goal…**）并勾选 **Also delete the branch**，就能丢掉这些工作。
- **你已经把它合并进项目之后**（自己合并，或通过 pull request）：像撤销其它改动一样撤销它，比如在 GitHub 的 pull request 上按 **Revert**。
- **某个任务出了错**：打开它按 **Restart from here**，或者从那个任务重启 goal。

## 为什么任务是 "standard"？

Foundry 写计划时，会把每个任务评为 **simple**、**standard** 或 **complex**，**standard** 是常规情况：典型的功能开发。评级决定用哪个模型：简单任务用预设里的 **Simple tasks** 模型（在 Production 里是 Sonnet；Balanced 的代码类 goal 里，它和 Standard 一样），复杂任务用它的 **Complex tasks** 模型。你可以在批准前在 Brief 上改。见 [Difficulty](./approving-the-brief.zh.md#difficulty)。

## 能在手机上用吗？

能，只要运行 Foundry 的电脑保持开机，并且你让它可以被访问，比如通过 Tailscale：见 [remote-access.md](../operate/remote-access.md)。页面在手机宽度下也能用。在 Settings 里设好 **Link base URL**，通知就会直接链接到 goal（[Notifications](./settings.zh.md#notifications)）。

## 能关掉浏览器或关机吗？

浏览器随时可以关：工作会继续。电脑必须保持开机、不休眠，因为工作在它上面运行。如果 Foundry 重启了，被中断的工作会自己续接，不占用重试次数。

## 能同时运行几个 goal 吗？

能。它们共用 **Concurrent Claude sessions** 这个上限（默认 3，在 [Settings → Models & limits](./settings.zh.md#limits) 里），所以同时跑的 goal 越多，每个就越慢。同一个项目上的两个 goal，在你合并之前看不到彼此的工作。

## "over-delivered" 是什么意思？

所有 **must** 检查都通过了（你要求的），**stretch** 检查也通过了（你在 Brief 上接受的额外项）。"Done" 只表示 must 检查通过了。

## goal 开始后还能补充信息吗？

能。在 goal 的 Overview 标签的 **Attachments** 下添加文件或链接；每个新会话都会收到。要改变做出来的东西，用里程碑或提示（见 [批准后还能改计划吗？](#批准后还能改计划吗)）。
