# Foundry 是做什么的

> [English](./README.md) · 中文

## 五句话说清楚

Foundry 是一个在你自己电脑上运行的网页应用，地址是 <http://127.0.0.1:4111>。
你用大白话描述一个 goal：一个功能、一个修复、一份文档、一份报告、几张图片。
Foundry 读你的项目，问你只有你能决定的事，然后写一份叫 **Brief** 的计划。
你批准 Brief 之后，它就驱动你选定的 Claude Code、Codex 或 Antigravity 去干活，并检查、审查做出来的结果。
做好的东西放在一个单独的分支上；Foundry 只会按你选择的交付策略推送或发布成果。

![Goals 页面：等你处理的事以黄色指示牌挂在顶部，正在进行的 goal 排在下方的信息板上，带着阶段、任务、费用和用时](images/goals.png)

## 一个 goal 的一生

1. **你来描述。** 按 **New goal**，写下你想要什么，选好项目文件夹，按 **Create & clarify**。见 [你的第一个 goal](./your-first-goal.zh.md)。
2. **Foundry 来问。** 它先读项目。如果有只有你能决定的事，它会分几轮简短地问你，每个问题都带一个推荐答案。小而清楚的 goal 会跳过这一步。见 [回答访谈](./answering-the-interview.zh.md)。
3. **你批准 Brief。** Brief 写明 Foundry 理解了什么、要做什么、怎么检查结果、预计用时（Claude 还显示费用估算）。改掉你想改的，然后批准。见 [批准 Brief](./approving-the-brief.zh.md)。
4. **它开始干活。** Foundry 把 goal 拆成多个任务去跑；互不依赖的任务会同时跑。每个任务都要先经过检查和审查，才会并入其余的工作。见 [运行期间](./while-it-runs.zh.md)。
5. **里程碑展示每个功能。** Brief 会给每个看得见、可以试的功能设一个里程碑。功能完成时，Foundry 用任务写好的脚本把它录下来（截图、视频、API 的返回）。所有任务都完成后，最终走查会把每个脚本再跑一遍，然后 goal 暂停让你看。你按 **Continue**，或者说要改什么。
6. **最终审查。** 所有任务都做完后，审查员对照你批准的验收检查，检查整体结果。能修的它自己修。
7. **你拿到结果。** 做好的东西在你项目里的一个单独分支上，也在一个你随时能打开的文件夹里。如果你选了，Foundry 还会推送代码或开一个 pull request。见 [拿到结果](./getting-the-result.zh.md)。

从第 3 步到第 7 步，Foundry 只会因为少数几种原因停下来。全部列在 [Foundry 什么时候需要你](./when-foundry-needs-you.zh.md)。

## 你会遇到的词

| 词 | 意思 |
|---|---|
| **Coding agent**（编码智能体） | Claude Code、Codex 或 Antigravity，在创建 goal 时选择，之后固定。账户和权限互相独立。 |
| **Goal** | 你想做成的一件事，用大白话写，在一个项目文件夹里。 |
| **Brief** | Foundry 写的计划，任何工作开始前都要你批准。 |
| **Area** | goal 涉及的产品的某一部分，比如"学生端""教师端"或"公共基础"。每个任务都属于一个 Area。 |
| **Task**（任务） | 计划里的一项工作。一个 goal 通常有几个。 |
| **Milestone**（里程碑） | 一个看得见、可以试的功能，设在完成它的那个任务上。功能完成时 Foundry 会录下它的样子，最终走查时再录一次。 |
| **Inbox** | 等你处理的事项列表：**New goal** 旁边的托盘图标，上面会显示数字。 |
| **Learnings** | Foundry 从一个项目文件夹里结束了的 goal 学到的东西，加上你自己添加的。这个文件夹之后的每个 goal 都会拿到，连同你在 **Yours, everywhere** 下为所有文件夹写的东西。见 [Learnings](./learnings.zh.md)。 |
| **Memory**（记忆） | Learnings 的长篇版：你自己运行的一台 Hindsight 服务器记下一个文件夹里的 goal 做过、决定过、被驳回过、写过的一切，并在 goal 的每个阶段开始前先回答一句。可选；你自己在该仓库里的会话共用同一个 bank。见 [Memory](./memory.zh.md)。 |
| **Schedule** | 存下来并加了时间的 New goal 表单：每天、每周或每月，Foundry 用它生成一个 goal 并自己跑完。见 [Schedules](./schedules.zh.md)。 |
| **Progress folder**（进度文件夹） | 实际干活的文件夹，就在你的项目旁边：`<project>-foundry/<goal>/`，或者在 Settings 里设的文件夹下面。它以 goal 的标题（到第一个标点为止，最多 40 个字符）加上 goal id 的最后 6 个字符命名。你随时都能打开。 |
| **Model preset**（模型预设） | 哪个模型负责规划、任务和审查。两种编码智能体各有独立的 Max、Production、Balanced 和 Economy 预设；Codex 还保存各角色的推理强度。 |

想了解完整术语表，可以看 Foundry 仓库里的 `CONTEXT.md`。

## 本指南的各页

1. [Foundry 是做什么的](./README.zh.md)：就是本页。
2. [你的第一个 goal](./your-first-goal.zh.md)：Setup 页面，以及从上到下的 New goal 表单。
3. [回答访谈](./answering-the-interview.zh.md)：Foundry 在规划前问你的问题。
4. [批准 Brief](./approving-the-brief.zh.md)：计划的每个部分，以及你能改什么。
5. [运行期间](./while-it-runs.zh.md)：goal 页面、任务、日志、进度文件夹、预览和里程碑。
6. [Foundry 什么时候需要你](./when-foundry-needs-you.zh.md)：它停下来的全部原因，以及该按什么。
7. [拿到结果](./getting-the-result.zh.md)：分支、推送和 pull request，媒体文件，以及调整已完成的结果（beta）。
8. [Figure goal](./figures.zh.md)（beta）：物件与机器的可交互等轴测图，每张一个网页。
9. [Schedules](./schedules.zh.md)：自己运行的 goal，每天、每周或每月。
10. [设置说明](./settings.zh.md)：用大白话讲 Settings 的每一部分。
11. [主题](./themes.zh.md)：选择 Foundry 的样子，以及做一个自己的主题。
12. [费用与用量](./costs-and-usage.zh.md)：哪些要花钱，怎样少花钱。
13. [搬到新电脑](./moving-to-a-new-computer.zh.md)：把设置、key 和 goal 带到另一个 Foundry。
14. [端口](./ports.zh.md)：哪些端口正在被使用、被谁占着，以及怎样释放。
15. [常见问题](./faq.zh.md)：常见问题的简短回答。

顶栏右侧 ⚙ 菜单里的 **Help** 在 Foundry 里面直接显示本指南。同一个菜单里还有 **Settings**、**Setup**、**Transfer**、**Ports**、浅色／深色模式、**Appearance**（主题，见 [主题](./themes.zh.md)），以及你运行的版本：⚙ 按钮上的红点表示有新版本，按版本号会打开 **About & updates**。
