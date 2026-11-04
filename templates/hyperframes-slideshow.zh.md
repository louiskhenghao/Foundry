---
name: 图片影片
summary: 你附上的照片或截图，做成一支片 —— 一拍一张，每张一句话，底下垫音乐。
nature: video
lang: zh
settings:
  videoPack: hyperframes
  mode: simple
  budgetPreset: thorough
inputs:
  - key: pictures
    label: 图片
    help: 在下面附到 goal 上（照片、截图、渲染图）。这里说明它们是什么；顺序重要的话也写上。
    example: 新工作室的十二张照片，按从门口走到窗边的顺序。
  - key: story
    label: 讲什么
    type: textarea
    help: 这支片的一条线；有要放在屏幕上的话也写在这里。
    example: 我们的工作室搬家了。门，桌子，大长桌，五点钟的窗。
  - key: duration
    label: 时长
    type: choice
    options: [15 s, 30 s, 45 s, 60 s]
    default: 30 s
  - key: formats
    label: 画幅
    type: choice
    options: ["16:9", "9:16", "1:1", "16:9 and 9:16"]
    default: 16:9
  - key: music
    label: 音乐
    type: choice
    options: [内置的一首, 我自己的曲子（附在下面）, 不要音乐]
    default: 内置的一首
  - key: brand
    label: 品牌
    type: textarea
    required: false
    help: 配色、字体、logo；有文件就附在下面。
    example: 暖灰加一种橙；文字用衬线体。
---

用附上的图片做一支 {{duration}} 的图片影片。

## 图片
{{pictures}}

## 讲什么
{{story}}

## 画幅
{{formats}}

## 音乐
{{music}}

## 品牌
{{brand}}

## 已经定好的
- 一拍一张，每张有自己缓慢的运动（推近、漂移），踩着节拍切；不要每两张之间都叠化。
- 每张最多一句话，在安全区内，停够读完的时间。
- 每张图按拍摄时的样子铺满画面；横版片里的竖图放在自己的模糊副本上，绝不拉伸。
