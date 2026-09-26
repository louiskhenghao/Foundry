# Foundry 是做什么的

> [English](./README.md) · 中文

## 五句话说清楚

Foundry 是一个在你自己电脑上运行的网页应用，地址是 <http://127.0.0.1:4111>。
你用大白话描述一个 goal：一个功能、一个修复、一份文档、一份报告、几张图片。
Foundry 读你的项目，问你只有你能决定的事，然后写一份叫 **Brief** 的计划。
你批准 Brief 之后，它就驱动 Claude Code 去干活，并检查、审查做出来的结果。
做好的东西放在一个单独的分支上；除非你同意，否则什么都不会离开你的电脑。

## 一个 goal 的一生

1. **你来描述。** 按 **New goal**，写下你想要什么，选好项目文件夹，按 **Create & clarify**。见 [你的第一个 goal](./your-first-goal.zh.md)。
2. **Foundry 来问。** 它先读项目。如果有只有你能决定的事，它会分几轮简短地问你，每个问题都带一个推荐答案。小而清楚的 goal 会跳过这一步。见 [回答访谈](./answering-the-interview.zh.md)。
3. **你批准 Brief。** Brief 写明 Foundry 理解了什么、要做什么、怎么检查结果、要花多少钱。改掉你想改的，然后批准。见 [批准 Brief](./approving-the-brief.zh.md)。
4. **它开始干活。** Foundry 把 goal 拆成多个任务去跑；互不依赖的任务会同时跑。每个任务都要先经过检查和审查，才会并入其余的工作。见 [运行期间](./while-it-runs.zh.md)。
5. **里程碑会停下来让你看。** 如果 Brief 把某个任务标成了里程碑，Foundry 做完它就会停下，把运行起来的结果给你看。你按 **Continue**，或者说要改什么。
6. **最终审查。** 所有任务都做完后，审查员对照你批准的验收检查，检查整体结果。能修的它自己修。
7. **你拿到结果。** 做好的东西在你项目里的一个单独分支上，也在一个你随时能打开的文件夹里。如果你选了，Foundry 还会推送代码或开一个 pull request。见 [拿到结果](./getting-the-result.zh.md)。

从第 3 步到第 7 步，Foundry 只会因为少数几种原因停下来。全部列在 [Foundry 什么时候需要你](./when-foundry-needs-you.zh.md)。

## 你会遇到的词

| 词 | 意思 |
|---|---|
| **Goal** | 你想做成的一件事，用大白话写，在一个项目文件夹里。 |
| **Brief** | Foundry 写的计划，任何工作开始前都要你批准。 |
| **Area** | goal 涉及的产品的某一部分，比如"学生端""教师端"或"公共基础"。每个任务都属于一个 Area。 |
| **Task**（任务） | 计划里的一项工作。一个 goal 通常有几个。 |
| **Milestone**（里程碑） | 做完后第一次有东西可以看或可以试的任务。goal 会在这里暂停，让你看一看。 |
| **Inbox** | 等你处理的事项列表，顶栏上会显示数字。 |
| **Progress folder**（进度文件夹） | 实际干活的文件夹，就在你的项目旁边：`<project>-foundry/<goal>/`，或者在 Settings 里设的文件夹下面。它以 goal 的标题（到第一个标点为止，最多 40 个字符）加上 goal id 的最后 6 个字符命名。你随时都能打开。 |
| **Model preset**（模型预设） | 哪个 Claude 模型负责哪项工作（规划、简单任务、困难任务、审查）。Foundry 自带四个：Max、Production、Balanced 和 Economy。 |

想了解完整术语表，可以看 Foundry 仓库里的 `CONTEXT.md`。

## 本指南的各页

1. [Foundry 是做什么的](./README.zh.md)：就是本页。
2. [你的第一个 goal](./your-first-goal.zh.md)：Setup 页面，以及从上到下的 New goal 表单。
3. [回答访谈](./answering-the-interview.zh.md)：Foundry 在规划前问你的问题。
4. [批准 Brief](./approving-the-brief.zh.md)：计划的每个部分，以及你能改什么。
5. [运行期间](./while-it-runs.zh.md)：goal 页面、任务、日志、进度文件夹、预览和里程碑。
6. [Foundry 什么时候需要你](./when-foundry-needs-you.zh.md)：它停下来的全部原因，以及该按什么。
7. [拿到结果](./getting-the-result.zh.md)：分支、推送和 pull request，还有媒体文件。
8. [设置说明](./settings.zh.md)：用大白话讲 Settings 的每一部分。
9. [费用与用量](./costs-and-usage.zh.md)：哪些要花钱，怎样少花钱。
10. [常见问题](./faq.zh.md)：常见问题的简短回答。

顶栏上还有一个 **Help** 链接：在 Foundry 里面直接显示本指南。
