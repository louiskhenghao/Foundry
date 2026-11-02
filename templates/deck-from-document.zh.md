---
name: 文档变幻灯片
summary: 把你附上的文档 —— 报告、论文、规格书、长备忘 —— 变成一套保留其事实和顺序的幻灯片，原生可编辑的 PPTX，带演讲备注。
nature: deck
lang: zh
settings:
  mode: simple
inputs:
  - key: document
    label: 文档
    help: 把它附到 goal 上（PDF、DOCX、Markdown、HTML）；在这里写出它的名字。
    example: 三季度平台复盘，附件 q3-review.pdf
  - key: audience
    label: 幻灯片给谁看
    help: 谁会看到，是有人讲还是自己读。
    example: 各工程负责人，在 30 分钟的评审会上讲
  - key: keep
    label: 必须保留的
    required: false
    help: 必须按原文出现的部分、数字或措辞。
    example: 成本表里的每个数字，三条建议一字不改
  - key: length
    label: 长度
    type: choice
    options: ["每节一页，8–12 页", "更完整地讲一遍，15–20 页", "文档需要多长就多长"]
    default: "每节一页，8–12 页"
  - key: language
    label: 语言
    required: false
    help: 幻灯片的语言；留空就用文档的。
    example: 文档的
---

把 {{document}} 变成一套幻灯片。

## 幻灯片给谁看
{{audience}}

## 必须保留的
{{keep}}

## 长度
{{length}}

## 语言
{{language}}

## 已经定下的
- 原生 PPTX，PowerPoint 里可编辑，16:9，演讲备注里放页面上放不下的内容；提交到仓库的 decks/ 下，每一页的图放在旁边，随时能重新生成。
- 保留文档的事实、数字和顺序；要紧的表格和图各成一页。
- 文档没说的，一句不加。
