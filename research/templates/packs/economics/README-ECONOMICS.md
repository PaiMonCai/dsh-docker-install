# Economics Research Pack

这个项目由 DSH Research 的 Economics 模板初始化。

建议先填写 `research.yaml` 中的 economics 区域，至少明确：

- population / unit_of_observation / sample_period
- outcome / treatment_or_exposure
- estimand
- identification_strategy
- fixed_effects
- standard_errors / clustering_level
- robustness_plan

环境额外提供：

- `pyfixest`：高维固定效应、聚类标准误等常见经验研究工作流
- `linearmodels`：IV / panel / system models
- `arch`：波动率与金融时间序列
- `wbgapi`：World Bank API
- `pandas-datareader`：常见经济金融数据接口

基础脚手架位于 `src/econometrics.py`。其中公式只是示例，不应在没有研究设计依据时直接作为论文模型。

## 可追溯宏观/金融数据快照

World Bank：

```bash
research-econ-data worldbank NY.GDP.MKTP.CD --economy CHN,USA --start 2000 --end 2025
```

FRED：

```bash
research-econ-data fred FEDFUNDS --start 2000-01-01
```

每次下载都会创建新的不可覆盖快照：

```text
data/raw/external/<provider>/<series>/<UTC timestamp>/
├── data.csv
└── metadata.json
```

`metadata.json` 记录 provider、series/indicator、查询范围、访问时间和数据文件 SHA256。
可以使用：

```bash
research-econ-data list
research-econ-data verify
```

注意：FRED 这里记录的是“检索时间”，不是 ALFRED 的历史实时 vintage。若研究依赖当时可获得的信息集，需要单独使用真正的 vintage 数据源。

## 回归 → 表格 → 图 → 论文

正式线性/固定效应模型可以通过 `research-econ-model` 登记。输入必须来自
`data/processed/`，并且必须显式声明方差估计方式：

```bash
research-run --name baseline -- \
  research-econ-model feols \
  --name baseline \
  --title "基准回归" \
  --data data/processed/analysis.csv \
  --formula "y ~ treatment + x1 | entity_id + year" \
  --vcov cluster \
  --cluster entity_id \
  --focus treatment
```

一次成功运行会生成：

```text
results/
├── models/baseline/model.json
├── tables/baseline.csv
├── tables/baseline.md
└── figures/baseline.png

paper/generated/economics-results.qmd
```

`model.json` 记录公式、显式 vcov、分析数据 SHA256、输入行数、系数和输出文件 SHA256。
论文模板会自动 include `paper/generated/economics-results.qmd`，所以模型登记后不需要复制粘贴回归表。

Quarto 交叉引用：

```text
@tbl-econ-baseline
@fig-econ-baseline
```

校验和重建：

```bash
research-econ-model list

# 把多个已登记模型并成一张论文回归表：
research-econ-model compare \
  --name main \
  --title "主回归结果" \
  --model baseline \
  --model controls \
  --term treatment

research-econ-model render
research-econ-model verify
```

`compare` 不会重新估计模型，而是读取各模型 manifest；如果任一底层模型后来被重新估计，
comparison manifest 的模型 SHA256 会失效，`verify` 会要求重新生成比较表。

生成的并列表可以在 Quarto 中引用：

```text
@tbl-econ-compare-main
```

如果分析数据、表格、系数图或比较表在登记后被手动改动，`verify` 会报 SHA256 不一致。

## DiD / Event Study Pipeline

先检查面板和 treatment timing：

```bash
research-econ-did check \
  --name policy-check \
  --data data/processed/panel.csv \
  --outcome y \
  --id firm_id \
  --time year \
  --cohort first_treated_year \
  --treatment treated \
  --never-treated 0
```

正式估计建议继续通过 `research-run`：

```bash
research-run --name did-saturated -- \
  research-econ-did estimate \
  --name did-saturated \
  --title "政策动态效应" \
  --data data/processed/panel.csv \
  --outcome y \
  --id firm_id \
  --time year \
  --cohort first_treated_year \
  --treatment treated \
  --never-treated 0 \
  --cluster firm_id \
  --estimator saturated \
  --mode dynamic
```

当前支持：

```text
twfe       传统双向固定效应基准
did2s      Gardner DID2S
saturated  cohort-interacted / Sun-Abraham-style event study
lpdid      Local-projection DiD
```

每个设计会保存：

```text
results/did/<name>/
├── did.json
├── diagnostics.json
├── cohorts.csv
├── estimates.csv
├── panel.png
└── event-study.png
```

并自动更新：

```text
paper/generated/did-results.qmd
```

Quarto 交叉引用：

```text
@tbl-did-<name>
@fig-did-<name>-panel
@fig-did-<name>-event
```

`research-econ-did check` 会检查重复 unit-time、cohort 是否在 unit 内恒定、一次性处理是否出现 1→0，
以及显式 treatment 与 cohort 隐含 treatment path 是否一致。

对于 staggered adoption，TWFE 只作为基准。若 treatment effects 可能随 cohort 或 event time 异质，
应同时考虑 DID2S、saturated 等估计器，而不是只报告 TWFE。

`research-econ-did verify` 会校验输入数据与输出 hash，并要求
`research.yaml` 中填写 treatment timing、comparison group、reference period 和 anticipation assumptions。
pre-treatment 的逐点 p 值只作为诊断，不被当作“平行趋势成立/不成立”的单独证明。
