# 镜像构建与自动更新

本文说明 Standard / Research / Economics / Reverse 镜像在 GitHub Actions 中的构建、发布与上游 DSH 自动更新链路。

> 返回项目首页：[README](../README.md)

使用者选择更新源可直接阅读 [Web 镜像检查](web-management.md#镜像更新检查)；
维护者需要的 OCI 合同、promotion 和重试细节见 [发布流水线](release-pipeline.md)。

## 开发版与标签发布

镜像分为开发版和标签发布版。普通提交、合并及每日上游更新只发布开发版；
推送 `v<SemVer>` 格式的 Git 标签才发布版本镜像并更新正式浮动入口。
例如 `v1.2.3`、`v1.2.3-rc.1`。Git 发布版本与镜像内的上游 DSH 版本分别记录。
当前规则也接受预发布标签；符合版本顺序条件的 `v1.2.3-rc.1` 同样可以移动正式浮动入口，
并没有单独的 RC 镜像通道。标签不支持 `+build` 元数据，总长度最多 90 个字符。

| 操作 | Standard | Research / Economics / Reverse |
|---|---|---|
| 镜像相关改动推送或合并到 `main` | `:dev` | `:research-dev` / `:research-economics-dev` / `:reverse-dev` |
| 推送 `v1.2.3` | `:1.2.3` 与 `:latest` | `:research-1.2.3` 与 `:research`，其余 edition 同理 |
| 手动运行，ref 为 `main` | 开发版 | 开发版 |
| 手动重跑已有版本标签 | 校验并复用已发布版本 | 校验并复用已发布版本 |
| Pull Request | 构建验证，不推送 | 构建验证，不推送 |
| 每日上游 DSH 检查 | 更新开发版 | 开发版跟随相同 Standard digest |

每次成功的开发构建还会发布带来源的快照，例如
`:dev-<commit前12位>-<run_id>-<attempt>`，衍生版增加对应 edition 前缀。
已发布版本标签不可用不同内容覆盖；旧标签重跑可以补齐版本镜像，但不会将
`:latest` 或对应 edition 的正式浮动入口回退到较旧的项目版本。
若新项目版本与已有的旧式 DSH 版本镜像 tag 重名且合同不同，会拒绝覆盖，应选择新的项目发布版本。

当前 `:latest`、`:research`、`:research-economics`、`:reverse` 是标签发布入口，
不会随普通 `main` 构建移动。历史 npm 通道镜像别名 `:alpha`、`:next` 等不再自动更新，
需要持续跟进开发时使用 `:dev` 或对应 edition 的 `-dev` 镜像。
`channel_tags` 仍作为上游 npm 通道元数据保存在镜像中，不再决定公开镜像 tag。

## 工作流与依赖

- **`.github/workflows/build.yml`**：处理 `main` 镜像相关改动和 `v*` 标签，先运行源码检查、amd64 Docker / Web / Chromium 审计，再构建 amd64 + arm64 候选镜像，最后提升到当前发布通道。
- **`.github/workflows/build-research.yml`**：独立构建 Research Core 与 Economics Pack。Standard 发布后传入精确 digest、上游 DSH 版本、来源 commit 和通道元数据。仅 Research 改动可以单独构建开发版；混合提交等待 Standard。
- **`.github/workflows/build-reverse.yml`**：采用相同依赖方式，发布前验证继承插件、运行时和真实浏览器。只有 Standard 监听 Git 标签；它使用同一个 Git 标签 dispatch 衍生工作流，确保工作流定义、代码和正式版基础镜像来自同一次发布。
- **`.github/workflows/promote-release.yml`**：串行校验并移动公开镜像 tag。开发候选需匹配当前 `main`；标签候选需匹配远端 Git 标签与已发布的同标签 Standard 合同。
- **`.github/workflows/check-update.yml`**：每天或手动在 `main` 检查 npm 上游，验证并发布开发版成功后才提交 DSH 版本更新。即使上游版本不变，也会修复缺失的开发镜像，并重试缺失的开发衍生版。它不会创建 Git 发布标签或更新正式版镜像。

Standard 发布完成后即可结束自己的运行，无需等待 Research / Reverse；衍生版失败
不会回滚 Standard。开发版 dispatch 失败会由每日 reconciliation 重试；标签发布
失败可在原标签运行中重跑失败的构建或 dispatch job，已发布版本会被校验并复用。

## 发布操作

先将需要发布的代码提交并推送，然后在该 commit 创建版本标签。例如：

```bash
git tag -a v1.2.3 -m "Release 1.2.3"
git push origin v1.2.3
```

版本号是本项目的发布版本，镜像内 DSH 包版本仍由该标签中的 `Dockerfile`
`DSH_VERSION` 决定。同一个 DSH 版本可以包含多个项目发布版本，用于发布插件和补丁。
正式发布不要求标签 commit 始终等于最新 `main`，后续开发提交不会改变该发布内容。

使用前确认仓库 **Settings → Actions → General → Workflow permissions** 具有所需的
写权限。GHCR 包设为 Public 后可免登录拉取。机器人提交不会递归触发普通 push
工作流，因此每日更新使用显式 `workflow_call`，并仅提升开发版。

容器侧按 `DSH_IMAGE` 的镜像 tag 跟进更新：默认安装继续使用正式浮动入口；
希望跟随开发进展时显式设置 `DSH_IMAGE=<image>:dev`，Research / Reverse 使用对应
`-dev` tag。已有安装修改实例 `config.env` 后执行 `dshd update`；`dshd edition`
会重置回该 edition 的默认正式 tag。

## 三条更新链路

| 链路 | 检测对象 | 生效方式 |
|---|---|---|
| 上游 DSH 自动检查（Actions） | npm 上游版本及开发镜像合同 | 验证后发布开发镜像，再提交版本记录；不创建发布标签 |
| 已部署实例自动检查（宿主机） | 当前 `DSH_IMAGE` 对应平台的远端 config digest 与运行镜像 ID | 默认每 6 小时检查；只显示结果，管理员确认后安装 |
| `dshd` 脚本自更新 | 项目 Raw 源中的管理脚本 | 运行命令时检查并更新脚本，不自动安装容器镜像 |

默认 `latest` 部署只跟进 Git 标签发布的镜像内容。改用 `dev` 才跟进普通开发构建。
宿主机检查比较内容差异，不判断远端 DSH 版本是否更高；镜像更新与回滚也不等于恢复持久化数据。
关闭管理脚本自更新使用 `DSHD_NO_SELF_UPDATE=1`，详见 [部署说明](deployment.md#dshd-自动更新)。

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
