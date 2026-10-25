---
name: 3D 产品展示网站
summary: 围绕一个可交互 3D 模型（一辆车、一辆自行车、一台设备）建站：访客能转动、配置、随滚动浏览，在手机上也跑满 60 fps。
nature: code
lang: zh
settings:
  mode: expert
  budgetPreset: thorough
  interviewDepth: 3
inputs:
  - key: product
    label: 产品
    help: 网站展示什么，一句话。
    example: Vela S，一款双座电动跑车
  - key: model_source
    label: 3D 模型
    type: choice
    options: [我会附上 glTF 或 GLB 模型, 参考照片在代码里建一个风格化模型, 找一个可自由使用的模型再改]
    other: true
    default: 我会附上 glTF 或 GLB 模型
  - key: sections
    label: 网站的各个区块
    type: textarea
    help: 从上到下，每个区块说什么、展示什么；3D 模型出现在哪里，镜头在那里怎么动。
    example: |
      首屏：车停在深色转盘上，名字加一句话；拖动转车，滚动开始。
      设计：镜头顺着车身滑过，三段短文字依次出现；大灯、门把手、轮毂上的热点各打开一条说明。
      配置器：车漆、轮毂、内饰；模型原地更新，价格行跟着变。
      性能：数字滚动跳出；进入该区块时画出传动系统示意图。
      页脚：试驾表单和法律条款。
  - key: variants
    label: 可配置的选项
    type: textarea
    required: false
    help: 颜色、内饰、选装；按网站该显示的名字写。
    example: 车漆——冰川白、墨黑、余烬红、苔绿。轮毂——19 寸空气动力、20 寸锻造。内饰——石板灰、燕麦色。
  - key: interactions
    label: 访客能对模型做什么
    type: textarea
    help: 转动、缩放、开门、开灯、换配置；手机和鼠标都要行。
    example: 拖动或滑动转车，捏合或滚轮在限度内缩放，点热点看说明，点门把手开门，到性能区块时大灯亮起。
  - key: stack
    label: 技术栈
    type: choice
    options: [仓库现有的, Next.js 加 React Three Fiber, Vite 加原生 Three.js, Astro 加一个 Three.js 岛]
    default: 仓库现有的
  - key: devices
    label: 必须流畅运行的设备
    type: choice
    options: [中端手机和笔记本, 只要笔记本或台式机]
    default: 中端手机和笔记本
  - key: brand
    label: 品牌
    type: textarea
    required: false
    help: 颜色、字体、语气；有 logo 或风格指南就在下面附上。
    example: 深石墨配米白，一个信号橙作强调；标题用宽体无衬线；文案短而自信，绝不喊口号。
---

# {{product}}：一个 3D 展示网站

## 3D 模型
{{model_source}}

## 各个区块
{{sections}}

## 可配置的选项
{{variants}}

## 访客能对模型做什么
{{interactions}}

## 技术栈
{{stack}}

## 必须流畅运行的设备
{{devices}}

## 品牌
{{brand}}

## 已决定
- 模型以 glTF 发布，用 Draco 或 Meshopt 压缩，首屏绘制后再懒加载，环境光用烘焙贴图，除一道接触阴影外不用运行时阴影；贴图按设备分档。
- 目标设备上每帧 16 ms 的预算：模型的三角形数、draw call 数和贴图内存要实测并写进 README，连同所用的细节层级。
- 滚动通过时间线驱动镜头（不劫持滚动：页面还是页面）；`prefers-reduced-motion` 下镜头运动变成切换。
- 每个 3D 区块都有静态备用图，给没有 WebGL 的设备和首屏；所有文案和热点说明都是真实 HTML，读屏器能读，搜索引擎能收录。
- 中端手机档 Lighthouse 性能 ≥ 90、无障碍 ≥ 95；配置器状态放在 URL 里，配好的车能分享。
- 切换配置时原地替换材质和网格，不重新加载模型；价格行和汇总来自同一个数据源。
- Playwright 测试覆盖配置器和热点；里程碑脚本在镜头前转动模型并切换一个配置。
