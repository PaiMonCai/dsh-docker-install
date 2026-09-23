# 自定义模型推理等级与 Composer Slider

本文说明镜像内置的 DSH Reasoning Editor。它同时覆盖：

- Models 页面里的 `reasoningEfforts` 能力声明；
- Composer 里的当前 Session 推理等级滑块。

> 返回项目首页：[README](../README.md)

## 自定义模型推理等级

镜像内置一个很薄的 DSH Web 扩展，用于补齐官方「自定义模型 API」目前没有暴露的
`reasoningEfforts` 编辑能力。它不 fork DSH，也不维护第二套模型配置：

```text
DSH 官方 Models 页面
        ↓ official settings.models.provider-card slot
DSH Docker Reasoning Editor
        ↓ remote.settings.mutate()
llm-pi-ai / providers.<route>.models[*].reasoningEfforts
```

只对 `llm-pi-ai` 管理的**手工声明自定义 Provider**显示。每个模型可以选择：

- **未声明**：删除该模型的 `reasoningEfforts`，继续采用 DSH catalog / 端点默认行为；
- **非推理模型**：写入 `reasoningEfforts: false`；
- **自定义等级**：使用类似 `dsh-better-reasoning-effort` 的离散滑轨，
  点击 `off / minimal / low / medium / high / xhigh / max` 节点声明模型支持的档位。
  高级映射默认折叠，仅在网关需要不同拼写时展开，例如 `max → xhigh`。

例如把 DSH 的 `max` 映射为网关的 `xhigh`，最终仍写回 DSH 官方配置：

```yaml
models:
  - id: my-reasoner
    reasoningEfforts:
      off:
      high: high
      max: xhigh
```

Models 页滑轨只负责声明该自定义模型可用的 `reasoningEfforts`。Composer 里则额外提供
一个类似 `dsh-better-reasoning-effort` 的运行时滑块：打开右下角「模型 · 推理等级」菜单时，
原来的「模型 / 推理等级」两级根菜单会显示为渐变推理滑块 + 一行「模型名 · 当前等级 ›」。
拖动后直接通过 DSH 当前 Session 的 `ModelDirectory.select()` 提交，所以 /model、官方 Composer
选择器和滑块看到的是同一份会话状态。若该模型没有声明默认推理档位，滑块会保留一个
**Default** 位置；选中它时只提交 `{ provider, model }`，不带 `reasoningEffort`，语义与官方
「Provider default」完全一致。

DSH 当前没有公开 Composer 根菜单的 replacement slot，因此只有**视觉挂载这一层**使用受约束的
DOM 适配：通过 `data-composer-card`、`aria-controls` 和 `role=menu` 找到官方菜单，
再用 `MutationObserver` 跟随 React 重渲染。它不会直接调用 Session HTTP API，也不使用
localStorage / IndexedDB 记忆第二份状态；模型目录、当前选择和提交仍全部由 DSH 官方
`modelDirectories` 服务负责。若上游以后提供 Composer slot，应优先迁移到官方 slot 并删除这层 DOM 适配。

DSH 当前 `llm-pi-ai` 的模型配置 schema 不接受模型级 `defaultReasoningEffort`，因此内置编辑器
不会写入这个字段。编辑器也不会自动猜测模型能力、不会探测网关、不会修改 API Key / Base URL /
输入模态 / compat 配置。Models 页保存仍使用 DSH Settings 的 revision fence；发生并发修改时会重读
并重试一次，且始终以当前 user-layer `models` 数组为基线保留其他字段。

> `off:` 留空表示不发送 `reasoning_effort`。如果某个 DeepSeek 兼容端点默认就会思考，
> 需要显式关闭时仍应按 DSH 官方约定设置 `compat.thinkingFormat: deepseek`。

该扩展作为镜像内本地 bundle 随版本发布，容器启动 Web profile 时仅通过现有
`dsh plugin` 生命周期幂等接入，不直接改写 `profiles/web/package.json`。默认开启；
设置 `DSH_REASONING_EDITOR=false` 后会通过同一个 Plugin Manager 从 Web profile 移除。
使用 `dshd` 管理部署时可执行 `dshd env set DSH_REASONING_EDITOR false`，随后按提示重建容器。
