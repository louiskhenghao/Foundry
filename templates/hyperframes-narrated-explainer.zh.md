---
name: 旁白讲解片
summary: 一支把一件事讲清楚的短片，旁白在这台电脑上合成，带字幕，踩着节奏剪。
nature: video
lang: zh
settings:
  videoPack: hyperframes
  mode: simple
  budgetPreset: thorough
inputs:
  - key: subject
    label: 讲什么
    help: 这支片要讲清楚的那一件事，一句话。
    example: Ledgerly 怎样一步步催一张逾期发票
  - key: script
    label: 口播稿，或要讲的要点
    type: textarea
    help: 贴上要念的话，或者只给要点，让片子来写。每 15 秒大约 40 个词。
    example: 发票只发一次。Ledgerly 每隔几天礼貌地提醒客户。款到了，你第一个知道。
  - key: url
    label: 在哪里能看到它
    required: false
    help: 网站或应用，短片可以从那里取真实界面和配色。
    example: https://app.example.com
  - key: duration
    label: 时长
    type: choice
    options: [30 s, 45 s, 60 s, 90 s]
    default: 45 s
  - key: formats
    label: 画幅
    type: choice
    options: ["16:9", "9:16", "16:9 and 9:16"]
    default: 16:9 and 9:16
  - key: voice
    label: 声音
    type: choice
    options: [中性的声音, 温暖的声音, 利落的声音]
    default: 中性的声音
  - key: language
    label: 旁白和字幕的语言
    default: 中文
  - key: brand
    label: 品牌
    type: textarea
    required: false
    help: 配色、字体、logo、品牌的语气；有文件就附在下面。
    example: 墨蓝 #1b2a49 配纸白，字标用几何无衬线；冷静、克制，从不推销。
---

做一支 {{duration}} 的旁白讲解片，讲 {{subject}}。

## 要说的话
{{script}}

## 在哪里能看到它
{{url}}

## 画幅
{{formats}}

## 声音与语言
{{voice}}，用{{language}}；屏幕上逐词显示同一种语言的字幕。

## 品牌
{{brand}}

## 已经定好的
- 旁白在这台电脑上合成（不用 key，不用账号）；每行字幕都在安全区内，和声音同时落下。
- 用产品的真实界面，不做假图；一个镜头一个意思，句子换了画面就换。
- 结尾停在产品名和一句话上，停够读完的时间。
