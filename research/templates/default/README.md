# __PROJECT_TITLE__

这是一个 **DSH Research Project**。

## 推荐工作流

1. 在 `research.yaml` 明确研究问题、假设与研究领域。
2. 文献放入 `literature/`，并维护 `evidence-matrix.csv`。
3. 原始数据只放 `data/raw/`，分析代码不要原地修改原始文件。
4. 清洗后的数据写入 `data/processed/`。
5. 可重复执行的分析放入 `src/`；探索性工作放入 `notebooks/`。
6. 表格和图形统一写入 `results/`。
7. 使用 `research-run --name baseline -- python src/analysis.py` 记录一次实验。
8. 使用 `quarto render paper/paper.qmd` 生成论文。
9. 使用 `research-archive` 创建可复现归档。

## 三个核心对象

- **Evidence Matrix**：每个结论对应哪篇论文、什么数据与什么方法。
- **Research Run**：一次分析对应明确的代码、输入 hash、环境和输出。
- **Research Archive**：可交付、可审阅、可复现的项目快照。
