---
name: 课件或培训幻灯片
summary: 一套教学幻灯片 —— 讲座、工作坊、入职培训 —— 一次只讲一个概念，给讲课的人配演讲备注，原生可编辑的 PPTX。
nature: deck
lang: zh
settings:
  mode: simple
inputs:
  - key: topic
    label: 主题
    help: 一句话说清这节课教什么。
    example: 我们的部署流水线怎么运转，从合并的 pull request 到上生产
  - key: learners
    label: 谁来学
    help: 谁坐在课堂里，他们已经会什么。
    example: 入职第一个月的后端新同事；会 git 和 Docker，不熟我们的工具
  - key: outcomes
    label: 学完后应该能做到什么
    type: textarea
    help: 两到五条具体的能力；幻灯片围绕它们组织。
    example: |
      - 能把一个改动从合并追到生产发布，说出每个阶段的名字。
      - 能看懂流水线看板，分清卡住的发布和慢的发布。
      - 能安全地回滚一次发布，并知道什么时候该回滚。
  - key: materials
    label: 取材的资料
    required: false
    help: 附到 goal 上的文档，或仓库里内容所在的位置。
    example: docs/deploy.md 和附上的运维手册
  - key: length
    label: 长度
    type: choice
    options: ["20 分钟的讲解，10–12 页", "45 分钟的一节课，18–25 页", "半天的工作坊，30–40 页带练习"]
    default: "45 分钟的一节课，18–25 页"
  - key: language
    label: 语言
    required: false
    help: 幻灯片的语言；留空就用你写的这种。
    example: 中文
---

做一套关于 {{topic}} 的教学幻灯片。

## 谁来学
{{learners}}

## 学完后应该能做到什么
{{outcomes}}

## 取材的资料
{{materials}}

## 长度
{{length}}

## 语言
{{language}}

## 已经定下的
- 原生 PPTX，PowerPoint 里可编辑，16:9，演讲备注写明每页该讲什么、该问什么；提交到仓库的 decks/ 下，每一页的图放在旁边，随时能重新生成。
- 一页一个概念，按学习者需要的顺序层层搭起来；每条能力一页小结，最后一页说去哪里继续看。
- 例子来自点名的资料，绝不编造。
