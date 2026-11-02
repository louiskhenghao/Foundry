# Deck goal（beta）

**deck** 就是一套幻灯片：向一屋子人的路演、一节课、季度复盘、一份文档变成的幻灯片。你用几句话说清，附上它该取材的文档，一个 **Slides** 种类的 goal 就把它做成原生的 **PPTX** 文件：真正的形状和文本框、图表和表格、演讲备注，在 PowerPoint、Keynote 或 Google Slides 里都能编辑。Foundry 把做好的每一页都给你看。

Deck 是 **beta** 功能：打开之前不出现，出现的地方都标着 **Beta**。

制作由 Foundry 替你安装的一个技能完成：Hugo He 的 **PPT Master**（ppt-master）。它先规划 —— 给谁看、要落下什么、页面清单 —— 再把每一页设计成一幅图，用自己的脚本把这些图编译成 PowerPoint 文件。这些脚本需要带一组包的 Python，你安装这个包时 Foundry 会把它们装进一个专属环境；不会往你系统的 Python 里加任何东西。

## 打开它

1. **Settings → Beta → Deck goals**：打开。New goal 表单的 goal 种类里会出现 **Slides**，Settings → Skills 下会出现 **Deck skills**。
2. 电脑上得有 **uv**：Foundry 用它做技能的 Python 环境，连 Python 本身一起。Setup 页的 doctor 会说它缺不缺；从 [docs.astral.sh/uv](https://docs.astral.sh/uv/getting-started/installation/) 安装。Docker 镜像里有。
3. **Settings → Skills → Deck skills**：**PPT Master** 已经选好；按 **Install**。Foundry 会把技能克隆到一个固定版本（它很大，约 80 MB），在数据文件夹的 `python/` 下做好 Python 环境并把技能的包装进去；日志在卡片下面滚动，第一次要几分钟。显示 **partial** 的包是在没有 uv 的情况下装的：装上 uv 再按一次 **Install**。
4. 工具，选了包之后 doctor 会列出来：**uv**、技能的 **Python 环境**（它会检查包能否导入），以及 **Chromium**（Settings → Preview & self-check → **Install Chromium**），用来渲染每页的预览；没有它 Foundry 照样数页数，只是不显示预览。

做幻灯片不需要 API key。如果 **Tools & keys** 下设了图片 key（OpenAI 或 Gemini），Brief 会问要不要用 AI 生成配图；没有的话，幻灯片用技能自带的图标、形状、图表和表格，以及你附上的图片。

做幻灯片是个长任务：技能要画几十页。它的会话可以跑 60 分钟，Foundry 才会切断并续跑，不管 Settings → Models & limits 里的 attempt timeout 写的是多少；续跑的会话从技能保留的设计规格接着做。

## 要一套幻灯片

在 New goal 表单上选 **Slides**。像对同事说话一样说清幻灯片做什么用、给谁看：*给种子轮投资人的 12 页产品路演，诉求是再约一次会*；*把附上的三季度复盘变成管理层会议的幻灯片，数字一个都别丢*；*给后端新同事的 45 分钟部署流水线入职课*。用 **Attach** 附上它该取材的文档：PDF、Word、Markdown、HTML 和表格都能读；幻灯片保留它们的事实和顺序。一个 goal 一套幻灯片是常见情况；几套就会变成几个任务。

**Slides** 下的四个模版 —— **路演幻灯片**、**文档变幻灯片**、**课件或培训幻灯片** 和 **汇报或复盘幻灯片** —— 会问你屋里坐着谁、要点、学习目标或事实，其余自己补上。

Slides 是媒体类 goal：表单会切到 **Simple** 并勾上 **Fast mode**，还会多出一个可选的 **Output folder**（它接收做好的 PPTX）。然后 Brief 会在动手之前定下：幻灯片给谁看、什么场合，目的和必须落下的那一个信息，页数范围，画幅（除非你要 4:3 或 A4，否则 16:9），语言，取材来源，演讲备注（默认有），转场或动画（默认只有普通淡入），设了 key 时要不要 AI 配图（默认不要），以及幻灯片的名字。它还会像图片 goal 的 Brief 一样提出两到四个 **风格方向** —— 配色、字体、气质 —— 你选中的那个就是幻灯片的外观。你像批准任何 Brief 一样批准它；命令行是 `foundry goal new "…" --repo <path> --nature deck`。

这个技能平时会在它自己开的页面上分两个阶段请用户确认方案。在 Foundry 里 Brief 就是那个确认：worker 根据它决定两个阶段，从不等你。

## 你得到什么

幻灯片是文件，不是代码：进度文件夹里的 `artifacts/decks/<name>.pptx`，从不进 git，goal 完成时复制到 **Output folder**（没设的话留在进度文件夹里，**Open ▾** 下能找到）。旁边的 `artifacts/decks/<name>/` 是技能留下的项目：设计规格、每一页的图、每页的预览和它带时间戳的导出件。分支上记录一份清单：幻灯片的路径、页数、每页一行、设计决定和用到的来源。

任务落地时，Foundry 自己打开这套幻灯片：不是 PowerPoint 包的文件、没有页的幻灯片、既没文字也没图片的页，都会让任务失败、再来一轮；被技能自己的交付检查拒绝的也一样。然后 Foundry 渲染技能留下的每页预览。**Have a look** 卡片和任务抽屉会显示它们，每页一张缩略图，卡片还链接到 PPTX 本身（点了会下载；用 PowerPoint 或 Keynote 打开）。审查者看的是同一批预览。

## 改一套幻灯片

goal 完成后，小改动走 goal 页面上的 **Adjust the result**（beta，见[调整结果](./getting-the-result.zh.md#调整结果)）：*去掉市场那一页*、*把诉求放到最后一页*、*第 6 页的图表改成百分比*。做这套幻灯片的会话从停下的地方接着改它的项目，改页面、重新导出，Foundry 再打开新文件；之前的文件留在 **Before it** 下。要一套不同的幻灯片，或者 goal 的工作已经合并了，就用 follow-up：**Continue with a follow-up…**。

## 致谢

PPT Master 的作者是 [Hugo He](https://github.com/hugohe3/ppt-master)，MIT 许可；Foundry 从它的仓库安装一个固定版本，并随自己的发布推进这个版本。它需要的 Python 包由你自己的安装装进你的数据文件夹，各自遵循自己的许可（其中 PyMuPDF 是 AGPL）。见 Settings → About & updates 下的 Open source credits 页面。
