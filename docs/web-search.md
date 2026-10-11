# DSH Web Search · SearXNG 主搜索 + Brave 备用（实验性）

该功能遵循 DSH 官方 `ctx.web` 能力接口和 Plugin Manager 生命周期，不 fork 上游 DSH Core。初次安装/旧版升级都**默认禁用**，不改变用户现有的搜索 Provider。

## 交互式设置菜单（推荐）

安装了最新的 `dshd` 管理脚本后，运行 `dshd` 并输入 **28：Web Search / SearXNG**，进入独立设置子菜单。主菜单及原有选项编号均不变。

子菜单直接显示 Web Search / SearXNG、Brave 回退、每日调用上限、缓存的当前状态；支持启用/关闭主搜索、搜索测试、诊断、日志、重启或更新 SearXNG、启用/关闭 Brave、设置每日 0–10000 次调用上限、开启/关闭/清理缓存。

- 涉及停用服务、更新镜像、启用付费备用和清理缓存的操作必须确认才会执行；
- 输入非法额度会重新提示；留空可取消。Ctrl-D 返回上级菜单，失败后留在搜索子菜单；
- 所有菜单按钮只是调用相应的 `dshd search ...` 命令，不写第二份配置；
- 如果启用过程失败（例如 SearXNG secret 生成失败），不会提前保存“已启用”状态；如果旧版曾保存了已启用但 Sidecar 未运行，菜单会显示“待修复”，选 1 可再次部署；
- 在 Web UI → 插件 → DSH Web Search 填写 Brave API Key。仅勾选启用仍不会自动购买服务，没有凭据不能付费回退。

## CLI 安装方式（dshd）

```bash
dshd search status
dshd search enable
dshd search test
dshd search doctor
```

`dshd search enable` 创建 Docker 私有网络 `${DSH_NAME}-search`，启动 SearXNG Sidecar `${DSH_NAME}-searxng`，重建 DSH 主容器，并通过 DSH Plugin Manager 在 Web profile 安装内置 Search Router。主容器与 Sidecar 通过别名 `dsh-searxng:8080` 通信。不要求暴露 8080 端口或打开宿主机 Docker Socket。

当已有 sing-box 出口时，DSH 同时加入独立的 `${DSH_NAME}-egress` 代理网络；关闭代理不移除搜索网络。无代理时搜索 Sidecar 使用 Docker 默认容器网络出口。

## 实际搜索语义

- 搜索模型工具保持官方 `web_search`，fetch 工具保持 `web_fetch`，不安装第二套工具。
- 每个 `web_search` 最长 12 秒：Provider 内部 11.5 秒，主 SearXNG 预算 7 秒、备用 Brave 最多 4 秒。
- 搜索默认只用 SearXNG。仅当用户明确启用 Brave 且已配置有效 `BRAVE_SEARCH_API_KEY`，并发生连接失败、HTTP 429/5xx、JSON 格式错误等情况时使用备用。
- 合法 0 条结果不触发付费回退；用户取消操作不触发备用。
- Brave 回退需用户显式启用，并使用 `DSH_SEARCH_BRAVE_DAILY_LIMIT` 限制每天的最大次数（默认 50）。计数持久化到 `$DSH_HOME/web-search/brave-budget.json`，仅包含 UTC 日期和次数，不含查询或密钥。
- 缓存只保存在 DSH 进程内，容量最多 32MiB / 500 条，SearXNG 结果 TTL 15 分钟，Brave 结果 TTL 2 分钟，重启后清空。不得把缓存理解成实时搜索。
- SearXNG 搜索可能受到底层搜索引擎的反自动化限制；服务自部署不代表结果永久可用。

## Brave 备用

```bash
dshd search brave enable
dshd search brave limit 50
dshd search brave disable
```

`enable` 只代表允许备用调用，不会自动申请或充值 Brave 服务。密钥通过 DSH 官方 Credentials 以 `BRAVE_SEARCH_API_KEY` 名称提供；不得放在公开配置文件或向 API 提交密钥。没有密钥时 Router 会返回 `DSH_SEARCH_BRAVE_CREDENTIAL_MISSING`，不会暗中回退到 DeepSeek 官方付费搜索。

## Docker Compose

仓库保留直接 Compose 部署路径。仅在明确需要搜索时：

1. 复制 `.env.example` 为 `.env`，设置 `DSH_SEARCH_ENABLED=true`。
2. **生成独立的 SearXNG 密钥**，把 `docker/search/settings.yml` 中 `REPLACED_BY_DSHD_AT_INSTALL` 替换为高强度随机值；建议复制到私有路径再调整挂载，不要提交密钥到 git。
3. 正式部署锁定 `DSH_SEARCH_IMAGE` 到经测试的镜像 digest。
4. 执行 `docker compose --profile search up -d`，检验搜索工具。

Compose 方式的 SearXNG 不映射宿主机端口，不应通过反向代理公开暴露。切换模式前不要直接修改 DSH 持久化 Profile 中的插件文件。

## 常用运维

```bash
dshd search status
dshd search test
dshd search logs
dshd search restart
dshd search cache clear
dshd search disable
```

`disable` 通过 Plugin Manager 删除自己拥有的插件、重建 DSH、关闭自身的 Sidecar 和私有搜索网络。不会删除聊天、Research 数据和其它插件。移除插件后由 DSH 既有组合层决定实际搜索 Provider。安装时修改了用户自己的 Profile 覆盖设置会影响优先级，应以 `dsh --profile web --dump-config` 检查最终组合。

## 升级与兼容

- 不直接修改 `@deepseek-ai/dsh-web`、`@deepseek-ai/dsh-tool-web` 等上游包。
- 推荐使用 `dshd search test`、`dshd doctor` 和 CI 中的搜索插件测试验证更新版本。
- 更改上游 `ctx.web` 类型、Provider 注册接口、Profile bundle 合并语义时，必须在 Release CI 中阻断发布并修正本插件。
- Search Router 是 Web Profile 插件；其他 Profile（如纯 headless 或 sdk）的自动安装尚未启用，未来需要逐 Profile 做兼容验证。
- Web UI 插件卡片提供 Brave API Key 的安全只写录入与配置状态。通过官方 `plugins.item` 插槽和 `remote.credentials`，不自行保存密钥；Sidecar 启停、备用回退开关与上限仍由 `dshd` CLI 管理。


### SearXNG 配置与权限

`dshd` 将首次生成的 `settings.yml` 保存到宿主机 `$STATE_DIR/search/searxng/settings.yml`，并生成独立随机密钥。整个配置目录挂载到 Sidecar 的 `/etc/searxng`；缓存目录单独挂载到 `/var/cache/searxng`。SearXNG 官方镜像首次启动会在 `FORCE_OWNERSHIP=true` 时修正挂载目录属主，因此不使用 `:ro` 单文件挂载避免非 root 进程无法读取 mode 0600 的密钥文件。配置文件不得对公网提供。

Search Sidecar 与网络带有 `io.caicailo.dsh.component=web-search` 所属标记。`disable`、`uninstall` 不删除没有此标记的同名用户资源；`enable` 遇到同名异主资源时拒绝接管，避免破坏用户已有 Docker 网络/容器。
