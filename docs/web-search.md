# DSH Web Search · DeepSeek 官方搜索 / SearXNG 双提供方

从此版本起，SearXNG **随 Ubuntu 24.04 LTS 版 DSH 镜像打包，但默认不启动**，不再以额外的 Docker Sidecar 形式部署。

## 运行模型

```text
DSH Docker container (one network namespace)
├── DSH Web Host (3080)
│   └── dsh-docker-web-search plugin (only when opted in)
│       └── SearXNG child process (127.0.0.1:18788)
└── network / proxy: direct or the existing DSH sing-box HTTP(S)_PROXY
```

- 默认 `DSH_SEARCH_ENABLED=false`：不加载自建插件补丁，DSH 原生 `deepseek-official` 仍是默认搜索，不启动 Python/Granian 搜索进程。镜像包含 SearXNG。
- 显式启用后：启动脚本根据持久化搜索偏好选择 **官方**或 **SearXNG** 原生 `--patch` 层，仍加载插件的 Web 设置面板，**不通过 Profile 插件安装器和 pnpm**。只有 SearXNG 被选为生效提供方时，Host 才启动 Granian/SearXNG 子进程。
- 本地搜索只监听 **127.0.0.1:18788**；不映射宿主机端口、不开 Docker Socket、也没有搜索专用网络。
- 进程继承 DSH 的 HTTP_PROXY / HTTPS_PROXY / NO_PROXY 环境变量。若 `dshd proxy` 使用 sing-box，搜索自然使用同一个出口；如无代理，则走 DSH 的默认 Docker 网络直连。
- SearXNG 版本在镜像构建时固定到 `Dockerfile` 的 `SEARXNG_REF`，与 DSH 镜像一起发布。构建前需要连接 PyPI 和 GitHub。
- SearXNG 属于 AGPL-3.0-or-later 上游组件，源代码原样随镜像保存在 `/opt/dsh/searxng-src`，请按上游许可证要求履行分发义务。

## 快速启用

```bash
dshd search status
dshd search enable
dshd search test
```

`dshd` 主菜单 **28：Web Search / SearXNG** 可以查看状态、测试、诊断、日志、重启和更新 DSH 镜像。

首次启用仍由 `dshd search enable` 完成；此操作保留既有行为，首次安装以 SearXNG 作为自建搜索模式。未启用插件时始终使用 DSH 官方搜索；已启用插件后可在 Web 面板选择官方或 SearXNG。启用后，**DSH Web 由独立「快捷入口管理」插件统一渲染的侧边栏纯图标栏**中，默认与「回收站」图标并排显示放大镜「网络搜索」；展开、收起侧边栏时均无可见中文文字，悬停可见中文提示，并可在「插件 → 快捷入口管理」随时隐藏、排序或调整图标大小。点击打开宽屏响应式搜索设置面板，可切换搜索提供方，修改 SearXNG 运行开关、缓存、Brave 回退、每日额度，并执行 SearXNG 测试/重启；也保留 **DSH Web → 插件 → DSH Web Search** 入口。搜索设置面板可通过关闭按钮、Escape 键或点击遮罩关闭，密钥仍保存在 DSH 官方凭据存储。切换提供方或关闭内置搜索后，请保存设置并在宿主机执行 `dshd search restart`；**当前生效的搜索 Provider 在重启前保持可用**，不会因设置变化立即失效。`dshd search disable` 则完全卸载自建插件补丁，恢复未经覆盖的官方配置。

Web 插件通过 DSH 受认证的 connection/request 接口保存设置，**不接触 Docker Socket**。Brave API Key 继续使用官方 `remote.credentials` 的只写存储。

## 配置与持久化

```text
$DSH_HOME/web-search/
├── settings.json             # provider、运行开关、缓存和 Brave 配置（0600，无密钥）
├── brave-budget.json         # UTC 日调用计数
└── searxng/
    └── settings.yml          # 实例密钥（0600），首次启动自动生成
```

SearXNG 首次运行生成独立强随机 `secret_key`，后续启动/升级不覆盖已有 `settings.yml`。默认继承官方配置但移除 Ahmia、Torch (Tor-only) 引擎，并禁用内部私有实例不需要的 limiter，同时启用 HTML/JSON 格式。镜像提供默认 `limiter.toml` 以免出现缺失配置告警。

修改复杂的搜索引擎策略可编辑持久化的 `settings.yml`，然后在 Web 插件里重启搜索进程。不要公开实例密钥、不要对公网转发搜索监听端口。

## 两种搜索提供方与生效时机

| 模式 | DSH Web searchProvider | 搜索进程 |
|---|---|---|
| 插件未安装 / CLI disable | `deepseek-official`（上游默认） | 不启动 |
| 插件已安装，选择 DeepSeek 官方 | `deepseek-official` | 不启动 |
| 插件已安装，选择 SearXNG 且后端已启用 | `dsh-docker-search` | 按需启动 |
| 选择 SearXNG 但关闭后端 | `deepseek-official` | 不启动 |

Web 搜索提供方由 DSH 在启动时确定，无法通过其公开服务接口热切换。在面板保存新模式后，需执行 `dshd search restart`；面板会显示**当前生效提供方**与**重启待生效**提示。切换时不修改上游官方包，也不伪造原生 Provider 的搜索请求。

旧版没有 `provider` 字段的四项偏好自动按原来的 SearXNG 模式读取；重建镜像不会改写用户的 `settings.json`。若旧偏好 `enabled=false`，下次重启会选择官方搜索。Brave **仅作为 SearXNG 的可选备用**，并不负责官方搜索回退。本版本不支持“官方失败自动改用自建”的跨 Provider 容错。

## 默认搜索、备用、额度

- 单次 Web Search 约 12 秒：SearXNG 预算 7 秒、Brave 回退最多 4 秒。
- 默认使用本地 SearXNG。只有主动启用 Brave 回退、配置了有效 `BRAVE_SEARCH_API_KEY`，并且主搜索发生可回退的错误时，才会调用 Brave API。
- 每日备用上限 0–10000，默认 50；0 表示禁止使用收费备用；计数按 UTC 日期保存。
- 有效的零结果不触发 Brave 费用回退；`dshd search test` 仅测试正在使用的 SearXNG 端点；返回零条结果会返回非零退出状态提醒检查网络/引擎。官方搜索应在 DSH 会话中用官方 Web Search 工具验证。
- 内存缓存只在 DSH 进程内：最大 500 条/32MiB，SearXNG 15 分钟、Brave 2 分钟，重启即清空。

## Compose

用当前 `Dockerfile` 构建后，设置 `.env` 内的 `DSH_SEARCH_ENABLED=true`，执行：

```bash
docker compose up -d --build
```

不再需要 `docker compose --profile search`；Compose 里也不再提供第二个搜索服务。直接通过 Compose 启用时，若需要国际网络，应按现有 DSH 网络方式将 HTTP(S)_PROXY 配入 DSH 容器，以便内置 SearXNG 继承。

## 从旧版 Sidecar 升级

1. 先更新 DSH 镜像到包含嵌入搜索的新版本，`dshd search enable` 会在替换容器前检查镜像是否包含 Granian 和 SearXNG。
2. 新容器就绪后，管理器仅清理带 `io.caicailo.dsh.component=web-search` 标记的旧搜索 Sidecar/网络，不删除同名的用户自建资源。
3. 旧 `$STATE_DIR/search/searxng/settings.yml` 不会被自动删除；嵌入式实例会在 DSH_HOME 内生成新配置。想迁移自定义搜索配置时，先备份并手动检查 `settings.yml` 的合并适配。
4. 回退到旧镜像时需要恢复旧版 `dshd` 对应的 Sidecar 配置；请保留升级前备份。

## 维护

```bash
dshd search status
dshd search test
dshd search doctor
dshd search logs
dshd search restart        # 兼容 CLI：会重启整个 DSH
dshd search update         # 拉取 DSH 镜像并重建（包含搜索）
dshd search disable        # 移除 Provider、还原 DSH 默认搜索；保留持久数据
```

Web 插件里的“重启搜索”只重启子进程，不需要重新启动整个 DSH；CLI 重启命令在没有直接 RPC 凭据的情况下仍采用完整 DSH 重启。系统自部署不保证上游搜索引擎永远可访问，搜索可能受到 DNS、代理线路和反机器人机制影响。
