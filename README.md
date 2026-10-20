# DSH Docker

**Deploy DSH. Do reproducible research.**

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Docker 发行与运维项目。
将官方 npm 包封装为可安装、可更新、可持久化、可反代的容器，并提供 Research、Economics 和 Reverse 衍生镜像。
不维护 DSH Core 分支；Web 增强优先使用官方扩展点，必要的版本适配见 [补丁兼容性清单](docs/upstream-patch-compatibility.md)。

基础运行时为 Ubuntu 24.04 LTS，包含 Node.js 24、Python 3.12、Go、Docker CLI、
Chromium/Playwright 和按需启动的 SearXNG。宿主机只需具备受支持的 Docker 环境。

## 选择镜像

| 版本 | 正式入口 / 固定版本 / 开发入口 | 用途 |
|---|---|---|
| Standard | `:latest` / `:<版本>` / `:dev` | 日常 DSH Agent、Web UI、开发环境 |
| Research Core | `:research` / `:research-<版本>` / `:research-dev` | 文献、数据、可复现分析 |
| Research Economics | `:research-economics` / `:research-economics-<版本>` / `:research-economics-dev` | 计量、DiD、Event Study |
| Reverse Edition | `:reverse` / `:reverse-<版本>` / `:reverse-dev` | 原生逆向 Agent、报告解读、REA 与逆向工具链 |

镜像仓库为 `ghcr.io/paimoncai/dsh-docker-install`。`<版本>` 指本项目 Git 发布标签去掉 `v`，
与镜像中的 DSH 包版本独立。上游 DSH 版本见 [Dockerfile](Dockerfile)，Research 引擎版本见 [research/VERSION](research/VERSION)。
各 edition 独立验收和发布，某一标签触发构建不代表所有衍生镜像均已可用；详见 [发布流程](docs/ci.md)。

```text
Standard
  +-- Research Core
  |     +-- Economics Pack
  +-- Reverse Edition
```

## 快速开始

在 Linux 宿主机运行交互安装器：

```bash
curl -fsSL https://raw.githubusercontent.com/PaiMonCai/dsh-docker-install/main/install.sh | bash
```

安装后输入 `dshd` 打开六分类菜单，或直接执行：

完整实例备份与迁移：`dshd backup export [FILE]` 导出数据、工作区、配置及自定义挂载，`dshd backup import FILE NEW_ID` 在新实例中恢复；支持 `dshd backup auto on daily 7` 设置每日保留 7 份。详见 [完整实例备份与恢复](docs/portable-backup.md)。

```bash
dshd status
dshd logs
dshd update
dshd token
dshd shell
dshd doctor
```

安装器引导设置容器、端口、工作区、持久数据、API 和 Trusted Hosts。
首次 Web 登录 Token 保存在持久卷，更新或重建后保持不变；重置 Token 不会注销已有浏览器 Cookie。
Compose、自行构建、域名访问和反向代理见 [部署与访问](docs/deployment.md)。

## 多实例与衍生版

默认命令管理默认实例；命名实例分别保存容器、端口、数据、工作区和更新配置：

```bash
dshd instance add study research
dshd instance add econ research-economics
dshd instances
dshd -i study status
dshd -i econ logs
```

现有实例可用 `dshd edition research`、`dshd research-pack economics` 切换科研工具链，
或用 `dshd edition standard` 返回 Standard。Research 提供 Dataset → Pipeline → Run → Result → Artifact → Paper 工作流；
Agent 使用工具，底层 `research-*` CLI 保留为稳定接口。详见 [Research 指南](research/README.md)。

Reverse 使用独立容器和数据卷，可通过 `bash install.sh reverse` 或 `dshd reverse install` 安装。
它继承 Standard 公共插件，增加逆向 Agent、报告解读、提示词预设与分析工具；不包含 dsh-purge。
详见 [Reverse 指南](docs/reverse-edition.md) 和 [多实例管理](docs/multi-instance.md)。

## 内置 Web 能力

| 功能 | 入口与行为 | 说明 |
|---|---|---|
| 实例管理 | 快捷栏 / 插件 → 实例管理；更新、重启、回滚、sing-box | [宿主机后台与恢复](docs/web-management.md) |
| 运行日志 | 快捷栏 / 实例管理 → 运行日志；SSE、重连、搜索和筛选 | [日志与升级](docs/web-management.md#运行日志) |
| 提示词与执行 | 设置 → 提示词与执行；附加指令、会话权限、工具禁用名单 | [配置与边界](docs/prompt-manager.md) |
| 会话管理 | 会话勾选批量移入回收站；回收站搜索、恢复、永久删除 | [会话与删除语义](docs/runtime.md#web-会话管理删除--永久删除--回收站) |
| 自定义模型推理等级 | 原生模型表单与 Composer；额外提供 Provider 内批量编辑 | [原生兼容与映射](docs/reasoning-editor.md) |
| 网络搜索 | 显式启用后在 Web 切换 DeepSeek 官方搜索 / SearXNG | [搜索设置与应用](docs/web-search.md) |
| 快捷入口管理 | 排序、更多、隐藏及原生导航图标化 | [Icon Dock](docs/icon-dock.md) |

这些公共插件通过镜像内的 DSH 原生 `--patch` 层加载，不依赖第三方插件安装器或 pnpm。
启用条件、环境开关与旧 Profile 迁移见 [内置插件接入规范](docs/builtin-plugin-contract.md)。

实例管理的宿主机后台在支持 root、Python 3、systemd 和 `flock` 的 Linux 上自动配置；
旧部署可运行 `sudo dshd web enable`。执行器负责容器替换和健康检查，无需给 Agent 挂载 Docker Socket。
更新日志采集器时，升级 `dshd` 后再次运行 `dshd web enable`。

自动检查默认每 6 小时运行，结果只显示在管理页，刷新浏览器不弹更新提醒。
它比较配置镜像在当前平台上的远端 config digest 与运行镜像 ID，检测内容差异；不查询 npm 最新版，也不判断语义版本是否更高。
安装更新需要主动确认，详见 [检查逻辑](docs/web-management.md#镜像更新检查)。

推理等级使用同一份 DSH `reasoningEfforts` 配置，已保存设置无需迁移。
原生目录已有能力信息的模型通常直接使用；自定义 API 或网关别名仍需按实际能力首次声明。
关闭内置批量编辑器后，原生模型表单与会话选择继续可用。

## 镜像发布与更新

- 普通镜像相关提交或合并到 `main`，以及每日上游 DSH 更新，只发布开发入口和构建快照。
- 推送 `v<SemVer>` Git 标签才发布固定版本，并按版本顺序更新正式入口。历史 `alpha` / `next` 镜像别名不再自动更新。
- Standard 发布后，以精确 digest 独立触发 Research 和 Reverse；标签发布的衍生版使用同一 Git 标签的代码。
- 已发布版本重跑时校验并复用；旧版本不会回退正式入口。PR 只构建验证，不推送镜像。

默认安装跟随正式入口。希望跟随 `main` 时，将实例 `config.env` 中的 `DSH_IMAGE` 改为完整开发版镜像地址，
例如 `ghcr.io/paimoncai/dsh-docker-install:dev`；衍生版使用对应 edition 的 `-dev` 标签，再执行 `dshd update`。
`dshd edition` 会重置到该 edition 默认正式入口。
`dshd` 脚本本身仍有独立自更新机制，不受镜像发布标签控制。

操作步骤见 [镜像构建与自动更新](docs/ci.md)，实现合同与重试机制见 [发布流水线](docs/release-pipeline.md)。

## 文档与维护

- [完整文档索引](docs/README.md)：部署、日常运维、Web 功能、科研与逆向、开发维护。
- [部署与访问](docs/deployment.md)：安装、API、Token、Trusted Hosts、反向代理及文件面板 HTTP 405 排查。
- [Runtime 与运维](docs/runtime.md)：环境变量、沙箱、开发工具、浏览器与会话管理。
- [安全升级与回滚](docs/safe-upgrade-rollback.md)：更新失败恢复、回滚点与数据边界。
- [国际网络出口](docs/proxy.md)：sing-box 节点、订阅、代理变量与诊断。
- [项目结构与维护](docs/project-layout.md)：目录职责、配置来源及检查入口。
- [插件诊断](docs/plugin-diagnostics.md)：内置插件自检与真实浏览器验收。

## 安全边界与项目原则

DSH Web 应部署在受控网络或 HTTPS 反向代理之后。挂载宿主机 Docker Socket 会赋予容器很高的宿主机控制能力，
仅在实际需要时启用。Research Dashboard 默认是只读工作流视图，同样不应直接暴露公网。

会话删除先做逻辑归档；永久删除可终止目标会话的活动任务且不可恢复，但不会删除 `/workspace`。
审批、沙箱与工具控制沿用 DSH 原生所有者；附加指令和工具禁用名单默认关闭，权限变更的生效与恢复见专题文档。

DSH Core 和会话状态由上游维护；本仓库负责 Docker、`dshd`、可选工具链和扩展适配。
UI 适配不构成安全沙箱，Research 与 Reverse 不接管 DSH Core。
