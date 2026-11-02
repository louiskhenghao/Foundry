---
name: 路演幻灯片
summary: 向一屋子人讲清一件事的幻灯片 —— 融资路演、销售演示、提案 —— 原生可编辑的 PPTX，带演讲备注，从你的要点和附上的文档做出来。
nature: deck
lang: zh
settings:
  mode: simple
inputs:
  - key: pitch
    label: 你在推介什么
    help: 一句话说清产品、项目或提案。
    example: Foundry，一个以目标驱动编程智能体的工具
  - key: audience
    label: 屋里坐着谁
    help: 谁来拍板，他们已经知道什么。
    example: 懂开发者工具但没见过 Foundry 的种子轮投资人
  - key: ask
    label: 你想从他们那里得到的一件事
    help: 这套幻灯片必须争取到的决定或行动。
    example: 一个月内和合伙人再开一次会并拿到 term sheet
  - key: points
    label: 要点，按顺序
    type: textarea
    help: 大致按页列出论证；附上有事实的文档，幻灯片会从中取材。
    example: |
      1. 问题：团队把高级工程师的时间花在盯着编程智能体上。
      2. 产品：描述一个目标，批准一个计划，拿到一个分支。
      3. 进展：三个团队每周 40 个 goal，70% 不用改就合并。
      4. 它怎么工作，一张图。
      5. 市场和对手。
      6. 团队。
      7. 要什么，换来什么。
  - key: length
    label: 长度
    type: choice
    options: ["8–10 页", "12–15 页", "18–20 页"]
    default: "12–15 页"
  - key: language
    label: 语言
    required: false
    help: 幻灯片的语言；留空就用你写的这种。
    example: 中文
---

为 {{pitch}} 做一套路演幻灯片。

## 屋里坐着谁
{{audience}}

## 你想从他们那里得到的一件事
{{ask}}

## 要点，按顺序
{{points}}

## 长度
{{length}}

## 语言
{{language}}

## 已经定下的
- 原生 PPTX，PowerPoint 里可编辑，16:9，带演讲备注；作为文件交付，不提交进仓库。
- 一页一个信息，诉求单独一页说，承载论证的数字画成图表。
- 附上的文档就是事实；不为填满一页而编造任何东西。
