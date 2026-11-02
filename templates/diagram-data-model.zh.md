---
name: 从代码画数据模型
summary: 一张讲清仓库存了什么的编辑风格实体关系图或数据库表结构图——有哪些表或实体、关键字段、它们怎么关联——从代码里读出来，做成网页并附带 SVG。
nature: diagram
lang: zh
settings:
  mode: simple
inputs:
  - key: scope
    label: 要建模的范围
    help: 图要覆盖的那部分数据；数据不多时就是全部。
    example: 订单、顾客、商品和支付
  - key: source
    label: 模型在代码里的位置
    required: false
    help: 要读的 schema、迁移、模型类或类型定义；留空让 worker 自己找。
    example: prisma/schema.prisma
  - key: detail
    label: 细节
    type: choice
    options: ["只画实体和关系，标出关键字段", "每张表连同列、类型和约束"]
    default: "只画实体和关系，标出关键字段"
  - key: focus
    label: 读者该先注意什么
    required: false
    help: 强调色要落在的一个实体或一条关系。
    example: 订单和商品之间的多对多
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

从这个仓库的代码里读出 {{scope}} 的数据模型，画成一张图。

## 模型在代码里的位置
{{source}}

## 细节
{{detail}}

## 读者该先注意什么
{{focus}}

## 在哪里阅读
{{destination}}

## 外观
{{skin}}

## 已经定下的
- 一个自包含的网页，旁边导出 SVG，提交到仓库的 docs/diagrams/ 下。
- 图里的每个实体和字段都在代码里存在；不编造任何东西，代码里不清楚的在清单里注明。
- 一张图最多九个实体；更大的模型拆成一张总览和一张细节。
