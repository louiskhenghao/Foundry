---
name: 应用内 AI 助手
summary: 一个扎根于你产品自身数据的聊天助手，能替用户执行操作，带流式输出、护栏、费用上限和一套评测集。
nature: code
lang: zh
settings:
  mode: expert
  budgetPreset: thorough
  interviewDepth: 3
inputs:
  - key: product
    label: 它住在哪个产品里
    example: Pantry，一个共享购物清单应用
  - key: tasks
    label: 助手做什么
    type: textarea
    help: 它该处理的事，按用户会怎么开口写；哪些会改数据。
    example: |
      回答清单上有什么、买过什么（「家里还有咖啡吗？」）。
      按要求添加、勾掉或移动条目（「把燕麦奶放到周末清单」）。
      根据柜子里有的东西排一周菜谱并补上缺的——用户确认之后。
  - key: data
    label: 它能读什么
    type: textarea
    help: 它扎根的数据和边界：只读用户自己的，绝不碰别的家庭的。
    example: 用户的家庭、清单、条目和购买记录；菜谱库；绝不碰别的家庭的数据，绝不碰支付信息。
  - key: provider
    label: 模型
    type: choice
    options: [Claude API, OpenAI API, 通过 Ollama 跑本地模型, 还没定——请提出建议并说明取舍]
    default: 还没定——请提出建议并说明取舍
  - key: guardrails
    label: 护栏
    type: textarea
    help: 它绝不能做或说的事；什么需要确认；不确定时怎么办。
    example: 绝不删除清单；一次加超过五个条目或任何花钱的操作先确认；拒绝超出备案标签以外的医疗和过敏建议；宁可说「我不知道」也不猜价格。
  - key: stack
    label: 技术栈
    type: choice
    options: [仓库现有的, 应用旁边一个带自己 API 的新服务, 放进现有后端]
    default: 仓库现有的
---

# {{product}} 里的 AI 助手

## 它做什么
{{tasks}}

## 它能读什么
{{data}}

## 模型
{{provider}}

## 护栏
{{guardrails}}

## 技术栈
{{stack}}

## 已决定
- 用工具调用而不是自由文本：每个操作都是带参数校验的类型化工具，授权检查在应用代码里而不是提示词里；破坏性和花钱的操作先问用户。
- 以检索方式扎根于用户自己的数据，查询时套用用户权限；助手引用它用到的内容，界面也显示出来。
- 流式回复带停止按钮；每用户每日预算和每次请求 token 上限，用量有记录。
- 至少三十条贴近真实的评测对话（正常路径、拒绝、注入攻击、模糊请求）在 CI 里对固定模型版本运行；通过率下降的改动不合并。
- 提示词注入防御：工具结果和检索到的文本是数据而不是指令；系统提示词和工具清单不因请求而泄露。
- 对话随用户数据存储，随账号删除，绝不用于训练。
- 里程碑脚本问一个有依据的问题、发起一个操作，并展示确认步骤。
