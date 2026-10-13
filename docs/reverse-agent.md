# Docker 内置逆向工程 Agent（dsh-purge × REA）

此版本在 **Docker 镜像构建阶段** 固定打包 `rea-agents@6.4.0` 和 `ANRCM0/dsh-purge` 的指定 Git Commit。容器启动时通过现有的 DSH `web --patch` 原生扩展机制注册「逆向工程」Agent 和只读工作台 API，**不是**运行时 `npm install` 或 `dsh plugin add`。

## 功能组成

| 来源 | 容器内功能 |
|---|---|
| `rea-agents@6.4.0` | 预装 `/usr/local/bin/rea`，供独立预设的 MCP Client 启动 `rea mcp` |
| `ANRCM0/dsh-purge@28c8eaf` | 专属逆向 Agent Persona、REA Skill、6 个分析工具、5 阶段笔记/证据/报告数据存储 |
| `dsh-purge` 逆向工作台源码 | 通过生成器包装成容器原生浏览器插件；在 Icon Dock 显示「逆向工作台」 |
| DSH Docker 自带插件机制 | `--patch` 注入预设注册器和只读工作台 API，绕过第三方插件安装器 |

**作用域隔离**：本镜像只加载 `dsh-purge` 的逆向预设、逆向工具、工作台，而**不加载**它的全局 system-prompt/jailbreak 补丁或红队插件。标准 Agent 仍保持 DSH 原有行为。完整 `dsh-purge` Git 快照被打包进镜像，但并不是所有子模块都会自动启用。

## 操作

```bash
dshd update
# 或在仓库根目录构建：
docker compose up -d --build
```

进入 DSH Web 后，从 Agent 预设选择器选「逆向工程」。MCP Client 在该模式内按 `rea mcp` 启动（可执行文件在 Docker 镜像的 PATH 内），无需另外配置 MCP。点击 Web 侧边栏快捷入口「逆向工作台」可查看当前目录下的项目、阶段进度、证据与 Markdown 报告。

开关（默认启用）：

```dotenv
DSH_REVERSE_AGENT_ENABLED=true
```

改为 `false` 然后重建/重启容器，可禁用逆向预设与工作台 API。REA 二进制仍留在镜像中；重新启用无需安装 npm 包。图标快捷入口在禁用时也不加载。

## 镜像锁定与更新

- `Dockerfile` 的 `REA_VERSION` 固定 REA npm 版本；不在容器启动时查询最新版本。
- `reverse-agent-source` 阶段使用 `REVERSE_AGENT_COMMIT` 指向 dsh-purge 固定 SHA 并检查下载的 SHA。
- `docker/plugins/dsh-reverse-agent/build-client.cjs` 从同一固定提交的 `lib/reverse/client.js` 生成 Docker 原生界面，避免单独维护一份 UI 源。
- 仅升级 `DSH_VERSION` 不会悄悄改变已固定的 REA / dsh-purge 行为。

## 数据与安全边界

数据保存在持久卷内：

- `$DSH_HOME/reverse-engineering/projects/`：项目和来源引用。
- `$DSH_HOME/reverse-engineering/reports/`：导出的报告。
- `$DSH_HOME/reverse-engineering/skills/`：缺失时由插件落地的工作流 Skill。

重新构建/替换镜像不会清空这些目录。不要向不可信互联网裸露 DSH Web；逆向 API 读取的项目可能含敏感代码和路径。请仅分析自己有权查看的软件。REA 自带工具是否支持某个二进制或外部分析引擎，取决于该工具在容器内是否可用；预装 REA 不等于预装 Ghidra/IDA/Hopper。

注意容器文件系统隔离：宿主机软件不会自动出现在容器中。要分析文件请放在 `/workspace` 或通过 `dshd mounts add` 挂载所需目录。默认模式先做静态分析，运行不可信程序须额外授权与隔离。

## 验收

GitHub Actions PR 路径执行 Docker 包装器单元测试，并构建镜像；Dockerfile 自身在构建阶段检查编译/打包和 dsh-purge 逆向预设源测试。实机仍应核验：

1. 模式选择器显示「逆向工程」，并且选择时没有 `broken` 状态。
2. 在逆向模式内确实列出 `mcp__rea__*` 工具，执行真实的 REA 只读工具调用。
3. UI 入口打开逆向工作台，并成功读取持久卷中的笔记。
4. 切回标准 Agent 后，逆向专属工具与 Persona 不泄漏。
5. 禁用 `DSH_REVERSE_AGENT_ENABLED` 后，逆向模式和工作台消失，其他插件正常工作。

如果 Docker 构建、网络拉取、MCP 握手或实机冒烟测试失败，不应声称镜像已生产可用。
