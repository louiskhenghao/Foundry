---
name: 产品 reel（HyperFrames）
summary: 一支在产品真实界面上展示它的短片，踩着音乐剪，用 HyperFrames 做、也能在里面改。
nature: video
lang: zh
settings:
  videoPack: hyperframes
  mode: simple
  budgetPreset: thorough
inputs:
  - key: product
    label: 产品
    help: 名字，以及它是做什么的，一句话。
    example: Ledgerly，给自由职业者的开票工具，替你催拖欠的款
  - key: url
    label: 在哪里能看到它
    required: false
    help: 网站或应用，短片可以从那里取真实界面和配色。
    example: https://app.example.com
  - key: duration
    label: 时长
    type: choice
    options: [15 s, 30 s, 45 s, 60 s]
    default: 30 s
  - key: formats
    label: 画幅
    type: choice
    options: ["16:9", "9:16", "16:9 and 9:16", "16:9, 9:16 and 1:1"]
    default: 16:9 and 9:16
  - key: message
    label: 要记住的那一件事
    type: textarea
    help: 看完之后，观众应该能说出产品的哪一点。
    example: 发票只发一次；Ledgerly 礼貌地一直提醒，直到款到。
  - key: brand
    label: 品牌
    type: textarea
    required: false
    help: 配色、字体、logo、品牌的语气；有文件就附在下面。
    example: 墨蓝 #1b2a49 配纸白，字标用几何无衬线；冷静、克制，从不推销。
  - key: music
    label: 音乐
    type: choice
    options: [内置的一首, 我自己的曲子（附在下面）]
    default: 内置的一首
---

给 {{product}} 做一支 {{duration}} 的产品 reel。

## 在哪里能看到它
{{url}}

## 画幅
{{formats}}

## 要记住的那一件事
{{message}}

## 品牌
{{brand}}

## 音乐
{{music}}

## 已经定好的
- 用产品的真实界面，不做假图；开头两秒内就要有钩子。
- 每种画幅各自一个 composition，手工重排，绝不从另一个裁切。
- 结尾停在产品名和一句话上，停够读完的时间；做完之后片子会在 Editor 里打开，想自己改的地方可以改。
