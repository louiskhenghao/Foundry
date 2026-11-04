# 编辑器

*Beta：在 [Settings → Beta](./settings.zh.md#beta) 打开。*

影片 goal 的成果是一支片，而一支片很少第一次就对。**Editor** 从 goal 页面打开它：HyperFrames goal 打开的是 HyperFrames 自己的浏览器编辑器，对着 goal 的项目，由你自己剪、挪、改时长、改样式；[motion-studio](./motion-studio.zh.md) 的片则打开一个拖条页，拖着看每一帧。在里面做的事都不花 goal 的钱。

## HyperFrames goals

HyperFrames goal 把片放在进度文件夹里的一个项目文件夹（`hyperframes init` 建的那个，里面有 `hyperframes.json`）。**Workspace & preview** 卡片在仓库自己的应用旁边，每个项目列一行 **Editor · <项目>**，goal 进行中和完成后都在：

- **Start** 在预览端口上、在项目文件夹里启动 HyperFrames 的浏览器编辑器，用项目自己脚本钉的版本（`npx hyperframes@<version> preview`），没钉就用 Foundry 的。第一次启动要下载那个版本，稍等一会。**Open** 在新分页打开；**Stop** 停掉。goal 页面顶部的 ⚙ **Open** 菜单里也有，在 **Editor** 下：按一下，需要的话先启动，然后打开。
- 里面有：时间轴（移动、裁剪、分割、吸附到节拍）、文字 / 布局 / 样式 / 素材 / 动效的检查器、图层、逐词改字幕、素材、**Lint** 和 **Export**。每一步改动都直接写进进度文件夹里项目的文件；HyperFrames 在项目的 `.hyperframes/backup/` 下留备份。
- **goal 还在跑的时候**，那一行会提醒：编码智能体在同一个文件夹里工作，你保存的东西会进它们的下一次提交，也可能被它们覆盖。goal 完成后做的改动只属于你，直到你 **Re-render**。
- 和任何预览一样，用 Tailscale 时手机也能通过你的 tailnet 打开编辑器（见 [Preview](./while-it-runs.zh.md#preview)）。在这台电脑上它只监听 localhost；在 Docker 里监听发布出去的预览端口范围。
- 编辑器里的 **Export** 写到项目的 `renders/` 文件夹，Foundry 不把它放进 git，也不交付。goal 的成果来自下面的 **Re-render**。

编辑器是人用的：里程碑、self-check 和整合从不启动它，任务并入时也不重启它。按 **Stop**、闲置超过预览的闲置时间、或 Foundry 停止时，它才停。

## Re-render

HyperFrames goal 结束后（done、over-delivered 或 failed），它页面上的 **Re-render** 卡片在你改完之后把片重新渲染一遍，不开任何会话：

1. 当前的成果先留一份在进度文件夹的 `artifacts/.history/<n>/` 下，和[调整结果](./getting-the-result.zh.md#调整结果)之前一样；编辑和调整共用一套编号。
2. 每个项目用 `hyperframes render --quality delivery` 渲染到 `artifacts/video/<项目>/final.mp4`，文件用 ffprobe 检查。**▸ output** 实时显示渲染过程。
3. 你的改动作为一个独立的提交落在 goal 分支上，*chore(video): edits in the editor (edit n)*，所以已经推送过的分支不会被改写。
4. 输出文件夹拿到新文件；已经推送的分支或已经开出的 pull request 拿到这个新提交 —— 不用再选任何东西。

卡片列出每次编辑，以及改之前留下的版本（**Before it**）。渲染失败的项目会在卡片上说明并保留它之前的文件；其他项目照常落地。Re-render 需要的就是 HyperFrames 需要的：Node.js 22 或更新、FFmpeg，以及 HyperFrames 第一次渲染时自己下载的 Chrome。

暂时不行的情况：goal 还在跑（等它结束）、工作已经合并或进度文件夹已清理的 goal（开一个 [follow-up](./getting-the-result.zh.md#continue-with-a-follow-up)）、Delegated goal、作为历史导入的 goal，以及正在交付的 goal。

## Motion-studio films

[motion-studio](./motion-studio.zh.md) 的片是时间的函数，不是剪出来的时间轴，所以没有什么可拖的：**Workspace & preview** 卡片按 `motion/<slug>/` 每部片列一行，**Open** 打开一个拖着看的页面 —— 画幅菜单、**Play**、一条拖条，还有快捷键（空格播放，← → 走一帧，按住 shift 走十帧，Home 和 End）。片在沙箱里运行，和 figure 的页面一样。这个页面只能看：要改片，去[调整结果](./getting-the-result.zh.md#调整结果)。
