# Runbook — 你会看到什么、它意味着什么、引擎会如何处理

> 中文 · [English](./runbook.md)

一份现场指南，讲解 goal 运行时 Foundry 显示的各类消息。术语见 [CONTEXT.md](../CONTEXT.md)；设计决策见 [adr/](./adr)。除非标注 **act**，这里的一切都是正常运行状态。

## 1. Task 的 Live log 中出现的行

| You see | Meaning | Engine / you |
|---|---|---|
| `● session 1a2b3c4d · claude-…` | 一个 worker Claude session 已启动（或被 **resumed** —— 同一次 Attempt 中的第二个 `●` 是一次 Continuation）。task reviewer 和 merger 显示为 `● reviewer session …` / `● merger session …`。 | — |
| `[claude-code:unrecognized_model] {"model":"claude-fable-5-1",…}` | 你的 Claude Code 比你选的模型更旧（例如 Fable 5.1 需要 2.1.259）；请求仍会原样发出，session 一切正常。 | 升级 Claude Code（`npm install -g @anthropic-ai/claude-code`）即可消除；Docker 下拉取最新镜像。 |
| `[reviewer] …` lines after the worker finished | task reviewer（廉价模型）在评判 diff。它与该 Attempt 共用同一份 log。 | — |
| `[reviewer] ✗ Output does not match required schema: root: must have required property 'pass' …` | reviewer 调用结构化输出工具时用了错误的形状（通常是把 JSON 包成了字符串）。Claude Code 拒绝它，reviewer 会重新正确发送。仅消耗一次廉价模型的重试，别无其他。该 Attempt 的判定不受影响。 | 提示词现已写明确切形状；如果你仍频繁看到它，请上报。 |
| `✗ Exit code 1 … (eval):cd:1: no such file or directory: apps/x` | *历史遗留问题。* Bash 工具保留了上一次的 `cd`。已修复：现在每条命令都从 workspace 根目录开始（`CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR=1`）。 | 如果它再次出现，说明引擎的 env 没有传达到 session。 |
| `■ error_max_turns` / `■ error_max_budget_usd` | session 在完成前触及了每个 session 的上限。 | **Continuation**：同一 session 以全新的额度被 resume（最多 `sessions.maxContinuations` 次）。 |
| `■ killed_timeout` / `■ killed_idle` | session 耗尽了挂钟时间 / 沉默过久。 | 带 "timed out" 消息的 **Continuation**，与上述上限一样最多 `sessions.maxContinuations` 次（默认 2）；之后再开一次全新的 Attempt。 |
| `⏳ rate limit rejected` | 触及了 Claude 的 5 小时 / 每周限额。 | 调度暂停直至 `resetsAt`；不会杀掉任何东西，不会丢失任何东西。 |
| `# The goal branch moved while this task was waiting` (in the Prompt tab) | 其间有其他 task 落地了；引擎先把它们合并进这个 task 的 worktree（Catch-up）。 | — |
| `# The goal branch moved and the automatic merge could not finish` | Catch-up 遇到了 Merge Attempt 无法解决的冲突。 | worker 被告知自己 `git merge` goal branch，保留双方的意图。 |

## 2. Attempt 状态与标记（Task view）

每次 Attempt 显示一个 **stat grid**（Result · Worker model · Turns · Cost worker + reviewer · Started · Duration · Session · Skills）和一个 **Sessions table**：为它运行的每个 Claude session 各占一行 —— worker 段（continuation 是额外的行）、task reviewer（廉价模型，显示为 `reviewer`）、merger。*"为什么 log 里显示了另一个模型？"* —— 就是那一行。上方的 **Task total** 条汇总了每一次 Attempt、每一个 session（worker / reviewer / merger），所以你看到的成本是 task 的真实成本，而不是最后一次 Attempt 的成本。

| Marker | Meaning |
|---|---|
| `#3 ↻1` | Attempt 3 被 continue 过一次（session 被 resume）。成本和 turn 数是各段的累计值。 |
| `interrupted` | 被引擎重启打断；在下一轮调度中作为 Continuation 恢复。不消耗重试次数。 |
| `→ 2 file(s) still conflicted (src/a.ts, src/b.ts)` / `→ conflicts resolved but must checks regressed — …` | 一次 Merge Attempt 失败的原因。 |
| `→ all must checks passed` | — |
| `passed` but task still `merging` | 正在落地到 goal branch：catch-up、squash、checks。 |

## 3. Task 状态及其原因

Task 状态：`pending`（等待它所依赖的 task）→ `ready`（可以开始）→ `running`（有 session 在工作）→ `observing`（checks + reviewer 评判该段）→ `merging`（落地到 goal branch）→ `done`。偏离正常路径时：`blocked`（有一个 escalation 需要你处理）、`failed`（它依赖的某个 task 失败了，或有一次新的 delivery 运行取代了它）、`skipped`（你跳过了它，或重启了它下游的某个 task）。

| State / reason | Meaning | Engine / you |
|---|---|---|
| `ready` · *"X is not parallelizable; it starts when Y finishes"* | Brief 把该 task 标记为串行。 | 等待空闲。如果它无需等待，下次在 Brief 里把它设成 `parallelizable`。 |
| `running` · *"retry 2/3"* | 一次 Attempt 失败后走的常规全新 Attempt 路径。 | — |
| `running` · *"continuation 1: max turns / max budget / timeout"* | session 触及了某个上限但被 resume（不是一次重试）。 | — |
| `ready` · *"X waits for Y: both touch src/shared/schema.gql"* | 声明的 `relevantFiles` 与一个正在运行的 task 重叠。 | 在 Y 完成后运行 —— 以避免 merge 冲突。 |
| `running` · *"resuming attempt 2 after the engine restart"* | 重启后的 Continuation。 | — |
| `running` · *"continuation 1: checks failed"* | checks 失败但该段有进展；同一 session 被告知还有什么没通过。 | — |
| `ready` · *"engine error (1/3), retrying: …"* | 引擎本身抛出了异常（不是模型）。 | 重试两次而不消耗 Attempt；第三次 task 进入 `blocked` → Inbox，`kind: engine`。 |
| `blocked` · escalation `retries_exhausted` | Attempt 用尽（见 §4）。 | **act** |
| `merging` for a long time | Merge Attempt（最多 2 次，然后交给人）和 must checks 在这里运行。 | 如果它以 Inbox 收场，见 §4。 |
| `done` · *"no changes to commit"* | 该 task 的工作已经在 goal branch 上了（通过其他途径落地）。 | — |
| note *"worktree of X is missing (…); recreating it from the goal branch"* | 它的 worktree 被丢弃了（早先完成，随后重启）。 | 从 goal branch 重新创建。 |

## 4. Inbox 通知

每条通知都会指明 goal 和 task，并直接链接到 task view；同一张卡片也会在 task 内部显示。

| Notice | Meaning | What to do |
|---|---|---|
| **Retries exhausted · merge conflict** — lists files and *why each attempt failed* | 两个 task 改动了同样的行；两次 Merge Attempt 都无法落地它（或落地了但 must checks 出现了回归）。 | **Resolve manually →**（按文件查看双方内容，take a side / 编辑 / 在你的编辑器中打开，Finish merge）。或 *Retry with hint*（"先合并 goal branch，保留 Postgres…"），或 *Skip task*。 |
| **Retries exhausted** — *"used N/M attempts; Must checks still failing"* + the last observation report | worker 无法让 checks 通过。 | **Suggest a hint**（AI 阅读该 task、失败的 checks 和最后一次 session，用平实的语言解释原因并填好 hint —— 你按 *Retry*），或 **Let AI handle it**（同上，并且当答案是"带这个 hint 重试"时立即应用；skip / budget / 手动 merge 永远不会替你应用）。或自己决定：*Retry with hint* / *Skip task*；如果是某个 check 有问题 —— 在 Expert view 里修它。 |
| **Retries exhausted · engine** — *"Engine error … 3 times in a row"* | Foundry 的 bug 或环境问题（缺少 git、磁盘）。 | 修复根因，然后 *Retry*。请上报。 |
| **Budget exceeded** | 触及成本或时间上限。 | *Raise budget* 或 *Abort*。 |
| **Wants to leave the workspace** | 某个 session 尝试 `git push` / 部署 / 付费服务。 | *Approve & run once* 或 *Deny*。 |
| **Tool denied** — *"the task failed and Claude was denied: &lt;tools&gt;"* | 最后一次 Attempt 失败了，且 Claude 拒绝了一次（非边界的）工具调用。 | 与 *Retries exhausted* 相同的选项：**Suggest a hint** / **Let AI handle it**、*Retry with hint*、*Skip task*。 |
| **Retries exhausted · goal review / delivery** | goal review 崩溃了（`kind: goal-review`），或已交付 PR 上的 CI 在该 task 的 Attempt 内无法修复（`kind: delivery-fix`）。 | 修复根因后 *Retry*；delivery-fix 可以再次用 *Deliver* 重新运行。 |
| **Brief question** | 只出现在 Brief 页面。 | 回答；如果它改变了计划，再 *Revise with answers*。 |

## 5. 值得了解的引擎注记

| Note | Meaning |
|---|---|
| *baseline at abc1234: N must check(s) already failing on the goal branch … merges are judged on regressions only* | goal 自身的测试套件本就是红的，与本次 merge 无关。一次正确解决的 merge 不会被它挡住。修复测试套件（goal review 会做），但 merge 照常流动。 |
| *merge attempt 1 for task/…: N must check(s) fail but already failed on the goal branch before the merge — accepted* | 同上，已应用。 |
| *catch-up: merged N goal-branch commit(s) into task/… before "…"* | Task worktree 在开始工作前 / 落地前被更新到最新。 |
| *N skill(s) installed for this stack (content in .agents/)* (the `goal.autoskills` detail, on the Goal → Project skills card) | 该技术栈的 project skills 以 symlink 形式装进了 `.claude/skills`；链接及其目标目录都被 git 排除，因此它们永远不会进入 commit。 |
| *…; N stale tracked link(s) removed from the index* | 一次较旧的运行让这些 symlink 进了 git；它们被从 index 中移除（文件仍留在磁盘上）。如果某个 branch 已经带着它们，用 `git rm -r --cached .claude/skills && git commit` 清理。 |
| *catch-up: task/… has an unfinished merge with conflicts … leaving it for the worker* | 早先的 session 留下了一个未完成的 merge；worker 被告知去完成它。 |
| *attempt … was interrupted by an engine restart; its session will be resumed* | 重启后的 Continuation。 |
| *attempt … was orphaned by an engine restart* | 无法被 resume（尚无 session）；重新跑一次全新的 Attempt，budget 已退回。 |
| *"…" waits for "…": both touch …* | 重叠感知的调度（§3）。 |
| *model X is unavailable (…); worker sessions of this goal now use Y* | 模型回退链启动了。检查 Settings → Models。 |
| *Setup → Sign in asks for a code* | 运行引擎的机器没有浏览器（Docker、远程主机），因此 Claude Code 退回到复制验证码的流程：打开它显示的链接，批准，把验证码粘贴进对话框。错误的验证码会重新打开输入框；sign-in 会等待 15 分钟。 |
| *coverage repair did not return a valid Brief …* | Clarifier 漏掉了一个 Area，且修复回合失败了；这个缺口会作为一个 Question 出现在 Brief 上。 |
| *usage limit reached (five_hour/weekly): paused until … ; goals resume automatically* | 一个 Claude 使用窗口耗尽了。不会杀掉任何东西；新 session 等待。Goals、Goal 和 Inbox 页面显示一条琥珀色横幅；该暂停能在引擎重启后存续（从事件日志重新装载），并在重置时间自行解除。 |
| *usage limit reset — goals resume* | 上述暂停结束了；每一个非终结状态的 goal 都被推进了一步。 |
| *Foundry &lt;version&gt; is available* (header pill + notification) | 每日检查发现了更新的 release。`update.available` 每个版本触发一次。 | 打开该 pill 或 Settings → About & updates 查看 changelog 并更新。见 §7。 |
| *autoskills: skipped — no stack manifest … retried after each task until one appears* | 空仓库 goal：还没有可检测的东西。每次 task 落地后引擎会再次检查；创建 package.json（或其他 manifest）的那个 task 会触发安装，正在运行的 task worktree 也会收到这些 skills。 |
| *graph refresh: graphify ok, gitnexus skipped* | goal 交付后（本地 goal 则在 done 时）的收尾动作：`graphify update`（安装了则加上 `gitnexus analyze`）重新为已交付的代码建立索引。`skipped` = 工具不在 PATH 上。另有一条独立的 *pull --ff-only … : …* 注记，报告用户的 checkout 能否先被 fast-forward（dirty/diverged = 不能，刷新会在能做的范围内运行）。 |
| *docs generation failed: …* | Documenter session（在 goal review 之后、done 之前）失败了；goal 仍然会完成。详情见 `goal.docs_generated` 和 Goal → Completion 卡片；无需通过重启最后一个 task 来重跑 —— docs 可以手写，或从 goal review 重启 goal。 |
| *N artifact(s) delivered to …* | 一个 media goal 完成了：workspace 的 `artifacts/` 被复制到了 goal 的输出文件夹（`goal.artifacts_delivered`）。未设置输出文件夹 → 文件留在 goal workspace（Open ▾ → The result）。 |
| *artifact delivery to … failed: …* | 把 artifact 复制到输出文件夹失败了（权限、磁盘缺失）。goal 仍然会完成；文件在 goal workspace 中完好无损 —— 手动复制它们，或修好文件夹后无需重启 delivery。 |
| *[artifacts] task…: N file(s) copied to the goal workspace* (a server-log line, not a UI note) | 一个 media task 整合了：在 worktree 被丢弃前，它那个被 git 排除的 `artifacts/` 被抢救进了 goal workspace。 |

## 6. 什么花钱，什么不花钱

- **Session**（worker、reviewer、merger、clarifier、goal reviewer、draft/revise）花钱；引擎在 git、checks 和 worktree 上做的一切都是免费的（只花时间）。
- **Continuation 比 Attempt 便宜**：resume 的 session 复用它的上下文（prompt-cached）；一次全新的 Attempt 要重新读一遍仓库。这就是为什么被打断的 session 和有进展的 session 会被优先 resume。
- **Baseline checks** 在一个用完即弃的 worktree 里，每个 goal-branch commit 运行一次 goal 的 must 命令 —— 花时间，不花 token。
- Session 上限：**Clarify** ≤ $6，**Draft with AI** ≤ $2，**Revise with answers** ≤ $3，一次 **Merge Attempt** ≤ $2，**goal reviewer** ≤ $2，**Documenter** ≤ $3（仅当 goal 的 Completion docs 开启时），**Style sample** 每次点击 ≤ $0.5（每个方向最多 8 次；较早的 sample 会保留），escalation 的 **AI hint** ≤ $1，一个 **task reviewer** ≤ $0.8。Worker attempt 使用 `FOUNDRY_ATTEMPT_MAX_COST`（默认 $10），受 goal 剩余 budget 约束。graph refresh 是免费的（无 LLM）。**Fast-pace goals** 完全跳过免费的 task/goal review 和生成的 docs —— 已批准的 checks 仍会运行。Usage 页面有按种类划分的账本。

## 7. 安全地更新与重启引擎

**优先使用内置更新，而非手动重启。** Settings → About & updates（或 header pill）每天检查 release 注册表；*Update* 会先排空 —— 它停止启动新 session 并等待繁忙的 session 完成（最多一小时；*Update immediately* 复选框会改为打断它们），然后替换二进制（Docker：watchtower sidecar；本地：`git pull --ff-only && bun install && bun run web:build`，任何失败都会回滚）并重启。回滚的更新会让你停留在旧版本。`FOUNDRY_UPDATE_CHECK=off` 关闭每日检查。在 service manager 下，设置 `FOUNDRY_SUPERVISED=1`，让 updater 退出并交由 launchd/systemd 启动新版本（见 [remote-access.md](./remote-access.zh.md)）。

如果你确实要手动重启：

1. `GET /api/health` → `active`（= `busy.total`）必须为 `0`，否则你会打断 session。（已经拿到 session id 的被打断 **work** session 会作为 Continuation 恢复，但正在进行中的那一段会被付两次费；merge session，或在真正开始前就被切断的 session，会被 orphan 掉并花费一次全新的 Attempt。）goal 的 *state* 无关紧要 —— 一个 `active: 0` 的 `running` goal（在等待某个串行 task，或处于 rate-limit `pausedUntil`）是安全的。
2. **绝不在 delivery 中途重启**：`busy.delivering` 必须为 `0`。delivery 期间的一次重启会把它标记为失败（*"engine restarted during delivery — run Deliver again"*）；每一个 delivery 步骤都是幂等的，所以只需再按一次 *Deliver*。
3. `/api/health` 上的 `restartNeeded` 列出了哪些设置的改动正在等待一次重启（`port`、`host`、`claudeBin`、`claudeHome`）。
4. 在添加了带默认值字段的 schema 改动之后：停止，`bun apps/cli/src/main.ts replay`，然后 `replay --verify`（必须打印 *identical*），然后启动。
5. 杀对进程：`pgrep -f "^bun apps/cli/src/main.ts serve"` —— 绝不用 `lsof -ti :4111 | head -1`（那可能是浏览器）。

## 8. 仍然需要人来处理的事

- 语义冲突（各方的测试都通过，但组合起来是错的）—— 由 goal 级别的 checks 和 Goal reviewer 捕获，由 fix task 或你来修复。
- 一个 task 改动了它未在 `relevantFiles` 中声明的共享文件 —— 调度器看不到这个重叠；catch-up 和 Merge Attempt 处理由此产生的冲突，手动解决是最后手段。
- 一个测试套件因无关原因发红的 goal：merge 照常流动（baseline），但在测试套件转绿之前 goal 无法完成 —— 由 goal review 的 fix task 或你来处理。

## 9. Image goal 需要一个图像后端

- 只有当 session 看到 `OPENAI_API_KEY`（任何兼容 OpenAI 的端点；`OPENAI_BASE_URL` 覆盖主机）或 `GEMINI_API_KEY`（`claude-image-gen` pack 默认使用）时，图像生成才会真正*运行*。没有 key，该 skill 会降级为顾问模式，worker 手写 SVG/HTML 渲染 —— 保真度明显更低。
- 提供 key 的常规方式是 **Settings → Tools & keys**（*OpenAI-compatible API key* 或 *Gemini API key*）：存在 `data/settings.json` 中，立即应用于下一个 session —— 无需重启。或者把它放进仓库根目录的 `.env`（被 gitignore；引擎启动时 Bun 会加载它）。无论哪种方式 session 都会继承它 —— 该 key 对每个 session 可见。
- 缺 key 时你会看到：skills Doctor 会警告（*gpt-image-2 backend*），worker 的提示词带有一条 ⚠ 降级模式注记，Clarifier 会在 image goal 上记录一条明确的假设，好让你在批准 Brief 前拒绝它。
