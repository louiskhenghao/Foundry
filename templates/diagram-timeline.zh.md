---
name: 时间线或路线图
summary: 一张讲清什么时候发生了什么、或者什么时候会来什么的编辑风格时间线——项目历史、发布计划、分阶段的迁移——做成网页并附带 SVG。
nature: diagram
lang: zh
settings:
  mode: simple
inputs:
  - key: subject
    label: 主题
    help: 这是谁的时间：一个项目、一个产品、一次迁移。
    example: 从旧结账流程切到新结账流程
  - key: events
    label: 事件或阶段，按顺序
    type: textarea
    help: 每条一行，带日期或时间段；多的话分成几个阶段。最多十二条。
    example: |
      - 2026-03：新结账流程放在开关后面，只对员工开放。
      - 2026-05：10% 的顾客；其余仍走旧流程。
      - 2026-07：50%；退款切到新流程。
      - 2026-09：全部顾客；旧流程只读。
      - 2026-11：下线旧流程。
  - key: today
    label: 我们现在在哪
    required: false
    help: 如果时间线延伸到未来，标为"现在"的日期或阶段。
    example: 2026-09，向全部顾客推开
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

画一张 {{subject}} 的时间线。

## 事件或阶段，按顺序
{{events}}

## 我们现在在哪
{{today}}

## 在哪里阅读
{{destination}}

## 外观
{{skin}}

## 品牌
{{brand}}

## 已经定下的
- 一个自包含的网页，旁边导出 SVG，提交到仓库的 docs/diagrams/ 下。
- 日期照给的画；要紧的地方间距跟着日历走，不要紧的地方跟着阅读顺序走。
- 强调色标出"现在"，或者读者该先看到的那一个事件。
