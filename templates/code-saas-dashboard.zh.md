---
name: SaaS 数据看板
summary: 一个产品指标的生产级看板——数据模型、图表、筛选、角色、实时更新和导出——做到经营者敢信。
nature: code
lang: zh
settings:
  mode: expert
  budgetPreset: thorough
  interviewDepth: 3
inputs:
  - key: domain
    label: 看板关于什么
    help: 它展示哪个产品或业务的数字，一句话。
    example: Orbit，给小型网店用的订阅分析产品
  - key: metrics
    label: 指标
    type: textarea
    help: 每个指标及其定义，像财务人员会说的那样；最要紧的放前面。
    example: |
      MRR——活跃订阅的月价之和，年付套餐按月折算；按套餐和总计。
      流失率——当月取消的订阅数除以月初活跃订阅数。
      活跃店铺——最近 30 天至少有一个订单的店铺。
      每日订单数和收入，旁边放上周同日和去年同日。
  - key: data_source
    label: 数据从哪来
    type: choice
    options: [应用自己的数据库, 数据仓库（BigQuery、Snowflake、ClickHouse……）, API 或事件流, 以上几种都有]
    other: true
    default: 应用自己的数据库
  - key: roles
    label: 谁能看什么
    type: textarea
    help: 各个角色，以及各自能看和能做的事。
    example: 店主看全部并能导出；经理只看自己的店铺；客服看计数但不看收入。
  - key: freshness
    label: 多新鲜
    type: choice
    options: [实时（秒级）, 准实时（几分钟）, 每小时, 每天]
    default: 准实时（几分钟）
  - key: stack
    label: 技术栈
    type: choice
    options: [仓库现有的, Next.js 加 Postgres 和一个图表库, 一个独立看板应用调用现有 API]
    default: 仓库现有的
  - key: must_have
    label: 第一天就必须有
    type: textarea
    required: false
    help: 筛选、日期范围、对比、下钻、导出、告警。
    example: 带预设的日期范围和「对比」开关，按套餐和国家筛选，从图表下钻到背后的行，任何表格导出 CSV，每周邮件摘要。
---

# {{domain}}：一个数据看板

## 指标
{{metrics}}

## 数据从哪来
{{data_source}}

## 谁能看什么
{{roles}}

## 多新鲜
{{freshness}}

## 技术栈
{{stack}}

## 第一天就必须有
{{must_have}}

## 已决定
- 每个指标在代码里只有一个定义，用手算的 fixture 测过，看板悬停时显示该定义；两张图永远不会对同一个数字说法不一。
- 聚合按上面的新鲜度预先算进汇总表（或物化视图）；页面绝不每次请求全表扫描，一年的数据下每页两秒内加载完。
- 授权按角色在查询层强制执行，而不是藏在界面里；有测试证明经理通过任何接口都读不到别家店的收入。
- 图表无障碍：每张有标题、文字摘要和表格视图；颜色通过对比度检查，且不单独承载含义。
- 日期处理明确时区（店铺的时区，显示在页头）和未完结的当前周期。
- 导出和摘要由与页面相同的代码生成，数字分毫不差。
- 加载、空、错误三种状态都是设计过的，不是碰运气；里程碑脚本走一遍筛选、下钻和导出。
