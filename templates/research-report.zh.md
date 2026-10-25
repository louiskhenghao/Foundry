---
name: 调研报告
summary: 围绕一个问题的调查，以一份带引用的报告收尾：答案清楚，依据清楚。
nature: research
lang: zh
settings:
  mode: simple
inputs:
  - key: question
    label: 问题
    type: textarea
    help: 你需要知道什么，尽量说准。一份报告只回答一个问题。
    example: 一个小团队做一款手机上必须能离线、联网后再同步的应用，该选哪种数据库，各个选择在运维上要付出什么？
  - key: scope
    label: 包含与排除
    type: textarea
    required: false
    help: 时间跨度、地区、产品或来源，哪些算、哪些不算。
    example: 只看开源或有免费档的；最近三年的版本；排除需要专门服务器团队的方案。
  - key: sources
    label: 允许的来源
    type: choice
    options: [只要官方文档和同行评审的研究, 官方文档、论文和可靠媒体, 任何可信来源（注明可靠程度）]
    default: 官方文档、论文和可靠媒体
  - key: length
    label: 篇幅
    type: choice
    options: [一页, 三到五页, 问题需要多长就多长]
    default: 三到五页
  - key: decision
    label: 它要支撑的决定
    required: false
    help: 你拿到答案后要做什么，报告就按这个来权衡轻重。
    example: 我们要为下一个版本选定数据库，两年内不会再换。
---

调研这个问题，写一份带引用的报告。

## 问题
{{question}}

## 包含与排除
{{scope}}

## 允许的来源
{{sources}}

## 篇幅
{{length}}

## 它要支撑的决定
{{decision}}

## 已决定
- 开头先给答案和把握有多大，然后是证据，最后是什么情况会改变答案。
- 每个不是常识的论断都带一个读者能打开的引用；引文一字不差。
- 来源之间有分歧就明说，并说明更信哪个、为什么。
