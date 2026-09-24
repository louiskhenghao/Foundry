# 回答访谈

> [English](./answering-the-interview.md) · 中文

## 访谈是什么

Foundry 写 Brief 之前，会先读你的项目和附件。大部分问题它能自己回答。它回答不了的，就只有你能决定：两种设计选哪个、用户是谁、某个旧功能要不要保留。这些它会分几轮简短地问你。

你在浏览器里回答。每轮只要一两分钟。

## 什么时候会有访谈

- 小而清楚的 goal 通常没有访谈。Foundry 直接写 Brief。
- 更大或更模糊的 goal，在有值得问的事时，会有一轮或多轮访谈。
- 如果你在 New goal 表单上勾了 **Interview me before planning**，至少会有一轮，除非已经没有需要你决定的事。
- Settings 可以把访谈完全关掉，也可以让每个 goal 都有访谈：[Settings → New goal defaults](./settings.zh.md#new-goal-defaults)。

访谈会出现在 goal 页面和它的 Brief 页面上，是一张标题为 **Round N — K questions** 的卡片。如果你设置了通知，还会收到一条消息（**Interview round** 开关）。

## 一轮访谈

![一轮有三个问题的访谈，每个问题的第一个选项标为推荐](images/interview.png)

一轮包含 Foundry 眼下能问的所有问题，最多八个，最重要的排在前面。每个问题是这样的：

### 问题

最上面带编号的文字。把它当成一位同事在问你一件事。

### 选项和推荐答案

最多四个可选的答案。第一个带有 **recommended** 字样：这是 Foundry 自己会选的。选它总是稳妥的。

都不合适？点 **something else…**，输入你自己的答案。

### 原因

问题下面的灰色小字。它说明 Foundry 在你的项目里发现了什么，让这个问题悬而未决，比如"这个应用既有网页登录，也有手机登录"。

### 承接的问题

有些问题会写着 **follows from …**，后面跟着前面那个问题：同一轮里写 "question 2"，前面的轮次写 "round 1, question 2" 再加上那个问题的开头。这个问题之所以有意义，是因为你对前面那个问题的回答。依赖于你还没给出的答案的问题，会等到下一轮再问。

### blocking 问题

标着 **blocking** 的问题必须先回答，**Send answers** 才能用。鼠标悬停在变灰的按钮上，可以看到还有哪些没答：它会列出这些问题的序号。即使还有 blocking 问题没答，**Accept all recommended** 和 **Enough — write the Brief** 也能用。

## 三个按钮

### Send answers

发送你选的答案。你留空的问题不会被记为你的决定；Foundry 会为它们做一个假设，你可以在 Brief 上看到并否决。

发送之后，Foundry 要么再问一轮（只在你的回答引出了新问题时），要么开始写 Brief。

### Accept all recommended

一键答完整轮。你已经回答的问题保留你的答案；每个空着的问题都选推荐选项。没什么强烈意见时就用它。

### Enough — write the Brief

停止提问。Foundry 用你目前给出的答案写 Brief，其余的做假设。问题问得太细时就用它。

## 最多几轮

总共最多四轮。通常是一两轮。第四轮之后，不管还剩什么没定，Foundry 都会开始写 Brief。

之前的轮次会折叠在当前这一轮下面：**▸ N earlier rounds** 显示问过什么、你答了什么。你没回答的问题也会注明：Clarifier 按它的推荐处理，并把它列在 Brief 的 Assumptions 里。

## 规划期间

你发送一轮答案后，卡片标题会变成 **Thinking about your answers…**，并有一行 **Planning with your answers · 3m 20s**，时间一直往上走。这是从你回答后开始算的时间。Foundry 正在读你的答案、再看一遍项目，然后要么准备下一轮，要么规划任务。

这通常要 2 到 8 分钟。它工作时，这一行下面的实时日志会一直滚动。日志长时间没动静、同时有一行像 `⏱ sub-agent still working · 3m 30s` 这样的内容，是正常的：规划器正在忙。你可以关掉页面；goal 会继续进行，你回来时页面会更新。

第一轮之前，卡片上显示的是 **Reading the repository…**，原因一样。

## 你的答案会怎样

每个答案都会变成一个 **Decision**（决定）。决定属于整个 goal：

- 它们出现在 Brief 页面的 **Decisions** 卡片里，已经体现在计划中。
- 每个执行者、每个审查员以及 pull request 都会一字不差地收到它们，并且必须遵守。
- 如果你之后再跑一次 Clarify，它会从你的决定出发，而不是重新问一遍。

你仍然可以在 Brief 页面上改主意：见 [批准 Brief](./approving-the-brief.zh.md#decisions)。

## 小贴士

- 简短的回答就可以。"是的，保留"就是一个完整的回答。
- 如果某个问题说明 Foundry 误解了 goal，就在 **something else…** 里指出来。它会纠正自己的理解。
- 不知道就选推荐选项。在开始做任何东西之前，你都可以在 Brief 上否决假设、修改答案。
