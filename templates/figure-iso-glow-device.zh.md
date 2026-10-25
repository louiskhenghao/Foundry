---
name: 发光线稿里的一台设备
summary: 一张 iso-glow 风格的等轴测图——深色底上的细线稿，平面或真 3D，只有正在工作的部分用一种强调色发光——一台触碰就会运作的设备。
nature: figure
lang: zh
settings:
  figurePack: iso-glow
  mode: simple
inputs:
  - key: object
    label: 设备
    help: 一台合成器、一个机柜、一台收音机、一块电梯面板、夜里的自动售货机。
    example: 一台带小屏幕的桌面合成器
  - key: live
    label: 什么是「活」的
    type: textarea
    help: 设备工作时什么会发光——屏幕、按下的键、指示灯、光束、传着信号的导线——以及什么时候亮。
    example: |
      屏幕显示一条波形，有音符在响时它会动。
      正在按下的键会发光，还有当前振荡器上方的 LED。
      输出口引出的一根导线在出声时发光。
  - key: interactions
    label: 观众能做什么
    type: textarea
    help: 能按的键、能转的旋钮、能拨的开关；每个做什么。
    example: 按键演奏（波形随之变化），转滤波旋钮（波形变平滑），拨电源开关（开机前全部是暗的）。
  - key: form
    label: 平面还是 3D
    type: choice
    options: [平面等轴测线稿（SVG）, 真 3D（three.js：可环绕、可旋转、有真正的等轴测视角）]
    default: 平面等轴测线稿（SVG）
  - key: accent
    label: 强调色
    type: choice
    options: [ember, cyan, lime, violet, rose, ice]
    default: ember
  - key: inside
    label: 内部视图
    type: choice
    options: [要，透视电路板和走线, 不要，只看外面]
    default: 不要，只看外面
---

把{{object}}画成一张 iso-glow 图。

## 什么是「活」的
{{live}}

## 观众能做什么
{{interactions}}

## 平面还是 3D
{{form}}

## 强调色
{{accent}}

## 内部视图
{{inside}}

## 已决定
- 严格的 iso-glow 观感：深色底上的单色细线稿，只有活着的部分用一种强调色，活着的东西会发光；没通电的东西绝不发光。
- 图必须能做点什么：观众能碰的每个控件都会改变「活」的部分，图从一个合理的状态（关机或待机）开始。
- 一个网页：在哪里都能打开，手机上能用，没有署名行；保留调色板选择器，强调色可以换。平面版自包含；3D 版第一次打开要从网上加载 three.js。
- 先查清真实设备：比例和控件都是真的。
