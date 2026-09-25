# 拿到结果

> [English](./getting-the-result.md) · 中文

## 结果在哪里

goal 完成后，它的工作在你电脑上的两个地方：

- **在你项目的一个分支上**，名字像 `goal/…`。分支是一条独立的历史线：在你决定把工作合进来之前，你自己的文件都不会被动。goal 页面顶部显示分支名（比如 `main → goal/abc123`）。
- **在进度文件夹里**，就在你的项目旁边：`<project>-foundry/<goal>/`。它就是那个分支，已经检出，可以直接打开和运行。见 [运行期间](./while-it-runs.zh.md#进度文件夹)。

goal 页面会用大白话告诉你："The work is on branch … in your repository. Nothing has left your machine." 接下来会发生什么，取决于你选的交付方式。

## 交付方式

交付方式在 New goal 表单里选（**4 · Delivery**），之后随时可以在 goal 的 **Delivery** 标签里改。

| 方式 | goal 完成时 Foundry 做什么 |
|---|---|
| **Local only** | 什么都不做。工作留在本地分支上。你想推送时自己推。这是 [Settings → New goal defaults](./settings.zh.md#new-goal-defaults) 里的默认，New goal 表单就从那里开始。 |
| **Push branch** | 先把基础分支上的新工作并进来，再把 goal 的分支推送到线上副本（比如 GitHub）。不开 pull request。 |
| **Open a PR** | 推送，然后开一个 pull request，用 Brief 和检查结果作为描述。由你审查并合并。 |
| **PR + auto-merge** | 开 pull request，等它的自动检查（CI），需要时修好 CI，全部通过后合并，并删除推送的分支。 |

用 **PR + auto-merge** 时，如果 GitHub 上的分支保护挡住了合并，Foundry 会打开 GitHub 自己的 auto-merge（`gh pr merge --auto`），并等一段时间（[Settings → Git & delivery](./settings.zh.md#git--delivery)）。如果到时 GitHub 还没合并，它之后会自己合并，Foundry 也不会删除这个分支。

每种方式都遵守两条规则：

- 推送、开 PR 和合并都由 Foundry 自己来做，严格按 Delivery 标签上列出的计划。给你做任务的 AI 不能推送；它要是试图推送，Foundry 会拦下并问你（见 [Foundry 什么时候需要你](./when-foundry-needs-you.zh.md#它想在你电脑以外做事)）。
- Foundry 从不强制推送，也从不直接推送到你的基础分支（比如 `main`）。改动只能通过合并进入 `main`。

pull request 类的方式需要 GitHub CLI 和一个已连接的账户：见 [连接 GitHub](#连接-github)。

## 整个 goal 一个 PR，还是每个任务一个

在 **Granularity** 下（选了 Local only 以外的方式后才出现）：

- **One PR for the whole goal**（默认）：所有内容放在一个 pull request 里，标题用 Brief 里的 pull request 标题。选 **Push branch** 时，这一项显示为 **One branch for the whole goal**。
- **One PR per task — stacked**：每个任务一个 pull request，每个都建在下面那个之上，标题用该任务的提交信息。开了 auto-merge 时，从下往上依次合并。选 **Push branch** 时，这一项显示为 **One branch per task**。

每个任务一个 PR，要审查的 pull request 更小，但每个都要单独推送、等待、合并一轮，所以更慢。只有一个任务的 goal 总是只有一个。如果某个任务没法干净地拆出来，Foundry 会退回到整个 goal 一个 pull request，并告诉你。

## 其它交付选项

选了 **Local only** 以外的方式后，会出现更多选项。

### Target

**remote** 是线上副本的名字（几乎总是 `origin`，会从你的项目里自动填好）。**base branch** 是 pull request 要合入的分支；留空表示 goal 起步的那个分支。**merge method**（只用于 auto-merge）有 **squash**（默认：在基础分支上只留一个提交）、**merge commit** 或 **rebase**。

### 还没有线上副本

如果你的项目还没有线上副本，表单会显示 **No remote yet**，并提供两种办法：

- **existing remote URL**：粘贴你建好的空仓库地址，比如 `git@github.com:you/repo.git`。
- **or create a GitHub repo**：选择所有者（你自己或你的某个组织）、名字，以及 **private** 或 **public**。Foundry 在交付时创建它。连接了 GitHub 时，这些会替你填好：你的账户、文件夹的名字、private。

### PR 开出之后

只用于 **PR + auto-merge**。四个开关默认都打开。

| 选项 | 含义 |
|---|---|
| **Wait for CI checks** | 等每个自动检查都报告结果后才合并。关闭：GitHub 一允许就合并。 |
| **Merge when no checks are configured** | 关闭：没有 CI 的仓库会停在已开出的 pull request 这一步。 |
| **Auto-resolve conflicts with the base branch** | 如果 `main` 有了新进展并产生冲突，由 Foundry 解决。关闭：冲突会让交付停下。 |
| **Delete the remote branch after merging** | 只删这个 goal 推送的分支，从不删基础分支。 |
| **Fix failing CI** | **don't fix**、**up to once**（默认）或 **up to twice**。见 [CI 失败时](#ci-失败时)。 |

## 连接 GitHub

交付选项底部有一行 GitHub 状态：

- **GitHub: yourname** 表示已连接。
- **gh installed, not logged in** 旁边有个 **Connect GitHub** 按钮。按下它，复制显示的一次性代码，打开链接，在 GitHub 里批准，然后按 **Done**。
- **GitHub CLI not installed** 表示这台电脑上没有 GitHub CLI。安装 Foundry 的人可以装上它；Setup 页面在 **GitHub CLI (optional)** 下显示了命令。

**Push branch** 不需要 GitHub CLI（除非要 Foundry 替你创建 GitHub 仓库）；它只需要线上副本接受你的推送。

## The Delivery tab

在 goal 页面上打开 **Delivery** 标签（在 Simple view 里，Result 卡片上的 **Deliver…** 会切换到 Expert view 并直接打开它）。

**goal 完成之前**，它显示 **Will deliver automatically when the goal is done**（方式是 Local only 时不显示）。你可以改交付方式，然后按 **Save policy (runs when done)**。选着 **Local only** 时，这个按钮是灰的。

**交付过程中**，卡片用勾、转圈或叉显示每一步：**Preflight**、**Remote**、**Sync with base**、**Build stack**、**Push**、**Open PR**、**CI checks**、**Fix CI**、**Merge**、**Cleanup**（只显示你的方式需要的步骤）。**Cancel** 停止交付。

**pull request** 以列表显示，带标题、CI 结果（**passing**、**failing**、**pending**）、状态（**open**、**merged** ……）和一个链接 **#123**，点开可以在 GitHub 上查看。Overview 标签的时间线也会显示 **Deliver · mode · N PRs · N merged**。

**合并之后**，有三行显示工作是否已在 GitHub 上合并、是否已在你自己的文件夹里，以及 goal 的文件夹是否已清理。见 [pull request 合并之后](#pull-request-合并之后)。

**N remote command(s) — full audit** 列出 Foundry 对线上副本执行过的每条命令及其结果。

**Change delivery**（Local only 的 goal 则是 **Deliver this goal**）是你选择方式、查看确切计划的地方：Foundry 会按顺序执行的每一条命令。除此之外什么都不会执行。按钮随后会说明它要做什么：**Push now**、**Open PR now**、**Open PRs now**、**Open PR and merge when green** 或 **Open PRs and merge when green**。

## CI 失败时

CI 是你的线上仓库对每个 pull request 运行的一组自动检查。交付前 Foundry 自己的检查已经通过了，但 CI 可能测得更多。

- 用 **Open a PR** 时，Foundry 不等 CI。你在 pull request 上看结果，自己决定。
- 用 **PR + auto-merge** 时，Foundry 会等。如果 CI 失败且 **Fix failing CI** 允许，一个小的修复任务会读失败日志，修好 goal 的分支，再推送一次。如果 CI 仍然失败，或者关了修复，交付会以 **failed** 停下：原因在 Delivery 标签上，pull request 保持打开；如果 **Delivery** 开关开着，你还会收到通知。如果修复任务自己也放弃了，Inbox 里还会出现一张 *Retries exhausted* 卡片。

交付失败后，你可以先修好原因（比如连接 GitHub，或修好 CI 配置），再按一次交付按钮。或者自己在 GitHub 上合并 pull request。

## 之后再改交付方式

随时可以在 Delivery 标签上改方式：

- 已完成的 **Local only** goal：选 **Push branch** 或 **Open a PR**，按按钮。goal 的其它东西都不变。
- 还在运行的 goal：选新方式，按 **Save policy (runs when done)**。

## 媒体类 goal 和输出文件夹

图片和视频 goal 产出的是文件，不是代码。这些文件从不加入 git；分支上只记录它们的清单（每个文件是什么内容、怎么做出来的）。

- 如果你在 New goal 表单里选了 **Output folder**，goal 完成时成品文件会复制到那里。Result 卡片会显示 "N file(s) are in … — open the folder and have a look."
- 没选输出文件夹时，它们留在进度文件夹里的 `artifacts` 文件夹中。用 **Open ▾** 过去。

goal 运行时，里程碑卡片会显示目前产出的文件。

## 完成后的附加项

你在 Brief 上选了最后自动运行哪些（见 [批准 Brief](./approving-the-brief.zh.md#completion)）：

- **Documents**（PRD、README update、Changelog、Confirmation sheet）在最终审查通过后写出，作为一个提交保存在 goal 的分支上，所以会和工作一起放进同一个 pull request。
- **Refresh the knowledge graph** 在交付后更新代码地图：Local only 的 goal 在进度文件夹里更新，已交付的 goal 在你自己的文件夹里更新。

Overview 标签的 **Completion** 卡片显示每一项的结果。这里失败从不会让 goal 失败，只会记一笔。

## 把结果放进你自己的文件夹

### 不用 git

你不必碰 git。进度文件夹*就是*完成的项目：用 **Open ▾ → Goal workspace**（在 Simple view 里是 **The result**）打开它，直接用，或者复制你需要的东西。goal 结束后它还在那里，直到这个 goal 的 pull request 合并、而且工作已经到了你自己的文件夹（见下文）。

### pull request 合并之后

Foundry 会自己把合并后的工作带进你自己的文件夹：先 fetch，再把你的基础分支（比如 `main`）fast-forward。只有在不会碰到你任何东西时它才这样做：你的文件夹里没有未保存的改动，这个分支上也没有你自己还没推送的提交。等你的文件夹有了这些工作，Foundry 会清掉 goal 留下的东西：进度文件夹、它的 worktree 和本地的 `goal/…` 分支。截图、goal 页面和它的历史都会保留。

goal 页面会显示现在的情况，在 Delivery 标签和 Simple view 的 Result 卡片上：

| 这一行 | 意思 |
|---|---|
| **Merged into main on GitHub** | pull request 已经合并。合并之前显示 **Waiting for the pull request to merge**；如果它被关闭了，显示 **closed without merging**（什么都不改、不删）。 |
| **Your local main is up to date** | 你自己的文件夹已经有这些工作。如果 Foundry 没能更新它，这一行会说明原因，并有一个 **Pull into my checkout** 按钮可以再试（比如你提交或暂存了自己的改动之后）。你也可以自己运行 `git pull`。 |
| **Workspace cleaned up** | 进度文件夹和本地分支已经删掉。如果它们还在，这一行会说明原因（你的文件夹还没有这些工作，或者进度文件夹里有未保存的改动），并有一个 **Clean up anyway** 按钮。 |

之后才合并的 pull request —— auto-merge 超过了 Foundry 等待的时间，或者你自己在 GitHub 上合并的 —— 会在几分钟内、或者你一打开 goal 页面就被发现，然后跑同样的步骤。这一切都可以在 [Settings → Git & delivery](./settings.zh.md#git--delivery) 里关掉；关掉后，只有你按 **Pull into my checkout** 时你的文件夹才会改变，文件夹也会一直留到你删除这个 goal。

### Local only 的 goal

工作在你项目里 goal 的分支上。你自己的文件夹没法切换到那个分支（进度文件夹占着它），但你可以合并它：在你的文件夹里，在你的基础分支上，运行

```
git merge goal/abc123
```

分支名用 goal 页面顶部显示的那个。或者把交付方式改成 **Push branch** 或 **Open a PR**，让 Foundry 通过 GitHub 来做。

不再需要这个 goal 时，**⋯ → Delete goal…** 会删除它和它的进度文件夹；只有在工作已经合并或推送之后，才勾选 **Also delete the branch**。

## Continue with a follow-up

一个 goal 很少是最后一步。goal 结束后（done、over-delivered、failed 或 cancelled），它的页面会显示 **Continue with a follow-up…**。它会打开 New goal 表单，带着一个 **Follows: …** 标签，并且已经填好之前那个 goal 的仓库、goal 类型、模型、effort、Fast mode、视图和交付方式。你只要写接下来要做什么；改主意了就把标签去掉。表单里的 [Follows](./your-first-goal.zh.md#follows) 部分会说明新 goal 从哪里开始，也可以选择不带附件或风格方向。

后续 goal 从之前的 goal 拿到的东西：

- **给 Clarifier 的背景：** 你当时要求了什么、已批准 Brief 的理解和决定、每个任务的结果、最终审查，以及没达到的 Stretch 检查。这些在创建后续 goal 时就复制下来了，所以之后删掉之前的 goal 也不会有影响。
- **从哪里开始：** 之前的工作已经在你的基础分支上时，就从基础分支开始；否则从之前那个 goal 的分支开始。这种情况下，Delivery 标签会说明之前那个 goal 的改动会随着这个 goal 的 pull request 一起交付。pull request 的目标仍然是你的基础分支。
- **附件和风格**（除非你取消了勾选）：附件的副本，以及选定的风格方向和它的参考样图，在新的 Brief 上已经选好。

之后 goal 页面会显示 **Follows: …**，之前那个 goal 上会显示 **Followed by: …**，都是链接。如果之前的 goal 被删除了，后续 goal 会显示 "follows a deleted goal" 和它的标题。在 goal 列表里，后续 goal 的标题下面有一小行 "↳ follows …"。

在命令行里：`foundry goal new "<prompt>" --follows <goal id>`。

### Mark as follow-up of…

如果你单独开了一个 goal，但它其实是接着之前某个 goal 做的，在它的页面上打开 **⋯ → Mark as follow-up of…**，选同一个仓库里更早的一个 goal。这只会记录这个关联：代码、分支和 Brief 都不会有任何变化。
