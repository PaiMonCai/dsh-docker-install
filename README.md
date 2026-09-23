# DSH Docker

**Deploy DSH. Do reproducible research.**

这是一个面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Docker 发行与运维项目。它不 fork DSH Core，而是把官方 npm 包稳定地封装成可安装、可更新、可持久化、可反代的容器，并在此基础上提供可选的 Research Edition。

版本来源保持单一：基础 DSH 版本见 [Dockerfile](Dockerfile) 的 `DSH_VERSION`，Research 版本见 [research/VERSION](research/VERSION)。

## 你应该用哪个版本

| 版本 | 镜像标签 | 适合 |
|---|---|---|
| Standard | `:latest` / `:<dsh版本>` | 日常 DSH Agent、Web UI、开发环境 |
| Research Core | `:research` | 一般科研、文献、数据、可复现分析 |
| Research Economics | `:research-economics` | 经济学、计量、DiD / Event Study |

关系始终是：

```text
DSH Standard
   └─ Research Core
        └─ Economics Pack
```

## 快速开始

推荐直接运行安装器：

```bash
curl -fsSL https://raw.githubusercontent.com/PaiMonCai/dsh-docker-install/main/install.sh | bash
```

安装完成后使用：

```bash
dshd
```

常用命令：

```bash
dshd status
dshd logs
dshd update
dshd restart
dshd token
dshd shell
dshd doctor
```

切换 Research：

```bash
dshd edition research
dshd research-pack economics

# 回到 Standard
dshd edition standard
```

完整安装、访问、反向代理、持久化和 API 配置见 [部署与访问](docs/deployment.md)。

## Standard 提供什么

Standard 镜像主要解决 DSH 的运行和管理问题：

- 官方 DSH npm 包的 Docker 化；
- Web / headless / sdk / acp 等 profile 入口；
- 持久化 `DSH_HOME` 与工作区；
- Trusted Hosts、Token URL 和反向代理适配；
- Remote Settings；
- Chromium / Playwright；
- Node / Python / Go / Docker CLI 开发环境；
- 可选宿主机 Docker Socket 管理；
- 国内网络构建镜像源适配；
- `dshd` 安装、更新、备份、恢复和诊断。

详细运行时说明见 [Runtime 与运维](docs/runtime.md)。

## 自定义模型推理等级

镜像内置一个轻量 DSH Web 扩展，用于补齐自定义模型的 `reasoningEfforts` 编辑能力。

```text
Models 页面
   ↓
声明模型支持哪些 reasoningEfforts
   ↓
DSH 原版 Composer 读取并提供推理等级选择
```

Models 页仍通过 DSH 官方 Settings API 保存；Composer 保持 DSH 原生的“模型 / 推理等级”交互，不做 DOM 替换。

详细设计、兼容边界和 `max → xhigh` 等映射方式见 [自定义模型推理等级](docs/reasoning-editor.md)。

## Research Edition

Research Edition 不是第二套 DSH，也不是“自动写论文”的独立平台。它是在 Standard 镜像上增加可复现研究能力：

```text
Dataset
  ↓
Pipeline
  ↓
Run
  ↓
Result
  ↓
Artifact
  ↓
Paper
```

普通用户主要通过 DSH Agent 使用 Research 工具；底层 `research-*` CLI 继续作为稳定协议、CI 和调试入口。

Economics Pack 额外提供 Python-first 的计量工具，包括固定效应、IV、DiD、Event Study、经济数据获取和结果注册。

完整 Research Engine、Dashboard、Economics Pack、V2 架构与 RC Gate 见 [Research Edition](research/README.md)。

## 镜像

GHCR：

```text
ghcr.io/paimoncai/dsh-docker-install:latest
ghcr.io/paimoncai/dsh-docker-install:research
ghcr.io/paimoncai/dsh-docker-install:research-economics
```

基础镜像更新后，CI 会先发布 Standard，再把这次发布的**精确镜像 digest**传给 Research 构建，避免 Research 继续基于旧的 `:latest`。

构建、GHCR 和自动检测上游 DSH 更新的说明见 [镜像构建与自动更新](docs/ci.md)。

## 文档

详细说明已经从根 README 拆出：

- [文档索引](docs/README.md)
- [部署与访问](docs/deployment.md)
- [Runtime 与运维](docs/runtime.md)
- [自定义模型推理等级](docs/reasoning-editor.md)
- [镜像构建与自动更新](docs/ci.md)
- [Research Edition](research/README.md)

## 安全边界

默认部署只应把 DSH Web 暴露给受控网络或 HTTPS 反向代理。启用宿主机 Docker Socket 后，容器基本拥有宿主机 root 级 Docker 控制能力，应只在明确需要时开启。

Research Dashboard 默认是只读工作流视图，不应直接裸露到公网。

更多安全和运行时说明见 [Runtime 与运维](docs/runtime.md)。

## 项目原则

这个仓库的边界保持简单：

```text
DSH Core             → 上游负责
Docker / dshd        → 本仓库负责
Research Engine      → 可选扩展
UI compatibility     → 尽量走官方扩展点
runtime state        → 始终由 DSH 自己拥有
```

不为了“方便”维护第二套 DSH 状态，不把 UI 适配描述成安全沙箱，也不让 Research 层反向接管 DSH Core。
