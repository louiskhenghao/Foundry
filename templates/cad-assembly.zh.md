---
name: 一个装配体
summary: 几个装在一起、动在一起的零件：逐个建模，再装配、导出。
nature: cad
lang: zh
inputs:
  - key: assembly
    label: 装配体
    help: 它是什么，一句话。
  - key: parts
    label: 零件
    type: textarea
    help: 每个零件以及它和其他零件怎么连接，一行一个，附上已知的关键尺寸。
  - key: motion
    label: 什么会动
    type: textarea
    required: false
    help: 哪些零件会动、动多远、绕着或沿着什么。
  - key: envelope
    label: 总体尺寸
    help: 它必须装进的空间，带单位。
  - key: exports
    label: 需要的文件
    type: choice
    options: [装配体的 STEP, 装配体和每个零件的 STEP, 每个零件的 STEP 和 STL, 每个零件的 STEP、STL 和图纸]
    default: 装配体和每个零件的 STEP
---

把{{assembly}}建成一个装配体。

## 零件
{{parts}}

## 什么会动
{{motion}}

## 总体尺寸
{{envelope}}

## 需要的文件
{{exports}}

## 已决定
- 一个零件一个任务，然后是装配；共用尺寸做成每个零件都读的参数。
- 几何检查就是测试：每个零件的尺寸和孔，装配体的间隙和行程。
- 紧固件和标准件取自零件库，绝不重新建模。
