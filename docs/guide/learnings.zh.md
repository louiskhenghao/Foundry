# Learnings

> [English](./learnings.md) · 中文

每个 goal 都会让 Foundry 对你的项目多知道一点：测试需要哪条命令、页面放在哪里、哪个错误白白花掉了两次尝试、你喜欢事情怎么做。Foundry 按项目文件夹把这些 **Learnings** 记下来，交给这个文件夹里之后的每个 goal，同一个教训不用付两次钱。

![Learnings 页面：一个项目文件夹，里面是它的 goal 教会的事，还有一条是用户自己写的](images/learnings.png)

## 它们从哪里来

- **goal 结束时**（done、over-delivered 或 failed），一个用 goal 的 housekeeping 模型的短会话会读一遍过程：你要求了什么、决定了什么，它在哪里停下来等你、你怎么回答的，你给的提示，失败的尝试遇到了什么，警告和最终审查。它把值得记住的项目知识加进去，合并重复的，删掉被证明不对的。被取消的 goal 不会留下任何东西。装了 `retro` skill 时（Claude），这个会话会以回顾的方式进行：它可以读 goal 的会话记录，专门找下一个 goal 会需要的东西——指向正确文件的提示、本可以抓住错误的检查、给审查者的规则、没起作用的指令。
- **在 pstack 套件下**，这个会话以 pstack 的 `reflect` 为方法——它的 judgment、tooling、divergent 三个视角，加上"什么该由结构来保证而不是靠一条笔记"——在一个会话里完成，不改任何技能。
- **来自你。** 你加的或改过的条目就是你的（✎）。Foundry 从不修改或删除它们。你在每个项目里都想要的东西，写在 **Yours, everywhere** 下面（见下文）。

goal 的 **Activity** 会写明改了什么，例如 *Learnings for this folder: +2 — added how the e2e tests start*。这个会话花几美分，计入 goal 的费用。

## 它们的作用

- **Clarify** 在提问和规划之前，读这个文件夹的全部 Learnings，你写的排在前面。
- **每个任务**都会拿到简短版，在 *Notes on this repository* 下面：构建、测试、运行的命令和容易踩的坑排在前面。
- 它们是起点，不是规定：代码说的不一样时，以代码为准。

一个文件夹最多保留 30 条，每条最多 300 个字符。

## Yours, everywhere

有些你想要的东西不属于某一个项目：你用的包管理器、注释和提交信息的语言、每个审查者都该守的规矩、你永远不想要的做法。Learnings 页面的第一张卡片 **Yours, everywhere** 就是记这些的本子。只有你往里写，每个文件夹里的每个 goal 都会连同文件夹自己的 Learnings 一起拿到它：Clarify 在单独的一行下面看到，每个任务在简短版里看到，你写的排在最前面。它也会写进每个文件夹的 `foundry-learnings` skill，作为最后一节，这样你自己的会话也能读到。文件夹自己的 Learnings 或代码说的不一样时，以它们为准。

## 分享给你自己的会话

每个文件夹的 Learnings 也会写进仓库，作为一个项目技能 `foundry-learnings`（Claude Code 在 `.claude/skills` 下，Codex 和 Antigravity 在 `.agents/skills` 下），这样你自己在那里开的会话也能读到。这个文件不进 git，Learnings 一变就重写，goal 在这个文件夹开始时也会刷新，最后一条删掉它就消失。请在 Learnings 页面上编辑，不要改文件。**Settings → New goal defaults → Share Learnings with your own sessions** 可以关掉它并删除文件。

## 这个文件夹的 Memory

Learnings 是那三十行。设好了 Hindsight 服务器之后（见 [Memory](./memory.zh.md)），Learnings 页面上每个文件夹的卡片还会显示它的 bank（`coding-agent::<folder>`）和一个 **Memory** 开关：关掉后，这个文件夹的 goal 既不读也不写 bank。记事本里的内容也会写进 bank，替换上一次写的记事本，所以你在这里写的一条 Learning 是纠正错误记忆最可靠的办法。

## 查看和编辑

- **⚙ → Learnings** 把每个有 Learnings 的文件夹显示成一张可以折叠的卡片。每条 learning 分两栏：左边是类别，右边是内容，内容下面一行写着它从哪里来（哪个 goal，或 **✎ yours**）。上方的标签（**all**、**build**、**test** …… **pitfall**）只显示一种类别，并标出各自的数量；搜索框在 Learnings、文件夹和 goal 里找字；**expand all** 和 **collapse all** 展开或折叠所有卡片，页面会记住你折叠了哪些。
- goal 页面上有到它所在文件夹 Learnings 的链接（**Learnings for this folder: N**）。**New goal** 表单在你选好文件夹后，会告诉你这个文件夹有几条。
- 文件夹卡片上的 **Add** 会打开一个窗口，写一条新的 learning：选类别，写内容。learning 下面的 **edit** 会在同一个窗口里打开这一条，可以修改（**Save**）或 **Remove**。
- 在结束了的 goal 上，**More ▾ → Learn from this goal again** 会再为这个 goal 跑一次那个会话。

## 关掉它

**Settings → New goal defaults → Learn from finished goals** 会停止 goal 结束时的会话。文件夹已有的 Learnings（包括你写的）仍会交给之后的 goal：要停止这一点，就在 Learnings 页面上删掉它们。

Learnings 只留在这台电脑上：[Transfer](./moving-to-a-new-computer.zh.md) 搬的是 goal，不搬 Learnings。
