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
