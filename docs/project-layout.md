# 项目结构与维护

本仓库按运行层组织文件。首页保留安装与功能入口，操作细节放在 `docs/`，
Research 与 Reverse 的实现、模板和专用测试放在各自目录。

> 返回 [文档索引](README.md) / [项目首页](../README.md)

## 目录职责

| 路径 | 职责与入口 |
|---|---|
| [Dockerfile](../Dockerfile) | Standard 运行环境、固定上游版本、构建期兼容补丁和公共插件打包 |
| [install.sh](../install.sh) / [dshd](../dshd) | 安装引导与宿主机管理：实例、配置、更新、备份、代理和 Web 后台 |
| [docker-compose.yml](../docker-compose.yml) / [.env.example](../.env.example) | 本地 Standard 构建与部署示例；Reverse 使用 [独立 Compose](../docker-compose.reverse.yml) |
| [docker/entrypoint.sh](../docker/entrypoint.sh) | 运行时初始化、Token、具体网卡绑定、原生补丁层和 profile 启动 |
| `docker/plugins/` | 公共 Web 插件；由 Standard 打包，Research 与 Reverse 继承 |
| `docker/patch-*.js` | 针对已知上游布局的兼容适配；清单在 [ci/upstream-patches.json](../ci/upstream-patches.json) |
| [docker/dsh-web-manager.py](../docker/dsh-web-manager.py) | 安装到宿主机的实例执行器，含镜像检查、任务与运行日志采集 |
| `ci/` | 镜像合同、registry 校验、发布通道、路径分类、衍生版门禁 |
| `.github/workflows/` | Standard/衍生版构建、promotion、上游更新和专项回归 |
| `tests/` | Standard、`dshd`、公共插件及发布逻辑回归；真实浏览器测试也在这里 |
| `research/` | Research Dockerfile、Python 引擎、CLI、原生适配器、模板、Economics Pack 和专用测试 |
| `reverse/` | Reverse Dockerfile、原生预设、分析 CLI、报告解读、提示词/工作台、Skills 和专用测试 |
| `docs/` | 面向使用者及维护者的专题文档；完整入口见 [索引](README.md) |

`docker/plugins/dsh-session-manager/` 中的脚本仍被镜像打包，用于历史删除队列兼容；
当前会话管理使用 `dsh-session-manager-web`。不要仅凭名称相似删除兼容脚本。
Reverse 的 `prompt-manager` 负责其专用预设与工作台，Standard 公共的 `dsh-prompt-manager`
负责附加指令与执行设置，两者职责见 [提示词与执行设置](prompt-manager.md)。

## 配置与状态来源

- 项目发布版本：`v<SemVer>` Git 标签；发布规则见 [CI 指南](ci.md)。
- 上游 DSH 版本：[Dockerfile](../Dockerfile) 的 `DSH_VERSION`，自动更新同时维护 Compose；Research 引擎版本独立记录于 [research/VERSION](../research/VERSION)。
- `dshd` 实例配置：默认 `/etc/dshd/config.env`，非 root 为 `~/.config/dshd/config.env`；命名实例见 [多实例指南](multi-instance.md)。
- DSH profile、会话和模型配置：持久化的 `DSH_HOME`，由 DSH 原生接口管理。推理等级编辑器使用同一份模型配置。
- 公共插件开关：入口脚本决定是否添加补丁，修改容器环境后重建；各开关与默认值见 [Runtime 环境变量](runtime.md#环境变量)。
- 附加指令与工具拒绝配置：`$DSH_HOME/dsh-docker/prompt-manager/state.json`；宿主机更新任务和检查结果使用独立管理目录，见 [Web 管理](web-management.md)。

实例的持久状态不应移动到源码目录。`workspace/`、`.env`、本地 `node_modules/`、
`.venv/` 和 Python 缓存由 Git 忽略；本地依赖与缓存也由 `.dockerignore` 排除。
模板中的示例数据、Skill 文档与源码是发布输入，不属于缓存。
脚本、YAML 和 Markdown 统一使用 LF，避免 Windows 签出时改变镜像中的 Skill 文档格式。

## 修改与检查

先按改动涉及的层选择检查。以下命令在仓库根目录运行，完整镜像和浏览器验收由对应工作流执行。

| 改动 | 相关检查 |
|---|---|
| 发布通道与 OCI 合同 | `node --test tests/test-release-contract.mjs`、`node tests/test-release-workflows.mjs` |
| 衍生版触发路径 | `bash tests/test-research-release-gate.sh`、`bash tests/test-reverse-release-gate.sh` |
| 公共插件加载 | `bash tests/test-native-web-plugins.sh`、`node --test tests/test-plugin-doctor.cjs` |
| 推理等级编辑 | `bash tests/test-reasoning-editor.sh` |
| 提示词与执行设置 | `node --test tests/test-prompt-manager.mjs tests/test-prompt-manager-ui.cjs` |
| 宿主机后台与实例界面 | `python -B tests/test-web-manager.py`、`node --test tests/test-instance-manager.mjs tests/test-instance-manager-ui.cjs` |
| 上游兼容补丁 | `node --test tests/test-upstream-patches.cjs tests/test-remote-settings-patch.cjs`，并运行被修改补丁自己的回归 |
| Research | [Research RC Gate](../research/README.md) 与 `research/tests/` |
| Reverse | [Reverse 验证说明](reverse-edition.md) 与 `reverse/tests/`、各组件的 `*.test.mjs` |

发布包集成测试、Linux 权限、Docker 多架构、真实 Web/Chromium 检查有各自运行依赖。
例如提示词集成测试需设置 `DSH_PROMPT_RUNTIME_ROOT`，见 [验证范围](prompt-manager.md#验证范围)。
Windows 上通过 Node 检查不代表 Linux 权限或容器行为已验证，应记录实际执行范围与跳过项。

Reverse Web 客户端的可编辑片段在 `reverse/prompt-manager/web/src/`。
修改后运行 `node reverse/prompt-manager/web/build-client.mjs` 更新生成的 `client.js`，
再运行 `node --test reverse/prompt-manager/web/build-client.test.mjs` 检查生成结果。

## 同步文档与发布

新增 Web 功能时同步专题文档、环境变量说明和 [文档索引](README.md)；
新增兼容补丁时同步补丁清单和 [兼容性文档](upstream-patch-compatibility.md)。
变更 Standard 构建输入时同时核对 [路径分类](../ci/release-paths.json) 与工作流过滤规则，
衍生版需要据此选择等待新基础镜像还是独立构建。

普通 `main` 推送只更新开发版；正式发布需要创建新的 Git 版本标签。
本地检查通过、远端 CI 通过、镜像已推送和已部署是不同状态，发布说明应分别确认。
