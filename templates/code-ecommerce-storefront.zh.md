---
name: 电商店面
summary: 一个真能卖货的店面——商品目录、搜索、购物车、对接支付商的结账、订单和后台——快、无障碍、可以直接接待真实顾客。
nature: code
lang: zh
settings:
  mode: expert
  budgetPreset: thorough
  interviewDepth: 3
inputs:
  - key: shop
    label: 店铺
    help: 卖什么、卖给谁，一句话。
    example: Hollow Hill Ceramics，手工拉坯餐具，卖给欧洲各地的家庭
  - key: catalogue
    label: 商品目录
    type: textarea
    help: 商品种类、规格、数量、数据今天放在哪。
    example: 六个系列约 120 件商品；按釉色和尺寸分规格；库存按规格计；照片和文案现在在一张表格和一个文件夹里。
  - key: payments
    label: 支付
    type: choice
    options: [Stripe, PayPal, Stripe 和 PayPal, 待定的支付商]
    default: Stripe
  - key: fulfilment
    label: 运费与税
    type: textarea
    help: 发往哪里、运费怎么算、税对你怎么算。
    example: 欧盟和英国；按国家统一运费，满 120 € 包邮；价格含增值税，结账时按国家显示。
  - key: locales
    label: 语言与货币
    required: false
    example: 英语和德语；欧元和英镑
  - key: stack
    label: 技术栈
    type: choice
    options: [仓库现有的, Next.js 加无头电商 API, 带自己数据库的全栈框架]
    default: 仓库现有的
  - key: admin
    label: 店主要管什么
    type: textarea
    required: false
    help: 店主不靠开发者就必须能做的事。
    example: 增改商品和库存，查看并发货订单，打印装箱单，设折扣码，看当天销售。
---

# {{shop}}：一个在线店面

## 商品目录
{{catalogue}}

## 支付
{{payments}}

## 运费与税
{{fulfilment}}

## 语言与货币
{{locales}}

## 技术栈
{{stack}}

## 店主要管什么
{{admin}}

## 已决定
- 金额一律用带币种的整数最小单位处理；合计、税和运费在服务端计算并在支付时复核；确认订单的是支付商的 webhook，不是浏览器。
- 结账无需账号，购物车跨会话保留，支付失败后能恢复而不丢车；整个流程通过无障碍审计，只用键盘也能完成。
- 商品页服务端渲染，带结构化数据（Product、Offer、面包屑）、真实图片尺寸和替代文字；中端手机档 Lighthouse 性能 ≥ 90、SEO ≥ 95。
- 库存在支付确认时原子地只扣一次；从构造上就不可能超卖，并有并发结账的测试证明。
- 订单、退款和状态变更是只追加的历史；邮件（确认、已发货、退款）由模板渲染，后台可预览。
- 密钥放在环境变量里，PCI 范围留给支付商（托管表单或跳转），每个表单都限速并在服务端校验。
- 里程碑脚本用支付商的测试卡端到端买一件商品，再在后台展示这笔订单。
