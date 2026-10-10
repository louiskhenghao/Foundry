# 端口

**Ports** 显示 Foundry 所在电脑上有哪些端口正在被使用，以及每个端口被谁占着。入口在顶栏右侧的 ⚙ 菜单：**Ports — what holds which port**。preview 提示端口已被占用、却怎么也查不到占用者时，就来这里看。

## 列出什么

每个端口归在一组里：

| 分组 | 谁占着端口 |
|---|---|
| **Foundry** | Foundry 自己、某个 goal 的 preview 应用（**Preview · 应用名**）、**VS Code (web)**、任务的会话在 goal 文件夹里启动的程序（**Task · 任务名**，或 **Started in a goal folder**），或者 Foundry 为某个仓库的预览运行的 Docker 服务（**Service · 名称**）。 |
| **Tailscale serve** | `tailscale serve` 转发到你 tailnet 的端口：**by Foundry**（preview 的 tailnet 链接）、**yours**（你自己加的），或 **→ Foundry**（把 Foundry 带到你其它设备上的那条）。tailnet 地址可以直接点开。 |
| **Docker** | 发布了这个端口的容器，显示名称和 compose 项目。 |
| **Other processes** | 其它程序：名称、进程号和它运行的文件夹。 |
| **Unknown holder** | 你的用户看不到的东西（系统或其它用户）。在终端里运行 `sudo lsof -nP -iTCP:<端口> -sTCP:LISTEN` 可以查到是谁。 |

`tailscale serve` 占端口的方式，不加 sudo 的 `lsof -i` 看不到，但开发服务器就是没法在那里监听：这正是端口"被占用"却什么都查不到的常见原因。

默认的 **For development** 只显示和开发有关的：Foundry、Tailscale 和 Docker 的端口，常用开发端口（3000、5173、8080……），预览端口范围，以及在你的项目里运行的程序。**All ports** 会加上系统和后台程序。搜索框按端口号、程序、容器或文件夹匹配。页面打开期间每五秒自动刷新一次。

在 Foundry 的 Docker 镜像里打开时，页面只显示它容器里的端口，并会注明。

## Stop & release

每行末尾的 ■ 按钮会停掉占着端口的东西，让端口重新空出来。会先弹出对话框说明会停掉什么；按 **Stop & release** 继续，按 **Cancel** 取消：

- preview 应用或 **VS Code (web)** 会停掉，之后随时可以再启动。Foundry 加的 serve 会在下次启动 preview 时自动加回来。
- 任务的程序（这次尝试可能会失败）、Docker 服务或容器（整个容器都会停，数据保留）、你自己加的 serve，或者你自己的程序（先收到 SIGTERM，几秒后还在就 SIGKILL）。
- Foundry 自己、把 Foundry 带到你其它设备上的那条 serve（以及你打开这个页面所经过的那条）、系统程序和其它用户的程序都没有按钮；那一行会写出原因。

停掉属于某个 goal 的东西，会记录在那个 goal 的 **Activity** 里。

## 从启动不了的 preview 过来

preview 因为 `EADDRINUSE` 停下时，它的卡片会写出是谁占着那个端口，能释放时附带 ■ 按钮，**Ports →** 会打开这个页面并定位到那个端口。Foundry 不会自己重启 preview：端口空出来后按 **Start preview**。

在终端里，`foundry ports` 会打印同样的列表（`--all` 显示全部，`--json` 输出数据）；停止操作在页面上做。
