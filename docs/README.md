# 文档索引

[项目首页](../README.md) 提供定位、镜像选择和快速开始。详细操作与维护说明按用途组织。

## 安装与日常运维

| 文档 | 内容 |
|---|---|
| [部署与访问](deployment.md) | 安装、Compose、API/Base URL、Token、Trusted Hosts、反向代理、Plugin Hub、文件面板 405 |
| [Runtime 与运维](runtime.md) | 运行设计、文件沙箱、开发环境、Docker Socket、浏览器、环境变量、会话回收站 |
| [多实例部署与运维](multi-instance.md) | 命名实例、端口和数据隔离、实例选择与恢复 |
| [Web 实例管理](web-management.md) | 宿主机执行器、定时镜像检查、更新与回滚、SSE 运行日志、故障恢复 |
| [终端 → Web 运维迁移](web-management-migration.md) | 六分类 40 项菜单归属、双端操作契约、四批次迁移验收边界 |
| [Web 迁移第二批](web-management-phase2.md) | 受控 Edition / Pack 切换、Research Dashboard、只读配置和诊断 |
| [Web 迁移第三批](web-management-phase3.md) | 统一七页管理中心、侧栏导航、任务检索与危险操作确认 |
| [Web 迁移第四批](web-management-phase4.md) | 默认终端救援菜单、旧菜单兼容、卸载安全顺序与集成检查 |
| [安全升级与回滚](safe-upgrade-rollback.md) | 容器替换、失败恢复、回滚点、旧镜像清理与数据边界 |
| [国际网络出口 / sing-box](proxy.md) | 节点、订阅、环境变量代理、诊断与安全边界 |

## Web 功能与插件

| 文档 | 内容 |
|---|---|
| [自定义模型推理等级](reasoning-editor.md) | 原生表单兼容、Provider 批量编辑、字段映射及禁用方式 |
| [提示词与执行设置](prompt-manager.md) | 附加指令、工作区 `DSH_PROMPT.md`、会话审批/沙箱和工具禁用名单 |
| [Web Search](web-search.md) | 官方搜索 / SearXNG 切换、保存并应用、Brave 备用及预算 |
| [Icon Dock](icon-dock.md) | 快捷栏布局、排序/隐藏、原生导航与扩展接口 |
| [插件诊断](plugin-diagnostics.md) | 内置插件加载自检、认证 API 与 Chromium E2E |

## Research 与 Reverse

| 文档 | 内容 |
|---|---|
| [Research Edition](../research/README.md) | Research Engine、Economics Pack、Dashboard、数据/运行/结果协议及 RC Gate |
| [Research 原生适配器](../research/adapter/README.md) | Agent/工具接入、wrapper 与 smoke test |
| [Reverse Edition](reverse-edition.md) | 独立安装、原生 Agent、分析工具链、报告解读、提示词与工作台 |
| [报告解读集成](report-reader-integrations.md) | 外部 Skills/MCP 的来源、已集成范围与候选方案 |

## 开发与发布

| 文档 | 内容 |
|---|---|
| [项目结构与维护](project-layout.md) | 目录职责、配置来源、生成文件与按改动选择检查 |
| [内置 Web 插件接入规范](builtin-plugin-contract.md) | 原生 `--patch` 加载、插件开关、Icon Dock 契约与验收 |
| [Context Manager 上游优先原生化方案](context-manager-upstream-first-plan.md) | billion-context Kernel 复用路线、版本迁移、分阶段 PR、验收门禁与回滚 |
| [billion-context 内置原生插件](context-manager-native-plugin.md) | 设置页启停、重启应用、原生回退、历史回取与验收 |
| [Context Manager M0 审计](context-manager-m0-audit.md) | 固定来源、实际发布包/API 差异、旧日志回放与升级阻断结论 |
| [ACP 上游功能对照矩阵](context-manager-upstream-parity-matrix.md) | 模块 Reuse / Adapt / Do not port 决策和代码归属 |
| [推理等级插件实现说明](../docker/plugins/dsh-reasoning-editor/README.md) | 同一 `reasoningEfforts` 字段、批量保存与加载方式 |
| [镜像构建与自动更新](ci.md) | 开发版 / Git 标签发布、工作流依赖、上游更新与发布操作 |
| [发布流水线](release-pipeline.md) | OCI 合同、digest 固定、promotion、重跑与 reconciliation |
| [上游补丁兼容性](upstream-patch-compatibility.md) | 补丁清单、风险、校验和移除条件 |

镜像构建规则以工作流与 `ci/` 实现为准；默认配置以 Dockerfile、Compose、`docker/entrypoint.sh`
及 `dshd` 为准。文档描述功能与验证入口，不将历史 CI 通过记录当作当前提交的验收结果。
