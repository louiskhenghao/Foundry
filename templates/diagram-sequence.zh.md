---
name: 时序图
summary: 一张讲清一个请求或事件如何在参与者之间按时间顺序传递的编辑风格图——谁调用谁、返回什么、在哪里等待——做成网页并附带 SVG。
nature: diagram
lang: zh
settings:
  mode: simple
inputs:
  - key: flow
    label: 流程
    help: 几个字说清什么在传、从哪到哪。
    example: 下单，从结账按钮到确认邮件
  - key: actors
    label: 参与者，从左到右
    help: 参与的人、服务和系统，按它们该站的顺序。最多六个。
    example: 顾客、Web 应用、API 网关、订单服务、队列、邮件 worker
  - key: messages
    label: 消息，按顺序
    type: textarea
    help: 每条消息一行，从一个参与者到另一个，有回复就写上回复，异步或可选的标注出来。最多十二条。
    example: |
      1. 顾客 -> Web 应用：按下"下单"。
      2. Web 应用 -> API 网关：POST /orders。
      3. API 网关 -> 订单服务：创建订单。
      4. 订单服务 -> 订单服务：写入订单（Postgres）。
      5. 订单服务 -> 队列：order.placed（异步）。
      6. 订单服务 -> API 网关 -> Web 应用：201 Created；顾客看到确认页。
      7. 队列 -> 邮件 worker：order.placed（稍后）。
      8. 邮件 worker -> 顾客：确认邮件。
  - key: focus
    label: 读者该先注意什么
    required: false
    help: 强调色要落在的一条消息或一个参与者。
    example: 经过队列的异步交接
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

画一张 {{flow}} 的时序图。

## 参与者，从左到右
{{actors}}

## 消息，按顺序
{{messages}}

## 读者该先注意什么
{{focus}}

## 在哪里阅读
{{destination}}

## 外观
{{skin}}

## 品牌
{{brand}}

## 已经定下的
- 一个自包含的网页，旁边导出 SVG，提交到仓库的 docs/diagrams/ 下。
- 时间向下流动；每条消息都标出它携带的内容，回复和异步消息按技能的时序图参考来画。
- 强调色只落在一条消息或一个参与者上，绝不是全部。
