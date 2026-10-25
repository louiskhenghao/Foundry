---
name: 带密钥、限流和文档的公开 API
summary: 为你的产品做一套带版本的公开 API——密钥认证、限流、分页、webhook、OpenAPI 描述、参考站点和客户端库。
nature: code
lang: zh
settings:
  mode: expert
  budgetPreset: thorough
  interviewDepth: 3
inputs:
  - key: product
    label: API 背后的产品
    example: Orbit，给网店用的订阅分析
  - key: resources
    label: 资源
    type: textarea
    help: API 暴露哪些东西、各自能做什么（读、建、改、删）；它们之间的关系。
    example: |
      店铺（读）、它们的订阅（读、取消）和发票（读、下载 PDF）。
      指标（读）：按日的 MRR、流失率和活跃店铺，带日期范围。
      Webhook（建、列、删）：subscription.created、subscription.cancelled、invoice.paid。
  - key: consumers
    label: 谁来调用
    help: 会用它的开发者和系统，以及从哪里调用。
    example: 我们客户自己的后端和几个合作伙伴的集成；只有服务器端，没有浏览器。
  - key: style
    label: 风格
    type: choice
    options: [REST 加 JSON, GraphQL, REST 再加一层 GraphQL]
    default: REST 加 JSON
  - key: limits
    label: 限流与套餐
    type: textarea
    required: false
    help: 速率限制、配额、套餐之间的差别。
    example: 每个密钥默认每分钟 600 次请求，免费套餐 60 次；指标接口按两倍计；允许 50 次突发。
  - key: stack
    label: 技术栈
    type: choice
    options: [仓库现有的, 一个独立的 API 服务, 放进现有后端]
    default: 仓库现有的
  - key: sdk
    label: 客户端库
    type: choice
    options: [只做 TypeScript, TypeScript 和 Python, 暂时不做]
    default: 只做 TypeScript
---

# {{product}} 的公开 API

## 资源
{{resources}}

## 谁来调用
{{consumers}}

## 风格
{{style}}

## 限流与套餐
{{limits}}

## 技术栈
{{stack}}

## 客户端库
{{sdk}}

## 已决定
- 版本放在路径里（`/v1`），并写明弃用策略；`v1` 发布后不做不兼容改动，只做加法。
- API 密钥在产品设置里创建和吊销，只显示一次，哈希存储，按店铺和读/写限定范围；每个请求记录密钥 id、接口和结果。
- 按密钥限流，带标准响应头（`RateLimit-*`、`Retry-After`），429 响应体说明何时重试；限额是配置，不是代码。
- 到处用游标分页，统一的错误体（代码、消息、请求 id），每个创建操作支持幂等键，日期用 UTC 的 ISO 格式，金额用带币种的最小单位。
- Webhook 带签名，退避重试一天，每次投递连同响应对客户可见；有重放按钮。
- OpenAPI 文档由代码生成（或代码由它生成），在 CI 里校验，并渲染成带可运行示例的参考站点；客户端库由同一份文档生成，随 API 版本一起发布。
- 契约测试跑在预置数据的数据库上；里程碑脚本创建密钥、分页列出一种资源、触发限流并收到一个 webhook。
