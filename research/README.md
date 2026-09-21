# DSH Research Edition

DSH Research 是在标准 DSH Docker 镜像之上的科研工作环境，目标不是“预装更多软件”，而是提供一条可复现的研究链路：

```text
Literature → Question → Data → Analysis → Results → Paper → Archive
```

## V1 核心

- Python 科研环境：NumPy / pandas / Polars / SciPy / statsmodels / scikit-learn / SymPy / PyArrow / DuckDB。
- JupyterLab / Jupytext / nbconvert。
- Pandoc + Quarto。
- XeLaTeX + latexmk + Noto CJK 字体。
- PDF 工具：Poppler / qpdf。
- Research Project 标准目录。
- Evidence Matrix 文献证据矩阵。
- `research-literature`：DOI / arXiv / PDF → BibTeX → 结构化笔记 → Evidence Matrix → 引用校验。
- 可选 **Economics Research Pack**：pyfixest / linearmodels / arch + 经济学项目模板与研究规则。
- `research-run` 可复现实验记录。
- `research-archive` 可交付研究归档。

## 构建

```bash
docker build -f research/Dockerfile \
  --build-arg BASE_IMAGE=ghcr.io/paimoncai/dsh-docker-install:latest \
  -t dsh:research .
```

## 使用

容器内：

```bash
cd /workspace
research-init my-study "My Study"
cd my-study

research-literature add 10.1257/aer.20181234
research-literature add arXiv:2401.01234
research-literature add /workspace/papers/paper.pdf
research-literature review
research-literature verify

research-run --name baseline -- python src/analysis.py

# Economics Pack 示例：
research-run --name baseline-regression -- \
  research-econ-model feols \
  --name baseline \
  --data data/processed/analysis.csv \
  --formula "y ~ treatment + x1 | entity_id + year" \
  --vcov cluster \
  --cluster entity_id \
  --focus treatment

quarto render paper/paper.qmd
research-archive
```

默认归档不包含 `data/raw`。只有明确确认原始数据允许分发时才使用：

```bash
research-archive --include-raw
```

## 文献管线

`research-literature` 把文献管理做成可检查的项目数据，而不是只保留聊天中的总结：

```text
DOI / arXiv / PDF
      ↓
sources.jsonl + references.bib
      ↓
literature/notes/<citation_key>.md
      ↓
evidence-matrix.csv
      ↓
review.md + paper citations
```

常用命令：

```bash
research-literature add 10.1257/aer.20181234
research-literature add https://arxiv.org/abs/2401.01234
research-literature add ./paper.pdf
research-literature extract <citation_key>
research-literature list
research-literature review
research-literature verify
```

PDF 导入时会尝试从前几页识别 DOI；识别成功且网络可用时，再通过 Crossref 补全元数据。
本地 PDF 默认复制到 `literature/pdfs/`，同时记录 SHA256；`extract` 可生成带页码标记的
`literature/extracted/<citation_key>.txt`，便于结构化阅读和页码追溯。PDF 与提取全文默认都不进入 Git。
`review` 只从 Evidence Matrix 生成可追溯证据索引，不会凭空生成论文结论。
`verify` 会检查 BibTeX、Evidence Matrix、结构化笔记和 `paper/*.qmd` 引用的一致性，并检查原始数据是否被误提交到 Git。

## Economics Research Pack

Economics Pack 不是把所有经济学工具塞进通用科研镜像，而是一个独立派生镜像：

```text
ghcr.io/paimoncai/dsh-docker-install:research-economics
```

宿主机切换：

```bash
dshd research-pack economics
dshd research-pack show
```

切回通用 Research：

```bash
dshd research-pack none
```

创建经济学项目：

```bash
research-init --template economics minimum-wage "最低工资与就业"
cd minimum-wage
```

Economics 模板会在通用 Research Project 的基础上增加：

- `research.yaml` 中的 population、unit of observation、estimand、identification strategy、fixed effects、clustering、robustness 等字段；
- 经济学专用 Agent 规则，要求区分相关/预测/因果并明确识别假设；
- `src/econometrics.py` 的 pyfixest 与 IV/2SLS 脚手架；
- 更适合经验经济学论文的 Quarto 结构；
- `pyfixest`、`linearmodels`、`arch`、`wbgapi`、`pandas-datareader`。
- `research-econ-data`：World Bank / FRED 原始数据快照、检索元数据与 SHA256 校验。
- `research-econ-model`：强制显式 vcov，登记模型公式、数据 SHA256、系数、表格和图形 hash，并自动更新 `paper/generated/economics-results.qmd`。
- `research-econ-model compare`：从多个 model manifest 生成并列论文回归表，并追踪底层模型 SHA256。
- `research-econ-did`：panel/treatment timing 检查 + TWFE / DID2S / saturated / LP-DiD + event-study 图表 + Quarto 自动引用。
- Quarto 可直接使用 `@tbl-econ-<name>` / `@fig-econ-<name>` 引用生成结果。

这些示例公式只是脚手架。Research Agent 被明确要求先定义 estimand 和识别策略，不能因为某个规格“显著”就把它升级为基准模型。

## V1 设计原则

1. 不 fork DSH 核心，Research Edition 继承标准镜像。
2. 原始数据默认不可变，代码输出进入 processed/results。
3. 每次正式分析留下命令、环境、Git 状态和输入/输出 hash。
4. 文献综述优先维护 Evidence Matrix，而不是只生成自由文本总结。
5. 项目可独立归档，方便论文复核、复现和交付。

## V2 开发方向与可行性验证

V2 的目标不是继续堆科研软件，而是把 V1 已经存在的 Literature / Data / Run /
Model / DiD / Paper / Archive 对象组织成一个真正可管理的 **Research Project lifecycle**。

V1 已经提供项目目录、`research.yaml`、sources/evidence、数据 snapshot、run manifest、
model manifest、DiD manifest、Quarto 结果和 hash 校验，因此 V2 可以在现有对象之上增量开发，
不需要推翻 V1，也不需要 fork DSH 核心。

### 可行性结论

| 方向 | 可行性 | V1 基础 | V2 实现原则 |
|---|---|---|---|
| Project State / Research Check | 高 | research.yaml + manifests + verify | 聚合现有状态，不重复保存第二套真相 |
| Pipeline DAG / stale detection | 高 | 输入/输出 SHA256 + research-run | 以显式 inputs/outputs/dependencies 构建增量执行 |
| Data Catalog / Lineage | 高 | raw/processed + snapshot metadata | dataset manifest + schema + source/code lineage |
| Research Dashboard | 高，但需隔离 UI 风险 | DSH Web + CLI | CLI/manifest 为 source of truth，UI 仅作为 DSH plugin 展示/触发 |
| R runtime | 高 | Quarto + research-run | 可选 R layer + renv；Python-first 不变 |
| Zotero sync | 高 | references.bib + sources.jsonl | 先做 read-only Web API v3 同步，再考虑双向写入 |
| Evidence Graph | 中高 | Evidence Matrix + notes | 从 paper/claim/evidence 建显式关系，不以向量相似度代替证据关系 |
| Advanced Economics | 高 | pyfixest / linearmodels / DiD | 每个方法单独定义 estimand、assumptions、diagnostics 和 smoke tests |
| Multi-agent research roles | 中高 | DSH Agent + workspace tools | 共享同一 Project State；角色只是工作流，不制造多套项目状态 |
| Replication Release | 高 | research-archive + hashes | 在 archive 上增加环境锁、许可/秘密检查和 release manifest |

DSH 官方本身采用 plugin 架构，并提供 UI plugin / Web Client 扩展点。因此 Research Dashboard
可以作为独立插件实现，而不修改 Harness 核心。由于 DSH 仍处于 developer preview，V2 必须保持
**CLI + 文件 manifest 是稳定协议，UI plugin 是可替换外壳**；即使上游 Web UI API 发生变化，
科研项目仍应能完全通过命令行恢复和验证。

R 也具备直接集成条件：Quarto 同时支持 Python/Jupyter 与 R/Knitr 工作流，项目级 R 依赖可通过
`renv.lock` 锁定和恢复。因此 V2 可以让 Python 与 R 共享同一个 `data/processed/`、
`results/` 和 `paper/`，而不是创建互不兼容的 Python/R 项目格式。

Zotero 提供稳定的 Web API v3 和本地 API，V2 可以先把 Zotero collection 映射到
`sources.jsonl` / `references.bib`，通过 item key/version 做增量同步。第一阶段默认 read-only，
API key/OAuth 只通过容器秘密配置传入，不写入科研项目和 Git。

### V2.0 — Project State / Pipeline / Dashboard

优先完成科研项目本身的“状态层”，而不是增加更多统计包。

计划新增：

```text
research-status
research-check
research-pipeline
research-data
```

目标状态模型：

```text
Research Project
├── Question / Design
├── Literature
├── Datasets
├── Pipelines / Runs
├── Models / DiD
├── Tables / Figures
├── Paper
└── Release
```

`research-check` 需要聚合现有 verify 结果，例如：

```text
Research question            ✓
Estimand                     ✓
Literature evidence          19 / 24
Raw data immutable           ✓
Processed dataset            current
Baseline models              3
DiD diagnostics              ✓
Stale tables / figures       0
Missing paper citations      2
Replication release          not ready
```

Pipeline 使用显式 DAG：

```yaml
pipeline:
  clean:
    command: python src/clean.py
    inputs:
      - data/raw/**
    outputs:
      - data/processed/panel.parquet

  baseline:
    depends_on: [clean]
    command: research-econ-model feols ...

  did:
    depends_on: [clean]
    command: research-econ-did estimate ...

  paper:
    depends_on: [baseline, did]
    command: quarto render paper/paper.qmd
```

输入 hash 改变后只把受影响的 downstream step 标记为 stale，并只重跑必要步骤。

Dashboard 作为 DSH UI plugin 展示同一份 Project State：

```text
Project
├── Literature
├── Data
├── Pipeline
├── Models
├── DiD
├── Results
├── Paper
└── Release
```

Dashboard 不直接拥有科研状态；删除 UI plugin 后，所有项目仍可通过 CLI 完整使用。

### V2.1 — R Runtime + 统一执行环境

Economics Pack 保持 Python-first，同时增加可选 R runtime：

```text
Python
├── pandas / Polars / DuckDB
├── pyfixest / linearmodels
└── ML / AI ecosystem

R
├── tidyverse / data.table
├── fixest
├── did / did2s
├── modelsummary
├── estimatr
└── ggplot2
```

统一使用：

```bash
research-run --name clean-python -- python src/clean.py
research-run --name robustness-r -- Rscript src/robustness.R
```

R 项目依赖使用 `renv.lock`，Python 继续记录当前 venv / package environment。
`research-run` 与 `research-archive` 负责同时记录两种运行时及其版本，不让语言差异破坏
现有可复现协议。

### V2.2 — Zotero + Evidence Graph

Zotero 第一阶段：

```text
Zotero Collection
      ↓
research-zotero sync
      ↓
sources.jsonl
references.bib
literature/notes
Evidence Matrix
```

同步必须幂等，保留 Zotero item key/version，避免重复导入。

在 Evidence Matrix 之上增加显式 Evidence Graph：

```text
Research Question
      ↓
Claim
├── supports → Paper / page / table
├── challenges → Paper / page / table
└── limitation → Paper / note
```

语义搜索只负责发现候选证据；真正进入论文的 claim 必须指向明确来源和可追踪位置。

### V2.3 — Advanced Economics

在当前 FE / IV / Panel / DiD 基础上逐步加入：

- RDD；
- Synthetic Control；
- Callaway–Sant'Anna / 其他现代 staggered-DiD 实现；
- Triple Difference；
- Matching / Weighting；
- Double Machine Learning；
- Causal Forest / heterogeneous treatment effects；
- placebo / falsification / sensitivity；
- power / minimum detectable effect。

每个方法都必须像现有 `research-econ-did` 一样包含：

```text
Design fields
→ Structural checks
→ Estimator
→ Diagnostics
→ Manifest
→ Tables/Figures
→ Quarto
→ verify
```

不提供“遍历大量规格后自动挑显著模型”的工作流。

### V2.4 — Research Agents + Replication Release

Agent 层可以按职责拆分：

```text
Planner
→ Literature
→ Data
→ Methods
→ Results
→ Writing
→ Reviewer
```

这些角色共享同一个 Project State，不各自维护隐藏状态。

新增 `research-release`，在 `research-archive` 之上生成可交付 replication package：

```text
release/
├── paper.pdf / paper.html
├── code/
├── data/processed/
├── results/
├── literature/references.bib
├── environment/
│   ├── python environment
│   ├── renv.lock
│   ├── docker image digest
│   └── system info
├── runs/
├── README.md
└── MANIFEST.json
```

release 前必须检查 secrets、API keys、原始数据许可、受限数据、版权 PDF、个人信息和大文件，
默认宁可不发布，也不把 `data/raw/` 或全文文献意外打包。

## V2 不变的架构原则

1. **文件与 manifest 是 source of truth**：UI、Agent 和 CLI 都读写同一项目状态。
2. **CLI first, UI optional**：Dashboard 不能成为项目可复现性的依赖。
3. **不 fork DSH 核心**：UI 和 Agent 扩展优先使用官方 plugin extension points。
4. **Python-first, multi-runtime**：R 是补充执行引擎，不推翻 Python 数据工程主线。
5. **方法服从研究设计**：先 question / estimand / assumptions，再选择 estimator。
6. **可追溯优先于自动化**：自动生成的表、图、结论都必须能回到数据、代码、run 和来源。
7. **V2 先做 Project State**：V2.0 完成以前，不以增加大量统计包作为主要开发目标。
