# 主题

> [English](./themes.md) · 中文

主题决定 Foundry 的样子：浅色和深色模式下的配色、字体、圆角，以及版式：导航放在哪里，标题、阶段、标签和等你的事怎么画。它不会改变页面显示什么。Foundry 自带三个主题，你也可以加上自己的。

## 选择主题

打开 **Settings → Appearance**，或者顶栏右侧 ⚙ 菜单里的 **Appearance**。每个主题都显示成一张用它自己的颜色和版式画的小图，下面用几个词写出它的版式（**Top bar** 或 **Side column**、**Poster titles**、**Numbered steps** 等），点一下就换成这个主题。主题下方的 **Light or dark** 有 **Light**、**Dark** 和 **Same as this computer** 三个选项，最后一个跟随电脑或手机的浅色/深色设置。⚙ 菜单里的 **Light mode** / **Dark mode** 一键在两者之间切换。

主题和明暗都只存在这个浏览器里，所以每个人、每台设备可以各选各的。改动立即生效，不需要保存。

![Settings → Appearance：三个自带主题、浅色或深色，以及怎样做自己的主题](images/appearance.png)

## 自带的主题

| 主题 | 样子 |
|---|---|
| **Wayfinding**（默认） | 把 Foundry 当成一套导视系统：混凝土灰和石墨色，信号黄只出现在需要你的地方；事情进行到哪一步用信号色表示（绿色完成、蓝色正在工作、紫色审查中、红色失败），页面的各个部分像地铁线路一样各有颜色。石墨色顶栏、海报式大标题、斜切的阶段牌、大写的标签、页面上一层淡淡的颗粒；字体是 Atkinson Hyperlegible，专为分清 0 和 O、1 和 l 而设计。 |
| **Ledger** | 把 Foundry 当成一本账簿：纸和墨，标题用 Fraunces 衬线字体，主按钮是蓝黑色的墨水，需要你的地方用荧光笔的黄绿色。页面挂在左侧的一栏上，阶段是一条带编号的步骤线，标题用小型大写字母，等你的事是一张带荧光笔边的卡片，卡片平铺在纸上。 |
| **Classic** | 有主题之前 Foundry 的样子：锌灰色、翠绿色的主按钮和系统自带的字体；标题朴素，标签照原样书写，阶段是一条带编号的步骤线，等你的事是一张带琥珀色边的卡片。 |

## 做自己的主题

1. 在 **Settings → Appearance** 里，在最接近你想要的那个主题下按 **Make a copy**。Foundry 把它写成主题文件夹里的一个文件，起一个自己的名字（比如 `wayfinding-copy.json`），并直接用上它。
2. 用编辑器打开这个文件。你自己的主题卡片上，以及 **Make a copy** 之后出现的提示里，都有 **Open in VS Code**（按钮用这台电脑上找到的编辑器命名；有好几个时是 **Open in an editor**，可以选）。**Open the folder** 会用编辑器或文件管理器打开整个主题文件夹，卡片上也显示文件夹路径并带 **copy**。改颜色、字体、圆角或版式都可以。能读 JSON Schema 的编辑器（比如 VS Code）会在你输入时检查每个值，并解释每一项设置：文件里写明了 `theme.schema.json`，Foundry 把它放在同一个文件夹里。
3. 保存文件，回到 Foundry 的窗口。每当 Foundry 的窗口回到前台，它都会重新读取主题文件，所以改动马上就能看到。**Read the files again** 可以手动做同样的事。

有错误的文件会列在 **Make your own theme** 下面，并说明要改什么，比如 `my-theme.json — light.page: a colour is written #rgb or #rrggbb`。文件有错期间，主题保持最后一次正常的样子。

你自己的主题在卡片上有一个 **⋯** 菜单。**Rename…** 给它改名，文件名也跟着改：这个浏览器继续用它，别的用着它的浏览器会回到 Wayfinding。**Make a copy** 以它为起点再做一个主题，**Export the file** 把它的文件存到你的电脑上，**Delete…** 删除这个文件。**Open the folder** 旁边的 **Import a theme file** 可以导入别处来的主题文件，比如从另一台 Foundry 导出的，或者手写的：Foundry 会像检查文件夹里的文件一样检查它，有错时说明要改什么，没错就直接用上。

主题文件夹是 Foundry 数据文件夹里的 `themes/`；Appearance 卡片会显示它在你电脑上的位置。除了 `theme.schema.json`，里面每个 `.json` 文件都是一个主题，以文件名命名：只能用小写字母、数字和连字符，并且不能叫 `wayfinding`、`ledger` 或 `classic`，这几个名字已经被占用。想分享主题，导出它的文件，在另一台 Foundry 上导入；或者把文件复制到那台 Foundry 的主题文件夹里。

## 主题文件

一个主题只需要名字，以及每种模式下的四个颜色。其余都是可选的，没写的由 Foundry 推算。最小的主题：

```json
{
  "name": "Paper",
  "light": { "page": "#f4f1ea", "panel": "#fffdf8", "line": "#e2dccf", "ink": "#2b2622" },
  "dark": { "page": "#16130f", "panel": "#201c17", "line": "#36302a", "ink": "#efe9df" }
}
```

完整一些、包含所有设置的例子：

```json
{
  "$schema": "./theme.schema.json",
  "name": "Night shift",
  "description": "Ink on warm paper, cobalt for the main button.",
  "fonts": {
    "sans": "\"Inter\", ui-sans-serif, system-ui, sans-serif",
    "display": "\"Fraunces\", Georgia, serif",
    "mono": "\"JetBrains Mono\", ui-monospace, monospace",
    "stylesheets": ["https://fonts.googleapis.com/css2?family=Inter:wght@400..800&family=JetBrains+Mono:wght@400..700&family=Fraunces:opsz,wght@9..144,600..900&display=swap"]
  },
  "shape": { "radius": 6, "slant": 0, "texture": "none" },
  "layout": { "nav": "side", "header": "compact", "stages": "steps", "labels": "small-caps", "signs": "card", "surface": "flat" },
  "light": {
    "page": "#f4f1ea", "panel": "#fffdf8", "inset": "#f8f4ec", "line": "#e2dccf", "lineStrong": "#a89f8f",
    "ink": "#2b2622", "inkSoft": "#4a433c", "inkFaint": "#6f665c",
    "band": "#2b2622", "bandInk": "#fffdf8", "accent": "#2747b8",
    "you": "#f2b705", "work": "#2747b8", "ok": "#2e7d4f", "bad": "#c0392b", "extra": "#7b4fa6",
    "codes": ["#2747b8", "#2e7d4f", "#7b4fa6", "#c4651b", "#c0392b", "#1f7f7a", "#a8487a", "#7a7a1f"]
  },
  "dark": {
    "page": "#16130f", "panel": "#201c17", "inset": "#28231d", "line": "#36302a", "lineStrong": "#6d6458",
    "ink": "#efe9df", "inkSoft": "#d3cabd", "inkFaint": "#a59b8e",
    "band": "#0e0c09", "bandInk": "#efe9df", "accent": "#8fa8ff",
    "you": "#f2b705", "work": "#8fa8ff", "ok": "#6cc08b", "bad": "#ff7b6b", "extra": "#c6a3e8",
    "codes": ["#8fa8ff", "#6cc08b", "#c6a3e8", "#f0a35e", "#ff7b6b", "#5cc7c0", "#e98fbf", "#c8c35c"]
  }
}
```

### 颜色

`light` 和 `dark` 两种模式各有一套颜色，写成 `#rrggbb`（或 `#rgb`）。

| 设置 | 用在哪里 | 不写时 |
|---|---|---|
| `page` | 所有内容背后的页面 | 必填 |
| `panel` | 卡片、信息板、菜单和对话框 | 必填 |
| `line` | 细线和边框 | 必填 |
| `ink` | 文字 | 必填 |
| `inset` | 代码块、表头，以及卡片里的小框 | 介于 page 和 panel 之间 |
| `lineStrong` | 输入框边框、空心的任务方块、滚动条 | line 朝 ink 再深一级 |
| `inkSoft` | 次要文字 | ink 朝 panel 淡三分之一 |
| `inkFaint` | 提示、时间和标签 | ink 朝 panel 淡一半，并保证看得清 |
| `band` | 顶栏 | page |
| `bandInk` | 顶栏里的文字和图标 | ink |
| `accent` | 主按钮、选中的标签和选项、焦点框 | ink |
| `you` | 等你的事：Needs you 指示牌、Inbox 数字、待批准的东西 | 琥珀色 |
| `work` | 智能体在工作（正在运行的目标或任务、正在跑的检查），以及信息：链接、说明 | 蓝色 |
| `ok` | 完成、通过、已合并、已交付、新增的行 | 绿色 |
| `bad` | 失败、错误、危险、删除的行 | 红色 |
| `extra` | 审查、合并，以及其他需要区分的类别 | 和 `work` 相同 |
| `codes` | 最多八个用来区分同类事物的颜色，从不表示状态：Brief 的各个部分、Areas、扩展的来源、致谢的分组。不足八个时循环使用。别和 `you` 的颜色太接近：用了它的颜色的类别，看起来就像在等你。 | 八个在该模式下看得清的色相：蓝、绿、紫、橙、粉、青、品红、黄绿 |

`you`、`work`、`ok`、`bad`、`extra` 和每个 `codes` 各选一次就好。它们用作卡片上的文字时，Foundry 会把颜色调深（浅色模式）或调浅（深色模式）直到看得清，色相不变：明亮的黄色 `you` 写成文字时会变成赭黄色。写在实心指示牌或按钮上的文字，会从主题的颜色里挑最清楚的那个。

Foundry 里所有颜色都跟随主题，包括本指南没有展示的页面。编码智能体自己的颜色（Claude Code 的橙色、Codex 的蓝色、Antigravity 的青色）在每个主题里都不变，一眼就能看出是谁做的。

### 字体

| 设置 | 说明 |
|---|---|
| `sans` | 正文字体，写成 CSS 字体列表，比如 `"Inter", ui-sans-serif, sans-serif`。不写时用系统自带字体。 |
| `display` | 页面标题和其他大标题（Ledger 用 Fraunces）。不写时用正文字体。 |
| `mono` | 数字、时间、路径和代码。不写时用系统的等宽字体。 |
| `stylesheets` | 最多三个加载字体的样式表地址，必须是 `https://`，比如 Google Fonts 的地址。电脑上已安装的字体不需要它。 |

字体列表里只能有字体名、引号、逗号和空格。

### 形状

| 设置 | 说明 |
|---|---|
| `radius` | 卡片的圆角半径，单位是像素，0 到 24（Wayfinding 是 10，Classic 是 8，Ledger 是 4）。按钮和标签按比例小一些；0 表示所有角都是直角。 |
| `slant` | 阶段牌倾斜的角度，−30 到 30 度（Wayfinding 是 −14，Classic 是 0）。 |
| `texture` | `grain` 在卡片后面的页面上铺一层淡淡的颗粒（Wayfinding）；`none` 保持平整。 |

### 版式

每一项都是几个固定名字中的一个。文件里没写的项，取 Wayfinding 的值，也就是每个列表里的第一个。

| 设置 | 选项 |
|---|---|
| `nav` | `top`：页面导航是横在顶部的一栏。`side`：屏幕宽 1280px 及以上时改为左侧的一栏，里面有 **New goal**、各个页面、Inbox，底部是用量、账号和 ⚙（Ledger）。更窄的屏幕仍是顶栏。 |
| `header` | `poster`：页面标题用很大的字。`compact`：朴素的一行标题（Classic）。 |
| `stages` | `plates`：目标的五个阶段画成大的斜切阶段牌，手机上是细长的色段。`steps`：一条带编号的步骤线（Ledger、Classic）。 |
| `labels` | `caps`：卡片标题和小标题用大写字母。`small-caps`：用小型大写字母（Ledger）。`plain`：照原样书写（Classic）。11px 及以下的小标签在所有主题里都保持大写。 |
| `signs` | `strip`：等你的事是一条 `you` 颜色的色带。`card`：一张带边的卡片，边、图标和等待时间用 `you` 颜色（Ledger、Classic）。 |
| `surface` | `raised`：卡片和信息板下有柔和的阴影。`flat`：只有细线（Ledger、Classic）。 |

## 主题做不到的事

主题文件里只能有颜色、字体列表、数字、https 样式表地址，以及版式里那些固定的名字，其他内容 Foundry 一律拒绝，所以主题只能改变 Foundry 的样子，别的什么都改不了。它可以把导航挪到左侧，用自己的方式画标题、阶段、标签和指示牌，但不会隐藏、删除或改名页面上的任何东西。
