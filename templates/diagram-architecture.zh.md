---
name: 架构图
summary: 一张讲清系统怎么搭起来的编辑风格图——有哪些部分、谁和谁通信——做成网页并附带 SVG，可直接放进 README 或文档页。
nature: diagram
lang: zh
settings:
  mode: simple
inputs:
  - key: system
    label: 系统
    help: 图要画的是什么：一个产品、一个服务、一条流水线。
    example: 我们的订单服务以及它和谁通信
  - key: parts
    label: 各部分及其连接
    type: textarea
    help: 用文字写出各组件，以及谁调用谁、谁给谁喂数据。最多九个部分；再多就拆成两张图。
    example: |
      - Web 应用和移动应用都调用 API 网关。
      - 网关路由到订单服务和商品服务。
      - 订单服务写 Postgres，并把事件发到队列。
      - 一个 worker 读队列，通过 SendGrid 发邮件。
  - key: focus
    label: 读者该先注意什么
    required: false
    help: 强调色要落在的一两个东西。
    example: 队列和 worker，它们是新加的
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

画一张 {{system}} 的架构图。

## 各部分及其连接
{{parts}}

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
- 每个部分都是一个独立的概念，每条线都承载信息；布局已经说明的就不再画。
- 强调色只落在一两个元素上，绝不是所有重要的东西都上色。
