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
