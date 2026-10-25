---
name: 修 bug
summary: 用「看到了什么、怎么复现、本该怎样」描述一个缺陷；修复从失败的测试开始。
nature: code
lang: zh
settings:
  budgetPreset: quick
  interviewDepth: 1
  workflow:
    tdd: required
inputs:
  - key: symptom
    label: 发生了什么
    type: textarea
    help: 你看到的现象；有报错信息就一字不差地贴上。
  - key: steps
    label: 怎么复现
    type: textarea
    help: 从头开始让它出现的步骤，包括相关的数据或账号。
  - key: expected
    label: 本该发生什么
  - key: where
    label: 在哪里
    required: false
    help: 页面、URL、命令、文件或模块，知道的话写上。
  - key: since
    label: 从什么时候开始
    required: false
    help: 某个版本、日期，或你怀疑的某次改动。
---

# Bug：{{symptom}}

## 怎么复现
{{steps}}

## 本该发生什么
{{expected}}

## 在哪里
{{where}}

## 从什么时候开始
{{since}}

## 已决定
- 先写一个在这个 bug 上会失败的测试，再让它通过；测试保留。
- 修原因，不修表象。如果原因在别处，说出来，不要绕着打补丁。
- 不相关的代码一律不动。
