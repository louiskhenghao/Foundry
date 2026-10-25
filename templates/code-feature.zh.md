---
name: 新功能
summary: 像资深工程师希望看到的那样描述一个功能：给谁用、怎么表现、怎样算做完。
nature: code
lang: zh
inputs:
  - key: feature
    label: 功能
    help: 一句话，就像写在更新日志里那样。
  - key: users
    label: 给谁用
    help: 会用它的人或系统，以及他们想做成什么。
  - key: behaviour
    label: 应该怎么表现
    type: textarea
    help: 按一个人实际体验的顺序一步步写；已知的页面、命令或接口直接点名。
  - key: constraints
    label: 约束
    type: textarea
    required: false
    help: 什么不能变、必须兼容什么、时间 / 体积 / 费用上的限制。
  - key: done_when
    label: 怎样算做完
    type: textarea
    required: false
    help: 你怎么知道它做对了。每一行都可以变成一条验收检查。
---

# 功能：{{feature}}

## 给谁用
{{users}}

## 应该怎么表现
{{behaviour}}

## 约束
{{constraints}}

## 怎样算做完
{{done_when}}

## 已决定
- 把功能装进现有的代码和约定里，不要重构本来好用的部分。
- 改动保持可审阅：小 commit，每个都说明原因。
- 测试覆盖上面描述的行为，而不是实现细节。
