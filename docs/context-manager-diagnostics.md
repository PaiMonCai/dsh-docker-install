# 原生上下文增强运行日志

日志随内置插件输出到 DSH 原生 logger，可从容器日志采集。每条包含固定前缀
`DSH_CONTEXT_EVENT ` 和一个 `dsh-context-log/v1` JSON 对象。默认记录启停、配置组合、
实际服务挂载、压缩提交和回退；真实模型效果留到后续环境测试，本轮不发起 Provider 请求。

## 开启调试与采集

Compose 的 `.env` 设置：

```dotenv
DSH_CONTEXT_MANAGER_LOG_LEVEL=debug
```

可选 `info`（默认）、`debug`、`warn`、`off`。日志级别按进程启动时读取；修改 Compose
环境变量后需要重建容器配置，例如 `docker compose up -d --force-recreate dsh`。
仅重启已有容器不会更新它的环境变量。该操作不修改增强开关、模型、会话格式或压缩策略。
直接 `docker run` 部署可用 `-e DSH_CONTEXT_MANAGER_LOG_LEVEL=debug`；其他管理方式需把
相同变量传入容器。debug 事件经普通 info 输出通道投递，不要求另外打开整个 DSH 的 debug。

```sh
docker logs --since 30m dsh 2>&1 | grep 'DSH_CONTEXT_EVENT ' > context-events.log
```

PowerShell 采集：

```powershell
docker logs --since 30m dsh 2>&1 | Select-String 'DSH_CONTEXT_EVENT ' | Set-Content context-events.log
```

`dsh` 替换为实际容器名。日志继续由容器/宿主机已有的轮转策略管理；插件不另建会话或
诊断文件库。每进程每 60 秒最多输出 240 条，超出后在下一条可输出记录的 `suppressed`
字段报告省略数量。存在省略或采集中断时，不能把日志当作完整的请求或计费账本。

## 事件含义

| 事件 | 级别 | 能确认什么 |
|---|---|---|
| `plugin.boot` | info | 本次启动读取的增强配置；不等于所有预设已挂载 |
| `preset.composed` | info | 预设配置是否替换、保留或因不兼容跳过 |
| `preset.observed` | info | Web 状态读取时观察到的挂载状态、待重启和跳过原因；相同状态不重复输出 |
| `engine.mounted` / `tools.mounted` | info | 原生压缩器/工具服务已经构造；实际会话执行另看后续事件 |
| `engine.trigger` / `engine.deferred` | debug | 压力/超窗路径，以及待提交 ACP 时仅延后压力分支 |
| `acp.proposed` | debug | 已排队的范围、层级、摘要字符数；尚未提交 |
| `acp.committed` | info | 原生事务和 ACP ACK 均通过持久化确认 |
| `acp.refused` | warn | 提交失败的分类原因，例如持久化、可见范围变化或取消 |
| `ccr.stored` | info | 原文已持久化并生成缩减候选，含前后字符数；不是模型账单或最终收包证明 |
| `ccr.skipped` / `ccr.failed` | debug / warn | 原样保留的分类原因，例如不适用、配额/写入拒绝、未落盘或完整性错误 |
| `tool.completed` / `tool.refused` | debug / warn | 已进入增强/只读工具执行器的调用、耗时与结果；执行前被原生权限拒绝的调用另查 DSH 工具日志 |
| `summary.started` / `summary.completed` | debug / info | 增强摘要生成与质量检查；最终持久提交另看原生事务 |
| `summary.fallback` / `summary.cancelled` | warn / info | 回退到原生摘要或在运行中取消；回退后的结果看原生事务结束事件 |
| `compaction.closed` | info | 原生事务结束及其成功标记；不替代 ACP ACK 确认 |
| `request.attempt` | debug | 原生请求尝试，可用于观察重试；不是一次已结算请求 |
| `request.usage` / `summary.usage` | debug | 原生事件提供的用量，未知计数保持 null，`known=false`；不计算实际费用或首 token 延迟 |
| `readers.mounted` | info | 停用后为已有记录安装同会话只读工具 |

## 关联与数据边界

`boot` 区分进程启动；`sessionHash`、`providerHash`、`modelHash`、`presetHash`、`callIdHash`
和 `compactionIdHash` 是标识的 SHA-256 前 16 位，仅供关联，不用于授权。`seq` 关联原生
事件序号，`blockId`、范围和字符数帮助定位压缩/回取；`historical=true` 标出继承事件或
停用后的读取，不能混入当前新请求的统计。固定 Kernel 版本与源码 SHA 随可读来源清单输出。

结构化载荷使用字段白名单，不输出消息、提示词、摘要正文、工具参数/结果、查询内容、
凭据、原始 Session/模型标识或原始异常文本。诊断日志自身失败不会改变提交、取消、
权限判断或原样保留的结果，也不会向 Session 追加诊断事件。

真实环境测试时，记录同一 `boot`/会话指纹下的挂载、提交、回退、CCR 和回取事件，并
结合 `acp_cache` 与 Provider 实际用量核对。日志用于解释发生了什么；质量、节费和生产
准入仍以同任务对照和实际运行结果分别验收。
