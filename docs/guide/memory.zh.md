# Memory

> [English](./memory.md) · 中文

[Learnings](./learnings.zh.md) 是 Foundry 按项目文件夹保留的那三十行。**Memory**（记忆）是它的长篇版：你自己运行的一台 [Hindsight](https://github.com/vectorize-io/hindsight) 服务器把一个文件夹里的 goal 做过什么、决定过什么、被驳回过什么、写过什么全部记下来，在后台整理归纳，并在 goal 的每个阶段开始前先回答一句——在这个仓库里，以前的工作对这个任务、这个计划、这次审查有什么可说的。你自己在同一个仓库里开的 Claude Code 或 Codex 会话共用同一个 bank。它是可选的：没有设好服务器之前，这里什么都不会发生。

## 它需要什么

Hindsight 是开源的（MIT）。它作为一个独立进程运行，自带内嵌数据库，所以不用再装别的东西；但它需要一个自己的 LLM 来从收到的内容里抽取事实：OpenAI、Anthropic、Gemini、Groq 或其他提供商的 key，或者一个订阅登录。要给它留 1.5–2 GB 内存，第一次启动时还会下载大约 215 MB 的模型。它的 LLM 费用由你承担，不记在 Foundry 的账本里；Foundry 自己不会为 Memory 调用任何模型。

**用你已有的登录。** 在这台电脑上运行的服务器可以不用 key，直接用 Foundry 的 goal 本来就在用的 Claude Code 或 Codex 登录。`HINDSIGHT_API_LLM_PROVIDER=claude-code` 会为每次抽取和回答启动一次你的 `claude`（安装服务器时带上这个 provider 的附加包：`uv tool install --with claude-agent-sdk hindsight-api`，或 `pip install hindsight-api claude-agent-sdk`）；`HINDSIGHT_API_LLM_PROVIDER=openai-codex` 从 `CODEX_HOME` 读取一个 Codex 登录——给它一个独立的目录，`CODEX_HOME=~/.hindsight/codex codex login`，这样服务器和你的终端就不会去刷新同一个 token。Hindsight 的文档把这两种方式都标为仅供个人使用。由此有两件事。这些调用计入你套餐的用量：一个文件夹第一次使用时会抽取它最近的 300 条提交，每条一次调用，在乎的话把卡片上的 **Seed a new folder from** 调低。而且一次回答要一分多钟而不是几秒：把卡片上的 **Wait for an answer** 调到 90–120 秒，或者让各阶段改拿记忆本身（见下文）。Docker 安装里的 Hindsight 够不到你电脑上的 `claude`，但可以用你的 Codex 登录：安装器问 provider 时回答 `openai-codex`，启动后它会通过 Foundry 容器里的 Codex CLI 用设备码把服务器登录进 compose 文件旁的 `hindsight-codex/`——一个属于它自己的登录（重新登录：`docker exec -it -e CODEX_HOME=/home/node/.hindsight-codex foundry codex login --device-auth`，然后 `docker compose restart hindsight`）。

## 设置

1. **启动一台服务器。** 用 Docker 方式安装的话，带 `--with hindsight` 再跑一次一行安装命令（或者在它问的时候回答 yes）：它会把 Hindsight 作为一个 compose profile 启动在 Foundry 旁边，把你给的 LLM key 存在 compose 文件旁的 `hindsight.env` 里（或者按上文登录 Codex），并让 Foundry 指向它——下面的第 2、3 步就只剩下连接编码智能体了。否则，在这台电脑上用 Docker：完整镜像自带数据库和模型（3.7–9 GB），下面那张卡片上有可以直接复制的命令。或者用 Python：`pip install hindsight-api`，然后带着同样的 `HINDSIGHT_API_LLM_*` 变量运行 `hindsight-api`。服务器监听 8888 端口，它的控制台在 9999。
2. **打开 Extensions → MCP servers**，找到 **Memory · Hindsight** 卡片。填入地址（服务器在这台电脑上时是 `http://127.0.0.1:8888`），如果服务器要求的话再填 bearer token，按 **Test**，再按 **Save**。卡片随后显示 **connected** 和服务器的版本。**Write each attempt's transcript to the bank** 默认开着；**Wait for an answer**（20 秒）和 **Seed a new folder from**（300 条提交）见下文。
3. **连接编码智能体。** **Connect Claude Code**（或者在 Codex 标签页上 **Connect Codex**）把这台服务器写进该编码智能体自己的配置并允许在 goal 里使用：worker 于是可以在干活中途自己去问记忆，并被告知它所在文件夹的 bank 是哪个。无论连不连，Foundry 都会在每个阶段开始前替它问一次。Antigravity 不从 Foundry 接收 MCP 服务器：它的 goal 只以文字形式拿到 Memory 回忆起的内容。对 Codex，Foundry 把 token 作为 `HINDSIGHT_API_TOKEN` 交给它的会话；你自己的会话要在 shell 里自行 export。

卡片上的 **Turn off** 停掉一切；已有的 Learnings 不受影响。**Settings → Skills** 里有指向这里的链接。

## 记住了什么

对每一个是 git 仓库、且没有被排除的文件夹，Foundry 会往它的 bank 里写：

- **goal 结束时**（done、over-delivered 或 failed）：它的记录，和 Learnings 会话读的是同一份——要求了什么、理解成什么、各项 Decision、每个任务和失败的尝试、在哪里停下来等你、你怎么回答的、警告、最终审查。被取消的 goal 不写任何东西。
- **这个文件夹的 Learnings**，每次变化时写入，替换上一次写的记事本——所以你亲手写的一条 Learning 也是纠正错误记忆最可靠的办法。
- **Brief 在你批准前的每次修订**、**second opinion** 提议了什么、每次**任务审查的结论**及其理由、每次 **replan** 的原因：这些是 Foundry 的理解、计划或工作哪里出了偏差的证据。
- **每次 attempt 的会话记录**的压缩版——你的任务、智能体说的话、每次工具调用一行（不含参数和输出）、失败的调用说了什么——只要卡片上的那个开关开着。这是服务器的 LLM 要读的大部分内容，开关就是为此而设。
- **这个文件夹最近的提交**（最后 300 条提交信息），在 Memory 第一次用于该文件夹时写入，这样第一个 goal 面对的就不是空的 bank；bank 里已经有文档时跳过，比如你自己的会话已经写过。
- **你做的决定**，来自每一个文件夹，写进一个属于你自己的 bank `foundry::person`：你的 **Yours, everywhere** 记事本、你批准的每份 Brief 里的 Decisions、goal 停下来问你时你的回答、你在里程碑上说的话——每条都标着它来自哪个仓库。Clarify 会在问文件夹 bank 的同时问这个 bank。被你排除的文件夹也不会往这里写。

Foundry 建的 bank 还会得到 Hindsight 自带集成所维护的五张 knowledge page——组件地图、核心概念、约定与模式、关键决定及理由、各项工作——服务器每小时根据 bank 里的内容重写一遍，回答时先读它们。Foundry 保管的各种 key 的值，在任何内容发出之前都会被抹掉。

## goal 拿到什么

每次 attempt 之前、Clarify 之前（planner 拿到同一个回答）、replan、任务审查和 goal 审查之前，Foundry 向 bank 问一个关于手头工作的问题，把回答放在会话的 **What Memory recalls** 下面，与文件夹的 Learnings 并列，最多 1500 个字符。卡片上的 **Wait for an answer**（20 秒）是一个阶段等这个回答的时间；超过它，这个阶段就改为拿到与问题相关的记忆本身——不经模型、不到一秒检索出来的——然后照常进行，那一节会写明这一点。服务器挂了，goal 除了这段等待什么也不损失；bank 里还什么都没有时，根本不会去问。和 Learnings 一样，它是起点：代码说的不一样时，以代码为准。

## 看到它

- goal 页面在基本信息下面写着 **Memory: 3/4 recalled · wrote back 6**（或者服务器没有回应）。Overview 标签页上的 **Remembered** 展开后能看到每个阶段被告知了什么——bank 的原话，回答没有及时到达的那些标着 **the memories themselves**——以及这个 goal 写回了多少份文档。**Activity** 列出每一次询问和写入。
- **Learnings** 页面上每个文件夹的卡片显示它的 bank（`coding-agent::<folder>`）和一个 **Memory** 开关：关掉后，这个文件夹的 goal 既不读也不写 bank。**Yours, everywhere** 卡片上显示的是你自己的 bank `foundry::person`。
- Hindsight 自己的控制台（服务器的 9999 端口）能看到各个 bank、里面的记忆，以及整理归纳的结果。

## 一个仓库一个 bank

文件夹的 bank 以仓库主目录的名字命名，`coding-agent::<name>`，和 Hindsight 自己的编码智能体集成的命名方式一致。把你终端里的 Claude Code 接到同一台服务器（`npx @vectorize-io/hindsight-coding-agents install claude-code`），你自己的会话和 Foundry 的 goal 就共用同一份记忆。目录名相同的两个 clone 共用一个 bank；用另一个名字 clone 的仓库有自己的 bank，而它的 Learnings 仍然跟着路径走，和以前一样。任何一边写错的记忆都会传到另一边，直到后来的事实推翻它：Hindsight 把更新的事实排在前面，而你写的 Learnings 也会被写入。

## 费用与隐私

goal 做的一切都会发到你设置的那台服务器：默认在这台电脑上，只有你指向别处时才去别处。Hindsight 的云服务只是另一个地址，从来不是默认值。它的 LLM 为抽取和每一次回答付费；Foundry 自己不增加任何模型费用。[Transfer](./moving-to-a-new-computer.zh.md) 不搬记忆：存储是服务器的。
