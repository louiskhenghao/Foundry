# Figure goal（beta）

**figure** 是日常物件或机器的一张可交互等轴测图，就是一个网页：一把能打开、看它煮沸的水壶，一台投币后掉出罐装饮料的自动售货机，一台能按下拉杆的烤面包机，再加一个开关，看它内部的机构怎么运作。你用一句话描述这个物件，一个 **Figures** 类的 goal 就把它画出来。页面是你的：在任何浏览器里都能打开，手机上也能用，不带署名行。

Figures 是 **beta** 功能：默认关闭，打开后它出现的地方会标上 **Beta**。

有两种风格可选，来自 April Zhu 的两个技能，Foundry 随包附带：

| 风格 | 长什么样 | 适合 | 耗时 |
|---|---|---|---|
| **Colorfigures** | 暖纸底上的彩色手绘墨线等轴测图。拖动可以把物件转一整圈，按钮按下去会做真实按钮做的事，打开 **See-through** 能看到带标签的机构在里面运作。 | 有可按部件的日常机器和设备：家电、自动售货机和街机、玩具、自助终端。不适合柔软或有机的东西。 | 每张图 15–30 分钟、几十万 token：技能会先研究真实物件怎么工作，再画、再从各个角度自检截图，最后组装页面。 |
| **iso-glow** | 深色底上的细线图，只有"活着"的部分用一种强调色发光：按下的键、亮着的窗、传着信号的线。有浅色主题、3D 模式，以及用于产品插画的实心发光风格。 | 桌面物件、设备、建筑和城市天际线，有信号亮起的示意图。 | 每张图约一分钟。 |

## 打开它

1. **Settings → Beta → Figure goals**：打开。New goal 表单的 goal 类型里会出现 **Figures**，Settings → Skills 下会出现 **Figure skills**。
2. **Settings → Skills → Figure skills**：选 **Colorfigures** 或 **iso-glow** 作为默认风格，按 **Install**。两个技能都随 Foundry 附带，安装就是把它们复制到你编码智能体的技能目录，不会下载任何东西。这个包和 Design、Image、Video 包用法一样，只有一点不同：一个 goal 可以选另一种已安装的风格（见下文）。
3. 工具，选了包以后 Setup 页的 doctor 会列出来：
   - **Chromium**（Settings → Preview & self-check → **Install Chromium**）：Foundry 会用它打开每个做好的 figure 页面，确认页面能跑。没有它，每个 figure 任务的检查都会失败。
   - **python3**：Colorfigures 用它组装单文件页面；iso-glow 没有也行。Docker 镜像里已带。
   - **这台电脑上的 Chrome**（只有 Colorfigures 需要）：技能用无头 Chrome 从各个角度自检它画的图。没有的话它会跳过这些截图并说明；Foundry 自己的检查照常运行。Docker 镜像里提供了一个。

不涉及任何图像模型或 API key：全部花费就是 worker 的 token 和时间，和代码类 goal 一样。figure 任务的会话可以跑满 45 分钟才会被 Foundry 切断再续接，不管 Settings → Models & limits 里的 attempt 时限设成多少：Colorfigures 的每一轮都很长。

## 要一张 figure

在 New goal 表单里选 **Figures**。像对一个人那样描述物件和它该做什么：*一台扭蛋机，我能投币、转把手*；*一把会自己烧开并跳停的水壶——展示它怎么知道该停*。一个 goal 一张图是最简单的情况；几张图会变成几个任务。

类型下面会多出一行 **Style**：**Default**（Figure skills 的设置）、**Colorfigures** 或 **iso-glow**。选 Default 时，如果你的措辞明显要另一种风格的样子，Foundry 仍可能选它：*暗底*、*发光*、*霓虹*、*线稿*、*天际线* 偏向 iso-glow；*彩色*、*手绘*、*剖视* 偏向 Colorfigures。你的编码智能体没装的风格会灰掉。

Figures 是媒体类 goal：表单会切到 **Simple**、勾上 **Fast mode**，并出现可选的 **Output folder**，goal 完成时成品页面会复制到那里。然后 Brief 会在动笔之前定下这张图必须展示什么：真实物件一步步怎么工作、每个按钮做什么、颜色、要不要内部视图、页面的文件名。你像批准任何 Brief 一样批准它；命令行是 `foundry goal new "…" --repo <path> --nature figure`，加 `--figure-pack iso-glow` 选另一种风格。

Colorfigures 的页面不带页脚，标签是技能画出来的那种大写字母。描述用中文或其它语言都没问题；想让按钮文字用某种语言，在 goal 里说一句就行。

## 你拿到什么

每张图是进度文件夹 `artifacts/` 下的一个 `.html` 文件，goal 完成时复制到 Output folder，和[图片与视频类 goal](./getting-the-result.zh.md#媒体类与-cad-类-goal-和输出文件夹)一样。分支上记录它的清单：这张图展示什么、每个按钮做什么。

任务落地时，Foundry 自己会在无头浏览器里打开这个页面：抛出错误、打印错误或什么都没画出来的页面会让任务失败，于是再来一轮。任务抽屉里显示 Foundry 拍的截图——合起来的物件，以及 Colorfigures 页面的透视图——并在 **Files** 下列出这个页面。点它会在预览里打开页面，是能跑的：拖动它、按它的按钮。**Source** 显示文件内容；**Open in a new tab** 单独打开它。页面在一个碰不到 Foundry 的沙箱里运行，所以一张 figure 永远读不到你的会话，也调不了 Foundry 的 API。

iso-glow 的页面打开时会加载一个网页字体，3D 模式还会从 CDN 加载 three.js；Colorfigures 的页面什么都不加载。在 Foundry 之外，双击文件就行：它是一个普通网页。

## 改一张 figure

goal 完成后，用 follow-up 提修改：goal 页面上的 **Continue with a follow-up…**，把改动写成一句话（*把门再开大一点*，*加一个退币口*）。新 goal 从做完的那个接着来，worker 能在原处找到页面和它的源码。

## 致谢

Colorfigures 和 iso-glow 的作者是 [April Zhu](https://april-zhu.com)，MIT 许可；Foundry 保存两者各一份作者发布时的快照（`catalog/bundled/`），原样不改，并随自己的发版刷新。Colorfigures 基于 ISO-GLOW，ISO-GLOW 基于 Tolga Cohce 的 iso-figure（MIT）。见 Settings → About & updates 下的 Open source credits 页。
