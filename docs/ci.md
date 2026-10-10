# 镜像构建与自动更新

本文说明 Standard / Research 镜像在 GitHub Actions 中的构建、发布与上游 DSH 自动更新链路。

> 返回项目首页：[README](../README.md)

## 自动构建与更新（GitHub Actions）

- **`.github/workflows/build.yml`** — 每次正式发布前先构建 amd64 审计镜像，验证开发工具与实际 Docker Web/端口映射能启动，全部通过后才推送镜像到 GHCR
  （`ghcr.io/<owner>/<repo>`），amd64 + arm64 双架构。触发方式：镜像相关文件变更、
  手动触发、被更新检查调用。发布哪些 tag 见[镜像 tag 与上游发布通道](#镜像-tag-与上游发布通道)。
- **`.github/workflows/build-research.yml`** — **独立 GitHub Actions 运行**，构建 Research Core 与 Economics Pack。Standard 推送成功后以 `workflow_dispatch` 启动新运行，固定传入刚发布镜像的 digest、代码 commit、DSH 版本和通道快照；基础版 **不等待科研构建**，科研失败也不会回滚基础版。Research-only 提交可独立构建；同一次 push 同时更改两版时，Research push 触发会跳过，等待基础版发布后再启动，以避免抢跑与重复构建。PR 只进行 amd64 验证，正式发布为 amd64 + arm64。手动运行时默认以 DSH 精确版本 tag 为基础镜像。除 `:research` / `:research-economics` 浮动 tag 外，版本和通道 tag 都跟随**实际包住的 DSH 版本**。
- **`.github/workflows/check-update.yml`** — 每天检查 npm registry 上
  `@deepseek-ai/dsh` 的最新版本，发现新版本时自动修改
  `Dockerfile` / `docker-compose.yml` / `README.md` 中的版本号并提交，
  先用待升级版本构建 amd64 镜像并执行实际 Docker Web/开发环境预检（此阶段不推送）；预检成功后才提交版本更新并正式发布，npm 通道名采用**检测时刻**的快照。预检失败不会修改 main 或覆盖 GHCR tag。
  版本比较由 `ci/semver-max.mjs` 按 SemVer 预发布优先级处理；npm 元数据不可用时明确失败，不提交不确定版本。
  也可在 Actions 页面手动触发。

使用前确认仓库 **Settings → Actions → General → Workflow permissions** 选择
"Read and write permissions"（更新检查需要提交代码的权限）。GHCR 首次推送后
在 Packages 页面把包设为 Public 即可免登录拉取。

注意：用 `GITHUB_TOKEN` 提交的 push 不会触发其他工作流（GitHub 防递归限制），
所以更新后的构建是通过 `workflow_call` 显式调用的，不依赖 push 事件。

## 镜像 tag 与上游发布通道

一次 Standard 镜像发布会产出三类 tag（`<image>` 指 `ghcr.io/<owner>/<repo>`）：

| tag | 含义 |
|---|---|
| `<image>:<dsh版本>` | 锁定到具体 DSH 版本 |
| `<image>:latest` | 始终指向**最新一次构建**（含 alpha / rc 预发布） |
| `<image>:alpha`、`<image>:next` … | 与上游 npm dist-tag 同名，跟随上游发布通道 |

Research 镜像用 edition 前缀表达同样的三类含义（浮动 tag 对应 `:latest`）：

| tag | 含义 |
|---|---|
| `<image>:research` | 浮动 tag，最新一次构建的 Research Core |
| `<image>:research-<dsh版本>` | 锁定到某个 DSH 版本的 Research Core |
| `<image>:research-alpha` … | 与上游 npm dist-tag 同名，跟随上游发布通道 |
| `<image>:research-economics`、`:research-economics-<dsh版本>`、`:research-economics-alpha` | Economics Pack 同理 |

研究镜像的 tag 跟随**它实际包住的 dsh 版本**（构建时以标准镜像的精确 digest 为
`BASE_IMAGE`），而不是 `research/VERSION` —— 后者是研究引擎自身版本，写入镜像并
记录到每次运行的元数据里，不参与镜像 tag。

通道 tag 与 npm 的发布通道语义对齐：

```text
docker pull <image>:next            ≈    npm i @deepseek-ai/dsh@next
docker pull <image>:alpha           ≈    npm i @deepseek-ai/dsh@alpha
docker pull <image>:research-alpha  ≈    研究镜像 ⊃ 上面那个 alpha
```

`:latest` 是这几类之外的另一个概念：上游只发预发布版，npm 的 `latest` dist-tag
常滞留在旧版本，而镜像 `:latest` 始终跟随最新一次构建。若上游 `latest` 恰好指向
本次构建的版本，它已经由 `:latest` 覆盖，不会重复打 tag；名为 `latest` 的通道也
不单独打 tag（研究镜像同理，否则 `:research-latest` 会被误读成"最新研究镜像"）。
需要严格对齐上游某个通道时，请显式使用 `:alpha` / `:next`（研究镜像用
`:research-alpha` / `:research-economics-alpha`）。

推导与降级规则由 `ci/image-tags.sh` 实现，构建前由 `tests/test-image-tags.sh`
离线验证：

- 优先使用调用方传入的通道名（`workflow_call` / `workflow_dispatch` 的
  `channel_tags` 输入，逗号分隔）；留空时查询上游 npm `dist-tags`，
  找出当前指向本次版本的通道名；
- 查询失败、元数据损坏，或没有任何通道指向该版本时，只发布 `<image>:<dsh版本>`
  与 `<image>:latest`，**不会**让构建失败；
- 通道名按 OCI tag 字符集过滤，非法名字忽略并告警；
- 版本号本身不能作为合法 OCI tag 时（例如带 `+build` 元数据）直接失败，
  避免静默发布出错误 tag。

只想补某个通道 tag 时，手动触发 build（或 build-research）工作流并填
`channel_tags`（如 `next`）即可；该输入只影响附加 tag，不改变构建内容。

Standard 构建成功推送之后，调用 `gh workflow run build-research.yml` 排队一个独立工作流，通过 `base_image` 固定基础镜像 digest、`source_sha` 固定代码来源、`dsh_version` 与 `channel_tags` 固定版本及通道快照。基础版的发布状态不再受 Research 构建耗时或失败影响；两个科研镜像仍在自己的工作流里并行构建。

容器侧要固定跟随某个通道，把 `DSH_IMAGE` 指向对应 tag 即可
（新装可用环境变量传入，已有安装改 `config.env` 里的 `DSH_IMAGE` 后 `dshd update`；
`dshd edition` 会把镜像重置回该 edition 的默认 tag）。例如锁定某个 dsh 版本的
Research 环境：`DSH_IMAGE=<image>:research-0.2.1-alpha.1`。

## 说明

- 构建参数 `DSH_VERSION` 锁定 npm 包版本（当前版本见 Dockerfile 顶部；
  developer preview 可能有破坏性变更），check-update 工作流会自动维护
- 镜像包含 Chromium、Python、Go、Docker CLI 和编译工具，因此体积会明显大于最小化 Node 镜像
- 本方案的基础运行层（patch 绑定、入口分发、沙箱策略）已在
  Docker 26.1.4 / 内核 6.8 上实测通过

## 无损镜像体积优化与审计

镜像默认维持完整的 Standard（Node.js、pnpm、Python、Go、Docker CLI、Chromium）与 Research（Jupyter、Quarto、LaTeX、科研工具链）运行能力，不移除开发/运行组件来换取体积。

- Standard：每次 `npm install` 的 **同一 `RUN` 层**删除 `NPM_CONFIG_CACHE`（包括 npm 临时包与日志）；Playwright 安装系统依赖后，同层删除 apt 索引。后续层再删除缓存只能产生 whiteout，无法缩小已有层。
- Research：构建时对 `uv venv`、`uv pip install` 设置 `UV_NO_CACHE=1`，避免把下载及解包缓存持久化到镜像层；运行时的 `UV_CACHE_DIR` 设置保持不变。科研 smoke test 结束后清理同层临时缓存。
- PR：Standard 与 Research 分别实际构建 `linux/amd64`，将本地未压缩大小和主要目录占用写到 GitHub Actions Job Summary；如 GHCR 可拉取现有浮动 tag，同步显示已发布镜像大小作为基线。`main` 发布仍保留 `amd64/arm64`，不改变版本 tag 或默认功能。

**比较口径：** `docker image inspect --format '{{.Size}}'` 是本地未压缩镜像大小，并非 GHCR 传输压缩大小或运行时内存使用量。请以 PR 中真实构建的对比结果判断本次优化收益。


## 内置文件面板 405 回归检测

Standard 的 Docker Web smoke 不再只检查首页 GET 可达：
实际启动镜像并经映射端口发送未登录的
`POST /api/workspaceFiles/list`（DSH 内置「文件」面板的目录加载接口）。
预期由已注册的 Connection API 路由返回 `401 unauthorized`；
`405` 表示请求落入 Web 静态资源兜底，镜像验收直接失败。
这不会伪造用户 Cookie，也不会访问或修改会话文件。

线上若仍在文件面板看到红色 `HTTP 405`，先比较：

```bash
# 服务器本机，经 DSH 宿主机映射端口（用部署实际端口替换 3080）
curl -i -X POST http://127.0.0.1:3080/api/workspaceFiles/list \
  -H 'content-type: application/json' -d '{}'

# 然后在域名反代入口执行同样的请求
curl -i -X POST https://你的DSH域名/api/workspaceFiles/list \
  -H 'content-type: application/json' -d '{}'
```

两条请求在未携带登录 Cookie 时都应返回 `401 unauthorized`。
本机 `401`、域名 `405` 时排查 Nginx/1Panel/OpenResty 对 `/api` 的代理路由、路径重写和域名路径前缀；
两边都 `405` 时确认部署的镜像确实更新、DSH Host 的 Connection `/api` 路由是否加载；
若浏览器的 Request URL 根本不是 `/api/workspaceFiles/list`（例如出现额外前缀），检查代理路径与 HTML base URL。
`403` 才主要排查原始 Host/Origin 与 DSH_TRUSTED_HOSTS。
