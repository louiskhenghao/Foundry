---
name: 重构
summary: 只改代码的形状、不改它做的事，边界清楚，理由清楚。
nature: code
lang: zh
settings:
  interviewDepth: 2
inputs:
  - key: area
    label: 重构什么
    help: 一个模块、一个目录、一个类，或一条流程。
    example: 通知模块（src/notify/*）
  - key: why
    label: 为什么
    type: textarea
    help: 今天什么事情很难，重构之后应该变得容易。
    example: 每个渠道（邮件、聊天、webhook）都重复同一套重试和格式化代码，改一次重试策略要改三处，总有一处漏掉。加第四个渠道应该只是一个文件的事。
  - key: keep
    label: 什么不能变
    type: textarea
    required: false
    help: 其他代码或其他人依赖的行为、公开接口、文件格式、性能。
    example: 消息文案、重试次数和公开的 send() 签名。现有通知测试原样通过。
  - key: stop_at
    label: 止于哪里
    required: false
    help: 改动的边界。边界之外的，再诱人也不碰。
    example: 各渠道自己的 HTTP 客户端保持原样。
---

# 重构：{{area}}

## 为什么
{{why}}

## 什么不能变
{{keep}}

## 止于哪里
{{stop_at}}

## 已决定
- 行为不变：现有测试原样通过，漏掉的行为用新测试钉住。
- 分步进行，每一步代码都能跑；一步一个 commit。
- 不夹带新功能。发现值得以后做的事，记下来，不要顺手做掉。
