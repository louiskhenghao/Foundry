---
name: 架构设计文档
summary: 一份 RFC 式的系统变更设计文档——问题、各方案及取舍、决定、计划和风险——附图。
nature: docs
lang: zh
settings:
  mode: simple
  interviewDepth: 3
inputs:
  - key: system
    label: 系统
    help: 要改的是什么，一句话。
    example: 一个中型电商平台的订单服务
  - key: problem
    label: 问题
    type: textarea
    help: 今天哪里疼，有数字就带上数字。
    example: 订单写进一个 Postgres，六个服务直接查它读取；改一次 schema 要协调一周，夜间报表把表锁二十分钟。
  - key: options
    label: 要权衡的方案
    type: textarea
    help: 你已知的候选方案；文档可以再加一个。
    example: |
      保留数据库，加只读副本和供其他服务读取的视图。
      把订单事件发布到事件流，让每个服务维护自己的读模型。
      在数据库前面加一个 API，所有服务都走它。
  - key: constraints
    label: 约束
    type: textarea
    help: 不能变的东西、期限、预算、团队技能、合规要求。
    example: 变更期间不能停机；五人团队熟 Postgres 和 TypeScript，不熟 Kafka；审计要求每笔订单变更可追溯七年。
  - key: readers
    label: 谁决定、谁读
    help: 文档写给谁看。
    example: 两位资深工程师决定；整个后端团队和产品负责人阅读。
---

# 设计文档：{{system}}

## 问题
{{problem}}

## 要权衡的方案
{{options}}

## 约束
{{constraints}}

## 谁决定、谁读
{{readers}}

## 已决定
- 结构：摘要和建议放最前；背景和带数字的问题；目标与非目标；各方案用相同的小标题（怎么运作、成本、风险、会排除掉什么后路）；决定及理由；每一步都能上线的迁移计划；风险和什么情况下重新审视；待定问题。
- 图用 Mermaid 写在文档里（现状、目标状态、迁移中间态），每张配一句说明。
- 关于负载、延迟或成本的每个论断都有来源：系统的实测、为文档跑的基准，或引用的报价；估算要说明是估算。
- 写到下个月入职的工程师不开会也能明白这个决定；建议是一个决定，不是一份菜单。
- 提交为 `docs/design/<日期>-<slug>.md`，决定作出后旁边配一条 ADR。
