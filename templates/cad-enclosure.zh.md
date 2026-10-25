---
name: 电路板外壳
summary: 给一块电路板做可打印的外壳——支撑柱、接口开孔、卡扣或螺丝盖、散热孔和墙面安装——为打印机而设计，用几何检查把关。
nature: cad
lang: zh
settings:
  budgetPreset: thorough
inputs:
  - key: board
    label: 电路板
    help: 名字和带单位的外形；有 STEP 或图纸就在下面附上。
    example: 一块 65 × 56 mm 的单板计算机，厚 1.6 mm，四个 2.75 mm 安装孔，孔距 58 × 49 mm
  - key: ports
    label: 接口与开孔
    type: textarea
    help: 每个必须通到外面的接口或指示灯，在板边的位置和尺寸。
    example: |
      长边上两个 USB-A 和一个以太网口，离板面高 15 mm。
      短边上 USB-C 供电和一个 micro HDMI。
      角落附近一个状态 LED——导光柱或一个 2 mm 孔。
      一个 40 针排针，盖子下仍能插拔。
  - key: lid
    label: 盖子
    type: choice
    options: [卡扣, 四颗螺丝拧进热熔螺母, 滑盖]
    default: 卡扣
  - key: mounting
    label: 怎么安装
    type: choice
    options: [放桌上，带橡胶脚垫, 拧在墙上或 DIN 导轨上, 两种都要]
    default: 放桌上，带橡胶脚垫
  - key: cooling
    label: 散热
    type: choice
    options: [被动散热孔, 留出 30 mm 风扇位, 不需要散热孔]
    default: 被动散热孔
  - key: process
    label: 怎么做出来
    type: choice
    options: [3D 打印（FDM）, 3D 打印（光固化）, CNC 加工]
    default: 3D 打印（FDM）
  - key: exports
    label: 需要的文件
    type: choice
    options: [每个零件的 STEP 和 STL, 每个零件的 STEP 和 3MF, 每个零件的 STEP、STL 和图纸]
    default: 每个零件的 STEP 和 STL
---

为{{board}}建模一个外壳。

## 接口与开孔
{{ports}}

## 盖子
{{lid}}

## 怎么安装
{{mounting}}

## 散热
{{cooling}}

## 怎么做出来
{{process}}

## 需要的文件
{{exports}}

## 已决定
- 参数化模型，参数是板的外形、孔位、板厚、壁厚和间隙；换一块板就是改几个数。
- 壁厚不小于 2 mm，支撑柱按 M2.5 螺丝或热熔螺母设计，板离底面 3 mm；每个接口开孔周围留 0.3 mm 间隙再加接头自身的公差。
- 为上述工艺而设计：超过 45° 的悬垂必须有倒角或打印机能架的桥，卡扣按材料的弹性取尺寸，零件摆成无需支撑即可打印的方向并注明。
- 几何检查就是测试：板带间隙放得进、每个接口对准开孔、盖子合得上、没有干涉；模型验收前先跑。
- 散热孔顺着气流（低进高出）并防手指伸入；一张图纸标出总体尺寸和螺丝位置。
