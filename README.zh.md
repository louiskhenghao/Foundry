<div align="center">

<img src="apps/web/public/logo.png" alt="Foundry logo" width="96">

# Foundry

**一句话写下目标，拿回做完、检查过、审查过的成果。**

Foundry 在你自己的电脑上运行，从网页驱动你的 Claude Code 或 Codex CLI：<br>
先问只有你能决定的事，给你看一次计划，然后自己去做、测试、审查、交付。

[English](./README.md) · 中文

[快速开始](#快速开始) · [怎么运作](#怎么运作) · [用户指南](docs/guide/README.zh.md) · [文档](docs/)

<br>

<img src="docs/guide/images/goals.png" alt="Foundry 的 Claude Code 与 Codex 目标列表：进度、编码智能体和每个目标可用的操作" width="900">

</div>

## Codex 编码智能体

现在也可使用 Codex CLI + ChatGPT 登录运行同一套 Foundry 流程：安装器问编码智能体时勾选 Codex（或者传 `--agent codex`），然后登录。

```sh
curl -fsSL https://raw.githubusercontent.com/louiskhenghao/Foundry/main/install.sh | bash -s -- --agent codex
codex login                   # 或者 Accounts → Sign in to Codex
```

Codex 启动配置默认使用 `data-codex/`，Claude 启动配置默认使用 `data/`。两种实例都可以运行两种编码智能体：创建 goal 时选择 **Coding agent**（编码智能体）。数据目录属于整个实例，不按每个 goal 分开；账户、预设和 MCP 权限则保持独立。Codex 只支持 ChatGPT 登录，用量窗口按账户实际返回显示，包括只有 weekly limit 的账户。

Foundry 需要支持 hooks 的 Codex CLI：`foundry setup` 会装好，Setup 页会检查。[完整安装与能力限制](docs/operate/codex.md)。升级现有实例前，请阅读[备份与回退](docs/operate/updates-and-backup.md#upgrading-to-mixed-provider-goals)（英文）。


## 为什么用 Foundry

Claude Code 和 Codex 都能执行你的请求。可要让一件真正的工作不跑偏，剩下的活都落在你身上：把真正的意思说清楚、拆开、每一步都检查、发现它跑偏、别让它把额度烧光。
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
  Foundry 在本机运行，使用所选 CLI 的账户：Claude 登录，或 Codex 的 ChatGPT 登录。执行任务不需要 API key。工作在独立分支上进行，运行期间不改动你自己的 checkout。
- **花多少由你定**  
  两种编码智能体各有独立模型预设。时间、尝试次数和并发限制对两者都有效；美元费用上限只适用于 Claude。

## 怎么运作

**Claude Code 与 Codex 共用同一套流程**。先在 **Accounts** 分别连接原生账户，再为每个新目标选择编码智能体。以下截图均使用演示数据。

<table>
<tr>
<td width="50%" valign="top">

**[1 · 说出来](docs/guide/your-first-goal.zh.md#the-new-goal-form)**<br>
按 **New goal**，选择 **Claude Code** 或 **Codex** 及对应模型预设，描述想要的结果。准备开始时选好项目文件夹。

工作流套件、TDD 和 Ponytail 从该文件夹最新的 goal 继承；没有时使用 Settings。你改过的字段会保留你的选择。

<img src="docs/guide/images/new-goal.png" alt="New goal 表单：统一的编码智能体选择器选中 Codex，下方是目标类型和视图选项">

</td>
<td width="50%" valign="top">

**[2 · 回答几个问题](docs/guide/answering-the-interview.zh.md)**<br>
只问仓库里定不下来的事，每题附理由和推荐答案。也可以直接按 **Accept all recommended**。

<img src="docs/guide/images/interview.png" alt="访谈第 1 轮：关于深色模式开关的三个问题，每题都有推荐选项和理由">

</td>
</tr>
<tr>
<td width="50%" valign="top">

**[3 · 批准 Brief](docs/guide/approving-the-brief.zh.md)**<br>
查看计划、任务和验收检查。想改就改，然后按 **Approve & run**。Codex 使用时间和尝试次数限制；Claude 还支持美元预算。

<img src="docs/guide/images/brief.png" alt="Codex 目标的 Brief：需求理解、PR 标题和批准按钮">

</td>
<td width="50%" valign="top">

**[4 · 在里程碑看一眼](docs/guide/while-it-runs.zh.md#milestones)**<br>
goal 暂停，预览已经跑起来了。按 **Continue**，或者说要改什么。

<img src="docs/guide/images/milestone.png" alt="一个里程碑：预览运行在 4200 端口，下面有反馈框和 Continue 按钮">

</td>
</tr>
<tr>
<td width="50%" valign="top">

**[5 · 让它跑](docs/guide/while-it-runs.zh.md)**<br>
能并行的任务就并行，每个任务检查通过才合进来。**Agents** 汇集两种编码智能体的会话；**Usage** 分别展示各自的额度。

<img src="docs/guide/images/goal-running.png" alt="运行中的 goal：Clarify 和 Brief 已完成，Run 进行中，右侧是验收检查，下面是工作所在的文件夹">

</td>
<td width="50%" valign="top">

**[6 · 只在要紧时打扰你](docs/guide/when-foundry-needs-you.zh.md)**<br>
任务受阻、改动冲突、预算到顶：都会进 **Inbox**，带着处理按钮——也可以推送到 Telegram 或 Discord。

<img src="docs/guide/images/inbox.png" alt="Inbox 里有一个用完所有尝试次数的任务，以及 Suggest a hint 和 Retry with hint 按钮">

</td>
</tr>
</table>

做完后，成果在独立分支上；如果你选了，还会帮你推送，或者开一个 pull request。见[拿到结果](docs/guide/getting-the-result.zh.md)。

## 快速开始

每个版本带来了什么：见 [更新日志](https://github.com/louiskhenghao/foundry-releases/blob/main/CHANGELOG.md)。

**一行安装**（macOS、Linux）：

```bash
curl -fsSL https://raw.githubusercontent.com/louiskhenghao/Foundry/main/install.sh | bash
# 跳过编码智能体的提问：  … | bash -s -- --agent codex   （或 agy 即 Antigravity、claude,agy、all）
```

它会问你要用哪些编码智能体：Claude Code、Codex 或 Antigravity；在 Mac 上还会问你要 app 还是 binary。
**The app**（macOS）把 `Foundry.app` 放进 Applications：Foundry 在菜单栏里运行，登录电脑时自动启动。**The binary**（Linux）
把最新发布的编译版 `foundry` 作为后台服务运行。两者都是发布本身，按发布的 `SHA256SUMS` 校验过，再由 `foundry setup`
装好缺少的东西（git、uv、graphify、各编码智能体的 CLI、GitHub CLI、Node.js 和你勾选的可选工具）。Foundry 3.0 不再有 Docker
镜像，也不再从源码安装（[ADR-0108](docs/develop/adr/0108-foundry-ships-only-as-the-app-and-the-binary.md)，英文）：安装器在这台电脑上
找到以前的安装时，会提出把它的 goal 搬过来（[步骤](docs/operate/install.md#moving-an-earlier-install)，英文）。它会问你要不要登录，
打开 <http://127.0.0.1:4111>（或它选的端口），并留下一个 `foundry` 命令：`foundry status | logs | stop | start | update | uninstall`，
Foundry 自己的命令也走它（`foundry ask`、`foundry usage`……）。再跑一次这行命令，或者 `foundry update`，就能更新。

**下载 app**（macOS）：从 [releases](https://github.com/louiskhenghao/foundry-releases/releases) 下载
`Foundry-<version>-mac-universal.dmg`，把 Foundry 拖进 Applications。它没有经过 Apple 公证，所以第一次打开时要去
**System Settings → Privacy & Security → Open Anyway**（[步骤](docs/operate/install.md#the-app-macos)，英文）。它的 Setup 页会装好需要的工具。

要修改 Foundry 本身、从 git checkout 运行它，见[开发文档](docs/develop/README.md#getting-a-working-tree)（英文）。

打开 <http://127.0.0.1:4111>，按 **New goal**，选一个仓库，写下你想要的。[Setup](docs/guide/your-first-goal.zh.md#检查-setup-页面)
页面会检查东西是否都装好了，缺什么可以一键安装。完整步骤和用手机远程访问：见 [安装](docs/operate/install.md)（英文）。

## 了解更多

| 我想要…… | 去看 |
|---|---|
| **使用 Foundry** —— goal、访谈、Brief、Inbox、花费 | [用户指南](docs/guide/README.zh.md) |
| **安装和运行** —— app 和 binary、远程访问、通知、更新、所有设置 | [运维文档](docs/operate/)（英文） |
| **修改代码** —— 架构、角色、测试、发布、设计决策 | [开发文档](docs/develop/) · [CONTRIBUTING](CONTRIBUTING.md)（英文） |

Foundry 用到的词（Goal、Brief、Milestone、Model Preset……）在 [术语表](CONTEXT.md)（英文）里有定义。
