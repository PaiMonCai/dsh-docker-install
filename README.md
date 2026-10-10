# DSH Docker

**Deploy DSH. Do reproducible research.**

这是一个面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Docker 发行与运维项目。它不 fork DSH Core，而是把官方 npm 包稳定地封装成可安装、可更新、可持久化、可反代的容器，并在此基础上提供可选的 Research Edition。

版本来源保持单一：基础 DSH 版本见 [Dockerfile](Dockerfile) 的 `DSH_VERSION`，Research 引擎自身版本见 [research/VERSION](research/VERSION)（写入镜像并记录到每次运行，不参与镜像 tag）。研究镜像的发布 tag 跟随它实际包住的 DSH 版本。

## 你应该用哪个版本

| 版本 | 镜像标签 | 适合 |
|---|---|---|
| Standard | `:latest` / `:<dsh版本>` / `:alpha`·`:next` | 日常 DSH Agent、Web UI、开发环境 |
| Research Core | `:research` / `:research-<dsh版本>` / `:research-alpha` | 一般科研、文献、数据、可复现分析 |
| Research Economics | `:research-economics` / `:research-economics-<dsh版本>` / `:research-economics-alpha` | 经济学、计量、DiD / Event Study |

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
dshd mounts show
dshd mounts add /opt/dsh/ssh /root/.ssh
dshd proxy setup
# 或查看现有配置
dshd proxy status
dshd doctor
dshd sessions list
dshd sessions               # 会话管理
```

切换 Research：

```bash
dshd edition research
dshd research-pack economics

# 回到 Standard
dshd edition standard
```

安装器与 `dshd` 菜单对每一步都做了错误隔离：某一步失败只会提示原因并**回到菜单**，
不会中途退出脚本；已填写的配置在拉取镜像之前就会落盘，网络恢复后继续即可。
菜单里 `Ctrl-C` 只取消当前操作，`0` / `Ctrl-D` 才退出。

完整安装、访问、反向代理、持久化和 API 配置见 [部署与访问](docs/deployment.md)，
交互行为细节见 [Runtime 与运维](docs/runtime.md#交互式菜单的错误边界)。

## 会话管理

使用 `dshd sessions` 可以按序号选择存储中的会话，移入回收区、恢复，以及永久清理。
也可通过 `dshd sessions list`、`dshd sessions delete PROJECT/ID`、
`dshd sessions trash`、`dshd sessions restore TRASH_ID`、
`dshd sessions purge TRASH_ID` 进行管理。

删除会话日志之前，管理器会暂时停止正在运行的 DSH，操作完成后自动尝试恢复启动。
Web 界面通过内置 `dsh-docker-session-manager` 插件，在会话右侧 `···` 菜单加入“删除会话”。
提交删除后，Host 将请求写入持久化队列，再由 Docker 容器受控重启时的入口脚本
将会话移入回收区，避免在运行期间直接修改日志。若禁用自动重启，则通过
`dshd restart` 应用删除请求。Web 插件可通过 `DSH_SESSION_MANAGER_WEB=false` 关闭。
详见 [Runtime 与运维](docs/runtime.md)。

## Standard 提供什么

Standard 镜像主要解决 DSH 的运行和管理问题：

- 官方 DSH npm 包的 Docker 化；
- Web / headless / sdk / acp 等 profile 入口；
- 持久化 `DSH_HOME`、工作区，并支持自定义目录挂载（如 `/root/.ssh`）；
- Trusted Hosts、Token URL 和反向代理适配；
- Remote Settings；
- Chromium / Playwright；
- Node / Python / Go / Docker CLI 开发环境；
- 可选宿主机 Docker Socket 管理；
- 国内网络构建镜像源适配；
- 可选 sing-box sidecar 国际网络出口，支持 HTTP / SOCKS、VLESS、Trojan、Hysteria2、Shadowsocks 分享链接、订阅刷新、节点测速与 URLTest 自动故障切换；
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
ghcr.io/paimoncai/dsh-docker-install:<dsh版本>
ghcr.io/paimoncai/dsh-docker-install:alpha
ghcr.io/paimoncai/dsh-docker-install:next
ghcr.io/paimoncai/dsh-docker-install:research
ghcr.io/paimoncai/dsh-docker-install:research-<dsh版本>
ghcr.io/paimoncai/dsh-docker-install:research-alpha
ghcr.io/paimoncai/dsh-docker-install:research-economics
ghcr.io/paimoncai/dsh-docker-install:research-economics-<dsh版本>
ghcr.io/paimoncai/dsh-docker-install:research-economics-alpha
```

三类 tag 各有分工：

```text
:<dsh版本>            锁定到具体 DSH 版本
:latest              始终跟随最新一次构建（含 alpha / rc 预发布）
:alpha  :next        与上游 npm dist-tag 同名，跟随上游发布通道
```

自动更新链路不仅会重建 `:<dsh版本>` 与 `:latest`，还会把指向该版本的
npm dist-tag 通道名原样打到镜像上，于是

```text
docker pull <image>:alpha   ≈   npm i @deepseek-ai/dsh@alpha
```

查询上游失败或版本不对应任何通道时，只发布版本号与 `:latest`，不让构建失败。

Research 镜像用同样的三类含义，只是加上 edition 前缀（`:research` /
`:research-economics` 是浮动 tag，相当于研究镜像的 `:latest`），且版本 tag 跟随
**它实际包住的 DSH 版本**：`:research-<dsh版本>`、`:research-alpha`。
`research/VERSION` 只标识研究引擎自身版本，不参与镜像 tag。

基础镜像更新后，CI 会先发布 Standard，再把这次发布的**精确镜像 digest**传给 Research 构建，避免 Research 继续基于旧的 `:latest`；同时把解析到的通道名一并传入，让两类镜像的通道 tag 始终一致。

构建、GHCR、镜像 tag 通道对齐与自动检测上游 DSH 更新的说明见 [镜像构建与自动更新](docs/ci.md)。

## 文档

详细说明已经从根 README 拆出：

- [文档索引](docs/README.md)
- [部署与访问](docs/deployment.md)
- [Runtime 与运维](docs/runtime.md)
- [国际网络出口 / sing-box](docs/proxy.md)
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


### Web 文件管理插件 405

镜像已内置 DSH 第三方 RPC 通道路由修复。若文件管理等插件的私有 RPC
接口返回 HTTP 405，可执行 `dshd update` 更新镜像。修复和排查边界见
[Web 插件文件管理 HTTP 405 修复](docs/deployment.md#web-插件文件管理-http-405-修复)。
