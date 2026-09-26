# Foundry

> [English](./README.md) · 中文

Foundry 把一句大白话写的目标 —— *"给订单页加 CSV 导出"*、*"给我们工作室做个官网"*、*"新饮品的海报"* —— 变成你仓库里做完、审查过的成果。它在你自己的电脑上运行，驱动你的 Claude Code：先问只有你能决定的事，给你看一次计划，然后自己去做、检查、审查、交付，只有真的需要你时才停下来。

- **先问再规划。** 一段简短的访谈把仓库里查不到的事问清楚；你只需批准一份 Brief。
- **做完之前你就能看。** 到了里程碑，goal 会暂停、启动实时预览，等你看过。
- **靠检查，不靠猜。** 每个任务都有验收检查；交付前会把整体结果再审查一遍。
- **你的成果，在你的文件夹里。** 进度放在仓库旁边的 `<repo>-foundry/`；推送和 PR 按你选的策略来。
- **花多少由你定。** 模型预设决定每项工作用哪个模型；预算会在超支前让 goal 停下来。

## 快速开始

你需要 [Bun](https://bun.sh)、已登录的 [Claude Code](https://docs.anthropic.com/en/docs/claude-code)（`claude` 在 PATH 上）和 git。也可以用 Docker —— 见 [安装](docs/operate/install.md)（英文）。

```bash
bun install && bun run web:build
bun run serve                 # 然后打开 http://127.0.0.1:4111
```

打开界面，按 **New goal**，选一个仓库，写下你想要的东西。

## 接下来看哪里

| 我想要…… | 去看 |
|---|---|
| **使用 Foundry** —— 创建 goal、看 Brief、回答访谈、处理 Inbox | [用户指南](docs/guide/) |
| **安装和运行** —— Docker、远程访问、通知、更新、所有设置 | [运维文档](docs/operate/)（英文） |
| **修改代码** —— 架构、角色、测试、发布、设计决策 | [开发文档](docs/develop/) · [CONTRIBUTING](CONTRIBUTING.md)（英文） |

Foundry 用到的词（Goal、Brief、Milestone、Model Preset……）在 [术语表](CONTEXT.md)（英文）里有定义。
