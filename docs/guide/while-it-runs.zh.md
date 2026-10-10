# 运行期间

## 按编码智能体显示执行信息

Codex 任务详情和活动记录将美元费用、模型回合数及技能调用标为不可用；实时工具日志、保存的记录及 Foundry 会话仍可查看。**Agents** 也会显示近期的 Claude 与 Codex 外部会话，并标注编码智能体。Codex 外部历史只读且限制近期记录量；**status unknown** 表示无法核实外部进程是否还在运行，不表示空闲或已完成。读取失败会显示警告，外部会话不能在 Foundry 停止。

Codex 任务的 **Codex models** 卡片展示创建时保存的角色模型、强度覆盖与备用顺序，也可查看其他任务类型的快照。以后修改 Settings 不会改写它；没有快照的旧任务会明确标示。


> [English](./while-it-runs.md) · 中文

Brief 批准后，Foundry 就自己干活。你可以关掉浏览器，工作会在你的电脑上继续。本页讲解 goal 页面，方便你想看的时候跟上进度。

![任务运行中的 goal 页面：费用和时间计量、阶段时间线和任务图](images/goal-running.png)

## goal 页面一览

从 **Goals**（顶栏上的列表）打开一个 goal。页面顶部有：

- 标题、状态标记（比如 **running**、**have a look**、**reviewing**、**done**）；goal 以 fast 模式运行时还有一个 **fast** 标签。
- 项目文件夹（**copy** 复制它的路径）、goal 的编码智能体（**Claude Code** 或 **Codex**）和分支：goal 起步的分支 → goal 自己的分支。**Goals** 列表也在每个项目路径旁显示同样的编码智能体。列表的每一行把相关信息叠在一起：标题、编码智能体和文件夹；状态和任务数；费用和时间对比上限；最近更新和创建日期。默认每页显示 10 个 goal，最新创建的在前，底部显示总数和页码；可在那里改为每页 20 或 50 个（这个浏览器会记住）。页码记在地址栏里。
- **time** 显示已用分钟数对比时间上限；Claude 还显示 **cost** 对比美元预算。Codex 美元费用不可用。
- **Open ▾**：在你的电脑上打开项目或进度文件夹（见 [进度文件夹](#进度文件夹)），或者用 **VS Code (web)** 打开：浏览器标签里的 VS Code，经 Tailscale 在手机上也能打开。第一次使用时启动（先在 [Settings → Tools & keys](./settings.zh.md#tools--keys) 装一次），只在这台电脑上运行，闲置两小时后停止。它的登录页要输入密码，菜单里会显示这个密码并带复制按钮；浏览器会记住它。编码智能体写过的文件夹会以受限模式打开，直到你选择信任它。在里面的修改是真实修改：goal 运行时，菜单会提醒你在它的文件夹里改动可能和编码智能体的冲突，并被带进它们的下一个提交。
- 一个随状态变化的主按钮：Brief 等你时是 **Review brief →**，运行时是 **Cancel**，完成后是 **Deliver…**、**Delivering…** 或 **Delivery**。
- **⋯**（More actions）：**Restart…**、**Re-run Clarify**、**Cancel goal**、**Delete goal…**，视情况出现。

再往下，卡片只在需要时出现：goal 等你查看时的里程碑卡片，Foundry 提问时的访谈，以及最终审查运行时带实时日志的 **Goal review…**。

某个编码智能体达到用量上限时，横幅会指出编码智能体和重试时间，只暂停该编码智能体的新会话。没有重置信号时，Foundry 延后重试；重试不保证额度已经恢复。见 [费用与用量](./costs-and-usage.zh.md)。

## Simple view：进度

在 Simple view 里，goal 页面显示：

- 一句话说明正在发生什么，比如 "Working." 或 "Paused — something needs you (see below)."
- **Needs you**：所有等你处理的事，并附有用来回应的按钮。
- **Progress**：一个进度条，显示完成了 **N/M pieces**，以及此刻进行中的任务：**in progress**、**checking** 或 **combining with the rest**。
- **Preview** 和 **Milestones**（Brief 批准之后）：和 Expert view 里一样的卡片，可以试用结果、观看每个里程碑的演示录屏。
- **Cost**：目前花了多少、上限是多少，以及 Foundry 已经工作了多久（等你的时间不算）。
- **Result**（goal 完成时）：工作在哪里、**Open ▾**、**Deliver…**，以及 goal review 的结论。
- 最后是你提出的需求和通往 Brief 的链接。

goal 标题栏里的 **Simple | Expert** 用来切换视图，两种视图下它都在同一个位置。**Expert** 显示其余所有内容。

![运行中 goal 的 Simple view：一句话说明正在做什么、带进行中任务的进度条，以及目前的花费](images/goal-simple.png)

## Expert view 的标签页

| 标签 | 显示什么 |
|---|---|
| **Overview** | goal 进行到哪了、什么需要你、进度文件夹、预览、验收检查。标签上有数字表示有事等你。 |
| **Tasks** | 任务图和每个任务的状态。显示 **done/total · N running**。 |
| **Activity** | 发生过的所有事，最新的在前。 |
| **Diff** | 相对 goal 起点的全部改动。 |
| **Delivery** | 结果会怎样处理，以及进度。见 [拿到结果](./getting-the-result.zh.md#the-delivery-tab)。 |

## Overview

![已完成 goal 的 Overview 标签：时间线各阶段全部完成、四个 pull request 已合并、goal 描述、进度文件夹，以及全部通过的验收检查](images/goal-overview.png)

从上到下：

- **时间线**：**Clarify → Brief → Run → Review → Done**（或 **Over-delivered**）；goal 要推送或开 pull request 时还有 **Deliver · mode**。当前阶段会闪动。点一个阶段，就跳到显示它工作内容的地方。
- **Brief**：时间线下方的一行，比如 **Brief APPROVED · 36 tasks · 11/11 assumptions accepted · 9/12 questions answered · est. $380 / 1500 min**。点它打开 Brief 页面，Understanding 和 Clarifier 写的其它内容都在那里。
- **What needs you**：和 Inbox 里一样的卡片，带按钮。
- **goal**：你最初的描述。面板角上的 **Open full**（两个斜向箭头的图标）会在更大的窗口里显示它。
- **Goal review**：最终审查运行后，紧跟在 goal 下面：一行显示结论（**passed**、**over-delivered** 或 **failed**）和审查员意见的开头；点 **reviewer notes** 展开全文，**Open full** 图标会在更大的窗口里打开。
- **Attachments**：紧跟在 goal 下面，和 New goal 表单上一样。随时可以再加；新的会话会收到。
- **Workspace & preview**：goal 的工作成果在哪里，以及启动它来试用。见 [进度文件夹](#进度文件夹) 和 [Preview](#preview)。
- **Milestones**：goal 有里程碑时，每个一行，最新的在上：要看什么、什么时候到的、goal 是暂停了还是继续了，以及你的回答。点一行会把录屏和截图显示成同样大小的格子；每一行各自展开、收起，可以同时打开两个里程碑来对比。点一个格子会在弹窗里放大，用 **←** / **→**（或顶部的箭头）逐个切换。
- **Model fallback**：只在某个模型不可用、Foundry 换了另一个模型时出现。
- **Project skills**：Foundry 为你项目的技术栈添加的 skill，按 Frontend、Backend、Database、Testing、Tooling 分组，并显示数量。它们不会进入你的提交。
- **Completion**：文档、知识图谱刷新和媒体文件各占一行，写着结果。见 [完成后的附加项](./getting-the-result.zh.md#完成后的附加项)。
- **Acceptance**（右侧）：每个 **must** 和 **stretch** 检查及其最新结果，比如 **3/4 passing**。点一个检查会在弹窗里打开：它检查什么（命令，或审查员的评分标准）、它的每一次运行（新的在上，点某一次就看那一次的输出），然后是所选那次运行的输出。命令的输出带行号显示，审查员的结论以 Markdown 显示（可切换 **Preview** 和 **Raw**），JSON 输出显示成树。输出上方有一行说明你看到的是 Foundry 保留的部分（长输出只保留开头、结尾和报错的行，失败时会做摘要）还是全部：**Show the whole output** 加载这次运行打印的全部内容，**Show the summary** 切回去。下面是 **Self-check** 开关和它最近一次的结果（见 [Self-check](#self-check)），goal 有里程碑时还有 **Have a look: pause at milestones**（见 [Milestones](#milestones)）。

## Tasks

**Tasks** 标签把计划画成一张图。每张卡片是一个任务，显示状态、已用的尝试次数和允许的次数（比如 2/3），这个任务到目前为止所有尝试加起来的费用、它的难度（**simple**、**standard** 或 **complex**，由它决定用预设里的哪个模型），以及最近一次尝试用的模型。箭头表示哪个任务在等哪个。在手机上，这张图会变成列表。

![Tasks 标签：计划画成一张图，一个任务已完成，两个并排（其中一个仍在运行），一个在等它们两个](images/goal-tasks.png)

### 任务状态

任务从 **pending**（等其它任务）依次到 **ready**、**running**、**observing**（跑检查和审查）、**merging**（并入 goal 的分支）和 **done**。任务也可能是 **blocked**（需要你）、**failed** 或 **skipped**。

每个状态和消息是什么意思，以及哪些不需要你做什么，见 [Foundry 什么时候需要你](./when-foundry-needs-you.zh.md#任务状态)。

### 任务内部

![全屏打开的任务：它的 spec、通过的那次尝试及其花费和轮数，以及会话的实时日志——读代码、写文件、跑测试](images/task-drawer.png)

点一个任务，它会在 goal 页面上方打开（按 Escape、点 × 或点它旁边的空白处关闭）。面板总是占满窗口的高度；在宽屏上，左栏和旁边的尝试各自滚动，文件列表再长也不会把实时日志滚走。你会看到：

- 标题、状态、标签，完成后还有它的提交。点提交那一行，可以看完整的提交信息。
- **Task total**：到目前为止的尝试次数、费用（分成 worker 和 reviewer）、轮数和分钟数。
- **spec**，以及你给过的 **human hint**（紧跟在 spec 下面；两者都可以用 **Open full** 图标在更大的窗口里阅读）、它的 **Checks** 及最新结果，以及 **Relevant files**（点一个就能打开；灰色的表示哪里都还没有这个文件，通常是计划里要这个任务新建的文件）。
- **Files**：这个任务新增或改动的文件（运行中显示为 **Files so far**）。图片以缩略图显示。点任何一个文件，就在页面里查看（窗口顶部的箭头，或 ← 和 →，可以切换到同一列表里的上一个或下一个文件，**Relevant files** 也一样）：图片、PDF、视频和音频直接播放，代码（按语言上色、带行号）、Markdown 和 JSON 排好版显示。不需要在运行 Foundry 的电脑上打开编辑器，所以用手机或通过[远程访问](../operate/remote-access.md)也能看。已完成任务的文件从它在你仓库里的提交读取，所以交付清理掉任务的文件夹之后也还能看；图片、视频类 goal 生成的图片和视频从不提交，会列在生成它们的那个任务下。
- **This task is waiting for you**（任务 blocked 时出现），并附有用来回应的按钮。
- 每次尝试一个标签：**#1**、**#2** …… 带结果和费用。**↻1** 表示会话被续接了一次，而不是从头开始，保留已有上下文。
- 选中的那次尝试：结果、worker 模型、轮数、费用、开始时间、时长、用了哪些 skill，然后是为它运行过的每个会话。
- 按钮：**Restart from here**（这个任务和之后的所有任务重新运行）、**Open worktree**（任务运行时它自己的文件夹），以及合并冲突需要你时的 **Resolve manually**。
- 任务看起来卡住时，有一个按钮能让它重新动起来，不用重启 Foundry。**Start now** 出现在运行中的 goal 里一个 **ready** 的任务上：没有任何东西挡着它，但它一直没开始。**Stop and retry** 出现在一个运行中、但已经三分钟没有活跃会话的任务上：在对话框里确认后，它停掉这个任务正在做的事，把它放回 **ready**；已经开始的会话会从中断的地方续接，其它情况下这次尝试不计入次数。因为某个原因在等待的 ready 任务，会在尝试列表下面写出原因，例如 *not started yet: every slot is taken*。

### 实时日志

在任务里，**Live log** 显示 worker 此刻在做什么：它说的话、用的工具（⚙）、工具的结果，以及每个会话一行。会话结束时，`■` 那一行还会显示 worker 最后说的话。

每条都只占一行，超出框的部分被截掉。点一行（或用 Tab 移到它上面再按 Enter），会在一个窗口里显示完整内容。**Preview** 显示排好版的样子，**Raw** 显示原文；**Copy** 复制全部内容。消息和思考默认用 **Preview** 打开；工具调用、工具结果和错误默认用 **Raw** 打开。日志本身会缩短较长的思考和工具结果，所以窗口会从会话保存的记录里读出全文。

工具调用，以及任何 JSON 格式的结果，会以 **Tree** 打开：每个对象和列表都能折叠，**Expand all** 和 **Collapse all** 一次全部展开或收起，搜索框会标出所有包含你输入内容的键和值，并展开它们所在的分支。**Text** 显示纯文本。树里的文件路径旁有 **open** 按钮：文件会在和任务 **Files** 相同的查看器里打开。任务合并后，它自己的文件夹会被删除，所以显示的是这个文件现在在进度文件夹里的样子；交付把进度文件夹也清理掉之后，就从任务的提交里读取。窗口里会说明是哪一种。

![从任务的 Files 打开的一张任务生成的图片：预览窗口直接在页面里显示它，并带有路径、复制、在新标签页打开和下载](images/file-preview.png)

**Observation** 显示交给下一次尝试的摘要。**Prompt** 显示 worker 收到的原话。

你会看到的那些行（`●`、`■ error_max_turns`、`⏱ sub-agent still working` ……）是什么意思，见 [Foundry 什么时候需要你](./when-foundry-needs-you.zh.md#任务的实时日志)。大多数都不需要你做什么。

## 进度文件夹

Foundry 从不在你自己的项目文件夹里工作。它在旁边一个单独的文件夹里工作：

```
Projects/
  my-app/                 ← your folder, never touched
  my-app-foundry/
    Add dark mode-a1b2c3/ ← the progress folder of one goal
```

进度文件夹以 goal 的标题（到第一个标点为止，最多 40 个字符）加上 goal id 的最后 6 个字符命名。里面是你的整个项目加上 goal 目前的工作：也就是 goal 的分支，已经检出。随时都可以打开、运行、阅读。并行运行的任务在各自隐藏的文件夹里工作，检查通过后再合并到这里。你可以在 [Settings → Engine (install)](./settings.zh.md#engine-install) 里改变进度文件夹的创建位置。

Overview 标签上 **Workspace & preview** 卡片的顶部写着 worker 提交到哪个分支、最新提交，并带 **Open ▾**。展开 **Run it yourself** 有现成可复制的命令：在那里打开终端并启动项目。合并后文件夹被清理掉，这一部分就不再显示，下面预览那一行会写明预览在哪里运行。

注意：因为这个文件夹*就是* goal 的分支，你没法在自己的文件夹里也切换到这个分支。要把结果放进你的文件夹，见 [拿到结果](./getting-the-result.zh.md#把结果放进你自己的文件夹)。

### The Open menu

**Open ▾**（在 goal 页面和 Workspace & preview 卡片上）列出两个地方：**Repository**（你自己的文件夹）和 **Goal workspace**（进度文件夹）。每个地方都提供它在你电脑上找到的编辑器、文件管理器和终端，比如 VS Code、Cursor、Finder、Terminal。点一个，就用它打开那个地方。**path** 复制路径。

## Preview

**Workspace & preview** 卡片的下半部分启动结果，让你在浏览器里试用。

- **Start preview** 在进度文件夹里运行项目的启动命令。卡片会显示是哪条命令，以及它来自 Brief 的 **How to run it** 还是 `package.json`。如果项目依赖还没安装（有 `package.json` 但没有 `node_modules`），Foundry 会先安装；输出里也能看到安装过程。
- 出现 **Running on port N** 后，按 **Open preview** 打开。**Stop** 停止它。命令启动的其他服务器会显示在 **Also serving** 下（见 [Where it runs](#where-it-runs)）。
- **▸ server output** 显示服务器打印的内容。

如果卡片显示 **Nothing to run yet**，说明还没有启动命令。等某个任务加上一条就会出现，或者你可以在 Brief 的 **How to run it** 下设一条。

### Several apps

一个仓库里可能有几个要一起运行的应用，比如网站、管理后台和 API。Foundry 会从 `package.json` 的 workspaces 里找到它们，或者由 Brief 在 **How to run it** 下列出。这时卡片每个应用一行，第一个排在最上面：

- 一个圆点（绿色：已响应，黄色：启动中，红色：上次运行失败，灰色：已停止）、应用的名字和它所在的文件夹；
- 运行时显示 **Open**，以及它自己的 **Start** 或 **Stop**；
- **▸ output** 显示这个应用打印的内容。

**Start all** 启动所有还没运行的应用；**Stop all** 把它们全部停掉。每个应用有自己的端口，并会在环境变量里拿到其它应用的地址，名字是 `FOUNDRY_APP_<KEY>_URL`，例如 `FOUNDRY_APP_API_URL`，这样网站就能找到 API。

只要端口空着，应用就沿用你自己运行它时用的端口，这样你 `.env` 文件里写的地址仍然能连上它。Foundry 从这些地方读出这个端口：启动脚本（`next dev -p 3001`）、应用 `.env` 文件里的 `PORT`、服务器代码里的默认值（`process.env.PORT ?? 4000`），或者框架的默认端口（Next 3000、Vite 5173）。如果这个端口被占用了（比如你自己的 dev server 正在用），应用改用 **Settings → Preview** 里的端口，所有指向 `localhost:<原端口>` 的变量都会在应用的环境变量里改成指向新端口；你的文件不会被修改。应用那一行会说明：**Usually on port 3000, which was taken; runs on 4200**，以及 **Pointed at the ports the apps got** 加上变量名。在 Docker 里，应用总是用这个范围里的端口（只有这个范围对外发布），变量也会指向那里。

### Services

如果仓库里有 Docker Compose 文件，里面有应用需要的服务（比如 Postgres 这样的数据库、MinIO 这样的文件存储），卡片会显示 **Services** 部分，列出每个服务、它的端口和状态。启动预览时会先启动这些服务。**Start services** 和 **Stop services** 作用于全部服务；每个服务也有自己的 **Start** 或 **Stop**。

- 同一个仓库的所有 goal 共用这些服务，所以两个 goal 不会在同一个端口上各启动一个数据库。
- 如果某个服务的端口在你电脑上已经被占用（比如你自己的 Postgres），它会显示 **in use elsewhere**：Foundry 不会启动它，应用直接用已经在运行的那个。
- 预览停止时服务继续运行，所以数据会保留。**Stop services** 会停掉它们，数据仍然保留。
- 需要装好 Docker。没有 Docker，或者 Foundry 本身运行在 Docker 里时，卡片会显示自己启动这些服务的命令，并带 **copy**。

Foundry 也会在里程碑时自己启动预览；预览在运行时，每个任务并入后都会重启它；一段时间没人打开（默认 60 分钟）时，它会停止预览。goal 结束时，Foundry 只停止它自己启动的预览；你自己启动的（比如为了看一个已完成的 goal）会一直运行，直到闲置。卡片会说明 Foundry 为什么停止了它。

### Where it runs

卡片顶部写着运行的是哪个分支、在哪里运行。goal 还在进行时，预览运行的是 goal 自己的那份仓库（它的进度文件夹，在 goal 的分支上），并标着 **not your checkout**，所以你看到的是 goal 做的成果，而不是你自己文件夹里的内容。**copy** 复制那个文件夹的路径。

goal 完成后，分支变成一个下拉菜单，下面一行说明选中的分支是什么（goal 的文件夹、带有合并成果的基础分支……），可以选 goal 分支、基础分支（比如 `main`）或你自己的其他本地分支；要换分支，先停掉预览。合并后 Foundry 会清理 goal 的文件夹并删除它的分支，这时预览改为运行基础分支（合并后的成果就在那里），并有一行琥珀色提示说明。

分支旁边还有第二个菜单，选择 goal 分支以外的分支在哪里运行：

- **(auto)**，默认：你的 checkout 已经在那个分支上时就在 checkout 里运行，直接用里面已经装好的依赖和 `.env` 文件；否则在 Foundry 的预览文件夹里运行，并有一行说明你的 checkout 在哪个分支上。
- **your checkout**：你自己的文件夹，保持原样，不管它在哪个分支上，包括你还没提交的改动。分支菜单会隐藏。
- **Foundry's preview folder**：Foundry 自己的文件夹，checkout 到那个分支的最新提交。

Foundry 绝不会为了预览去切换、重置或拉取你的 checkout。改任一菜单前先停掉预览。

如果启动命令除了 Foundry 分配端口的那个服务器之外还启动了别的（比如一个 demo 脚本同时启动 web 应用、管理后台和 API，或者 `turbo dev`），Foundry 会找出它们监听的端口，把能响应网页请求的列在 **Also serving** 下，按各自的 package 名（或所在文件夹）命名，每个都有自己的链接。它用到的所有端口都不会再分给其他 goal 的预览。

### When it fails

如果某个 app 自己停了，卡片会显示 **The last run failed**、原因（比如 `exited with code 1`）以及它最后打印的几行（比如错误信息），不用打开输出就能看到。如果它在运行但 90 秒内没有响应，会有一行琥珀色提示：可能还在启动，也可能它的命令没用 Foundry 分配的端口（在 Brief 的 **How to run it** 里用 `{port}` 就能解决）。安装依赖失败也会显示出来。如果是因为端口被占用（`EADDRINUSE`）而停下，卡片会写出是谁占着那个端口，能释放时附带 ■ 按钮，并有一个指向[端口](./ports.zh.md)的链接。

### Environment

应用常常需要一些设置和密钥（比如 API key、bot token），项目把它们放在 git 之外的 `.env` 文件里，所以 goal 的文件夹里没有。卡片上的 **Environment** 一行写着已设置几个、示例文件还要求几个；按 **Edit…** 会在弹窗里打开，每个变量一行，左边是名字，右边是值：

- 每个名字下面有一段说明，讲它是什么、去哪里拿：示例文件（比如 `.env.example`）里为它写的注释；很多项目都会用到的名字有内置提示（数据库地址、从 @BotFather 拿 bot token、从控制台拿 API key）；还有示例值，以及哪些文件读取它。随便一个随机字符串就行的密钥，按 **Generate** 会自动填一个。
- **Set for this repository** 列出已保存的变量。保存过的值不会再显示：输入框会写着 **saved · type to replace**。留空表示保留原值，输入新内容就会替换；**×** 删除这个变量。要改名，就删除它再用原来的值重新添加。
- **Listed in example files, not set** 列出示例文件里提到、但还没有任何来源提供的变量，没有示例值的排在前面。填上你需要的就行，空着的不会保存。并不是每个都需要：示例文件也会列出可选设置，有些启动脚本也会自己写环境变量。
- **Add variable** 按名字添加一个。**Save** 把它们保存到这个仓库，所以这个仓库的每个 goal 都会用到；app 下次启动时生效。
- 如果你自己的仓库文件夹里有被 git 忽略的 `.env` 文件（`.env`、`.env.development`、`.env.local`、`.env.development.local`），按 **Import from your checkout** 会把这里还没设置的变量复制过来。不按就不会读取你的文件夹。

这些值只留在这台电脑上。它们只交给预览的进程，绝不会写进 goal 的文件夹（编码智能体工作的地方），在预览的输出和 self-check 的报告里会显示成 `••••`。预览运行的是 goal 的代码，所以那些代码仍然可以读取它们。它们优先于项目自己的 `.env` 文件。Foundry 自己的 `PORT` 和 `FOUNDRY_APP_<KEY>_URL` 永远以它们为准。

### Self-check

**Self-check after each task** 是 Overview 的 **Acceptance** 卡片里、检查列表下面的一个开关；批准之前，它也在 Brief 的 **How to run it** 部分里。打开后，每个任务并入后 Foundry 都会在隐藏的浏览器里打开预览，截图并检查错误。有错误就会让一个 must 检查失败，所以错误会被修掉。卡片会显示最近一次的结果：通过还是失败、有几个错误（列出前几个），以及截图链接。整个过程不用 AI，所以不花钱。

它只对结果在浏览器里运行的 goal 有用，而且需要下载一次（在 [Settings → Preview & self-check](./settings.zh.md#preview--self-check) 里按 **Install Chromium**）。默认关闭。

它和里程碑的「看一看」不一样：self-check 是每个任务之后自动做的快速冒烟测试，只看首页，从不给你看任何东西，也不会暂停；失败时 Foundry 会去修那些错误，花费只来自这些修复。**Have a look** 是给你看的：到了里程碑，Foundry 按要看的内容录一段操作，开关打开时还会停下来等你。

## Milestones

**Have a look: pause at milestones** 决定 goal 到了里程碑要不要停下来。默认开启（[Settings](./settings.md)）；每个 goal 在 Brief 的 **How to run it** 部分和 Overview 的 **Acceptance** 卡片里都有自己的开关，从下一个里程碑开始生效。关掉后 goal 会继续往下跑，下面这段说明和它的录屏会发到你的通知渠道。

里程碑任务并入后，goal 会暂停。它的状态标记显示 **have a look**，Inbox 显示 **Have a look**，goal 页面顶部出现一张卡片：**Have a look — task name**。

![Have a look 卡片：要看什么、运行中的预览和自检截图](images/milestone.png)

卡片显示：

- 要看什么，按 Brief 里写的。
- **What Foundry saw**：预览的录屏和截图，让你不用自己启动任何东西就能看到。卡片刚打开时会显示 **Recording a walkthrough of the preview…**：一个小模型根据要看的内容和页面上的控件规划几个步骤（点击、填入示例数据、打开页面；绝不登录、付款或删除），由一个隐藏的浏览器照着操作，录下视频，并在值得看的地方截图。做不了的步骤会跳过；规划不出来时，保留一张页面截图，并有一行琥珀色提示说明原因。它和 self-check 一样需要 Playwright 的 Chromium。
  - 有多个应用时，录制打开的是文件夹里装着这个任务文件的那个应用。
  - 应用启动前，如果 Docker 已安装但没在运行（Docker Desktop、OrbStack、Rancher Desktop 或 colima），Foundry 会把它打开；应用的示例 env 文件要求、但只有你的 checkout 里的 env 文件才有的变量，会从那里取过来。
  - 错误页面的截图（HTTP 错误、"could not be found" 页面、空白页）看不到里程碑的内容：会被剔除，琥珀色提示会说剔除了几张。
  - 应用没有响应，或者只显示错误页面时，Foundry 会用这个应用的 mock 命令、带着假数据再录一遍：**How to run it** 里的 **Mock command**，或者应用 `package.json` 里的 `dev:mock`、`start:mock` 或 `mock` 脚本。这时摘要以 *With mock data* 开头。负责带里程碑界面的 worker，在应用需要后端、Docker 或密钥才能运行时，会被要求加上这样一个脚本。
- 预览，已经在启动，带 **Open preview**。
- **What the self-check saw**：自检开着时的最新截图。
- **Artifacts**：媒体类 goal 目前产出的图片和文件。
- 目前的代码在 **Diff** 标签上；文件夹在 **Open ▾** 里。

然后要么按 **Continue**，要么写下你看到的，按 **Turn into a plan**。具体怎么运作，一步步写在 [Foundry 什么时候需要你](./when-foundry-needs-you.zh.md#里程碑可以看了)。

同样的截图和视频会在第二条消息 **📸 What the milestone looks like** 里发到你的通知渠道，不管 goal 有没有暂停；之后也可以在 Overview 的 **Milestones** 卡片里重看。视频太大、超过渠道上限（Telegram 50 MB，Discord 10 MB）时，留在 goal 页面上，消息里会说明。

## Activity

goal 发生过的所有事，最新的在前，每件一行：阶段、任务开始和结束、检查、决定、交付步骤。**important only** 隐藏常规的行；**show bookkeeping events** 显示更多。以 **…** 结尾的行只显示了一段较长文字的开头，比如 worker 的消息、检查结果或一条说明；点它可以看全文。

![勾选 important only 的 Activity 标签：goal 通过审查、每项检查、每个任务的合并，最新的在最上面](images/goal-activity.png)

## Diff

goal 相对起点改过的每个文件，以及各自新增和删除了多少行。这正是会进入 pull request 的内容。

点一个文件，会在弹窗里打开它的改动：代码按语言着色，新增的行为绿色（+），删除的行为红色（−），并标出在旧文件和新文件中的行号。**Whole file** 显示文件现在的完整内容，goal 改动的行带底色（goal 的文件夹还在时可用）。顶部的箭头，或 ← 和 →，切换到上一个或下一个文件。

![Diff 标签：goal 改动的每个文件，以及新增和删除的行数](images/goal-diff.png)

## 取消、重启、删除

| 你想 | 这样做 |
|---|---|
| 立刻停止 goal | 顶部的 **Cancel**。运行中的会话会停止。已完成的工作留在 goal 的分支上。 |
| 停止后再运行一次 | **⋯ → Restart…**。选 **All tasks from the beginning** 或某一个任务；那个任务和之后的所有任务会用新的尝试重新运行。之前的任务保留结果，重启的任务在已有工作的基础上继续。goal 处于 blocked、done、over-delivered、failed 或 cancelled 时可用。 |
| 重做一个任务 | 在 **Tasks** 标签打开它，按 **Restart from here**。 |
| 批准前重新规划 | **⋯ → Re-run Clarify**（Brief 页面上也有）。 |
| 删除 goal | **⋯ → Delete goal…**。运行中的会话停止。进度文件夹、任务文件夹和 goal 的分层交付分支会被永久删除；附件移到废纸篓。goal 从列表中消失，它的事件历史会保留。勾选 **Also delete the branch** 会连 goal 的分支一起删除；如果你从没推送过，这些工作就没了。 |

## The Agents page

![Claude Code 和 Codex 会话（演示数据）](images/agents.png)

使用 **All agents**、**Claude Code** 或 **Codex** 筛选会话。编码智能体旁的数量表示已加载的近 24 小时会话。**Search sessions** 在所选编码智能体内匹配标题、目标名称、模型、目录及会话 ID。列表自动刷新，外部会话仍只读。

顶栏上的 **Agents** 合并显示 Foundry 自己的会话和近期原生 Claude Code、Codex 历史，每行标明编码智能体。读取数量有限，不是全部历史会话的清单。

- **Foundry agents**：Foundry 为你的 goal 启动的会话，按 goal 分组。每组标题显示 goal、它的编码智能体、项目文件夹、会话数量和正在工作的数量；**Open goal →** 打开 goal 页面。点标题可以收起或展开该组。组里有会话在工作或 idle 时（或者只有一个 goal 时）默认展开；你的选择会记在这个浏览器里，搜索时所有组都会展开。运行中的会话可以用 ■ 按钮停止。每一行写明会话处理的任务，带 **work** 或 **merge** 标签和第几次尝试；**merge** 会话在集成或交付时把某个分支更新到最新。
- **Your sessions**：你自己打开的会话（在终端里、在 VS Code 里）。Foundry 只看着，从不碰它们。

每一行把信息叠在一起：会话是什么（标题；你自己的会话还有文件夹和分支）、由什么运行（编码智能体图标——Claude Code 橙色、Codex 蓝色——以及模型和可用的上下文用量）、什么时候（最后活跃时间，以及运行了多久或在哪里打开）。助手 agent 缩进显示在启动它们的会话下面，每个都显示描述、类型、状态、模型、上下文用量、最后活跃时间和运行时长。点一行可以跟看它的对话：和任务的实时日志一样，每条消息占一行，点一行就在窗口里打开整条消息。标题栏统计过去 24 小时内 **working**、**idle**、**finished** 和 **unknown** 的会话数。外部 Codex 会话及其子会话的进程状态未知，不计入已知忙碌数量。有会话在工作时，顶栏上一个小的 **N busy** 标签显示有几个。

如果某个会话长时间 **idle**，而它的 goal 显示正在运行，就值得看一眼；任务的实时日志通常会说明原因。
