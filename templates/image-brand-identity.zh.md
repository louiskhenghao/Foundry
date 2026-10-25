---
name: 品牌视觉系统
summary: logo、配色、字体和使用规则：先出几个方向再深化，交付设计师和开发者都能直接用的文件。
nature: image
lang: zh
settings:
  mode: simple
  budgetPreset: thorough
inputs:
  - key: brand
    label: 品牌
    help: 名字，以及它做什么，一句话。
    example: Vela，小批量生产的电动跑车
  - key: personality
    label: 性格
    type: textarea
    help: 三到五个词，以及品牌不是什么；你欣赏其气质的品牌。
    example: 精准、安静、自信、带一点浪漫。不吵闹、不是运动攻击型、不复古。欣赏好钟表那种克制。
  - key: uses
    label: 它会出现在哪
    type: textarea
    help: 视觉系统必须胜任的场合：应用图标、网站、车标、文件、社媒。
    example: 车上的徽标（金属，40 mm）、网站页头、应用图标、发票和幻灯片模板、社媒头像。
  - key: directions
    label: 先出几个方向
    type: choice
    options: ["2", "3", "4"]
    default: "3"
  - key: colours
    label: 起步的颜色
    required: false
    help: 已有的颜色，或留空放手去做。
    example: 深石墨是定下的；其余都开放。
  - key: avoid
    label: 避免
    type: textarea
    required: false
    example: 闪电、叶子、渐变蓝的通用无衬线字标。
---

为{{brand}}设计一套品牌视觉。

## 性格
{{personality}}

## 它会出现在哪
{{uses}}

## 先出几个方向
{{directions}}

## 起步的颜色
{{colours}}

## 避免
{{avoid}}

## 已决定
- 先出方向：每个方向一个 logo、一套配色和一组字体搭配，放在上面的场合里展示，附一句创意说明；选定一个之后才深化。
- logo 单色能用、反白能用、16 px 能用、一米大也能用；交付 SVG（主标、图标、字标），带留白和最小尺寸规则。
- 配色含主色、一组中性色阶和信号色，各给十六进制，文字与背景的对比度经过检查。
- 字体：一款展示字体和一款正文字体，可商用，附网站和文件用的字号与字重。
- 一页使用规范（能做 / 不能做）和一个命名统一的素材文件夹；全部内容另在一份开发者能读的 `brand.md` 里概述。
