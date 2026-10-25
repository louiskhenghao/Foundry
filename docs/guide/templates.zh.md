# 模版

> [English](./templates.md) · 中文

**模版**是 New goal 表单的起点：一段留着空白（*产品*、*时长*、*给谁看*）的 goal 描述，加上这类 goal 适合的设置（种类、Simple 还是 Expert、节奏、预算、访谈深度）。你填空，描述自己写好；表单按这类 goal 该有的样子设好；按 **Create** 之前你照样可以改任何东西。

Foundry 自带一套模版，每种 goal 两三个，中英文都有。你自己的模版是你做的文件：从一个你喜欢的 goal 另存、从 Foundry 的某个复制一份，或者从零写。

## 从模版开始

在 New goal 表单的 *What kind of goal is this?* 下面，**Start from a template…** 会弹出模版对话框：按种类分组，一打开就停在你选中的种类上（表单还是 *Auto* 时显示所有种类），带搜索。每张卡片写着模版的名字、它是做什么的、要填几个输入。**EN / 中文** 切换模版显示的语言；这个浏览器会记住。

按下一张卡片，会发生三件事：

- 模版的输入出现在描述框上方，每个都有标签和一句怎么写的提示。标着 `*` 的填好才能建 goal；选择题给出选项，有的还允许自己写。
- 描述随着你填写的输入自动写出来。文字是模版的，你随时可以改；一旦改了，输入就不再改写描述（**Write it from the inputs again** 可以再写一遍）。
- 表单带上模版的设置：goal 的种类，以及模版点名的其他设置，比如产品 reel 会设成 *Video*、motion-studio 引擎、Simple 视图和 Thorough 预算。模版没点名的，保持你原来的样子。

按钮随即显示为 **Template: …**，输入上方同名的小标签说明表单背后是哪个模版；它的 **×** 会忘掉模版，但保留文字和设置。如果你已经写了描述，选模版前会先问你。

goal 记得自己的模版：goal 页面的事实栏里有 **template: …**。

## 让 AI 填

输入下方的 **Fill in with AI** 读你的笔记（随便几行，说你想要什么），从中填好各个输入。它只用你的笔记：不会编出你没给的名字、数字或日期，你没说的就留空。它写的内容先展示出来；**Use these** 填进输入，**Discard** 原样保留。

没选模版时，描述框下方的 **Write it with AI** 对整段描述做同样的事：把你写在框里的内容当作笔记，按模版的章法写出描述；表单还是 *Auto* 时顺便判断 goal 的种类。

两者都是在 housekeeping 模型上的一次短调用，几分钱。勾上 **Also read the repository**（下方的仓库通过检查之后才能勾），草稿改为在你的 checkout 里用 Explainer 的模型跑几轮只读的回合，让文字能点出真实的文件和命令；这要一两分钟，最多一美元。费用显示在 **Usage** 页，记为 `template` 会话；它不属于任何 goal，不计入任何预算。

## 做自己的模版

打开顶栏的 **Templates**。这一页列出你的和 Foundry 的模版；任何一个上的 **Use** 都会用它开一个新 goal，**View** 则在弹窗里读它：带占位符名字的原文，或者 **Filled in**——每个空白都填上示例，上方有 **Edit**（你自己的才有）和 **Make a copy**。

![Templates 页面：你自己的模版，然后是 Foundry 按种类分组的模版，以及模版文件夹](images/templates.png)

- **New template** 用一个空模版打开编辑器。
- **Import a file** 导入一个来自别处的模版文件：从另一个 Foundry 导出的，或手写的。Foundry 会先检查。
- 在 **Foundry's** 下面，**Make a copy** 把一个内置模版写进你的文件夹，两种语言都带上，用一个自己的名字；副本归你改。

在 goal 页面上，**⋯** 菜单里有 **Save as template…**：编辑器打开，以这个 goal 的描述作为模版的文字，带上 goal 当时的设置。在该变成输入的地方写上 `{{a_key}}`，下一个同类 goal 的模版就好了。

### 编辑器

编辑器一次显示一个模版的一种语言。**EN / 中文** 切到另一种语言的文件；还没有的话，就从你眼前的文字开始。

- **About**：名字、goal 种类、画廊里显示的一句话摘要。
- **The description**：表单的起点文字。里面每个 `{{key}}` 都是一个输入：写上 `{{product}}`，右边就出现一个叫 *Product* 的输入。
- **Settings the template brings**：视图、节奏、工程纪律、workflow suite、访谈深度、预算（custom 时带数字）、该种类有的话还有视频引擎或 figure 风格，以及是否用命令检查跳过 Clarify。每项起初都是 *Form default*，即不动表单。
- **Inputs**：每个 `{{key}}` 的标签、提示、是一行、一段还是选择题（选项用 `|` 隔开，是否允许自己写）、默认值、是否必填。有默认值的输入默认不是必填，除非你说是。
- **As the form will show it**：描述里每个输入显示为一个空白。

**Save** 写入文件。内置模版在这里是只读的；**Make a copy to edit** 把它变成你的。

### 改名、导出、删除

你的每个模版在 Templates 页面上都有一个 **⋯** 菜单：**Rename…**（文件跟着改名）、**Export the English file** / **Export the 中文 file**（文件原样导出，留存或转给别人）、**Delete…**。**Open in VS Code**（以这台电脑上找到的编辑器命名）打开它的文件手动改；在那里保存，页面回到前台时就会显示变化。

## 模版文件

你的模版放在 Foundry 数据文件夹的 `templates/` 里；Templates 页面会显示它在哪。每个模版是一个 Markdown 文件：英文是 `<id>.md`，中文是 `<id>.zh.md`，id 由小写字母、数字和连字符组成。有错误的文件列在 Templates 页面的 **The templates folder** 下面，并说明该改什么。

文件是两行 `---` 之间的 frontmatter，然后是描述：

```markdown
---
name: 产品 reel
summary: 一支展示产品的短片，踩着音乐剪。
nature: video
lang: zh
settings:
  videoPack: motion-studio
  mode: simple
  budgetPreset: thorough
inputs:
  - key: product
    label: 产品
    help: 名字，以及它是做什么的，一句话。
  - key: duration
    label: 时长
    type: choice
    options: [15 秒, 30 秒, 45 秒, 60 秒]
    default: 30 秒
  - key: brand
    type: textarea
    required: false
---

为{{product}}做一支 {{duration}} 的产品 reel。

## 品牌
{{brand}}

## 已决定
- 一条时间线；每种画幅都从它剪出来。
```

- `name` 和 `nature`（`code`、`docs`、`research`、`image`、`video`、`figure` 或 `cad`）必须有；`summary` 和 `settings` 可选；`.zh.md` 文件写 `lang: zh`。
- `settings` 可以写 `mode`（`simple` 或 `expert`）、`workflow`（`pace`、`tdd`、`ponytail`、`profile`）、`budgetPreset`（custom 时加 `budgets`：`maxCostUsd`、`maxDurationMin`、`maxConcurrent`、`attemptsPerTask`）、`interviewDepth`（0–5）、`autoBrief`（`mustChecks` 和 `stretchChecks`，命令列表）、视频模版的 `videoPack`、figure 模版的 `figurePack`。跟电脑和账号有关的东西不属于这里：coding agent、模型、delivery、文件夹都是表单自己的事。
- `inputs` 只是细化描述里已有的东西：一个没有条目的 `{{key}}` 就是一个必填的单行输入，标签取自它的 key。条目可以给 `label`、`help`、`type`（`text`、`textarea`，或带 `options` 的 `choice`，`other: true` 允许自由作答）、`default`、`required` 和 `example`（预览「Filled in」时显示的示例，不会写进 goal）。描述里没出现过的 key 的条目是警告，不是错误。
- 描述可以用 Markdown。只放着一个留空的可选输入的行（`## 品牌` 后面跟着 `{{brand}}`）在写出描述时会被去掉。

内置模版的中文孪生是同一个模版的另一种语言：同样的输入和设置，各自的文字。

## 带着它们走

Transfer 文件（见[搬到新电脑](./moving-to-a-new-computer.zh.md)）在勾选 **Templates & themes** 时会带上你的模版和主题。到了另一台电脑，它们落在已有的旁边：内容一模一样的文件跳过，冲突的加一个数字编号。

在终端里，`foundry templates` 列出模版，`foundry templates export <id>` 和 `foundry templates import <file>` 搬运文件，`foundry goal new --template <id> --set key=value …` 用模版建一个 goal。
