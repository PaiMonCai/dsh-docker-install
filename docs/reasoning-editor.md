# 自定义模型推理等级

本文说明镜像内置的 DSH Reasoning Editor。它只负责补齐 Models 页面中自定义模型的
`reasoningEfforts` 声明能力；Composer 保持 DSH 官方原版交互。

> 返回项目首页：[README](../README.md)

## 作用

DSH Runtime 本身支持 `reasoningEfforts`，但当前自定义模型表单没有完整暴露这个字段。
镜像内置的轻量 Web 扩展通过官方 `settings.models.provider-card` slot 接入，并通过
`remote.settings.mutate()` 写回 `llm-pi-ai` 的正式配置：

```text
DSH 官方 Models 页面
        ↓ settings.models.provider-card
DSH Docker Reasoning Editor
        ↓ remote.settings.mutate()
llm-pi-ai / providers.<route>.models[*].reasoningEfforts
```

它只对 `llm-pi-ai` 管理的手工声明自定义 Provider 显示。

## 支持的配置

每个模型可以选择：

- **未声明**：删除该模型的 `reasoningEfforts`，继续采用 DSH catalog / 端点默认行为；
- **非推理模型**：写入 `reasoningEfforts: false`；
- **自定义等级**：通过离散档位控件声明
  `off / minimal / low / medium / high / xhigh / max`；
- **高级映射**：当网关使用不同拼写时，可显式映射，例如 `max → xhigh`。

例如：

```yaml
models:
  - id: my-reasoner
    reasoningEfforts:
      off:
      high: high
      max: xhigh
```

左侧 key 是 DSH 中展示的档位，右侧 value 是发给兼容 API 的真实值。非 `off` 档位留空时使用档位名本身。

> `off:` 留空表示不发送 `reasoning_effort`。如果某个 DeepSeek 兼容端点默认就会思考，
> 需要显式关闭时仍应按 DSH 官方约定设置 `compat.thinkingFormat: deepseek`。

## Composer

Composer 不再由本仓库替换或注入自定义滑块，保持 DSH 官方交互：

```text
模型        <当前模型> >
推理等级    <当前等级> >
```

当 Models 页面已经正确声明 `reasoningEfforts` 后，官方 Composer 会根据 DSH 自己的
ModelDirectory / Session 状态提供可用推理等级。这样运行时选择、键盘交互、焦点管理和后续
DSH UI 升级都继续由上游维护。

## 边界

该扩展不会：

- fork 或 patch DSH React 源码；
- 对 Composer 做 DOM 注入、MutationObserver 或菜单替换；
- 自动猜测模型能力或探测网关；
- 修改 API Key、Base URL、输入模态或 compat 配置；
- 建立 localStorage、IndexedDB、数据库或额外配置文件作为第二事实来源；
- 写入当前 `llm-pi-ai` schema 不支持的模型级 `defaultReasoningEffort`。

保存使用 DSH Settings 的 revision fence；发生并发修改时会重读并重试一次，并以当前
user-layer `models` 数组为基线保留其他字段。

## 生命周期

扩展作为镜像内本地 bundle 随版本发布。容器启动 Web profile 时仅通过现有
`dsh plugin` 生命周期幂等接入，不直接改写 `profiles/web/package.json`。

默认开启。需要完全移除这个 Models 页编辑器时：

```bash
dshd env set DSH_REASONING_EDITOR false
dshd recreate
```

关闭后由同一个 DSH Plugin Manager 从 Web profile 移除。
