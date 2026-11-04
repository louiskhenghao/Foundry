---
name: 字幕短片
summary: 你附上的一段录像或录音 —— 一场分享、一段演示、一条语音 —— 剪成带字幕、标注和开场钩子的短片。
nature: video
lang: zh
settings:
  videoPack: hyperframes
  mode: simple
  budgetPreset: thorough
inputs:
  - key: recording
    label: 录像或录音
    help: 在下面附到 goal 上（录屏、真人出镜的视频、音频文件）。这里说明它是什么。
    example: 一段 6 分钟的录屏，我在走一遍新的账单页面，带我的声音。
  - key: keep
    label: 要留下什么
    type: textarea
    help: 短片必须带上的片段或要点；其他的可以舍。
    example: 我展示提醒计划的那段，以及"再也不用自己催"那句话。
  - key: duration
    label: 短片时长
    type: choice
    options: [30 s, 60 s, 90 s, 最长 3 分钟]
    default: 60 s
  - key: formats
    label: 画幅
    type: choice
    options: ["9:16", "16:9", "16:9 and 9:16", "1:1"]
    default: 9:16
  - key: language
    label: 字幕语言
    default: 录音本身的语言
  - key: brand
    label: 品牌
    type: textarea
    required: false
    help: 配色、字体、logo；有文件就附在下面。
    example: 墨蓝 #1b2a49 配纸白，字标用几何无衬线。
---

把附上的录像剪成一支 {{duration}} 的短片。

## 录像
{{recording}}

## 要留下什么
{{keep}}

## 画幅
{{formats}}

## 字幕
逐词显示，用{{language}}，转写在这台电脑上完成；数字或名字重要的地方加标注。

## 品牌
{{brand}}

## 已经定好的
- 从最强的那一刻开始，而不是从头开始；空白和停顿都剪掉。
- 录像自己的声音撑起短片，做过响度平衡；只在它没说话的地方垫音乐。
- 字幕都在安全区内，绝不盖住人脸或正在展示的东西。
