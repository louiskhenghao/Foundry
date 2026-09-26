<div align="center">

# Foundry

**一句话写下目标，拿回做完、检查过、审查过的成果。**

Foundry 在你自己的电脑上运行，从网页驱动你的 Claude Code：<br>
先问只有你能决定的事，给你看一次计划，然后自己去做、测试、审查、交付。

[English](./README.md) · 中文

[快速开始](#快速开始) · [怎么运作](#怎么运作) · [用户指南](docs/guide/README.zh.md) · [文档](docs/)

<br>

<img src="docs/guide/images/goals.png" alt="Foundry 的 goal 列表：六个 goal，各处在一个状态——运行中、受阻、等你看、等你批准 Brief、访谈中、已完成——每个都显示任务进度和相对预算的花费" width="900">

</div>

## 为什么用 Foundry

Claude Code 很会照你说的去做。可要让一件真正的工作不跑偏，剩下的活都落在你身上：把真正的意思说清楚、拆开、每一步都检查、发现它跑偏、别让它把额度烧光。
Foundry 做的就是这部分。

- **一句话就开始**  
  *"给订单页加 CSV 导出。"* *"给我们工作室做个官网。"* *"新饮品的海报。"*
- **先问再规划**  
  它先读你的仓库，只问代码里查不到的事——每个问题都附一个推荐答案。
- **只批准一份计划**  
  Brief：它理解了什么、有哪些任务、结果怎么检查、大概花多少。想改哪里都行，改完再批准。
- **做完之前你就能看**  
  到了里程碑，它会暂停、启动实时预览，等你看过。
- **靠检查，不靠猜**  
  每个任务都有验收检查；交付前会按这些检查把整体结果再审查一遍。
- **代码始终是你的**  
  全部在你的电脑上跑，用你的 Claude 订阅（Pro 或 Max）——不需要 API key。工作在独立分支上进行，你自己的 checkout 不会被动到。
- **花多少由你定**  
  模型预设决定每项工作用哪个模型；每个 goal 都有预算，超支前就会停下。

## 怎么运作

<table>
<tr>
<td width="50%" valign="top">

**1 · 说出来**<br>
按 **New goal**，选项目文件夹，写下你想要的。代码、文档、调研、图片、视频都行。

<img src="docs/guide/images/new-goal.png" alt="New goal 表单：goal 类型 Auto、Code、Documents、Research、Images、Video，以及目标描述">

</td>
<td width="50%" valign="top">

**2 · 回答几个问题**<br>
只问仓库里定不下来的事，每题附理由和推荐答案。也可以直接按 **Accept all recommended**。

<img src="docs/guide/images/interview.png" alt="访谈第 1 轮：关于深色模式开关的三个问题，每题都有推荐选项和理由">

</td>
</tr>
<tr>
<td width="50%" valign="top">

**3 · 批准 Brief**<br>
一页大白话写成的计划。想改就改，然后按 **Approve & run**。

<img src="docs/guide/images/brief.png" alt="工作室官网的 Brief：它的理解、PR 标题，以及一个带配色方案的风格问题">

</td>
<td width="50%" valign="top">

**4 · 在里程碑看一眼**<br>
goal 暂停，预览已经跑起来了。按 **Continue**，或者说要改什么。

<img src="docs/guide/images/milestone.png" alt="一个里程碑：预览运行在 4200 端口，下面有反馈框和 Continue 按钮">

</td>
</tr>
<tr>
<td width="50%" valign="top">

**5 · 让它跑**<br>
能并行的任务就并行，每个任务检查通过才合进来。可以盯着看，也可以走开。

<img src="docs/guide/images/goal-running.png" alt="运行中的 goal：Clarify 和 Brief 已完成，Run 进行中，右侧是验收检查，下面是工作所在的文件夹">

</td>
<td width="50%" valign="top">

**6 · 只在要紧时打扰你**<br>
任务受阻、改动冲突、预算到顶：都会进 **Inbox**，带着处理按钮——也可以推送到 Telegram 或 Discord。

<img src="docs/guide/images/inbox.png" alt="Inbox 里有一个用完所有尝试次数的任务，以及 Suggest a hint 和 Retry with hint 按钮">

</td>
</tr>
</table>

做完后，成果在独立分支上；如果你选了，还会帮你推送，或者开一个 pull request。

## 快速开始

你需要 Claude 订阅（Pro 或 Max）和 git。

**用 Docker** —— 所有工具都在镜像里：

```bash
mkdir -p ~/foundry && cd ~/foundry
docker run --rm imlouiskhenghao/foundry cat /app/docker-compose.yml > docker-compose.yml
FOUNDRY_REPOS=~/code docker compose up -d      # 你的仓库，挂载到 /repos
```

**从源码运行** —— 需要 [Bun](https://bun.sh)、已登录的 [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
（`claude` 在 PATH 上）和 [graphify](https://github.com/safishamsi/graphify)：

```bash
git clone https://github.com/louiskhenghao/Foundry.git foundry && cd foundry
bun install && bun run web:build
bun run serve                 # 然后打开 http://127.0.0.1:4111
```

打开 <http://127.0.0.1:4111>，按 **New goal**，选一个仓库，写下你想要的。[Setup](docs/guide/your-first-goal.zh.md#检查-setup-页面)
页面会检查东西是否都装好了。完整步骤、在 Docker 里登录 Claude、用手机远程访问：见 [安装](docs/operate/install.md)（英文）。

## 了解更多

| 我想要…… | 去看 |
|---|---|
| **使用 Foundry** —— goal、访谈、Brief、Inbox、花费 | [用户指南](docs/guide/README.zh.md) |
| **安装和运行** —— Docker、远程访问、通知、更新、所有设置 | [运维文档](docs/operate/)（英文） |
| **修改代码** —— 架构、角色、测试、发布、设计决策 | [开发文档](docs/develop/) · [CONTRIBUTING](CONTRIBUTING.md)（英文） |

Foundry 用到的词（Goal、Brief、Milestone、Model Preset……）在 [术语表](CONTEXT.md)（英文）里有定义。
