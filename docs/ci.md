# 镜像构建与自动更新

本文说明 Standard / Research 镜像在 GitHub Actions 中的构建、发布与上游 DSH 自动更新链路。

> 返回项目首页：[README](../README.md)

## 自动构建与更新（GitHub Actions）

- **`.github/workflows/build.yml`** — 构建并推送镜像到 GHCR
  （`ghcr.io/<owner>/<repo>`），打 `:latest` 和 `:<dsh版本>` 双标签，
  amd64 + arm64 双架构。触发方式：镜像相关文件变更、手动触发、被更新检查调用。
- **`.github/workflows/build-research.yml`** — 构建 Research Core 与 Economics Pack。
  PR 仅做 amd64 验证；合并到 `main` 后发布 amd64 + arm64：
  `:research`、`:research-<research版本>`、`:research-economics`、
  `:research-economics-<research版本>`。
- **`.github/workflows/check-update.yml`** — 每天检查 npm registry 上
  `@deepseek-ai/dsh` 的最新版本，发现新版本时自动修改
  `Dockerfile` / `docker-compose.yml` / `README.md` 中的版本号并提交，
  然后调用 build 工作流构建新镜像。也可在 Actions 页面手动触发。

使用前确认仓库 **Settings → Actions → General → Workflow permissions** 选择
"Read and write permissions"（更新检查需要提交代码的权限）。GHCR 首次推送后
在 Packages 页面把包设为 Public 即可免登录拉取。

注意：用 `GITHUB_TOKEN` 提交的 push 不会触发其他工作流（GitHub 防递归限制），
所以更新后的构建是通过 `workflow_call` 显式调用的，不依赖 push 事件。

## 说明

- 构建参数 `DSH_VERSION` 锁定 npm 包版本（当前版本见 Dockerfile 顶部；
  developer preview 可能有破坏性变更），check-update 工作流会自动维护
- 镜像包含 Chromium、Python、Go、Docker CLI 和编译工具，因此体积会明显大于最小化 Node 镜像
- 本方案的基础运行层（patch 绑定、入口分发、沙箱策略）已在
  Docker 26.1.4 / 内核 6.8 上实测通过
