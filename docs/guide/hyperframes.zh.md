# HyperFrames 影片

**HyperFrames** 引擎像做网页一样做影片 goal 的片：每个场景一个 HTML composition，用 GSAP 做动效，由 HyperFrames 命令行逐帧渲染成真正的视频文件。它是 Settings 里 Video skills pack 默认指定的引擎，不需要 key 也不需要账号，还带一个人可以打开的浏览器编辑器（见[编辑器](./editor.zh.md)）。这一页讲 HyperFrames goal 需要什么、Foundry 怎样让它走完一间工作室的关卡，以及你能拿到什么。

## What the goal needs on this computer

- **Node.js 22 或更新**：命令行跑在它上面（Mac 上 `brew install node`；Docker 镜像自带）。
- **ffmpeg**，带 ffprobe：编码、contact sheet、响度处理和校验都用它（`brew install ffmpeg`）。
- 渲染用的 Chrome：HyperFrames 第一次渲染时自己下载无头 Chrome，不用装。

Settings 的 Video skills pack 选的是 HyperFrames 时，Setup 页面的 doctor 会检查 Node.js 和 ffmpeg。skill 本身来自 Extensions 目录：HyperFrames 的四个（写法指南、命令行、积木注册表、素材）、Foundry 自己的 **hyperframes-harness**，以及 Herk Edit Kit 做 showreel、Shorts 和长片节拍的 playbook。

## How a film is made

Clarifier 在渲染之前先把一支片需要的东西定下来：主题或产品和它的网址、时长、画幅（16:9、9:16、1:1、4:5 —— 第一个是片本身，其他每种画幅都是手工重排的独立 composition，绝不裁切）、品牌配色与字体或你从卡片里选的风格方向、你附的参考、音乐（你附的曲子，或内置的一首）、声音（没有，或在这台电脑上合成的旁白）、屏幕上文字的语言，以及结尾那一句。音频和视频附件最大 200 MB。

然后计划走过 harness 的关卡：

1. **风格指南和分镜** —— 收齐真实素材，从参考写出风格指南，把镜头排在节拍网格上；项目建在 `video/<slug>/` 下。
2. **搭建与草稿** —— 每个场景一个子 composition，由根 composition 挂载，命令行的检查全过，渲染一版草稿和第一张 contact sheet。这个任务是里程碑：sheet 会显示在 goal 页面上，goal 继续往下走。
3. **批评轮次** —— worker 按固定的评分表给自己的 sheet 打分，修掉最差的三处，只重渲染改过的那一段；至少三轮，每轮连分数一起记录。
4. **声音** —— 放好音乐，剪切点上加音效，Brief 要求时用本机的文字转语音做旁白、本机的转写做字幕。
5. **交付** —— 每种画幅按交付质量渲染，调到 -14 LUFS，附 contact sheet、手机 sheet 和封面；校验器逐个测量文件。

每个任务都被评两次：worker 先批评自己的 contact sheet，然后任务审查者打开这些 sheet，给 **七个维度**打 1–10 分（hook、readability、motion、variety、composition、brand、sound）；每个维度都到 8 分以上任务才落地。分数显示在任务抽屉里，并标出比上一次的变化，和 motion-studio 的片一样。

goal 进行中和完成后，它页面上的 **Editor** 一行会在项目上打开 HyperFrames 的浏览器编辑器；goal 结束后，**Re-render** 在你改完之后把片重新做出来。见[编辑器](./editor.zh.md)。

## What you get

在 goal 的 artifacts 里，每种画幅一份：`final-<format>.mp4`（H.264，宽或高 1080，你要的时长，-14 LUFS）、`poster.png`、`contact.png` 和 `phone.png`，`rounds/` 下是每轮批评的 sheet；artifacts 条用封面播放这支片。仓库里：`video/<slug>/` 下的项目（已提交）和一份能重新渲染的 README，`docs/video/` 下的风格指南和记着每轮分数的 review log。命令行自己的文件夹（`renders/`、`.hyperframes/`、`.thumbnails/`）不进 git。

## Templates

四个内置[模版](./templates.zh.md)用正确的设置开一个 HyperFrames goal：**旁白讲解片**（本机合成的声音、字幕、节奏）、**字幕短片**（你附的录像，剪出字幕和钩子）、**图片影片**（你的图片，一拍一张，每张一句）和**产品 reel（HyperFrames）**。
