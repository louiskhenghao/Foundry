---
name: 品牌片
summary: 一支讲品牌主张的片子，几个节拍讲完，用它自己的颜色和语气。
nature: video
lang: zh
settings:
  videoPack: motion-studio
  mode: simple
  budgetPreset: thorough
inputs:
  - key: brand
    label: 品牌
    example: Ridgeline，为修而生的户外装备
  - key: story
    label: 故事
    type: textarea
    help: 品牌主张什么，分三个节拍讲：从哪里来、要往哪里去。
    example: |
      第一次出门就撕破的一件冲锋衣，和那个把它修好而不是卖你一件新的作坊。
      十年的装备，每个零件都设计成可以更换，修理柜台从没关过门。
      下一个十年：我们做过的每一件东西都有配件，只要还有人穿着它。
  - key: duration
    label: 时长
    type: choice
    options: [45 秒, 60 秒, 90 秒]
    default: 60 秒
  - key: formats
    label: 画幅
    type: choice
    options: ["16:9", "9:16", "16:9 和 9:16", "16:9、9:16 和 1:1"]
    default: 16:9 和 9:16
  - key: mood
    label: 情绪
    type: textarea
    help: 沉稳还是急促，温暖还是精准；想要哪些片子或品牌的感觉，要避开哪些。
    example: 沉稳而温暖，不急的剪辑，日光和作坊的质感；不要史诗感，不要航拍，不要煽情的弦乐。
  - key: end_card
    label: 结尾那句话
    help: 片子最后停在哪句话上，一字不差。
    example: 为修而生。
  - key: assets
    label: 素材
    type: textarea
    required: false
    help: logo、颜色、字体、片段或照片，在下面附上。
    example: 字标（SVG）、石板蓝 #35506b 和焦橙 #c2561f、随附的十二张作坊照片。
---

为{{brand}}做一支 {{duration}} 的品牌片。

## 故事
{{story}}

## 画幅
{{formats}}

## 情绪
{{mood}}

## 结尾那句话
{{end_card}}

## 素材
{{assets}}

## 已决定
- 全片用品牌自己的颜色和字体；logo 只出现一次，在结尾。
- 一条时间线；每种画幅都从它剪出来，绝不从另一种裁切。
- 配乐按故事的节拍写，不是垫在下面。
