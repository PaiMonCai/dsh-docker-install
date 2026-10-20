# Web 管理迁移 · 第二批：受控版本、Dashboard 与诊断

> 实施分支：`feat/web-management-phase2-operations`（叠加在第一批 PR 分支上）。功能需在专项 CI 与真实临时容器中验证通过后才能发布。

## 本批具体交付

| Web 入口 | 已接入功能 | 宿主机操作 | 参数范围 |
|---|---|---|---|
| 运行与更新 → Edition / Research Pack | Standard、Research Core、Economics | `dshd web-switch standard / research / research-economics` | 仅这三个枚举；不允许自定义镜像 |
| 国际网络 → Research Dashboard | 运行状态、启停 Sidecar | `dshd dashboard start / stop` | 当前实例、默认工作区；不允许 Web 指定项目/路径 |
| 配置与诊断 → 配置摘要 | Edition / Research Pack / 存储模式 / API 模式与 Key 是否配置 / Docker Socket 权限摘要 | `dshd web describe` | 只读非敏感字段，禁止读取 Key 明文 |
| 配置与诊断 → 诊断 | 开发环境、存储摘要、插件自检 | `dshd env` / `storage show` / `doctor plugins --json` | 固定命令，无参数、Shell 或任意路径 |

新增 9 种固定 Web 操作，总操作数由 16 种扩展为 25 种。完整操作表见 [`docker/management-operations.json`](../docker/management-operations.json)。

## 安全与恢复边界

- 所有写操作均经 DSH Web 认证、Node 请求检查、宿主机 Python 固定白名单和 `dshd` 每实例锁。CLI 和 Web 使用相同的底层运维函数，Web 不提供任意进程调用。
- 版本切换必须先拉取目标镜像，再使用 `DSHD_SAFE_UPGRADE=1` 替换当前实例并健康检查。镜像拉取失败时**不保存新配置**；容器替换失败时由 `create_container` 的旧容器恢复逻辑处理；保存配置失败后尝试恢复旧容器。与原 `dshd edition` 交互流程不同，本批 Web 专属路径不“先落盘再拉镜像”。
- 默认更新成功后的回滚点清理由当前 `dshd` 规则决定，原持久化数据不会被版本回滚恢复。多版本的数据结构可能不兼容，应在重大更新前另行备份。
- Reverse 必须使用独立实例安装，Web 不能从 Standard/Research 覆盖 Reverse；新 Web 入口不会接受用户提供的镜像 URL、容器名称和实例 ID。
- Dashboard 只用于 Research、以宿主机回环地址监听；开启/停止需确认，不接受用户自定义项目路径。运行状态来自绑定实例 `name + "-dashboard"` 的状态读取。
- 诊断输出以有界任务日志展示，经过宿主机脱敏。存储诊断可能展示宿主机当前目录位置，仅供可信管理员，不适用于普通多租户用户。
- 为解决老版本兼容问题：第一批操作对没有 `management` 能力字段的旧宿主机继续运行；**本批新增 9 种操作需要明确的宿主机能力声明**，没有声明或 schema 不匹配一律禁用/拒绝。
- 脚本交互菜单和原本的 CLI 命令继续保留，停机、Web 故障、救援不依赖容器内 Web。

## 暂未迁移的高风险内容

原始 `config.env`、API Key 写入、Trusted Hosts 变更、Whale Widget 远程写权限、Docker Socket 提权、自定义挂载和持久化数据恢复**均未接入**。这些操作必须先设计专用的权限模型、参数校验、恢复策略与审计，不允许通过通用 `dshd config` 或 Shell API 放行。

跨实例汇总与新建实例也留在下一轮独立授权设计；本批所有操作仅限后台绑定的一个实例。

## 验收命令

```bash
bash -n dshd
bash tests/test-dshd-web-management.sh
bash tests/test-dshd-web-switch.sh
python3 tests/test-web-manager.py
node --check docker/plugins/dsh-instance-manager/client.js
node --test tests/test-management-operations.mjs tests/test-instance-manager.mjs tests/test-instance-manager-ui.cjs
```

专项工作流还要覆盖真实 Docker 临时实例的重启、升级和恢复。**当前没有增加真实 Docker 的跨 Edition 升级验收**，在实际生产系统切换前需单独做 Research/Core/Economics 的镜像和数据兼容测试。
