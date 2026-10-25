---
name: 社媒图组
summary: 同一个信息、几个平台，一组风格统一的图。
nature: image
lang: zh
settings:
  mode: simple
inputs:
  - key: brand
    label: 品牌或账号
    example: Ridgeline，一个小型户外装备品牌
  - key: message
    label: 要说的话
    type: textarea
    help: 这组图传达什么，一两句；要印在图上的字，如果有。
    example: 春季系列上市，为修而生而不是用完即弃。图上只放「为修而生」和上市日期。
  - key: platforms
    label: 平台
    type: choice
    options: [Instagram, X, LinkedIn, Instagram 和 X, 三个都要]
    other: true
    default: 三个都要
  - key: count
    label: 几张
    type: choice
    options: ["3", "5", "8"]
    default: "5"
  - key: style
    label: 观感
    type: textarea
    help: 颜色、字体、摄影还是插画、参考作品。
    example: 扁平插画，石板蓝配焦橙，那一行字用粗无衬线体；不用照片，不用渐变。
  - key: avoid
    label: 避免
    type: textarea
    required: false
    example: 图库式的笑脸、山景俗套、每张图超过一行字。
---

为{{brand}}做一组 {{count}} 张的社媒图。

## 要说的话
{{message}}

## 平台
{{platforms}}

## 观感
{{style}}

## 避免
{{avoid}}

## 已决定
- 一个创意贯穿每一张：同一套配色、字体和留白，各按平台尺寸出图。
- 每张按平台原生尺寸交付，用平台名加编号命名。
- 图上不出现上面没说过的内容。
