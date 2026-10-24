# Kernel 0.0.160 原生升级与长任务对照

本轮将内置插件的固定 Kernel 从 `0.0.147` 升到 `0.0.160`，并提供可重复的
原生 Basic／内置增强／外部 billion-context 三组对照材料。代码、CI、真实 Provider
效果和生产启用分别记账；本轮不会使用现有实例密钥发起模型请求。

## 来源与审查

| 项目 | 固定内容 |
|---|---|
| 旧运行包 | `0.0.147-dsh.bc4a3f87.1`，来源 `bc4a3f87e2dc98e82df6f707d362e75492fdf3d1` |
| 新运行包 | `0.0.160-dsh.a2d8cb9b.1`，来源 `a2d8cb9b2e5060978d130b9cebc3e41b1506a0db` |
| 可重复来源 | `ci/acp-kernel-audit/native-snapshot.json`：Git tree、包/锁文件/许可证校验和、旧包完整性及冻结样本 |
| 历史 M0 | `snapshot.json` 与 `evidence.json` 保持原来的 `0.0.101 → 0.0.147` 评估含义 |
| 构建补丁 | 仅保留类型自引用解析和确定的 tsup 入口顺序，不改上游运行算法 |

已核验新来源的 229 个 Git blob。相对旧包，实际 ESM 导出、导出路径、Core 方法、
默认配置和初始状态结构没有增删或变化；12 项声明发生变化，完整前后文本由构建脚本
输出到 `node_modules/.cache/native-output/api-diff.json`。两份完整许可证内容与旧来源相同。
这里的 `0.0.160` 是固定源码构建版本，不据此声明 npm 发布状态或自动追随上游 HEAD。

审查结果：

- 压缩参数解析修复：支持顶层边界搭配 `content` 摘要；支持额外的范围分隔符；
  未识别的双引用分隔符拒绝处理，不能静默缩成第一条消息。
- 工具声明优先向模型展示单个 `content` 字符串形式，解析器继续兼容旧形式。
  DSH 的开放参数对象保留该兼容性；真实 ToolRuntime 检查新增 `--builtin --canonical`。
- 上游失败压缩记录和较旧压缩交换的保护规则随 Kernel 更新，但 DSH 仍保留其原生
  范围、工具配对、未闭合 step、媒体及多工具消息保护。不能把某条上游规则的存在
  等同于所有 DSH 工具别名和消息组合均自动获得同样行为。
- 上游 wire 适配随原始分发包保留，DSH 适配器继续使用原生 Agent、ToolRuntime、
  CompactionEngine 和 Session；不启用代理、fetch patch 或另一个持久化事实源。

## 回放与验证

升级前用实际 `0.0.147` 运行依赖生成并冻结新的合成日志。原有 `0.0.101` 样本和旧包
都保留：旧包仅用于升级差异基线，插件运行依赖只指向新包。

`build-native.mjs` 对两份冻结样本校验 SHA-256，验证冷回放、原文分页、CCR、缺失 ACK、
未完成事务拒绝和分叉隔离，再执行 T1/T2/T3 桥接、两次逐字节一致构建、API 对比与
完整上游测试。Standard 镜像也独立消费两份日志，使用实际安装的 DSH Session 回放。

```sh
npm ci --ignore-scripts --no-audit --no-fund --prefix ci/acp-kernel-audit
npm ci --ignore-scripts --no-audit --no-fund --prefix docker/plugins/dsh-context-manager
node ci/acp-kernel-audit/build-native.mjs --check
node --test tests/test-context-manager-upstream.mjs tests/test-context-manager-comparison.mjs
```

2026-10-23 本地结果：上游测试 1,460/1,460，无跳过；独立重建与已提交 tarball 字节一致；
原生回归、启停/UI 和对照报告测试共 47/47；指定候选的历史审计测试 7/7。
发布及插件继承契约另行通过。本地没有 Docker 运行时，真实镜像及 Linux 原生运行链
以本提交的 Actions 最终结果为准，不用本地检查替代。

## 可重复长任务材料

在源码根目录运行，目标目录必须不存在：

```sh
node ci/context-manager-comparison.mjs prepare D:/my-project/context-comparison-0160
```

输出包括带缺陷的代码、固定规格与测试、12,000 条合成记录的八份数据、十轮任务步骤、
校验清单和 `results.json` 模板。不要把答案清单 `workload.json` 放入模型可读工作区。
每次从原始文件复制独立工作区，整个实验共 12 个独立会话：

| 维度 | 固定安排 |
|---|---|
| 任务 | 代码维护、大结果阅读 |
| 对照组 | DSH 原生 Basic、内置增强、外部 billion-context |
| 重复 | 每任务每组两次，第二轮反转组顺序 |
| 条件 | 相同不可变镜像 digest、Provider、准确模型、模型参数、权限和输入文件 |
| 版本 | 外部 billion-context 单独固定版本，不能与内置增强叠加 |

操作人先填 Provider、模型、外部版本和费用/时长上限，再执行 `TASKS.md` 的步骤。
上限由操作人执行；准备与报告工具不发起请求，也不承诺自动中止收费会话。
记录所有请求，包括重试和摘要调用；会话标识只记录本地 SHA-256。

```sh
node ci/context-manager-comparison.mjs report D:/my-project/context-comparison-0160
```

报告验证组数、独立会话、统一条件、原始材料校验和及外部版本，再复用原生 usage
标准化模块。缺失缓存计数、未观测请求和费用保持未知。大结果答案按确定性源数据
核对；代码任务按未修改的固定测试与人工补丁审查记录，不能用模型自称成功代替。
任务失败或质量不通过时，不输出节省比例。时长是完整任务耗时，不是首 token 延迟。
两次重复仅提供可复查样本，不构成普遍性能结论；报告始终不授予生产准入。

当前已完成材料与报告器，真实 Provider 对照尚未执行。按本轮要求，先补齐
[结构化运行日志](context-manager-diagnostics.md)，后续在真实环境中测试。日志相关的
本地针对性检查合计 53/53；完整升级、日志与镜像 CI 以最新提交的最终结果另行记录。
