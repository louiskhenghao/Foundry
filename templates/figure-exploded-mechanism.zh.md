---
name: 机构爆炸图
summary: 一张把机构在空中拆开的图——每个零件都有标注，沿自己的轴拉出再装回——然后让它运转起来，观众由此明白零件怎样合成功能。
nature: figure
lang: zh
settings:
  mode: simple
  budgetPreset: thorough
inputs:
  - key: object
    label: 机构
    help: 一枚机械表机芯、一个自行车花鼓、一把门锁、一组相机快门。
    example: 一个带飞轮的自行车后花鼓
  - key: parts
    label: 零件
    type: textarea
    help: 要展示和标注的零件，按拆开的顺序；每个起什么作用。
    example: |
      轴和锥碗——花鼓绕着它们转。
      轴承——两圈钢珠，每侧一圈。
      鼓壳——拉着辐条。
      带棘爪和弹簧的飞轮体——向前带动车轮，向后打滑。
      飞轮片——链条拉动的地方。
  - key: steps
    label: 图要走哪些步骤
    type: textarea
    help: 观众该看到的顺序，从装配到爆炸再装回，以及机构运转。
    example: |
      1. 装配状态，缓缓转动。
      2. 爆炸：零件沿轴滑出，每个停下时出现标注。
      3. 踩踏：棘爪咬合，鼓壳随飞轮片转动。
      4. 滑行：飞轮片停下，棘爪哒哒滑过，鼓壳继续转。
      5. 装回。
  - key: interactions
    label: 观众能做什么
    type: textarea
    required: false
    help: 爆炸程度的滑块、各步骤的按钮、拖动转动。
    example: 一个从装配到爆炸的滑块；「踩踏」和「滑行」按钮；拖动转动；点标注多看一句。
  - key: look
    label: 样子
    type: textarea
    required: false
    help: 颜色、材质、表面处理。
    example: 拉丝铝鼓壳，黑钢飞轮片，棘爪做成黄铜色以便突出。
---

画一张{{object}}的爆炸图。

## 零件
{{parts}}

## 图要走哪些步骤
{{steps}}

## 观众能做什么
{{interactions}}

## 样子
{{look}}

## 已决定
- 动笔前先查清真实机构：零件、顺序和运动都是真的，标注用真实名称。
- 每个零件沿自己的轴爆开，再精确回到原位；标注在每个阶段都可读，且绝不遮住零件。
- 机构能运转：运转时该动的零件动，不该动的不动。
- 一个自包含的网页：在哪里都能打开，手机上能用，没有署名行。
