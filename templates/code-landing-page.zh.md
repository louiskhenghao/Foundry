---
name: 带动效的营销落地页
summary: 只卖一件事的发布页：动效有分寸，转化可衡量，Lighthouse 拿高分。
nature: code
lang: zh
settings:
  mode: simple
  interviewDepth: 2
inputs:
  - key: product
    label: 产品
    help: 页面卖什么，一句话。
    example: Ledgerly，替你催拖欠款的开票工具
  - key: audience
    label: 给谁看
    example: 每月开十来张发票的自由职业者和两人工作室
  - key: sections
    label: 各个区块
    type: textarea
    help: 从上到下；每块传达什么、展示什么。
    example: |
      首屏：那一句话、副标题、注册按钮，以及一段循环播放的催款提醒发出去的录屏。
      怎么用：三步，配随滚动自己画出来的小插图。
      证据：三条引言和数字（收到钱要几天，用前用后）。
      定价：两个套餐，年付开关，FAQ 折叠在下面。
      页脚：再放一次注册、联系方式、法律条款。
  - key: cta
    label: 行动号召
    help: 主按钮上的字，以及它通往哪里。
    example: 「免费开始——不用绑卡」，通往注册页
  - key: style
    label: 观感
    type: textarea
    help: 颜色、字体、参考、要避免的。
    example: 纸白、墨蓝和一个暖色强调；大而友好的字体；动效克制——东西落定，不弹跳；不用图库照片，不用渐变。
  - key: measure
    label: 要衡量什么
    type: textarea
    required: false
    help: 事件和目标，以及你已有的统计工具。
    example: 各区块的注册点击、滚动深度、定价开关的使用；主站已经装了 Plausible。
---

# {{product}} 的落地页

## 给谁看
{{audience}}

## 各个区块
{{sections}}

## 行动号召
{{cta}}

## 观感
{{style}}

## 要衡量什么
{{measure}}

## 已决定
- 一页一个目标：每个区块都通向同一个行动号召，手机首屏就能看见它。
- 动效要有理由：滚动进入的动画短而落定，`prefers-reduced-motion` 下全部去掉，访客阅读时没有东西在动，不发生布局偏移（CLS 为 0）。
- 中端手机档 Lighthouse 性能、无障碍、最佳实践、SEO 全部 ≥ 95；图片用现代格式并写真实尺寸；字体自托管，切换时不闪。
- 文案为上面的受众而写，朗读过一遍，从 360 px 起每种宽度都排得下；HTML 语义化，不开 JavaScript 也是一份像样的文档。
- Open Graph 和 Twitter 卡片、站点地图、产品和 FAQ 的结构化数据。
- 上述目标的事件通过统计工具触发，无需 cookie 横幅；标题的 A/B 开关已就位但默认关闭。
- 里程碑脚本在手机宽度下从头滚到尾，并点击行动号召。
