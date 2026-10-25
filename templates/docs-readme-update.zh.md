---
name: 更新 README
summary: 为读它的人把 README 更新到位，该有的都有，多的一句没有。
nature: docs
lang: zh
settings:
  mode: simple
  budgetPreset: quick
inputs:
  - key: audience
    label: 谁读它
    type: choice
    options: [第一次试用的新人, 改代码的贡献者, 部署运维的人, 以上全部]
    other: true
  - key: cover
    label: 必须讲到什么
    type: textarea
    help: 读者必须学到的东西，一行一条；最近有变化的要点出来。
  - key: tone
    label: 语气
    type: choice
    options: [平实简短, 友好, 正式]
    default: 平实简短
  - key: keep
    label: 保持原样
    type: textarea
    required: false
    help: 必须保留的章节或措辞。
---

为{{audience}}更新 README。

## 必须讲到
{{cover}}

## 语气
{{tone}}

## 保持原样
{{keep}}

## 已决定
- 前五行说清项目是做什么的，然后是怎么跑起来，再是怎么用。
- 出现的每条命令都是今天在这个仓库里能跑的，要核对。
- 过时的内容删掉，而不是在旁边再加一段。
