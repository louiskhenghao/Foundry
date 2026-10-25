---
name: 动态文字讲解
summary: 用会动的文字讲清一件事，踩着节奏，用你选的颜色。
nature: video
lang: zh
settings:
  videoPack: motion-studio
  mode: simple
  budgetPreset: thorough
inputs:
  - key: topic
    label: 讲什么
    example: 复利是怎么回事
  - key: script
    label: 文字
    type: textarea
    help: 脚本，或按顺序要讲的要点。短句动起来最好看。
    example: |
      你存下 100。
      它赚了 5。现在是 105。
      明年，那 5 也开始赚钱。
      起初很小。后来一点也不小。
      三十年：432，什么都没做。
      早点开始。让时间干活。
  - key: duration
    label: 时长
    type: choice
    options: [30 秒, 45 秒, 60 秒, 90 秒]
    default: 45 秒
  - key: formats
    label: 画幅
    type: choice
    options: ["16:9", "9:16", "16:9 和 9:16"]
    default: 16:9 和 9:16
  - key: rhythm
    label: 节奏
    type: choice
    options: [舒缓, 轻快, 有力]
    default: 轻快
  - key: palette
    label: 颜色与字体
    required: false
    help: 两三种颜色和一个字体家族，或者一个可以取用的品牌。
    example: 近黑、粉笔白和一种酸绿；大字用瘦高的黑体。
---

做一支 {{duration}} 的动态文字讲解，讲{{topic}}。

## 文字
{{script}}

## 画幅
{{formats}}

## 节奏
{{rhythm}}

## 颜色与字体
{{palette}}

## 已决定
- 屏幕上的每个字在手机上一眼能读清；一次只出现一个意思。
- 动作跟着意思走：重音落在节拍上，脚本换气处停顿。
- 一条时间线；每种画幅都从它剪出来，绝不从另一种裁切。
