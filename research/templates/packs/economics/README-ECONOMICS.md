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
