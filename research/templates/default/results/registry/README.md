# Research Result Registry

V2 统一结果索引位于 `results/registry/*.yaml`。

不要把 Registry 当作替代模型/方法 manifest 的第二数据库。方法自己的详细输出仍保留在：

```text
results/models/*/model.json
results/comparisons/*/comparison.json
results/did/*/did.json
...
```

Registry 只统一记录：

```text
Result id / type / title
source manifest
run
input datasets / files
artifacts
provenance hash
derived status
```

状态由当前文件和 fingerprint 动态推导：

```text
current
stale
missing
invalid
```

常用命令：

```bash
research-result list
research-result show model-baseline
research-result verify
research-result sync
```

已有 Economics 结果可通过 `research-result sync` 导入；Research Economics Pack
在生成 model / comparison / DiD 结果后也会自动刷新 Registry。
