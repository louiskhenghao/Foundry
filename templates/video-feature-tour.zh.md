---
name: 应用功能导览片
summary: 在应用的真实界面上走一遍功能的片子——镜头运动、标注和字幕，一个功能一个节拍——覆盖你要发的每种画幅。
nature: video
lang: zh
settings:
  videoPack: motion-studio
  mode: simple
  budgetPreset: thorough
inputs:
  - key: product
    label: 应用
    help: 名字，以及它是做什么的，一句话。
    example: Orbit，给网店用的订阅分析
  - key: url
    label: 在哪里能看到它
    help: 应用地址或演示账号，片子要用真实界面做。
    example: https://demo.example.com（登录 demo / demo）
  - key: features
    label: 功能，按顺序
    type: textarea
    help: 一行一个：展示什么，以及要说的那一句。
    example: |
      总览——「你的 MRR、流失率和活跃店铺，今早的。」
      对比——「任意区间对比去年，一个开关。」
      下钻——「从图表的一处下跌到背后的具体订单。」
      摘要——「每周一，这一周的情况进你的邮箱。」
  - key: duration
    label: 时长
    type: choice
    options: [45 秒, 60 秒, 90 秒]
    default: 60 秒
  - key: formats
    label: 画幅
    type: choice
    options: ["16:9", "9:16", "16:9 和 9:16", "16:9、9:16 和 1:1"]
    default: 16:9 和 9:16
  - key: captions
    label: 屏幕上的文字
    type: choice
    options: [每个节拍都有字幕, 每个功能只有一个标题]
    default: 每个节拍都有字幕
  - key: brand
    label: 品牌
    type: textarea
    required: false
    help: 颜色、字体、logo、语气；有文件就在下面附上。
    example: 石板灰配米白，一个蓝绿强调色；字标用几何无衬线；字幕简短、现在时、不用感叹号。
---

为{{product}}做一支 {{duration}} 的功能导览片。

## 在哪里能看到它
{{url}}

## 功能，按顺序
{{features}}

## 画幅
{{formats}}

## 屏幕上的文字
{{captions}}

## 品牌
{{brand}}

## 已决定
- 真实界面，按各画幅的分辨率从上述应用录取，绝不重画；界面里的数据合理且各节拍之间一致。
- 一个功能一个节拍：镜头推进到屏幕上要紧的部分，标注指向视线该落的地方，字幕用品牌的语气；剪切踩在配乐的节拍上。
- 一条时间线；每种画幅都从它剪出来，绝不从另一种裁切；竖版画幅重新排字幕。
- 结尾停在产品名、一句话和地址上，停够读完的时间。
