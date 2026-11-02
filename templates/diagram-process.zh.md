---
name: 流程图
summary: 一张讲清一件事怎么一步步发生的编辑风格图——带判断分支的流程、参与者之间的时序、带交接的过程——做成网页并附带 SVG。
nature: diagram
lang: zh
settings:
  mode: simple
inputs:
  - key: process
    label: 过程
    help: 几个字说清发生了什么。
    example: 退款申请是怎么处理的
  - key: steps
    label: 步骤，按顺序
    type: textarea
    help: 每步一行，写明谁来做，以及会分叉的判断。最多九步。
    example: |
      1. 顾客在订单页申请退款。
      2. 客服检查订单是否在 30 天内；超期的拒绝并留言。
      3. 金额超过 200 美元的由经理审批。
      4. 财务打款，顾客收到邮件。
  - key: shape
    label: 形式
    type: choice
    options: ["让技能自己选", "流程图（判断和分支）", "时序图（参与者之间按时间顺序的消息）", "泳道图（谁做什么，带交接）", "时间线"]
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
  - key: brand
    label: 品牌
    required: false
    help: 图要跟随其配色和字体的网站地址；留空则用技能自带的配色。
    example: https://example.com
---

画一张 {{process}} 的图。

## 步骤，按顺序
{{steps}}

## 形式
{{shape}}

## 在哪里阅读
{{destination}}

## 外观
{{skin}}

## 品牌
{{brand}}

## 已经定下的
- 一个自包含的网页，旁边导出 SVG，提交到仓库的 docs/diagrams/ 下。
- 连线横平竖直，只在标签能多说一点时才加标签；主线用强调色，其余保持安静。
- 如果一张三列的表格能说清同一件事，就直说，不画。
