# 在 Docker 中运行 Foundry

> 中文 · [English](./docker.md)

Foundry 让 Claude Code 针对**你已有的一个 git 仓库**开展工作。镜像里已经装好了引擎、它的 web
UI，以及它用到的所有工具（`bun`、`git`、`claude`、`gh`、`ripgrep`、`npx`、`uv`、`graphify`）。它特意不打包两样东西，
因为它们是你的：**你的 Claude 登录凭据**和**你的仓库**。这两者都通过挂载提供。

你需要：Docker（Desktop 或 Engine）、一个 Claude 订阅（Pro/Max）——不需要 API key——以及约 2 GB 磁盘空间来存放镜像。

---

## 1. 拉取镜像

```bash
docker pull imlouiskhenghao/foundry:latest
```

## 2. 登录 Claude

引擎是通过 Claude Code 工作的，所以 container 需要有自己的 Claude 会话——在 Claude Code 看来，一个 container 就是一台独立的
机器，即便你自己那台已经登录过也一样。有三种方式，任选其一即可，而且只需做一次。

**a. container 跑起来之后，从 web UI 登录（最简单——无需终端）。**
先做完 §3，打开 <http://127.0.0.1:4111>，在 Setup page 上点 *Sign in*。container 里没有浏览器，所以 Claude Code
不会自己完成登录，而是显示一个链接并要你输入一个 code：在你自己的浏览器里打开这个链接、批准，然后把 code 粘回对话框
（你有 15 分钟）。code 被拒绝时只会重新打开输入框。

**b. 启动之前，从终端登录。**

```bash
docker volume create foundry-claude
docker run --rm -it -v foundry-claude:/home/node/.claude \
  imlouiskhenghao/foundry claude auth login
```

流程相同——它会打印一个 URL，你在浏览器里批准，再把 code 粘回来（`-it` 就是让你能够粘贴的关键）。
登录信息落在 `foundry-claude` volume 里，重启后依然保留。

**c. 用你已登录那台机器上生成的 token。**

```bash
claude setup-token            # on YOUR machine; prints a long-lived token for your subscription
```

把它放进一个不纳入 git 的文件里，再交给 container：

```bash
echo "CLAUDE_CODE_OAUTH_TOKEN=<the token>" > ~/.foundry.env   # chmod 600
docker run -d --name foundry --env-file ~/.foundry.env ...  # rest of the flags as in §3
```

之后 `docker exec foundry claude auth status` 会报告 `"authMethod": "oauth_token"`，也就没有什么需要再登录的了。
把这个 token 当密码看待：它就是你的订阅。

> **仅限 Linux：** 你也可以改为挂载你已有的凭据——用 `-v ~/.claude:/home/node/.claude`
> 代替 `foundry-claude` volume。在 Linux 上 Claude Code 把凭据存在 `~/.claude/.credentials.json` 里，所以
> 它们会随挂载一起带过去（container 也会把它的会话和 skills 写到那里）。在 **macOS 上这行不通**：凭据存在
> Keychain 里，而不在 `~/.claude`，所以挂载的 `~/.claude` 会带来设置
> 和 skills，但带不来登录凭据。

随时可查：`docker exec foundry claude auth status`。

## 3. 指向你想让它处理的仓库

有两种形态，挑一个和你情况相符的。

### A. 你只有一个仓库

假设它位于 `/Users/dana/code/acme-app`（macOS）或 `/home/dana/code/acme-app`（Linux）：

```bash
docker volume create foundry-data

docker run -d --name foundry \
  -p 127.0.0.1:4111:4111 \
  -v foundry-data:/app/data \
  -v foundry-claude:/home/node/.claude \
  -v /Users/dana/code/acme-app:/repos/acme-app \
  imlouiskhenghao/foundry
```

打开 <http://127.0.0.1:4111>，点 **New goal**，在 *Repository* 里填 **container** 路径：

```
/repos/acme-app
```

输入框下方的面板应当变绿，显示你的分支和 commit 数。如果它显示 *not a git repository*，
说明你填的是宿主机路径——引擎只能看到你挂载进去的东西。

### B. 你在同一个文件夹下有多个仓库

把父目录挂载一次，里面的每个仓库都能访问到：

```bash
docker run -d --name foundry \
  -p 127.0.0.1:4111:4111 \
  -v foundry-data:/app/data \
  -v foundry-claude:/home/node/.claude \
  -v /Users/dana/code:/repos \
  imlouiskhenghao/foundry
```

| 它在你机器上的位置 | container 内部 | 你在 *New goal → Repository* 里填什么 |
|---|---|---|
| `/Users/dana/code/acme-app` | `/repos/acme-app` | `/repos/acme-app` |
| `/Users/dana/code/work/api` | `/repos/work/api` | `/repos/work/api` |
| `C:\Users\dana\code\acme-app` (Windows) | `/repos/acme-app` | `/repos/acme-app` — mount as `-v C:\Users\dana\code:/repos` in PowerShell, `-v //c/Users/dana/code:/repos` in Git Bash |

你想挂多少个都行：`-v ~/code:/repos -v ~/Desktop/client-work:/client`。

挂载必须是**可写的**：引擎会添加 git worktree，这会写入你仓库的 `.git/`。
它绝不碰你的工作树或你已有的分支——只会新增 `goal/<id>`（以及 task）分支，
你在 `git branch` 里能看到它们；实际的工作发生在 `/app/data` 下的 worktree 里。

### Linux：如果你的 user id 不是 1000

镜像以 uid 1000 运行。如果 `id -u` 给出的是别的值，就以你自己的身份运行，并把引擎的状态存放在
你拥有的文件夹里（named volume 会被创建为归 1000 所有）：

```bash
mkdir -p ~/.foundry/data ~/.foundry/home/.claude
docker run -d --name foundry \
  --user "$(id -u):$(id -g)" -e HOME=/home/node \
  -p 127.0.0.1:4111:4111 \
  -v ~/.foundry/data:/app/data \
  -v ~/.foundry/home:/home/node \
  -v ~/code:/repos \
  imlouiskhenghao/foundry
```

这里挂载的是整个 home，而不只是 `.claude`：作为非 1000 用户，镜像里的 `/home/node` 对你是只读的，
而 `gh auth login`、`npx autoskills` 和 `uv` 都需要往里面写东西（`~/.config/gh`、`~/.npm`、`~/.cache`）。
在 `claude auth login` 那一步也用同样的 `--user`/`-e HOME` 参数，配上同一个 `~/.foundry/home` 文件夹。
用 compose 时，把同样的值填到 `services.foundry.user:` 下面。

### 更想用 docker compose？

`docker compose` 需要在**你运行它的那个文件夹里**有一个 `docker-compose.yml`，否则它会回复
`no configuration file provided: not found`。镜像自带了一个：

```bash
docker run --rm imlouiskhenghao/foundry cat /app/docker-compose.yml > docker-compose.yml
docker compose run --rm foundry claude auth login     # once
FOUNDRY_REPOS=~/code docker compose up -d             # mounts ~/code at /repos
```

不设 `FOUNDRY_REPOS` 时，compose 文件会挂载 `~/Projects`。它还会把 `FOUNDRY_MODEL_STRONG` /
`_WORKER` / `_CHEAP` 和 `FOUNDRY_MAX_CONCURRENT` 从你的 shell 里透传进去，并启动 watchtower sidecar，
让一键更新得以工作（见 *更新*）；它的 token 默认为 `foundry-watchtower`——
设置 `FOUNDRY_WATCHTOWER_TOKEN` 可以更改。sidecar 的端口从不对宿主机发布。

## 4. 交付：推送、pull request、合并（可选）

一个 goal 会产生一个本地分支。如果你想让引擎推送它或开一个 PR，就给 container 它自己的
GitHub 登录（Foundry 从不存储 token——由 `gh` 来存）。要么在 Setup page 上点 *Connect GitHub*（同样的
device-code 流程，无需终端），要么：

```bash
docker exec -it foundry gh auth login
```

如果你希望这次登录在重建 container 后依然保留，就在 `docker run` 里加上 `-v foundry-gh:/home/node/.config/gh`。

---

## 各样东西存放在哪里

| container 内的路径 | 是什么 | 要保留吗？ |
|---|---|---|
| `/app/data/engine.db` | SQLite：goals、tasks、attempts、events（自动创建、自动迁移——无需配置） | **要** |
| `/repos/<repo>-foundry/`（bind mount） | 进度文件夹：每个 goal 一个 git worktree，引擎的任务 worktree 在 `.foundry/` 下 | 直到 goal 被删除 |
| `/app/data/worktrees` | 进度文件夹功能之前创建的 goal 的 worktree | 直到 goal 交付为止 |
| `/app/data/settings.json` | 你在 Settings 页面上改过的一切 | **要** |
| `/app/data/models.json` | 在这台机器上解析出的模型名（学习得来） | 可选 |
| `/app/data/transcripts`, `check-output`, `attachments` | 会话日志、check 输出、你上传的文件 | 可选 |
| `/app/data/skills-cache`, `skills-trash` | 拉取到的 skill 源；卸载掉的 skills（可恢复） | 可选 |
| `/home/node/.claude` | Claude 登录、会话、已安装的 skills | **要** |
| `/repos/...` | 你的仓库（从你机器挂载进来） | 它*就是*你的机器 |

备份这两个 volume：

```bash
docker stop foundry
docker run --rm -v foundry-data:/d -v "$PWD":/out alpine tar czf /out/foundry-data.tgz -C /d .
docker run --rm -v foundry-claude:/c -v "$PWD":/out alpine tar czf /out/foundry-claude.tgz -C /c .
docker start foundry
```

## 更新

Foundry 每天查询一次发布 registry；当存在更新版本时，页头会显示一个更新标签（pill）
（Settings → About & updates 里也有），并附上 changelog。

- **一键更新**（配合自带 `docker-compose.yml` 的 compose）：compose 文件会运行一个小小的
  [watchtower](https://containrrr.dev/watchtower/) sidecar——它是唯一接触 docker
  socket 的 container。在 UI 里点 *Update* 会先停止开启新会话，并等待正在运行的 agent 完成
  （最多一小时；勾选 *Update immediately* 则改为直接中断它们），然后 sidecar 拉取新镜像并
  重建 container；页面会自行重新连接。按钮要生效，必须同时满足两点：
  container 的名字是 `foundry`，且它能看到 `FOUNDRY_WATCHTOWER_URL` + `FOUNDRY_WATCHTOWER_TOKEN`——两者
  都来自 compose 文件。v0.2.0 之前拉取的 compose 文件没有 sidecar：重新拉取一次（§3）。
- **手动更新**（无 sidecar）：UI 会改为显示 `docker compose pull foundry` 和 `docker compose up -d foundry`。
  如果你当初是用普通的 `docker run` 起的，等效做法是 `docker pull imlouiskhenghao/foundry:latest`、
  `docker rm -f foundry`，再用相同的 volume 跑同一条 `docker run` 命令。两种方式都会重放事件日志，
  未完成的 attempt 会从停下的地方继续。

## 排障

| 你看到的现象 | 原因 | 解决办法 |
|---|---|---|
| `no configuration file provided: not found` | `docker compose` 在一个没有 `docker-compose.yml` 的文件夹里运行 | 用上面的 `docker run` 形式，或者从镜像里取出 compose 文件（§3） |
| `Not logged in · Please run /login` | `claude login` 不是一个命令 | `claude auth login`（带 `-it`） |
| Setup page 显示一个链接并要你输入 code | 在 Docker 里这是正常的：里面没有浏览器，所以 Claude Code 用复制-code 的流程 | 打开链接、登录、把 code 粘进对话框 |
| New goal 里出现 *not a git repository* | 你填的是宿主机路径 | 填 container 路径，例如 `/repos/acme-app` |
| 在仓库里写入时报 `Permission denied`，或 worktree 失败（Linux） | 你的文件不归 uid 1000 所有 | 用上面的 `--user "$(id -u):$(id -g)"` 配方 |
| `port is already allocated` | 别的东西占用了 4111 | 改用 `-p 127.0.0.1:4112:4111` 并打开那个端口 |
| Setup page：*markitdown not installed* | 镜像早于 v0.2.1——从那之后 PDF/Office → markdown 转换器已内置（container 内的安装无法写入归 root 所有的工具目录） | `docker pull imlouiskhenghao/foundry:latest` 并重建 container |
| 仓库的 `git worktree list` 里有陈旧的 worktree | worktree 是用 container 路径注册的 | 在那个仓库里执行 `git worktree prune` |

## 说明

- UI 没有任何鉴权——请把发布的端口保持在 `127.0.0.1` 上，绝不要把 4111 暴露到网络。若要从外部访问，把宿主机接入 Tailscale tailnet 并执行 `tailscale serve 4111`——见 [remote-access.md](./remote-access.zh.md)。
- `FOUNDRY_HOST=0.0.0.0` 在镜像里已经设好；请在宿主机一侧做回环绑定（`-p 127.0.0.1:…`）。
- 有用的环境变量：`FOUNDRY_MODEL_STRONG` / `_WORKER` / `_CHEAP`（默认 `opus`/`opus`/`haiku`）、`FOUNDRY_MAX_CONCURRENT`（3）、`FOUNDRY_TDD`（`required|preferred|off`，默认 `required`）、`FOUNDRY_GOAL_MODE`（`simple|expert`，默认 `expert`）、`FOUNDRY_UPDATE_CHECK=off`（关闭每日版本检查）。其余一切都可以在 Settings 里编辑。
- 首次以空的 `~/.claude` volume 启动时：entrypoint 会把 graphify skill 装进去（`graphify install --platform claude`）。`FOUNDRY_SKIP_SETUP=1` 会跳过这一步；已经带有 `skills/` 目录的挂载 `~/.claude` 永远不会被动。
- 被中断的 attempt 会在重启后作为 Continuation 恢复——见 [runbook](./runbook.zh.md)。
- 自行构建：`docker build -t foundry .`（加上 `--build-arg CLAUDE_CODE_VERSION=x.y.z` 可锁定一个不同的 CLI）。
- 从不需要也从不使用 API key；引擎启动的每个会话都会剥离 `ANTHROPIC_API_KEY`。
