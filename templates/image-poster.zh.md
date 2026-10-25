---
name: 海报
summary: 为一场活动、一个产品或一句话做一张海报，尺寸和风格由你定。
nature: image
lang: zh
settings:
  mode: simple
inputs:
  - key: subject
    label: 海报是为了什么
    help: 活动、产品或要传达的话，一句话。
  - key: size
    label: 尺寸
    type: choice
    options: [A4 竖版, A3 竖版, 1080 × 1350（社媒竖图）, 1920 × 1080（屏幕）]
    other: true
    default: A4 竖版
  - key: style
    label: 观感
    type: textarea
    help: 情绪、年代、参考作品，以及绝不能像什么。
  - key: words
    label: 必须出现的文字
    type: textarea
    required: false
    help: 标题、日期、地点、行动号召，照原样写。
  - key: colours
    label: 颜色
    required: false
    help: 品牌色或一套配色，用名字或十六进制都行。
---

为{{subject}}设计一张海报。

## 尺寸
{{size}}

## 观感
{{style}}

## 必须出现的文字
{{words}}

## 颜色
{{colours}}

## 已决定
- 交付上述尺寸的可印刷文件，外加一张屏幕尺寸的预览。
- 文字一个字都不能错；隔着一个房间也要看得清。
- 先出两三个方向，再把选中的那个做完。
