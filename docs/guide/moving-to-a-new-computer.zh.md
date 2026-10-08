# 搬到新电脑

**Transfer** 把一个 Foundry 知道的东西带到另一个 Foundry，通常是在新电脑上：你的设置、key 和 goal。在旧电脑上导出一个文件，再到新电脑上导入。入口在顶栏右侧的 ⚙ 菜单：**Transfer — move to another computer**。

## Export

![Transfer：Export 勾选了 Settings 和 Goals，Import 等待选择文件](images/transfer.png)

勾选要放进文件的内容，然后按 **Export**。文件会被下载；这台电脑上什么都不会变，goal 照常进行。

- **Settings**：Settings 里的所有设置，但不包括只属于这台电脑的：**Engine (install)** 整个部分、**Notifications** 的链接地址和 tailnet 名称、markitdown 路径、**Folder browser roots** 以及预览端口。
- **Keys & secrets**：API key、通知 token，以及你在 goal 的 Preview 卡片里填的变量。它们会用你输入两次的密码封存。没有密码就读不出来，Foundry 也无法帮你找回。
- **Goals**：**All goals**，或者用 **Choose goals** 一个个挑。如果某个 goal 是另一个没被选中的 goal 的 Follow-up，会提示你，并附上加入它的链接。每个 goal 都会带上它的历史、附件和截图。只要 goal 的分支里有 base 分支还没有的成果，无论完成与否，分支也会一起带走。未完成的 goal 还会带上 progress folder 里被 Git 忽略的文件，例如生成的图片和风格样张。
- **Session transcripts**：这些 goal 的完整会话日志。它们可能很大，大文件更适合在终端里用 `foundry export --transcripts`。

## Import

在新电脑上打开 **Transfer**，按 **Choose a Transfer file…**。Foundry 读取文件后显示：

- **Goals**：每个 goal 是新的、*already here*（已经在这里）还是 *deleted here*（在这里删过）。只有新的 goal 可以勾选。已经在这里的 goal 永远不会被覆盖。
- **Repositories**：goal 用到的每个项目在这台电脑上的文件夹。相同路径、相同 remote 的文件夹会自动填上。留空的话，可以之后在 goal 页面上再选。
- **Settings that differ**：逐个部分选择 **Use imported** 或 **Keep mine**，默认选中导入的。
- **Keys & secrets**：勾选 **Bring Keys & secrets in**，输入密码并按 **Unlock**，就能看到每个 key 遮掩后的样子以及你这里现有的值。想保留自己的，就在那个 key 上勾选 **keep mine**。预览变量会加在这里已有的变量旁边。

按 **Import** 后导入，并列出带进来了什么、跳过了什么以及原因。

## Imported goals

导入的 goal 是历史记录：你可以查看它的一切，也可以从它开始一个 Follow-up，但 Foundry 不会运行、交付或盯着它。它的页面上有 **imported** 标记和一张 **Came from another computer** 卡片：

![一个等待 Reattach 的导入 goal：来源、待 map 的仓库和 Reattach 按钮](images/goal-imported.png)

- **Map repository** 把它指向这台电脑上的项目文件夹，并把它的分支放回去。
- **Reattach**（只有未完成的 goal，且已经 map 之后）在这里给它建一个 progress folder 并继续进行。写出文件时被打断的工作会在新的会话里重新开始，失去的那次尝试也会还给它。如果这个 goal 在另一台电脑上还在跑，两边从此会各走各的：请先在那边停掉。

## What does not travel

登录、skills、MCP 服务器和插件属于各个编码智能体自己的设置：请在新电脑上登录并安装。如果你要的是完整复制所有东西，请看 [updates-and-backup.md](../operate/updates-and-backup.md) 里的备份。
