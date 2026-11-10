---
name: 发布短片（/brag）
summary: 用 /brag 给这个仓库本身做一支 15–25 秒的发布短片——钩子、揭晓、两三个亮点和一个收尾，全用项目自己的话，配上音乐、音效和发出去用的分享文案。
nature: video
lang: zh
settings:
  videoPack: hyperframes
  mode: simple
  budgetPreset: thorough
inputs:
  - key: project
    label: 它是什么
    help: 这个仓库里的项目，一句话；其余的 /brag 自己去代码里找。
    example: Ledgerly，给自由职业者的开票工具，替你催拖欠的款
  - key: tone
    label: 语气
    type: choice
    options: [default, polished, yc-parody, chaotic, deadpan, cinematic, app-store]
    other: true
    default: default
    help: 选一个预设，或者用几个字写你自己的方向（2016 年的假 A 轮发布会、博物馆展品、用力过猛的手游广告）。
  - key: format
    label: 画幅
    type: choice
    options: ["横屏（16:9）", "竖屏（9:16）", "方形（1:1）"]
    default: 横屏（16:9）
  - key: duration
    label: 时长
    type: choice
    options: [15 秒左右, 20 秒左右, 25 秒左右]
    default: 20 秒左右
  - key: voice
    label: 旁白
    type: choice
    options: [不要, 在这台电脑上合成的旁白]
    default: 不要
  - key: music
    label: 音乐
    type: choice
    options: [/brag 自带的一首, 我自己的曲子（附在下面）, 不要]
    default: /brag 自带的一首
  - key: focus
    label: 重点
    type: textarea
    required: false
    help: 这支片要讲的一个版本、一个功能、一个角度；留空就是整个项目。
    example: 上周上线的提醒排期，还有"已付款"的彩带。
  - key: post
    label: 发到哪里
    required: false
    help: 决定分享文案怎么写。
    example: X 和 LinkedIn
---

用 /brag 给这个仓库做一支 {{duration}} 的发布短片：{{project}}。

## 语气
{{tone}}

## 画幅
{{format}}

## 旁白
{{voice}}

## 音乐
{{music}}

## 重点
{{focus}}

## 发到哪里
{{post}}

## 已经定好的
- 故事归 /brag，用 `--full` 跑（绝不用 slim 版）：它读代码，写 `brag-plan.md`、`composition-brief.md` 和 `share-copy.txt`，把 composition 交给 HyperFrames。屏幕上的每一句主张都是项目自己说过的；不编造，画面里不出现密钥、内网地址或真实客户。
- 它的输出文件夹就是 HyperFrames 项目 `video/<slug>/` 本身（里面不再套 `composition/`），这样 Editor 和 Re-render 都找得到。它的 `brag.mp4` 就是 `artifacts/video/<slug>/final-<format>.mp4`，调到 -14 LUFS，把 /brag 选出的最佳一帧烘进第 0 帧并留作 `poster.png`；`share-copy.txt` 留在项目文件夹里，下面附上自带曲目的许可证要求的署名。
- Foundry 的 harness 照样评审：contact sheet、三轮批评、审查者七个维度都到 8 分以上、校验器测量交付文件。
