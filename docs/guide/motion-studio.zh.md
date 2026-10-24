# 动效工作室

*Beta：在 [Settings → Beta](./settings.zh.md#beta) 打开。* 做影片 goal 的第二条路：不只靠一个 video skills pack，而是让 goal 走 **motion-studio** 引擎。它是 Foundry 自带的一套小工作室 harness，worker 不用每次重造：一个能按需画出影片任意时刻的渲染器、一个让 worker 交活之前先看自己画面的 critique 循环、一套固定的交付物，以及量这些交付物的检查。

## Choosing the engine

Beta 开关打开后，New goal 表单上的影片 goal 在 *Kind of goal* 下面多一个 **Engine** 选择。留在 Settings 指定的 pack 上，或者选 **motion-studio**。这个选择在建 goal 时冻结，和 workflow suite 一样；goal 的会话用它来组提示词，而 Extensions 目录、doctor 和 Settings 里的 Video skills pack 对其他 goal 保持原样。

## What the goal needs on this computer

引擎通过无头 Chromium 渲染、用 ffmpeg 编码。Chromium 用的是 Foundry 自检已经自带的那份；**ffmpeg** 要装在这台机器上（Mac 上 `brew install ffmpeg`；Docker 镜像自带）。Beta 开关打开时，Setup 页的 doctor 会检查这两样，motion-studio goal 会等它们齐了再开工，和 CAD goal 等工具一样。

## Sessions that run long

做片和渲染的会话比改代码的长得多：现在每个 goal 都能带自己的 **Attempt timeout**（New goal 表单的 Custom 预算里，5 到 240 分钟），限制这个 goal 的单次会话；留空就沿用 [Settings → Models & limits](./settings.zh.md#models--limits)。motion-studio goal 建出来就是 60 分钟。
