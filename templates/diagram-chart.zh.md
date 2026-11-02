---
name: 数据图表
summary: 一张编辑风格的图表——柱状、折线、散点、瀑布、树图、热力图、桑基图或甘特图——按你给的数字画出来，做成网页并附带 SVG。
nature: diagram
lang: zh
settings:
  mode: simple
inputs:
  - key: question
    label: 图表回答什么
    help: 读者应该从中得到的那一件事。
    example: 哪个套餐贡献了大部分收入，今年变化如何
  - key: data
    label: 数据
    type: textarea
    help: 数字，用小表格或列表给出，带单位；或者仓库里存放它们的文件。
    example: |
      套餐, 2025, 2026（收入，千美元）
      入门版, 120, 140
      团队版, 310, 420
      企业版, 260, 390
  - key: kind
    label: 图表类型
    type: choice
    options: ["让技能自己选", "柱状图", "折线图", "散点图", "瀑布图", "树图", "热力图", "桑基图", "甘特图"]
    default: "让技能自己选"
  - key: destination
    label: 在哪里阅读
    type: choice
    options: ["README 或文档页", "wiki 页面，全宽", "一页幻灯片", "社交媒体的链接卡片"]
    default: "README 或文档页"
  - key: skin
    label: 外观
    type: choice
    options: ["极简浅色", "极简深色", "完整编辑风格，带标题和摘要卡片"]
    default: "极简浅色"
---

画一张图表，回答：{{question}}。

## 数据
{{data}}

## 图表类型
{{kind}}

## 在哪里阅读
{{destination}}

## 外观
{{skin}}

## 已经定下的
- 一个自包含的网页，旁边导出 SVG，提交到仓库的 docs/diagrams/ 下。
- 数字照给的画，坐标轴标上单位；不为了填空而编造任何数。
- 强调色只标出问题所问的那一个系列或那一根柱子。
