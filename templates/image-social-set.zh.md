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
  - key: message
    label: 要说的话
    type: textarea
    help: 这组图传达什么，一两句；要印在图上的字，如果有。
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
  - key: avoid
    label: 避免
    type: textarea
    required: false
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
