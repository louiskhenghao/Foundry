# 动效工作室

*Beta：在 [Settings → Beta](./settings.zh.md#beta) 打开。* 做影片 goal 的第二条路：不只靠一个 video skills pack，而是让 goal 走 **motion-studio** 引擎。它是 Foundry 自带的一套小工作室 harness，worker 不用每次重造：一个能按需画出影片任意时刻的渲染器、一个让 worker 交活之前先看自己画面的 critique 循环、一套固定的交付物，以及量这些交付物的检查。

## Choosing the engine

Beta 开关打开后，New goal 表单上的影片 goal 在 *Kind of goal* 下面多一个 **Engine** 选择。留在 Settings 指定的 pack 上，或者选 **motion-studio**。这个选择在建 goal 时冻结，和 workflow suite 一样；goal 的会话用它来组提示词，而 Extensions 目录、doctor 和 Settings 里的 Video skills pack 对其他 goal 保持原样。

motion-studio goal 一建出来就带着做片需要的设定：Settings 或表单没另说就是 **xhigh** 档位、**Thorough** 预算、每次会话一小时（见 [Sessions that run long](#sessions-that-run-long)），里程碑只通知不暂停。

## What the goal needs on this computer

引擎通过无头 Chromium 渲染、用 ffmpeg 编码。Chromium 用的是 Foundry 自检已经自带的那份；**ffmpeg** 要装在这台机器上（Mac 上 `brew install ffmpeg`；Docker 镜像自带）。Beta 开关打开时，Setup 页的 doctor 会检查这两样，motion-studio goal 会停在 Clarify 等它们齐了再开工，和 CAD goal 等工具一样；在 Setup 页装好就继续。

## How a film is made

渲染之前，Clarifier 先把一支片需要的东西定下来：主题或产品和它的网址、时长、格式（16:9、9:16、1:1、4:5，全部出自同一条时间线，绝不裁切）、品牌色和字体或你从卡片里选的风格方向、你附上的参考（一帧、一段、一个图库）、音乐（附上的音轨，或按影片节拍合成的一条）、画面文字的语言和结尾那句话。参考片段和音轨直接附在 goal 上：音频和视频文件可以到 200 MB。

然后计划按工作室的关卡走：

1. **Style guide and shotlist**：收齐真实素材，照参考写出风格指南，把分镜排到节拍网格上。这个任务是里程碑：分镜会显示在 goal 页面上，goal 不停继续。
2. **Stills and animatic**：每个镜头先出静帧，再用低帧率动起来，每一轮都出一张 contact sheet。
3. **Full pass**：到处用弹簧、动态模糊、高潮处才放出压着的那个颜色；至少三轮 critique，每轮打分并记录。
4. **Sound**：按节拍合成配乐（或者量出你音轨的网格），在提示点上放音效，混到平台要求的响度。
5. **Render and verify**：每种格式、循环检查、海报和 contact sheet；校验器量这个文件。
6. **House style**：下一支同产品的片从哪里起步。

每个任务被评两次：worker 按固定的评分表自评自己的 contact sheet，然后 task reviewer 打开这些图，给**七个维度**打 1 到 10 分（hook、readability、motion、variety、composition、brand、sound）；每个维度都到 8 分任务才算过。分数显示在任务抽屉里，并标出比上一次尝试的变化。

## What you get

在 goal 的 artifacts 里，每种格式一份：`final-<format>.mp4`（H.264，宽或高 1080，你要的时长，-14 LUFS）、`loop_check.mp4`、`poster.png` 和 `contact.png`；artifacts 条用封面播放这支片。仓库里：`motion/<slug>/` 下的源码和一份能重新渲染的 README，`docs/motion/` 下的风格指南、记着每轮分数的 review log，以及 house style。goal 完成时，house style 还会写成一个项目 skill（`motion-house-style`），你自己的编码会话会读到，和 Learnings skill 一样不进 git。

## Sessions that run long

做片和渲染的会话比改代码的长得多：现在每个 goal 都能带自己的 **Attempt timeout**（New goal 表单的 Custom 预算里，5 到 240 分钟），限制这个 goal 的单次会话；留空就沿用 [Settings → Models & limits](./settings.zh.md#models--limits)。motion-studio goal 建出来就是 60 分钟。

## Where the idea comes from

这套 harness 沿用了 Opus 5.5 发布后动效社区摸索出的做法：影片是时间的函数、闭式弹簧、节拍网格、代码合成的声音、让模型看自己的帧，见 Movez 的 [*How to build motion design studio with Opus 5.5*](https://x.com/0xMovez/status/2104216919033192746)。脚本和提示词是 Foundry 自己写的。
