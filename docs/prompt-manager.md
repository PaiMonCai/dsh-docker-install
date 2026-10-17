# 提示词与执行设置

Standard Web 内置「设置 → 提示词与执行」。Reverse 继承同一个插件，但使用独立的 DSH_HOME；Reverse 专用的「逆向提示词」管理器继续负责其 Persona 和预设。

该功能借鉴 [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge) 的逐轮注入、独立指令文件和可观察状态理念。本项目独立实现，通过 DSH 官方 `system-prompt/assemble`、`permissionPresets` 和 `tools.guard` 接口接入，不安装 dsh-purge、不修改官方 npm 包或启动器。

## 附加指令

- 全局指令：在设置页填写，显式启用后追加为 `dsh-docker:user-guidance` 分块，最多 16 KiB UTF-8。
- 工作区指令：显式启用后读取 `/workspace` 到会话当前目录各层的 `DSH_PROMPT.md`，由父到子组合为独立分块。模板括号 `{{...}}` 保留为普通文本。
- 原生 `AGENTS.md` / `CLAUDE.md` 的发现、优先级、投影和更新仍由 DSH 原插件负责，不额外复制进 System Prompt。
- 文件必须是工作区内普通文件；符号链接、越界目录、单文件或组合后超过 16 KiB、超过 32 层的目录链会跳过整个工作区附加块，并在诊断中显示原因。不会默默截掉父目录指令。
- 配置在每次提示词组装时读取，适用于本实例各 Agent，包括子代理。更新不需要重启；已经发出的模型请求不会回溯修改。

例如启用工作区附加指令后：

```text
/workspace/DSH_PROMPT.md             # 通用项目约定
/workspace/my-app/DSH_PROMPT.md      # 当前项目补充
/workspace/my-app/src               # 会话目录
```

DSH 的 `complete` 提示词可在组装 Hook 之后替换分块，因此附加内容不保证在这种模式下进入最终请求。诊断只表示 Hook 观察结果，不能当成模型接受指令或最终请求正文的证明。

## 审批与沙箱

设置页列出最多 100 个已加载会话，展示其实际沙箱模式、审批策略和权限预设。先停止所选会话的运行，再选择 DSH 当前提供的预设并点击「应用到所选会话」。该操作调用官方权限所有者，由其写入 `permission/preset`、`sandbox/mode` 和 `approval/policy` 会话事件；重启后按原生日志恢复。

默认预设通常是 `workspace-write + ask`。`danger-full-access + never` 表示关闭 DSH 文件沙箱、不弹审批；**`never` 本身并不是自动批准**：仍需审批的请求会由 DSH 原生逻辑拒绝。界面只显示官方实际可用的预设，包括配置提供的其他预设。

「恢复所选会话默认预设」重新应用当前部署默认预设。它不修改其他会话或未来会话默认值，不提升 Linux 用户或 Docker 权限，也不改变宿主机挂载和 Docker Socket 的访问边界。

## 工具禁用名单

输入精确 DSH 工具名称，每行一个，最多 64 项。保存后通过官方工具运行时 guard 检查本实例各 Agent 的后续调用，包括子代理与 PTC 嵌套调用。名单只增加拒绝，不会放行其他插件拒绝的工具。工具 schema 仍由官方服务提供，模型调用禁用工具时会收到明确错误。

这是**按工具名称的拒绝名单**，不是按行为分类的安全策略。例如禁用 `write` 不会阻止 `bash` 或另一个 MCP 工具写入文件；限制文件效果应选择合适的沙箱模式，并结合实际能力配置。已进入工具正文的调用不会被追溯取消。

「停用附加设置」关闭全局/工作区追加并清空工具禁用名单，保留已编辑文本。会话权限需要单独恢复。

## 持久化、诊断与禁用

- 管理页默认启用；附加指令默认关闭、工具禁用名单初始为空，已有会话权限不自动更改。
- 状态位于 `$DSH_HOME/dsh-docker/prompt-manager/state.json`，原子写入、文件权限 0600。保存使用版本哈希检测其他页面的并发修改。
- 最近一次组装诊断仅在内存保存：分块名称、字节数、SHA-256 和工作区文件来源；不保存完整提示词或用户消息。多会话共用最近一次记录，刷新可能显示另一会话的组装。
- 配置损坏时保留原始提示词；工具检查拒绝后续工具调用，避免禁用名单失效。管理员可在停止工作后备份并修复上述状态文件，或关闭整个插件。
- 完全关闭：设置 `DSH_PROMPT_MANAGER=false` 并重建容器。内置插件不会加载，附加指令和工具 guard 随插件移除；已经写入会话的原生权限事件仍然有效，需通过 DSH 权限预设另行恢复。
- RPC 使用独立的 `/dsh-docker-prompt-manager` 通道，沿用 DSH Connection 的登录校验，不占用官方 `/api` 路由。

## 验证范围

本地可运行 `node --test tests/test-prompt-manager.mjs tests/test-prompt-manager-ui.cjs`。发布包回归使用 `tests/test-prompt-manager-published.mjs`，需把 `DSH_PROMPT_RUNTIME_ROOT` 指向安装了当前 DSH 依赖的 package 根目录。

CI 在构建镜像内验证客户端的 Cordis 服务依赖声明、真实 SystemPrompt 渲染、工具调用拦截、嵌套调用和插件卸载；Chromium E2E 检查原生设置页及登录后 RPC 保存/停用。客户端必须声明 `slots`、`connection`，才能在原生生命周期中访问对应服务。测试配置只写入临时目录/隔离 CI 卷。
