---
name: 日常物件
summary: 一件熟悉物件的图，玩它的时候，它做的和真的一样。
nature: figure
lang: zh
settings:
  mode: simple
inputs:
  - key: object
    label: 物件
    help: 一台烤面包机、一盏台灯、一台自动售货机、一台街机。
  - key: does
    label: 玩它的时候会发生什么
    type: textarea
    help: 观众按、拉、转或投入什么东西时会怎样，按顺序写。
  - key: look
    label: 样子
    type: textarea
    required: false
    help: 颜色、材质、年代、像哪个牌子；绝不能像什么。
  - key: page_name
    label: 文件名
    required: false
    help: 网页文件的名字，不带 .html。
---

画一个可以玩的{{object}}。

## 玩它的时候会发生什么
{{does}}

## 样子
{{look}}

## 文件名
{{page_name}}

## 已决定
- 拖动能把物件转一整圈；每个控件做的事和真的一样。
- 一个自包含的网页：在哪里都能打开，手机上能用，没有署名行。
- 比例是真物件的比例；动笔前先从参考里量出来。
