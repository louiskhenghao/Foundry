# Diagram goal（beta）

**diagram** 是一张让读者看懂的图：系统是怎么搭起来的、一个请求怎么流转、一个过程里谁做什么、什么时候发生了什么、哪个套餐带来了收入。你用一句话说清；一个 **Diagrams** 种类的 goal 就把它画成一个自包含的网页，图以 SVG 的形式在页面里，旁边再导出一份 SVG，可以直接放进 README、文档页、wiki 或幻灯片。页面在任何浏览器里都能打开，离线也行。

Diagram 是 **beta** 功能：打开之前不出现，出现的地方都标着 **Beta**。

画图的是 Foundry 替你安装的一个技能：Cathryn Lavery 的 **diagram-design**。45 种图 —— 架构图、流程图、时序图、状态机、数据模型、时间线、泳道图、象限图、雷达图、树图、组织架构图、分层图、维恩图、金字塔、甘特图、桑基图、看板、用户旅程、部署图、依赖图、UML 类图、数据库表结构，以及各种图表（柱状、折线、散点、树图、热力图、瀑布）—— 有浅色、深色和完整编辑风格三种外观，一种强调色、细线边框、没有阴影。它一张图只放九个部分，更多的就拆成一张总览和一张细节。它能重画你给的 draw.io、Mermaid 或 Excalidraw 文件，也能从一个网站读取品牌的配色和字体。

## 打开它

1. **Settings → Beta → Diagram goals**：打开。New goal 表单的 goal 种类里会出现 **Diagrams**，Settings → Skills 下会出现 **Diagram skills**。
2. **Settings → Skills → Diagram skills**：**diagram-design** 已经选好；按 **Install**。Foundry 会把技能仓库的一个固定版本克隆到你 coding agent 的技能文件夹里，所以在 Foundry 更新推进这个版本之前，goal 用的始终是同一个技能。这个包和 Design、Image、Video 包一样：选一个，或者 **None**。
3. 工具，选了包之后 Setup 页的 doctor 会列出来：
   - **Chromium**（Settings → Preview & self-check → **Install Chromium**）：Foundry 用它打开每个做好的页面确认它能跑，并渲染 PNG。没有它，每个 diagram 任务都过不了检查。
   - **python3**：技能用两个只依赖 Python 本身的小脚本导出 SVG、检查自己的页面。Docker 镜像里有。

不涉及图像模型和 API key：全部花费就是 worker 的 token 和时间，和代码 goal 一样。一张图几分钟。

## 要一张图

在 New goal 表单上选 **Diagrams**。像对同事说话一样描述图要展示什么：*订单服务以及它和谁通信*；*退款申请是怎么处理的，谁审批什么*；*迁移的时间线*；*按这些数字，哪个套餐带来最多收入*。一个 goal 一张图是最简单的情况；几张图就会变成几个任务。**Diagrams** 下的三个模版 —— **架构图**、**流程图** 和 **数据图表** —— 会问你各部分、步骤或数字，其余自己补上。

Diagrams 是媒体类 goal：表单会切到 **Simple** 并勾上 **Fast mode**，还会多出一个可选的 **Output folder**（它接收 Foundry 渲染的 PNG；页面和 SVG 进仓库）。然后 Brief 会在画之前定下：每张图必须展示什么、是哪一种，在哪里阅读（README、wiki、幻灯片、链接卡片 —— 尺寸随之而定），以及整个 goal 只定一次的外观（浅色、深色或完整编辑风格）、字体（技能的网页字体，或者页面必须离线打开时用系统字体）和品牌：技能自带的配色，或者一个网站地址，技能会读取它的配色和字体。你像批准任何 Brief 一样批准它；命令行是 `foundry goal new "…" --repo <path> --nature diagram`。

当你给了品牌网站，第一个任务会把品牌的配色和字体写进仓库的 `docs/diagrams/style-guide.md`，这个仓库里之后的每张图都跟随它；删掉这个文件就回到技能自带的配色。技能自己安装的文件从不改动。

## 其他 goal 里的图

包装好、beta 打开后，**Documents**、**Research** 或 **Code** goal 也能画图。当一张图比一段文字更能让读者看懂 —— README 里的架构、设计文档里的流程、报告里的时间线 —— Foundry 会把这张图规划成一个独立的任务，排在用到它的写作任务之前，文档则用 markdown 图片的写法嵌入那个 SVG（指向 `diagrams/<name>.svg`），GitHub 会直接渲染。这样的任务和 diagram goal 的任务一样画、一样检查；Brief 会把它列在任务里，你可以像去掉别的任务一样去掉它。

## 你得到什么

每张图是一个自包含的 `.html` 页面，**提交在仓库里**，位置是 `docs/diagrams/<name>.html`（除非你的仓库把图放在别处），旁边是它的 SVG `docs/diagrams/<name>.svg`；push、pull request 或自动合并都带着这两个文件。分支上还会记录一份清单：图的种类、展示什么、假设了什么。Foundry 自己渲染的 PNG（两倍像素）放在进度文件夹的 `artifacts/` 下（从不进 git）；可选的 **Output folder** 会收到它。

任务落地时，Foundry 自己在无头浏览器里打开页面：抛错、打出错误日志或没有 SVG 的页面会让任务失败、再来一轮；被技能自己的自检拒绝的页面也一样（它检查单文件是否安全、完整、可访问）。**Have a look** 卡片和任务抽屉会显示 Foundry 拍的截图并链接到页面；抽屉的 **Files** 下列出页面和 SVG。点页面就在预览里运行它，它在一个碰不到 Foundry 的沙箱里；**Source** 显示文件，**Open in a new tab** 单独打开。

页面打开时会从 Google Fonts 加载字体，除非 Brief 选了系统字体；没有网络时图照样显示，只是用系统字体。在 Foundry 之外，双击文件就行：它就是一个普通网页。

## 改一张图

goal 完成后，小改动走 goal 页面上的 **Adjust the result**（beta，见[调整结果](./getting-the-result.zh.md#调整结果)）：*在网关和订单服务之间加上缓存*、*把队列作为重点*。画这张图的会话从停下的地方接着画；Foundry 再次无头打开页面，并把之前的页面留在 **Before it** 下。要一张不同的图，或者 goal 的工作已经合并了，就用 follow-up：**Continue with a follow-up…**，用文字说明改动。新 goal 从做完的那个开始，所以 worker 能在原处找到页面和品牌文件。

## 致谢

diagram-design 的作者是 [Cathryn Lavery](https://github.com/cathrynlavery/diagram-design)，MIT 许可；Foundry 从它的仓库安装一个固定版本，并随自己的发布推进这个版本。见 Settings → About & updates 下的 Open source credits 页面。
