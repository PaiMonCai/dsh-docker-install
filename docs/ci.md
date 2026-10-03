# 镜像构建与自动更新

本文说明 Standard / Research 镜像在 GitHub Actions 中的构建、发布与上游 DSH 自动更新链路。

> 返回项目首页：[README](../README.md)

## 自动构建与更新（GitHub Actions）

- **`.github/workflows/build.yml`** — 构建并推送镜像到 GHCR
  （`ghcr.io/<owner>/<repo>`），amd64 + arm64 双架构。触发方式：镜像相关文件变更、
  手动触发、被更新检查调用。发布哪些 tag 见[镜像 tag 与上游发布通道](#镜像-tag-与上游发布通道)。
- **`.github/workflows/build-research.yml`** — 构建 Research Core 与 Economics Pack。
  PR 仅做 amd64 验证；合并到 `main` 后发布 amd64 + arm64：
  `:research`、`:research-<research版本>`、`:research-economics`、
  `:research-economics-<research版本>`。
- **`.github/workflows/check-update.yml`** — 每天检查 npm registry 上
  `@deepseek-ai/dsh` 的最新版本，发现新版本时自动修改
  `Dockerfile` / `docker-compose.yml` / `README.md` 中的版本号并提交，
  然后调用 build 工作流构建新镜像，并把**检测时刻**的 npm 通道名一并传入。
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

通道 tag 与 npm 的发布通道语义对齐：

```text
docker pull <image>:next    ≈    npm i @deepseek-ai/dsh@next
docker pull <image>:alpha   ≈    npm i @deepseek-ai/dsh@alpha
```

`:latest` 是这两类之外的第三个概念：上游只发预发布版，npm 的 `latest` dist-tag
常滞留在旧版本，而镜像 `:latest` 始终跟随最新一次构建。若上游 `latest` 恰好指向
本次构建的版本，它已经由 `:latest` 覆盖，不会重复打 tag。需要严格对齐上游某个
通道时，请显式使用 `:alpha` / `:next`。

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

只想补某个通道 tag 时，手动触发 build 工作流并填 `channel_tags`（如 `next`）即可；
该输入只影响附加 tag，不改变构建内容。

容器侧要固定跟随某个通道，把 `DSH_IMAGE` 指向对应 tag 即可
（新装可用环境变量传入，已有安装改 `config.env` 里的 `DSH_IMAGE` 后 `dshd update`；
`dshd edition` 会把镜像重置回该 edition 的默认 tag）。

## 说明

- 构建参数 `DSH_VERSION` 锁定 npm 包版本（当前版本见 Dockerfile 顶部；
  developer preview 可能有破坏性变更），check-update 工作流会自动维护
- 镜像包含 Chromium、Python、Go、Docker CLI 和编译工具，因此体积会明显大于最小化 Node 镜像
- 本方案的基础运行层（patch 绑定、入口分发、沙箱策略）已在
  Docker 26.1.4 / 内核 6.8 上实测通过
