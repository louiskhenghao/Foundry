---
name: 一个零件
summary: 一个机加工或打印的零件：从它的作用和关键尺寸，到你需要的文件。
nature: cad
lang: zh
inputs:
  - key: part
    label: 零件
    help: 它叫什么，装在哪里。
    example: 一个 40 mm 窗帘杆的墙面托架
  - key: function
    label: 它的作用
    type: textarea
    help: 它固定、导向、遮盖或连接什么，承受什么力或热。
    example: 托住 40 mm 窗帘杆的一端，离墙 80 mm，用两颗螺丝固定在墙上；承受大约 5 kg 的窗帘，偶尔被拽一下。
  - key: dimensions
    label: 关键尺寸
    type: textarea
    help: 带单位。总体尺寸、孔位和孔径、配合与间隙、壁厚。
    example: |
      杆槽内径 40.5 mm、深 25 mm，顶部开口，杆能向上取出。
      墙板到杆心的外伸距离 80 mm。
      墙板 60 × 40 mm，两个 5 mm 沉头孔，孔距 40 mm。
      壁厚不小于 4 mm。
  - key: material
    label: 材料
    required: false
    example: PETG；机加工则用铝
  - key: process
    label: 怎么做出来
    type: choice
    options: [3D 打印（FDM）, 3D 打印（光固化）, CNC 加工, 钣金, 还没定]
    default: 还没定
  - key: exports
    label: 需要的文件
    type: choice
    options: [STEP, STEP 和 STL, STEP 和 3MF, STEP、STL 和一张图纸]
    default: STEP 和 STL
---

建模{{part}}。

## 它的作用
{{function}}

## 关键尺寸
{{dimensions}}

## 材料
{{material}}

## 怎么做出来
{{process}}

## 需要的文件
{{exports}}

## 已决定
- 参数化模型：关键尺寸是有名字的参数，改一处只改一个数。
- 几何检查就是测试：体积、包围盒、孔位、壁厚，建模前先写好。
- 手或工具会碰到的地方倒圆或倒角；会遮住尺寸的地方不倒。
