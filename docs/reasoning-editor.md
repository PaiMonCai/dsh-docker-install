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

## 批量配置（v1.1）

对于一个 Provider 内有大量自定义模型的情况，现在不需要逐个编辑：

1. 打开 Models 页面中该自定义 Provider 的 **推理等级 → 配置**。
2. 使用 **全选全部**、**选择筛选结果** 或逐行复选框确定目标模型。
3. 在 **批量设置** 中选择 **未声明 / 非推理模型 / 自定义推理等级**。
4. 对自定义等级勾选需要展示的档位；如果网关使用特殊值，可以开启 **高级映射**。
5. 点击 **应用到已选模型**，此时只改变浏览器里的草稿，尚未写入持久设置。
6. 检查逐行配置，需要时微调，再点击 **保存 N 个模型的修改** 一次提交。

**撤销未保存修改** 可以恢复当前打开页面时读取的原始配置。保存只写入实际修改过的模型的 `reasoningEfforts`；其他模型字段、未选中的模型、同 Provider 内其他配置均保持原状。

遇到其他页面同时改变了目标模型推理设置，会明确拒绝覆盖并要求重新读取。仍遵循 DSH 官方 `remote.settings.mutate()` revision 检查；不引入新的持久化源。批量功能仅作用于当前自定义 Provider，不跨 Provider 自动更改。

## Web 展开状态稳定性（v1.2）

此前某些 DSH Web 的模型设置卡片在刷新 Settings 或重新挂载插槽时，会把插件组件本地的展开开关重置为关闭；若上游传入新的 `remote.settings` 包装对象，还可能触发额外读取，覆盖未保存的编辑内容。

现在编辑器以 **Provider 身份与配置路径** 区分卡片，并在**当前 Web 页面内存中**暂存已展开卡片的 UI 状态与未保存草稿：

- 父组件重新挂载同一 Provider 的卡片：继续保持展开，同时恢复待保存草稿、筛选条件和批量选择。
- 同一个 Provider 的远端 Settings 客户端对象更换：不再无条件重新请求并清空草稿。
- 手动点击「收起」：立即关闭并清除对应内存草稿缓存；再次打开按官方 Settings 重新读取。
- 切换到其他 Provider：以独立 Key 隔离草稿，禁止写入另一个 Provider。
- 整页刷新、退出 Web 或更换浏览器：不会保留未保存草稿；已保存设置仍由 DSH 官方 `remote.settings.mutate()` 管理。

内存缓存最多保留 16 个卡片快照，**不使用 localStorage、IndexedDB、额外服务端状态文件**，不持久化 API Key。写入时仍检查官方 revision 和当前目标模型的 `reasoningEfforts`；若有其他标签页同时修改相同模型，则拒绝覆盖。

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
