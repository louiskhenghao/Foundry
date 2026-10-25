---
name: 产品 reel
summary: 一支展示产品的短片，踩着音乐剪，覆盖你要发的每种画幅。
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
  - key: url
    label: 在哪里能看到它
    required: false
    help: 网站或应用，短片可以从那里取真实界面和配色。
  - key: duration
    label: 时长
    type: choice
    options: [15 秒, 30 秒, 45 秒, 60 秒]
    default: 30 秒
  - key: formats
    label: 画幅
    type: choice
    options: ["16:9", "9:16", "16:9 和 9:16", "16:9、9:16 和 1:1"]
    default: 16:9 和 9:16
  - key: message
    label: 唯一要记住的一件事
    type: textarea
    help: 看完之后，观众应该能说出产品的哪一点。
  - key: brand
    label: 品牌
    type: textarea
    required: false
    help: 颜色、字体、logo、品牌的语气；有文件就在下面附上。
  - key: music
    label: 音乐
    type: choice
    options: [按节拍生成配乐, 用我自己的曲子（在下面附上）]
    default: 按节拍生成配乐
---

为{{product}}做一支 {{duration}} 的产品 reel。

## 在哪里能看到它
{{url}}

## 画幅
{{formats}}

## 唯一要记住的一件事
{{message}}

## 品牌
{{brand}}

## 音乐
{{music}}

## 已决定
- 用产品的真实界面，不用假图；开头两秒内抓住人。
- 一条时间线；每种画幅都从它剪出来，绝不从另一种裁切。
- 结尾停在产品名和一句话上，停够读完的时间。
