# Dataset Catalog

V2 使用 `data/catalog/*.yaml` 登记重要数据集。不要手工维护 hash；优先使用：

```bash
research-data register data/raw/source.csv --name source --kind raw
research-data register data/processed/panel.parquet \
  --name panel \
  --kind processed \
  --input source \
  --code src/clean.py \
  --pipeline-step clean
```

Dataset manifest 记录文件 SHA256、格式、维度、来源/许可信息，以及上游 dataset、代码、run/pipeline step 血缘。

常用命令：

```bash
research-data list
research-data show panel
research-data verify
research-data lineage panel
```
