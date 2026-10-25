---
name: 新功能
summary: 像资深工程师希望看到的那样描述一个功能：给谁用、怎么表现、怎样算做完。
nature: code
lang: zh
inputs:
  - key: feature
    label: 功能
    help: 一句话，就像写在更新日志里那样。
    example: 订单页导出 CSV
  - key: users
    label: 给谁用
    help: 会用它的人或系统，以及他们想做成什么。
    example: 每月在表格里对账的店长。
  - key: behaviour
    label: 应该怎么表现
    type: textarea
    help: 按一个人实际体验的顺序一步步写；已知的页面、命令或接口直接点名。
    example: |
      订单页的日期筛选旁边有一个「导出」按钮。按下后下载当前视图里订单的 CSV，列和表格一致，一个订单一行，文件名为 orders-<起>-<止>.csv。超过一万行时在后台导出，页面在做好时提示。
  - key: constraints
    label: 约束
    type: textarea
    required: false
    help: 什么不能变、必须兼容什么、时间 / 体积 / 费用上的限制。
    example: 表格本身不变。金额导出为数字而不是格式化后的字符串。Excel 和 Numbers 都能干净地打开。
  - key: done_when
    label: 怎样算做完
    type: textarea
    required: false
    help: 你怎么知道它做对了。每一行都可以变成一条验收检查。
    example: |
      导出筛选后的一周，得到的行和表格显示的完全一致。
      导出五万个订单不会超时。
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
