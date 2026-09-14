# Foundry
> 中文 · [English](./README.md)

一套本地编排系统，驱动**你宿主机上的 Claude Code**（订阅登录、你自己的 skills、你自己的 MCP 服务器）在软件目标上超额交付——只需 Clarify 一次，随后自动、并行地在隔离的 git worktree 中执行 Plan → Act → Observe → Retry，只在五种原因之一发生时才打断你。

术语定义见 [CONTEXT.md](./CONTEXT.md)。为什么这样设计：[docs/adr](./docs/adr)。goal 运行时那些消息（实时日志行、task 状态、Inbox 通知、引擎备注、重启规则）是什么意思：[docs/runbook.md](./docs/runbook.zh.md)。在家里的机器干活时如何用手机操作它：[docs/remote-access.md](./docs/remote-access.zh.md)。

## 工作原理

```
Goal ──► Clarify ──► Brief (you approve once) ──► Tasks (DAG) ──► Goal review ──► local branch
              │                                      │
         explores repo                    per task: Attempt = fresh claude -p session
         graphify / grep                            ├─ Act     (worker role, boundary-guarded)
         planner subagent                           ├─ Observe (command checks + cheap reviewer)
                                                    └─ Retry   (new session + observation report)
                                          parallel tasks: own worktree, merged back; conflicts → Merge Attempt
```

- **Must / Stretch 检查。** Must = 你要求的东西（外加仓库自身的质量关卡）。Stretch = Clarifier 提出、由你接受的额外内容。所有 Must 通过 → `done`；连 Stretch 也通过 → `over_delivered`。未经你批准，任何东西都不会被加进范围。
- **五种升级，别无其他：** 一个阻塞性的 Brief 问题 · 一个 task 用尽重试次数 · 一条会离开工作区的命令（`git push`、PR、部署——被 PreToolUse hook 拦截）· 预算超支 · 一个被拒绝的工具。其余一切都是自动的。
- **产物是一个本地分支**（`goal/<id>`），检出在**你的仓库旁边的进度文件夹**里（`<repo>-foundry/<goal>/`），随时可以打开、运行、查看。推送是你点一下的按钮。
- **先问再规划。** Clarify 会分轮访谈你——只问仓库里查不到的决定，每题带推荐答案和提问依据——没有可问的了才写 Brief。小 goal 直接出 Brief。
- **做完之前你就能看。** Brief 会标出 1–3 个里程碑；一到里程碑，goal 暂停、启动预览并通知你（开了自检还会附截图）。你可以继续，也可以写下看到的问题——它会变成后续任务的 hint、修复任务或一条 Decision，确认后才生效。
- **事件溯源。** 每一次状态变更都是 SQLite 里的一个事件；UI 流式播放同一批事件；引擎通过重放 + 对账从崩溃中恢复。

## Docker

```bash
docker run -d --name foundry -p 127.0.0.1:4111:4111 \
  -v foundry-data:/app/data -v foundry-claude:/home/node/.claude -v ~/Projects:/repos \
  imlouiskhenghao/foundry        # http://127.0.0.1:4111, your repos at /repos/<name>
```

然后在 Setup 页面登录 Claude：它给你一个链接和一个输入框，用来填浏览器返回的 code（容器自身没有浏览器）。在终端里执行 `claude auth login`，或用 `claude setup-token` 生成的 token，同样可以。

镜像自带引擎、UI 以及它所驱动的工具（bun、git、`claude`、`gh`、ripgrep、npx、uv、graphify、markitdown）；你的 Claude 登录和你的仓库以挂载方式接入。细节与注意事项：[docs/docker.md](./docs/docker.zh.md)。

## 环境要求

- macOS/Linux、[Bun](https://bun.sh) ≥ 1.1、git
- 已安装并登录的 Claude Code CLI（`claude` 在 PATH 中）。驱动 Claude 不需要 API key——而且 `ANTHROPIC_API_KEY` 会被刻意从子进程中剥除。（图像生成类 goal 是唯一例外：它们需要一个 OpenAI 兼容或 Gemini 的 key，在 Settings → Tools & keys 中设置。）
- 可选：PATH 中的 [`graphify`](https://github.com/safishamsi/graphify)，用于提供代码图谱上下文（自动探测）。

## 快速开始

```bash
bun install
bun run web:build          # builds the UI into apps/web/dist (served by the engine)
bun run serve              # http://127.0.0.1:4111

# Full flow (Clarify → Brief in the UI → run):
bun run cli goal new "Add CSV export to the orders API" --repo ~/code/my-app

# Skip Clarify: one task + explicit checks
bun run cli goal new "Fix the failing tests" --repo ~/code/my-app --auto-approve --check "bun test" --follow
```

在自带的 fixture 上试一试：

```bash
bun run fixture                     # creates fixtures/demo-repo with a planted bug
bun run cli goal new "Fix the bug in src/math.ts so tests pass" --repo fixtures/demo-repo --auto-approve --check "bun test" --follow
bun run fixture -- --parallel && bun scripts/e2e-conflict.ts   # two parallel tasks that conflict → Merge Attempt
```

### 在新机器上首次运行

```bash
bun run cli doctor                 # claude installed? logged in? git, bun, graphify, required skills…
bun run cli skills install --tier required    # or: --tier recommended
```

Web UI 里在 **Setup** 下有同样的功能（首次运行发现缺东西时会自动打开），还有一个 **Skills** 页面，列出这台机器上 Claude Code 能看到的每一个 skill——用户级（`~/.claude/skills`）、插件提供的、以及项目级的——并标明每个由谁管理（手动安装、`npx skills` 链接、gstack clone/copy、插件、Foundry）、同名冲突警告、从精选目录一键安装，以及可逆的卸载（skill 会被移入 `data/skills-trash/`，绝不 `rm -rf`）。

目录位于 [`catalog/skills.json`](./catalog/skills.json)：`required`（缺了它引擎会明显变弱——如今只有 graphify）、`recommended`（改善 worker / reviewer / clarifier 各角色）、`optional`。每一条都说明*为什么*。改这个 JSON 就能整理出你自己的目录。

**来源与更新。** Skills 页面按来源把每个已安装的 skill 分组——由 Foundry 管理的 GitHub 仓库、由 `npx skills` 管理的、由某个 Claude Code 插件管理的；gstack clone；项目 skill；以及来源靠字节比对已知源推断出来的手动安装副本。对每个来源它会显示安装时间、上游最近变更时间，并对每个 skill 显示它是最新、过时（字节匹配某个较旧的上游版本）还是本地已修改。*Check for updates* 会把每个上游仓库拉取进 `data/skills-cache`（深挖到 100 个 commit，好让每个 skill 的日期是真实的）。点一下就用它自己的工具更新整个来源——`npx skills update`、`claude plugin marketplace update` + `claude plugin update`，或者 Foundry 自己的安装器——过程输出流式呈现，每一次运行都记为一个 `skills.update_run` 事件。匹配某个目录条目的散装副本可以被*采纳*（替换成一个受管安装，旧副本进回收站）；遮蔽了更新插件 skill 的用户级副本会被 doctor 标记出来，一键清进回收站。

**Simple 还是 Expert。** 每个 goal 都以同一个引擎的两种视图之一打开（创建时选择；Settings → New goal defaults 设置默认值；随时可按 goal 切换）。*Simple* 展示一份大白话的 Brief——系统理解了什么、只有你能回答的问题、你可以否决的假设、你将得到什么的清单、价格——运行时则用大白话展示进度条、花费以及任何需要你处理的事项。*Expert* 展示一切：Area、task 图、验收检查、Draft/Revise、attempt 日志、merge 解决过程、交付。另有两项按 goal 的设置：**TDD required / preferred / off**（Simple goal 从 *preferred* 起步；任何 task 都可在 Brief 中关掉它；docs、infra、chore 和 research 类 task 从不被强制 TDD），以及 **pace**——*thorough*（默认）会跑引擎自己的 task 与 goal 评审并撰写文档，*fast* 则全部跳过，你批准的检查一通过就结束 goal（图像和视频类 goal 从 fast 起步）。

**Workflow。** Foundry 遵循 Matt Pocock 的工程 workflow（[ADR-0004](./docs/adr/0004-workflow-skills-mandated-and-observed.md)）。目录条目携带 `workflow` 规则——worker 对功能和重构**必须**调用 `tdd`、对 bug **必须**调用 `diagnosing-bugs`，merger **必须**用 `resolving-merge-conflicts`，goal reviewer 应当施用 `code-review` 的两条评审轴——每个 session 都会得到一个 `# Workflow skills` 小节，点名那个实际加载的调用（插件副本优先）。runner 记录每个 session 调用了哪些 skill；task 抽屉里展示它们，且当某个被强制的 skill 被跳过时会告知 task reviewer（一条备注，而非阻塞）。Setup 页面有一张一键的 *Development workflow* 卡片，负责安装/采纳这套组合。`FOUNDRY_WORKFLOW=plain` 把它退回成从前那一行提示。

**Scenario 与 pack**（[ADR-0005](./docs/adr/0005-scenario-skills-and-settings.md)）。Clarifier 为每个 task 打上一个 *scenario* 标签（frontend、backend、fullstack、data、mobile、infra、docs、research、image、video、general），目录规则可以绑定到 scenario。UI 类 task 会得到一个 **design pack** 作为 MUST——在 Setup 或 Settings → Skills 中选择：ui-ux-pro-max（默认；一个引擎可用 `claude plugin` 安装的插件）、Anthropic 的 frontend-design、[impeccable](https://github.com/pbakaus/impeccable)、[bencium](https://github.com/bencium/bencium-marketplace) 组合包（impact-designer + design-audit + typography）、[garden](https://github.com/ConardLi/garden-skills) 的 web-design-engineer，或 `taste`（design-taste-frontend）。媒体类 task 以同样方式得到 **image** 与 **video** pack：image = gpt-image-2（默认）、claude-image-gen（Gemini / OpenAI gpt-image）或 taste-imagegen；video = web-video-presentation（默认）、mmx-cli 或 hyperframes 的动态图形套件。各 pack 互斥：只有选中的那个会展示给 session，goal reviewer 则拿到它对应的评审版本。

**代码之外**（[ADR-0008](./docs/adr/0008-non-code-goals.md)）。一个 goal 的 *nature*——code、docs、research、image 或 video（或 *auto*，由 Clarifier 决定）——会改变 Brief 问什么、以及“done”意味着什么。媒体类 goal 把文件写进 git 之外的 `artifacts/`，在 `docs/artifacts/` 下带一份已提交的清单，完成时把结果复制到 goal 的输出文件夹。

**项目 skill（autoskills）。** 当一个 goal 的 Brief 被批准，引擎会在该 goal 的工作区里跑 [`npx autoskills`](https://www.autoskills.sh/)（需要 Node ≥ 22 以及一份技术栈清单，如 `package.json`）：它探测技术栈，把匹配的 skill 安装进工作区的 `.claude/skills`。引擎随后恢复 `CLAUDE.md`（autoskills 会改写它），把新的 skill 目录和 `skills-lock.json` 加进仓库的 `.git/info/exclude`——注意这条 exclude 会被该仓库的所有 worktree 共享，包括你自己的 checkout——把这些 skill 复制进各 task 的 worktree，并告知每个 worker 加载了哪些项目 skill。关闭开关：Settings → Skills → autoskills。

### 创建一个 goal

New Goal 页面先问这是哪种 goal（nature：auto / code / docs / research / image / video）以及你想看多少（Simple 还是 Expert、pace、TDD），然后是四个步骤。**Goal**——描述它，并附上文字承载不了的东西：截图、PDF、文件或链接（拖入、粘贴或选取；每个 ≤ 25 MB，存放在 `data/attachments/<goal>/` 下，作为只读参考交给该 goal 的每个 session，绝不复制进仓库）。当 [markitdown](https://github.com/microsoft/markitdown) 已安装（Setup 有一键 `uv tool install`），PDF、Office 文件、HTML、EPUB…… 在上传时被转成 markdown，链接被快照为 markdown，于是 session 只需 `Read` 一个 `.md`，而不必把 PDF 页面渲染成图片或花一次 WebFetch——token 少得多。worker 还被告知，对它们在仓库内部遇到的文档执行 `markitdown <file>`。点开一个附件：*Markdown* 标签页展示 session 究竟读到了什么，*Original* 标签页内联展示图片、PDF 和文本（其他类型在新标签页打开）。**Repository**——*Select folder…* 打开一个文件夹浏览器（近期仓库、常见位置、git 徽标；在 macOS 上还有原生 Finder 对话框）；下面的面板展示分支、commit、remote 和身份，需要时提供一键 `git init`，并根据探测到的内容预填 Delivery。**Budget**——预设：*Auto*（默认：clarify 期间不设上限；Brief 的估算 ×2 会被提出，你在批准前确认或修改它）、*Quick*、*Thorough*、*Unlimited*、*Custom*。**Delivery**——见下文。

**Brief。** Clarify 以一份你只批准一次的文档收尾。Clarifier 先列出这个 goal 覆盖的 **Area**（它点名的每个面向用户的角色或 app 一个——学生门户、教师门户……——外加一个用于打底工作的 *shared* Area），然后**每个 Area 规划 1–6 个 task**（总数不设上限；超过 12 个时页面会警告这个 goal 很大）。每个 task、goal 级检查和问题都携带它的 Area；引擎会检查每个 Area 至少有一个 task，缺失时会把 Clarifier 打回一次——依然存在的缺口会变成页面上的一个问题。Brief 页面展示 task 图（按 Area 上色），并按 **Stage** 列出各 task（一个 stage 里的 task 并行运行；上一个 stage 完成后下一个才开始）；每张 task 卡片有一个 *runs after* 选择器、它的 kind / scenario / Area / commit scope（留空 = 该 Area 的 slug）、它的 spec，以及它自己的验收检查（Command = 一条必须退出 0 的 shell 命令，Reviewer = 一个 Claude session 依据评分标准判定 diff；可切换类型、切换 must/stretch、把某项检查在 task 与 goal 两级之间移动）。goal 级检查坐在它们自己的卡片里，按 Area 分组。对你新加的 task 点 **Draft with AI**，会从 Brief 以及对仓库的只读查看中起草它的 spec、属性、依赖和检查（≤ $2，强模型）；对已有 spec 的 task 它只*建议验收*；没有 task 的 Area 提供 *Draft tasks for this Area*。所有东西都作为一份提案回来，你逐项接受——你亲手输入的任何内容都绝不会被覆盖。**Decisions。** 你对 Brief 各问题的回答以及你取消勾选的假设都是 *decision*：每个 worker、goal reviewer 和 PR 正文都会一字不差地收到它们，重新跑一次 Clarify 会从它们出发，而不是再问一遍。因为这些 task 是在你做决定之前规划的，Decisions 卡片提供 **Revise with answers**（≤ $3）：Clarifier 重读 Brief 和仓库，返回一份 diff——改动、新增或删除的 task、检查与 Area——你逐项接受；在此之前页面会标注“N decisions not applied to the plan”，但不阻塞批准。

**Session 会接着干，而不是从头来。** 一个被切断的 worker session——被引擎重启、它按 session 计的轮次或花费上限，或者一次超时——会被*恢复*（`claude --resume`，完整上下文保留），而不是被一次得重新理解 task 的全新 attempt 取代；一个检查仍失败但有进展（它提交了点东西且没有变得更糟）的 session 也是如此：它拿到检查报告接着干。每个 attempt 最多 `sessions.maxContinuations` 次（默认 2），这些都不计作重试；超过之后，或者当毫无进展时，那条老的“带观察报告的全新 attempt”路径接手。一次 Merge Attempt 的第二次尝试会恢复第一次。Task 视图在被延续的 attempt 上显示 `↻n`。

**从源头减少冲突。** 有三样东西让并行的 task 不相撞：调度器绝不同时跑 `relevantFiles` 有重叠（同一个文件，或一个在另一个的目录里）的两个 task，不论 Brief 怎么说——等待的那个 task 会拿到一条备注；每次 attempt 之前、以及即将落地之前，一个在自己 worktree 里的 task 会与 goal 分支**追平**（其他 task 的 commit 被并进这个 task 分支，干净地并进、或经由一次带着该 task 上下文的 Merge Attempt；若连那也失败就让 worker 手动合并），于是重试是在当前代码之上进行，最终的 squash 不会冲突；而 Merge Attempt 只按*回归*来评判——那些在合并之前就已经在 goal 分支上红了的 must 检查（每个 commit 在一个用后即弃的 `_baseline` worktree 里算一次）不会记在一次正确解决的合并头上。planner 还被告知把共享注册表（`schema.gql`、导航配置、barrel、Prisma migration）留给后面一个非并行的接线 task。

**你亲自解决的合并冲突。** 当两个 task 碰到同几行，引擎最多跑两次 Merge Attempt（一个强模型 session 编辑冲突文件，然后跑 must 命令检查）。若它们放弃，该 task 被阻塞，Inbox 条目会准确说明每次尝试为何失败（是留下了冲突，还是检查失败了）——并提供 **Resolve manually**。那个页面在一个单独的 `_resolve` worktree 里重建冲突（goal 的其余部分继续合并），逐一列出每个冲突文件，*ours*（goal 分支）和 *theirs*（task 分支）并排展示，让你选一边、两边都要、在浏览器里编辑结果，或在你的编辑器里打开这个 worktree。*Finish merge* 把解决结果作为该 task 的 Conventional Commit 提交，跑 must 检查（带一个 *Finish anyway* 的逃生口），把它落到 goal 分支上并把 task 标为 done；这个升级由“完成”这一动作本身来回应。

**过期的 checkout。** 你的本地 `main` 常常落后于 `origin/main`。在一个 goal 探索仓库之前，引擎会跑 `git fetch origin main`（只更新 remote-tracking ref——你的工作树和分支毫发无损），当本地基点严格落后时，改从 `origin/main` 起 goal 分支；Clarifier 探索的正是那个 worktree。Repository 卡片展示这个差距（“3 behind origin/main — the goal will start from origin/main”），带一个 *pull into my checkout* 按钮把你的分支快进（当你有未提交改动或分支已分叉时会拒绝）。已分叉、或领先且有未推送的 commit → goal 从本地起，交付时的 sync-with-base 会并入远端。当一份 Brief 正待批准时，**Re-run Clarify**（Brief 页面，或 Goal 页面的 ⋯ 菜单）把 goal worktree 和 Brief 扔掉，再次 fetch，让 Clarifier 探索崭新的 tip——附件、预算和交付策略都保留。Settings → *Sync with upstream*（`fetchBeforeGoal`、`startFrom`，以及一个默认关闭的 *refresh between tasks*，它会在没有任何东西运行时把一个已移动的基点并进 goal 分支）。

在 Goal 页面，**Open ▾** 会用装好的任何东西（VS Code、Cursor、Zed、Windsurf、Finder、Terminal、iTerm、Warp）打开仓库 checkout、goal 分支 worktree 或某个 task worktree，或者复制路径；引擎只打开它自己解析出来的目录。

### 交付：git init → GitHub → PR → CI → merge

对每个 goal 你选一个**交付策略**（New Goal 页面，或稍后经由 *Deliver…*，它会先展示确切的计划）：

| mode | what the engine does once the goal is done |
|---|---|
| `local`（默认） | 什么都不离开这台机器 |
| `push` | 与基分支同步（冲突 → Merge Attempt），推送 `goal/<id>` |
| `pr` | ……然后开一个 PR，正文是 Brief + 检查结果 |
| `pr-automerge` | ……等 CI，红了就修一次（有界的 task），绿了就合并、删掉远端分支 |

**粒度。** 每个策略有一个 *unit*：`goal`（一切合成一个分支 / 一个 PR）或 `task`（新 goal 的默认：每个 task 一个 PR）。每个完成的 task 恰好变成 goal 分支上的一个 commit——引擎把它的各次 attempt squash 起来，写一条 [Conventional Commits](https://www.conventionalcommits.org) 消息（`feat(scope): subject`，type 来自 task kind，scope 与 subject 来自 Brief）；sync 合并和全新仓库的初始 commit 遵循同一标准，模型从不 commit。用 `unit: task` 时，交付会把那些 commit 逐个重新应用到远端基分支之上，进入 `goal/<id>-1-<slug>`、`goal/<id>-2-<slug>`、……，并每个分支开一个 PR，各自基于下面那个、以 commit 头作标题（PR 正文：task spec、它的检查、reviewer 备注、在栈中的位置）。auto-merge 自底向上走这个栈：把 PR 重新指向基分支、把基分支引入、等 CI、合并，然后在删掉已合并分支*之前*把它上面那个 PR 重新指向（GitHub 会关闭一个其基分支消失了的 PR）。失败后的重跑会从停下的地方接着来：已合并的 task 被跳过，分支位置稳定，一个打开的 PR 被复用，一个已关闭的被重开、或者——当 GitHub 拒绝时——用同一分支的一个全新 PR 替换。一个无法被重新应用的 commit（即便经过 Merge Attempt）会让引擎退回成整个 goal 一个 PR，并记一条 `delivery.note`。单 PR 的标题是 Brief 的标题（在 Brief 页面可编辑）。

绝不松动的规则：模型待在它的 worktree 里（hook），只有引擎碰远端，绝不 `--force`，绝不直接推基分支，每条远端命令都记为一个 `delivery.command` 事件。一个没有 git 的仓库会得到一键的 `git init` + 初始 commit；一个没有 remote 的可以在 GitHub 上创建（owner/org 选择器）。GitHub 身份用官方 `gh` CLI——`foundry github login` / Connect GitHub 跑它的 device flow；Foundry 不存任何 token。没有 `gh` 时，`push` 到一个已有的/URL remote 仍然可用。

**在 goal 评审之后、done 之前。** 当 pace 为 *thorough*，一个 **Documenter** session（仅文档，≤ $3）撰写你在批准 Brief 时选定的文档——一份 PRD、README 更新、一条 changelog 条目、一份干系人问卷——作为 goal 分支上的一个 `docs:` commit，从而在同一次交付里一起发布（[ADR-0007](./docs/adr/0007-completion-actions.md)）。交付之后，引擎在交付代码所在处刷新代码知识图谱（`graphify update`，装了的话还有 `gitnexus analyze`）。

### Agents 监视器

**Agents** 页面（`/agents`，页头小胶囊）实时展示这台机器上每一个 Claude Code session——Foundry 启动的那些，以及你自己开的那些（终端、VS Code）——带状态（busy / idle / finished）、模型、耗时、上下文窗口占用和嵌套的子 agent。点一个 session 看它的实时日志；Foundry 启动的 session 可以从这里停掉，外部的只做监视。

### 通知

Foundry 可以在一个 goal 需要你、完成或交付时，在一次 Claude 用量限额暂停/恢复引擎时，或在有新版本发布时，推送到 **Telegram** 和 **Discord**（Settings → Notifications）——每一类各有自己的开关，带一个 *Send test message* 按钮和一个链接 base URL，让消息深链回正确的页面。逐步设置见 [docs/notifications.md](./docs/notifications.zh.md)。在家里的机器持续干活时用手机访问 UI：[docs/remote-access.md](./docs/remote-access.zh.md)。

### 用量与限速

**Usage**（页头小胶囊 + `/usage` 页面、`bun run cli usage`）是一个小仪表盘，展示 Foundry 自身消耗了什么：当前的 5 小时和 7 天窗口（花费、token、耗时条、重置倒计时、每小时 / 每天花费）、缓存命中率、每个 session 的平均花费和时长、失败的 session，以及按 goal（带标题）、session 种类和模型的细分，外加 CLI 给出的最近一次限速信号（`allowed` / 重置时间）。当一个 session 报告订阅被限速，引擎会停止启动新 session 直到重置时间，然后自行恢复。订阅套餐不暴露用量 API，所以这些是 Foundry 自己的数字，不是你账号的百分比——想要那个就在 Claude Code 里跑 `/usage`。我们从不读你的凭据。

### CLI

```
serve                                    start engine + server
goal new "<prompt>" --repo <path> [...]  create a goal (--preset auto|quick|thorough|unlimited|custom, --max-cost N|none,
                                         --max-min, --concurrency, --attempts, --auto-approve, --check, --stretch, --follow,
                                         --deliver push|pr|pr-automerge [--remote] [--remote-url], --title, --base, --model)
status [goalId]                          goals overview / one goal's tasks, attempts, checks
brief <goalId> [--approve]               print / approve the Brief
deliver <goalId> [--mode push|pr|pr-automerge …]   run (or re-run) delivery
escalations · answer <id> <action>       inbox from the terminal
watch <goalId> · diff <goalId> · cancel <goalId>
replay --verify                          rebuild read models from the event log and compare
doctor · skills list|catalog|install|uninstall|restore|update|trash · usage [--probe]
github [status|login] · auth [status|login|logout]
```

## 配置

**Settings** 页面（`/settings`，API `GET/PUT /api/settings`）编辑下面的一切，并只把你改动的部分存进 `data/settings.json`。每个值的优先级：已保存 › 环境变量 › 默认值——页面会显示每个值来自哪里。大多数设置立即生效（concurrency、模型、session 上限、workflow profile、design / image / video pack、pace、TDD 默认值、autoskills、评审和交付默认值、通知、工具、安全）；`port`、`host`、`claudeBin` 和 `claudeHome` 在 `bun run serve` 重启后才生效（页面和 `/api/health` 会这么说）。

**模型随时间变化。** Settings → Models & limits 列出这台机器见过解析成功的东西（一个由每个 session 的 `init` 消息喂养、习得而来的注册表，`data/models.json`）外加各家族别名；一个新的 Claude 家族只差一个“custom”条目，首次 session 之后（或 *Test* 之后，一次短的付费调用）就会显示它解析出的 id。当某个模型被发现不可用——废弃的别名、退役的 id——该 session 会用回退链上的下一个模型重跑，并更新这个 goal 的模型（`goal.models_changed`，在 Goal 页面展示）；Doctor 会警告那些在这里从没解析成功、或上次失败的 tier（[ADR-0006](./docs/adr/0006-model-registry-and-fallback.md)）。**Fable 5.1**：选 `fable`（Claude Code ≥ 2.1.259 会把它解析为 `claude-fable-5-1`），或直接选固定 id 的 `claude-fable-5-1` 条目——较旧的 Claude Code 仍会把这个 id 原样发出去，只是在 live log 里多打一行无害的 `[claude-code:unrecognized_model]`，升级 Claude Code（`npm install -g @anthropic-ai/claude-code`）后即消失。

环境变量为初始值播种（对 CI 或一次性运行很方便）：

| var | default | meaning |
|---|---|---|
| `FOUNDRY_PORT` / `FOUNDRY_HOST` | `4111` / `127.0.0.1` | 服务器监听地址（需重启） |
| `FOUNDRY_MAX_CONCURRENT` | `3` | 并发 `claude` 进程的全局上限 |
| `FOUNDRY_CLAUDE_HOME`（或 `CLAUDE_CONFIG_DIR`） | `~/.claude` | Claude Code 主目录：skills、plugins、settings.json（需重启） |
| `FOUNDRY_MODEL_WORKER` / `_STRONG` / `_CHEAP` | `opus` / `opus` / `haiku` | 每个 tier 的模型——`fable`、`opus`、`sonnet`、`haiku`（Claude Code 家族别名；从 Claude Code 2.1.259 起 `fable` 指向 Fable 5.1）或一个完整的 model id，例如 `claude-fable-5-1`。*strong* = Clarify、Planner、Goal review、Merge Attempt；*worker* = task attempt；*cheap* = task reviewer、探测 |
| `FOUNDRY_MODEL_FALLBACKS` | `opus,sonnet,haiku` | 当一个 session 的模型不可用（废弃别名、退役 id）时按序尝试——见 [ADR-0006](./docs/adr/0006-model-registry-and-fallback.md) |
| `FOUNDRY_ATTEMPT_MAX_COST` / `FOUNDRY_ATTEMPT_MAX_TURNS` | `10` / `150` | 一次 worker attempt 的按 session 花费（USD）和轮次上限；花费还受 goal 剩余预算约束 |
| `FOUNDRY_MAX_CONTINUATIONS` | `2` | 一次 attempt 在换全新 attempt 之前，可恢复其被切断/有进展 session 的次数 |
| `FOUNDRY_WORKFLOW` | `mattpocock` | `plain` 禁用被强制的 workflow skill（仅留一行提示） |
| `FOUNDRY_TDD` / `FOUNDRY_GOAL_MODE` / `FOUNDRY_PACE` | `required` / `expert` / `thorough` | 新 goal 起步时的 TDD 纪律、默认视图和 pace |
| `FOUNDRY_DESIGN_PACK` / `FOUNDRY_IMAGE_PACK` / `FOUNDRY_VIDEO_PACK` | `ui-ux-pro-max` / `gpt-image-2` / `web-video-presentation` | UI / image / video task 的 pack（design 还有：`frontend-design`、`impeccable`、`bencium`、`garden`、`taste`、`none`） |
| `FOUNDRY_AUTOSKILLS` | `true` | 每个 goal 跑 autoskills（`0`/`false` 关闭） |
| `FOUNDRY_DELIVERY_MODE` | `local` | 新 goal 的默认交付策略 |
| `FOUNDRY_SYNC_FETCH` / `FOUNDRY_SYNC_START` / `FOUNDRY_SYNC_REFRESH` | `true` / `auto` / `false` | goal 之前 fetch 基点；本地落后时从远端 tip 起（`auto`）或总是本地；task 之间刷新 |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `GEMINI_API_KEY` / `KIMI_API_KEY` | — | 为交给 session 的图像生成 key 播种（也可在 Settings → Tools & keys 中编辑） |
| `FOUNDRY_TELEGRAM_BOT_TOKEN` / `FOUNDRY_TELEGRAM_CHAT_ID` / `FOUNDRY_DISCORD_WEBHOOK` / `FOUNDRY_NOTIFY_BASE_URL` | — | 为通知渠道播种 |
| `FOUNDRY_UPDATE_CHECK` | `on` | `off` 禁用每日版本检查（[self-update](./docs/adr/0010-self-update-via-docker-hub-and-watchtower.md)） |
| `FOUNDRY_MARKITDOWN` | 自动探测 | markitdown 二进制的路径 |
| `FOUNDRY_URL` | `http://127.0.0.1:<port>` | `foundry` CLI 访问服务器的地址（当引擎绑定到别处时设置它） |

按 goal 的预算（花费、分钟、concurrency、每个 task 的 attempt 数）在创建 goal 时设定，超支时可从 Inbox 里调高。

角色（提示词）是 [`roles/`](./roles) 里的纯 markdown——不碰代码就能编辑它们：`clarifier`、`planner`、`worker`、`reviewer-task`、`reviewer-goal`、`merger`、`documenter`。

## 结构

```
packages/core     zod schemas, event log (bun:sqlite), projections, state machines, DAG
packages/runner   ClaudeRunner interface + ClaudeCliRunner (spawns `claude -p --output-format stream-json`), boundary hook
packages/engine   scheduler, attempt loop, checks/, reviewers, merge, clarify, budgets, escalations, context/ providers,
                  attachments, agents/ (session monitor), auth/, notify/ (telegram, discord), update/ (self-update),
                  models/ (registry + fallback), convert/ (markitdown), git/ (conventional commits, sync), completion,
                  fs/ (folder browser, native picker), delivery/ (git init, gh, pipeline),
                  skills/ (scanner, catalog, installer, trash, doctor, sources, updates, updaters, workflow), usage/ (ledger, rate-limit pause)
catalog/          skills.json — curated required / recommended / optional skills
packages/server   Hono API + WebSocket + static UI
apps/web          React UI (goals, new goal, brief review, run view, inbox, agents, skills, setup, usage, settings, merge-resolve)
apps/cli          thin CLI
roles/            versioned role prompts (clarifier, planner, worker, reviewer-*, merger, documenter)
data/             runtime: engine.db, settings.json, models.json, transcripts/, worktrees/ (goals from before progress folders), check-output/, attachments/, skills-cache/, skills-trash/ (gitignored)
docs/, scripts/, fixtures/, Dockerfile, docker-compose.yml
```

## Token 经济学（靠设计，而非靠工具链）

- 每次 *retry* 都是一个全新 session，收到的是一份提炼过的 *Observation Report*，绝不是上一次的完整记录；一个被切断或仍在推进的 session 会被*恢复*（`claude --resume`，上下文保留），先来最多 `maxContinuations` 次
- task spec 只携带相关文件 / 图谱摘录（有 graphify 时用它，否则用 ripgrep）
- 规划/编码/goal 评审用强模型，task 评审和输出提炼用便宜模型
- 检查输出在抵达模型之前被引擎截断/提炼
- 来自 CLI 的 `rate_limit_event` 实时呈现；花费按 goal 对着预算追踪

## 开发

```bash
bun install
bun run dev              # engine (--watch) + UI build (--watch); or `bun run web:dev` for HMR on :5173
bun test                 # unit tests (core, runner, engine)
bun run typecheck
bun scripts/spike-runner.ts   # raw runner spike against the real CLI
bun scripts/spike-guard.ts    # boundary hook + permission-denial spike
bun run release <patch|minor|major>   # cut a release: bump, tag, changelog, multi-arch image
```
