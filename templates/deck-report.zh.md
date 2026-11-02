---
name: 汇报或复盘幻灯片
summary: 一套汇报幻灯片 —— 项目进展、季度复盘、事故复盘 —— 说清发生了什么、意味着什么、接下来怎么办，数字画成图表，原生可编辑的 PPTX。
nature: deck
lang: zh
settings:
  mode: simple
inputs:
  - key: subject
    label: 汇报的对象
    help: 项目、周期或事故。
    example: 结账流程迁移，三季度
  - key: readers
    label: 给谁看
    help: 谁听或谁读，他们据此决定什么。
    example: 月度评审会上的管理层；他们决定迁移是否保留预算
  - key: facts
    label: 发生了什么
    type: textarea
    help: 事实和数字，带来源；附上数据，幻灯片会把它画成图表。
    example: |
      - 已上线：新结账流程覆盖 50% 顾客（计划：九月到 100%）。
      - 新流程转化率 3.4%，旧流程 3.1%（看板导出见附件）。
      - 两次事故，都在一小时内；根因已修。
      - 花费：26 万预算用了 21 万。
  - key: meaning
    label: 意味着什么，接下来怎么办
    type: textarea
    help: 你对事实的解读、风险，以及要做的决定或诉求。
    example: |
      上线晚了一个月，原因是支付服务商的限流；转化率的提升站得住。诉求：保留预算，延到十一月，做到 100%。
  - key: length
    label: 长度
    type: choice
    options: ["简短更新，6–8 页", "完整复盘，10–15 页"]
    default: "完整复盘，10–15 页"
  - key: language
    label: 语言
    required: false
    help: 幻灯片的语言；留空就用你写的这种。
    example: 中文
---

做一套关于 {{subject}} 的汇报幻灯片。

## 给谁看
{{readers}}

## 发生了什么
{{facts}}

## 意味着什么，接下来怎么办
{{meaning}}

## 长度
{{length}}

## 语言
{{language}}

## 已经定下的
- 原生 PPTX，PowerPoint 里可编辑，16:9，带演讲备注；作为文件交付，不提交进仓库。
- 先来一页总结；每个数字画成图表或表格，标上来源和周期；风险和诉求各自单独成页。
- 数字照给的用；不把数字凑成更好听的故事。
