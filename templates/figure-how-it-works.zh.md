---
name: 它是怎么工作的
summary: 一张可以玩的机器或装置图，一步步展示真东西是怎么工作的，里外都有。
nature: figure
lang: zh
settings:
  mode: simple
inputs:
  - key: object
    label: 对象
    help: 一把电水壶、一台扭蛋机、一组自行车齿轮、一把锁。
    example: 一把电水壶
  - key: show
    label: 必须展示什么
    type: textarea
    help: 它工作的步骤，按顺序，图应该照这个顺序带观众走一遍。
    example: |
      1. 开关闭合电路，底座下的发热盘开始加热。
      2. 水变热、对流、开始沸腾。
      3. 蒸汽顺着导管下到一片双金属片，它受热弯曲。
      4. 金属片把开关顶开，指示灯熄灭。
  - key: interactions
    label: 观众能做什么
    type: textarea
    required: false
    help: 能按的按钮、能拉的杆、能转的部件；每个做什么。
    example: 按开关开始烧水；打开壶盖；拖动把水壶转一圈。
  - key: inside
    label: 内部视图
    type: choice
    options: [要，透视机构并标注部件, 不要，只看外面]
    default: 要，透视机构并标注部件
  - key: colour
    label: 颜色
    required: false
    help: 对象的颜色或表面处理，如果要紧的话。
    example: 拉丝不锈钢，黑色把手，开关里一点蓝光。
---

画一张图，展示{{object}}是怎么工作的。

## 必须展示什么
{{show}}

## 观众能做什么
{{interactions}}

## 内部视图
{{inside}}

## 颜色
{{colour}}

## 已决定
- 先查清真东西是怎么工作的再画；画出来的机构必须是真的。
- 一个自包含的网页：在哪里都能打开，手机上能用，没有署名行。
- 每个会动的部件都有观众看得见的理由。
