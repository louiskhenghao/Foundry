---
name: 产品需求文档
summary: 一份 PRD：说清问题、谁有这个问题、范围内外各是什么、成功怎么衡量。
nature: docs
lang: zh
settings:
  mode: simple
  interviewDepth: 3
inputs:
  - key: product
    label: 产品或功能
    example: Pantry 应用里的共享购物清单
  - key: problem
    label: 问题
    type: textarea
    help: 今天什么不对或缺什么、对谁、代价是什么。
    example: 一家人把清单写在纸上或聊天记录里，东西买重或者漏买，没人知道柜子里还有什么。用户要这个功能要得比什么都多。
  - key: users
    label: 给谁用
    help: 会用它的人，以及决定用不用的人。
    example: 共用一个厨房的两到五个人；已经在用 Pantry 的那位邀请其他人。
  - key: scope
    label: 范围内
    type: textarea
    help: 第一版做什么，一行一个能力。
    example: |
      一张清单，通过邀请链接共享。
      添加、勾掉、删除条目；改动几秒内出现在每部手机上。
      每个条目显示是谁加的。
  - key: out_of_scope
    label: 范围外
    type: textarea
    required: false
    help: 刻意不做的事，免得以后有人问。
    example: 价格追踪、商店地图、菜谱、一户多张清单。
  - key: success
    label: 成功怎么衡量
    type: textarea
    required: false
    help: 能告诉你它成了的数字或观察。
    example: 一个月内一半活跃家庭共享了清单；「买重了」的投诉从客服里消失。
---

为{{product}}写一份产品需求文档。

## 问题
{{problem}}

## 给谁用
{{users}}

## 范围内
{{scope}}

## 范围外
{{out_of_scope}}

## 成功怎么衡量
{{success}}

## 已决定
- 结构：摘要、问题、用户、目标与非目标、需求（必须 / 应该 / 可以）、待定问题、成功指标。
- 需求是可验证的陈述，每条带理由；不做超出读者判断所需的方案设计。
- 用新来的同事第一遍就能看懂的大白话写。
