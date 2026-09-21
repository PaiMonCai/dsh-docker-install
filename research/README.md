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

## V2 开发方向与实施方案

V2 的目标不是继续堆科研软件，而是把 V1 已经存在的 Literature / Data / Run /
Model / DiD / Paper / Archive 对象组织成一个真正可管理、可追踪、可增量执行、可复现发布的
**Research Project lifecycle**。

V1 已经提供项目目录、`research.yaml`、sources/evidence、数据 snapshot、run manifest、
model manifest、DiD manifest、Quarto 结果和 hash 校验，因此 V2 采用增量演进：
不推翻 V1，不 fork DSH 核心，而是在现有对象之上增加统一的 Research Engine、状态模型、
数据血缘、Pipeline DAG、Result Registry 和 Release 协议。

V2 的整体目标可以概括为：

```text
Literature / Evidence
        ↓
Question / Design
        ↓
Data Catalog / Lineage
        ↓
Pipeline DAG
        ↓
Runs
        ↓
Results
        ↓
Paper
        ↓
Replication Release

        ↑
Research Agent / Dashboard
```

### 可行性结论

| 方向 | 可行性 | V1 基础 | V2 实现原则 |
|---|---|---|---|
| Shared Research Engine | 高 | 现有 Bash/Python CLI | 抽取项目发现、YAML/manifest、hash、Git、状态聚合等公共逻辑 |
| Project State / Research Check | 高 | research.yaml + manifests + verify | 聚合现有状态，不重复保存第二套真相 |
| Pipeline DAG / stale detection | 高 | 输入/输出 SHA256 + research-run | 以显式 inputs/outputs/dependencies + step signature 构建增量执行 |
| Data Catalog / Lineage | 高 | raw/processed + snapshot metadata | dataset manifest + schema + source/code/run lineage |
| Result Registry | 高 | model / DiD manifests + artifacts | 用统一 Result 对象承接 model / DiD / RDD / figure / table 等产物 |
| Research Dashboard | 高，但需隔离 UI 风险 | DSH Web + CLI | CLI/manifest 为 source of truth，UI 仅作为 DSH plugin 展示/触发 |
| R runtime | 高 | Quarto + research-run | 可选 R layer + renv；Python-first 不变 |
| Zotero sync | 高 | references.bib + sources.jsonl | 先做 read-only Web API v3 同步，再考虑双向写入 |
| Evidence Graph | 中高 | Evidence Matrix + notes | 从 claim 到来源位置建立显式证据关系，不以向量相似度代替证据 |
| Advanced Economics | 高 | pyfixest / linearmodels / DiD | 每个方法单独定义 estimand、assumptions、diagnostics 和 smoke tests |
| Research Agents | 中高 | DSH Agent + workspace tools | 共享同一 Project State；角色只是工作流，不制造多套项目状态 |
| Replication Release | 高 | research-archive + hashes | 在 archive 上增加环境锁、许可/秘密检查和 release manifest |

DSH 官方本身采用 plugin 架构，并提供 UI plugin / Web Client 扩展点。因此 Research Dashboard
可以作为独立插件实现，而不修改 Harness 核心。由于 DSH 仍处于 developer preview，V2 必须保持
**CLI + 文件 manifest 是稳定协议，UI plugin 是可替换外壳**；即使上游 Web UI API 发生变化，
科研项目仍应能完全通过命令行恢复和验证。

R 也具备直接集成条件：Quarto 同时支持 Python/Jupyter 与 R/Knitr 工作流，项目级 R 依赖可通过
`renv.lock` 锁定和恢复。因此 V2 可以让 Python 与 R 共享同一个 `data/processed/`、
`results/` 和 `paper/`，而不是创建互不兼容的 Python/R 项目格式。

Zotero 第一阶段保持只读、幂等同步，通过 item key/version 做增量更新；
API key/OAuth 只通过容器秘密配置传入，不写入科研项目和 Git。

### V2.0 — Research Project Engine

V2.0 是整个 V2 的基础版本。目标不是增加更多统计包，而是先建立统一的项目状态、
数据对象、运行对象、结果对象和增量执行协议。

V2.0 完成以后，一个 Research Project 应能够回答：

```text
我现在做到哪一步？
哪些数据和结果仍然 current？
哪些结果已经 stale？
为什么 stale？
这个表或图由哪次 run、哪份数据、哪段代码生成？
修改某个输入以后，哪些 downstream step 必须重跑？
论文是否引用了当前结果？
项目是否已经满足 replication release 条件？
```

#### Phase 0 — Shared Python Research Engine

当前 Research Edition 同时存在 Bash 与 Python CLI。V2 不再让每个新命令重复实现
项目根目录发现、YAML 解析、SHA256、Git 状态、manifest 读写和错误处理，而是增加内部 Python Engine：

```text
research/
├── dsh_research/
│   ├── __init__.py
│   ├── project.py
│   ├── config.py
│   ├── hashing.py
│   ├── manifests.py
│   ├── state.py
│   ├── checks.py
│   ├── datasets.py
│   ├── lineage.py
│   ├── pipeline.py
│   ├── runs.py
│   ├── results.py
│   ├── paper.py
│   └── release.py
└── bin/
    ├── research-status
    ├── research-check
    ├── research-data
    └── research-pipeline
```

外部 CLI 名称保持稳定，内部公共逻辑逐步迁移到 `dsh_research.*`。
这样 V1 命令可以继续兼容，同时为 V2 后续 R、Zotero、Dashboard、Agents 和高级计量提供统一底座。

#### Phase 1 — Project Schema v2 + Project State

新增：

```text
research-status
research-migrate
```

`ProjectState` 是**派生状态**，不是第二套数据库。它从以下 source of truth 聚合：

```text
research.yaml
sources.jsonl
evidence-matrix.csv
dataset manifests
run manifests
result / model / DiD manifests
pipeline state
paper
Git state
```

可以使用 `.research/cache/state.json` 加速，但 cache 必须可安全删除；
删除后运行 `research-status` 应能完全重新构建状态。

目标状态模型：

```text
Research Project
├── Question / Design
├── Literature / Evidence
├── Datasets / Lineage
├── Pipeline / Runs
├── Results
│   ├── Models
│   ├── DiD
│   ├── Tables
│   └── Figures
├── Paper
└── Release
```

示例：

```text
$ research-status

Project
  Title                  AI 与企业生产率
  Schema                 2
  Git                    clean
  Research Pack          economics

Research Design
  Question               ✓
  Estimand               ✓
  Identification         ✓

Literature
  Sources                42
  Reviewed               31
  Evidence entries       86

Data
  Registered datasets    5
  Current                4
  Stale                  1

Pipeline
  Steps                  8
  Current                6
  Stale                  2
  Failed                 0

Results
  Registered             7
  Stale                  1

Paper
  Missing citations      2
  Stale artifacts        1

Release
  Status                 NOT READY
```

同时必须提供机器可读接口：

```bash
research-status --json
```

V2 若升级 `research.yaml` schema，必须提供非破坏性迁移：

```bash
research-migrate --to 2
```

迁移前保留原文件备份，并保证已有 V1 项目可以被 V2 CLI 检测和升级，而不是直接失效。

#### Phase 2 — Research Check Rule Engine

新增：

```text
research-check
```

`research-status` 回答“项目现在是什么状态”，`research-check` 回答“项目有什么问题”。

统一 Check Result：

```json
{
  "id": "paper.missing-citation",
  "severity": "error",
  "status": "fail",
  "message": "citation key not found",
  "path": "paper/paper.qmd"
}
```

严重级别：

```text
INFO
WARN
ERROR
```

建议支持：

```bash
research-check --quick
research-check --full
research-check --release
research-check --json
```

示例：

```text
PASS  project.question
PASS  economics.estimand
PASS  data.raw.immutable

WARN  literature.coverage
      5 sources have no Evidence Matrix entries

WARN  pipeline.stale
      baseline depends on stale dataset panel

ERROR paper.citation
      citation @smith2024 not found

ERROR result.stale
      table baseline was generated from an older dataset hash
```

CLI exit code 应稳定，便于 CI 直接使用 `research-check --release` 作为发布门槛。

#### Phase 3 — Data Catalog + Lineage

新增：

```text
research-data
```

V2 不再只依赖目录约定理解数据，而是给每个重要 dataset 建立 manifest：

```text
data/
├── catalog/
│   ├── cps.yaml
│   ├── panel.yaml
│   └── analysis.yaml
├── raw/
└── processed/
```

示例 Dataset Manifest：

```yaml
schema: 1

dataset:
  id: panel
  title: Firm Panel

kind: processed
path: data/processed/panel.parquet
format: parquet

fingerprint:
  sha256: "..."
  size: 123456

dimensions:
  rows: 302145
  columns: 48

lineage:
  inputs:
    - dataset:raw-firms
    - dataset:policy
  pipeline_step: clean
  run_id: 20260921T120000Z-clean

access:
  distributable: true
```

CLI 目标：

```bash
research-data register data/raw/cps.parquet --name cps --kind raw
research-data list
research-data show panel
research-data verify panel
research-data lineage panel
```

Data Catalog 必须能够追踪：

```text
Source / Raw Dataset
        ↓
Cleaning Code
        ↓
Run
        ↓
Processed Dataset
        ↓
Model / Result
```

#### Phase 4 — Pipeline DAG + Stale Detection

新增：

```text
research-pipeline
pipeline.yaml
```

Pipeline 使用显式 DAG，而不是只依赖脚本执行顺序：

```yaml
schema: 1

steps:
  clean:
    command:
      - python
      - src/clean.py
    inputs:
      - dataset:raw-firms
    outputs:
      - dataset:panel

  baseline:
    depends_on: [clean]
    command:
      - research-econ-model
      - feols
      - --name
      - baseline

  did:
    depends_on: [clean]
    command:
      - research-econ-did
      - estimate
      - --name
      - did-main

  paper:
    depends_on: [baseline, did]
    command:
      - quarto
      - render
      - paper/paper.qmd
```

stale detection 不能只依赖文件 mtime。每个 step 应计算稳定的 **Step Signature**：

```text
step signature
  = command
  + dependency signatures
  + input hashes
  + relevant source-code hashes
  + referenced research config
  + relevant runtime identity
```

例如 `src/clean.py` 改变，即使 raw data 没变，也必须使：

```text
clean → stale
baseline → stale
did → stale
paper → stale
```

而仅修改 bibliography 时，不应让数据清洗与模型全部重跑。

CLI 目标：

```bash
research-pipeline status
research-pipeline list
research-pipeline graph
research-pipeline explain did
research-pipeline run
research-pipeline run baseline
```

`research-pipeline explain` 必须说明 stale 原因，而不是只返回布尔状态。例如：

```text
did is stale because:

dataset:panel
  expected: sha256 AAA
  current:  sha256 BBB

caused by:
  clean

clean is stale because:
  src/clean.py changed
```

Pipeline 执行时只重跑 stale 节点及其必要依赖；已经 current 的上游步骤必须跳过。

#### Phase 5 — research-run Manifest v2

V1 `research-run` 已经记录 command、Git commit、Git dirty、Python/uv/Quarto/Pandoc、
pip freeze、输入输出 hash、stdout/stderr 和 exit code。V2 不推翻这一能力，而是把它升级为
Pipeline 与 Result 的标准运行记录。

Run Manifest v2 至少包含：

```json
{
  "schema": 2,
  "id": "20260921T120301Z-baseline",
  "pipeline_step": "baseline",
  "command": [],
  "inputs": [
    {"dataset": "panel", "sha256": "..."}
  ],
  "outputs": [
    {"result": "baseline", "sha256": "..."}
  ],
  "environment": {
    "python": "...",
    "r": null,
    "image_digest": "..."
  },
  "git": {
    "commit": "...",
    "dirty": false
  },
  "exit_code": 0
}
```

Pipeline 必须能够根据 Run Manifest 判断：上一次运行到底基于什么数据、代码和环境。

#### Phase 6 — Result Registry

V2 增加统一的 **Research Result** 抽象，不让 Project State 直接耦合所有计量方法。

统一 Result 可以承接：

```text
model
did
rdd
synthetic-control
descriptive-table
figure
table
other
```

每个 Result 至少记录：

```text
id
type
inputs
run
manifest
artifacts
hash
status
```

于是科研对象形成统一链路：

```text
Dataset
   ↓
Pipeline Step
   ↓
Run
   ↓
Result
   ↓
Artifact
   ↓
Paper
```

后续 RDD、Synthetic Control、DML 等方法只需要注册新的 Result 类型和 diagnostics，
不需要不断扩张 Project State 的核心结构。

#### Phase 7 — JSON Interfaces

V2 核心 CLI 必须同时支持人类可读输出与稳定 JSON：

```bash
research-status --json
research-check --json
research-data list --json
research-pipeline status --json
```

JSON 是 Dashboard、DSH Agent、CI 和未来其他客户端的稳定接口；
不要让 UI 直接解析终端文本。

#### Phase 8 — Research Dashboard

Dashboard 是 V2.0 的最后一层，而不是最先开发的部分。

```text
DSH Research UI plugin
        ↓
Research CLI / JSON
        ↓
Research Engine
        ↓
Files + manifests
```

建议页面：

```text
Overview
Research Design
Literature
Data
Pipeline
Results
Paper
Release
```

Dashboard 只展示和触发同一份 Project State，不拥有独立科研数据库；
删除 UI plugin 后，所有项目仍可通过 CLI 完整恢复、执行和验证。

### V2.1 — R Runtime + 统一执行环境

Economics Pack 保持 Python-first，同时增加可选 R runtime。为避免普通 Economics 镜像过重，
优先采用分层镜像：

```text
research
   ↓
research-economics
   ↓
research-economics-r
```

第一阶段 R 环境控制在经济学高频工具：

```text
R
├── renv
├── data.table
├── ggplot2
├── fixest
├── modelsummary
└── estimatr
```

`did` / `did2s` 等现代 DiD 包在 amd64 / arm64 smoke test 稳定后逐步加入。

Python 与 R 共用同一运行协议：

```bash
research-run --name clean-python -- python src/clean.py
research-run --name robustness-r -- Rscript src/robustness.R
```

R 项目依赖使用 `renv.lock`，Python 继续记录 venv/package environment。
`research-run`、Pipeline 和 `research-release` 同时记录两种 runtime 及其版本，
不让语言差异破坏现有可复现协议。

### V2.2 — Zotero + Evidence Graph

Zotero 第一阶段：

```text
Zotero Collection
      ↓
research-zotero status / sync
      ↓
sources.jsonl
references.bib
literature/notes
Evidence Matrix
```

同步必须只读优先、幂等，保留 Zotero item key/version，避免重复导入。
`research-zotero status` 应显示 collection version、last synced version、new / updated / deleted / conflicts。

凭据只通过环境变量或 DSH secret 配置传入，例如：

```text
ZOTERO_API_KEY
ZOTERO_LIBRARY_ID
```

不得写入 `research.yaml`、项目文件或 Git。

在 Evidence Matrix 之上增加显式 Evidence Graph。第一版优先使用简单、可审计的文件结构，
例如 `literature/claims.yaml`，不急于引入图数据库或向量数据库。

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

在当前 FE / IV / Panel / DiD 基础上，按“先完善现有因果推断主线，再扩展高级方法”的顺序开发：

1. Modern DiD completion：Callaway–Sant'Anna / 其他 staggered-DiD 实现；
2. RDD；
3. Synthetic Control；
4. placebo / falsification / sensitivity；
5. Matching / Weighting；
6. Triple Difference；
7. power / minimum detectable effect；
8. Double Machine Learning；
9. Causal Forest / heterogeneous treatment effects。

每个方法都必须像现有 `research-econ-did` 一样包含：

```text
Design fields
→ Structural checks
→ Estimator
→ Diagnostics
→ Manifest
→ Result Registry
→ Tables/Figures
→ Quarto
→ verify
```

不提供“遍历大量规格后自动挑显著模型”的工作流。

### V2.4 — Research Agents + Replication Release

Agent 层共享同一个 Project State，不各自维护隐藏状态。

长期角色可以包括：

```text
Planner
Literature
Data
Methods
Results
Writing
Reviewer
```

但第一阶段优先实现：

```text
Planner
Reviewer
```

Planner 读取 Project State 和 Research Check，告诉用户下一步应该完成什么；
Reviewer 负责检查研究设计、数据、识别策略、推断、结果一致性和复现风险。

Reviewer 重点检查：

```text
研究问题和 estimand 是否明确
识别策略是否与 estimator 匹配
聚类 / 标准误层级是否合理
数据和结果是否 stale
论文表格是否来自当前 result
event study 是否被错误解释
是否存在只报告显著规格的风险
论文数字是否与 manifest 一致
引用是否存在并可追溯
```

#### Archive 与 Release 分离

`research-archive` 定位为内部项目快照；
`research-release` 定位为可对外交付的 replication package。

新增：

```bash
research-release check
research-release build
```

`research-release check` 至少检查：

```text
pipeline current
results current
paper current
Git state
secrets / API keys
raw-data license
restricted datasets
copyright PDFs
PII / sensitive data
large files
runtime locks
```

Release 输出：

```text
release/
├── paper/
│   ├── paper.pdf
│   └── paper.html
├── code/
├── data/
│   └── processed/
├── results/
├── literature/
│   └── references.bib
├── environment/
│   ├── python.txt
│   ├── pip-freeze.txt
│   ├── R.txt
│   ├── renv.lock
│   ├── docker-image.txt
│   ├── system.txt
│   └── git.txt
├── runs/
├── README.md
└── MANIFEST.json
```

默认宁可不发布，也不把 `data/raw/`、受限数据、全文版权文献、秘密或个人信息意外打包。

### V2 Testing Strategy

V2 的 Pipeline、状态聚合和 Release 必须由自动化测试保护，而不能只依赖 CLI smoke test。

建议测试结构：

```text
research/tests/
├── test_project.py
├── test_migrate.py
├── test_state.py
├── test_checks.py
├── test_catalog.py
├── test_lineage.py
├── test_pipeline.py
├── test_stale.py
├── test_runs.py
├── test_results.py
└── test_release.py
```

Pipeline 最低集成测试：

```text
raw → clean → model → paper
```

第一次运行：

```text
RUN clean
RUN model
RUN paper
```

第二次无修改：

```text
SKIP clean
SKIP model
SKIP paper
```

修改 raw：

```text
RUN clean
RUN model
RUN paper
```

只修改 model script：

```text
SKIP clean
RUN model
RUN paper
```

只修改 paper：

```text
SKIP clean
SKIP model
RUN paper
```

此外必须覆盖 DAG cycle、失败节点、schema migration、hash 稳定性、
release secret scanning 和 amd64 / arm64 镜像 smoke test。

### V2 推荐开发顺序

V2 不一次性做成一个大 PR，而是按可回滚、可测试的小步演进：

```text
PR 1   refactor: add shared Research Python engine
PR 2   feat: add Project Schema v2 and research-status
PR 3   feat: add research-check rule engine
PR 4   feat: add dataset catalog and lineage
PR 5   feat: add pipeline DAG parser
PR 6   feat: add stale detection and incremental execution
PR 7   feat: migrate research-run to manifest schema v2
PR 8   feat: add Result Registry
PR 9   feat: add stable JSON interfaces
PR 10  feat: add Research Dashboard plugin
PR 11  feat: add optional R runtime
PR 12  feat: add Zotero sync
PR 13  feat: add Evidence Graph
PR 14+ feat: advanced economics methods
PR N   feat: Planner / Reviewer + replication release
```

建议版本节奏：

```text
0.4.0  V2 engine prototype
0.5.0  Project State + Check
0.6.0  Data Catalog + Lineage
0.7.0  Pipeline DAG + stale detection
0.8.0  Result Registry + Dashboard preview
0.9.0  V2 release candidate
2.0.0  Stable V2
```

在 `2.0.0` 前保持现有 V1 CLI 尽量兼容，不因为内部重构破坏已创建的 Research Project。

## V2 不变的架构原则

1. **文件与 manifest 是 source of truth**：UI、Agent 和 CLI 都读写同一项目状态。
2. **Derived state 可重建**：`.research/cache` 等缓存可以删除，项目仍能从 source of truth 恢复。
3. **CLI first, UI optional**：Dashboard 不能成为项目可复现性的依赖。
4. **稳定 JSON 协议**：Dashboard、Agent 和 CI 消费 JSON，不解析终端文本。
5. **不 fork DSH 核心**：UI 和 Agent 扩展优先使用官方 plugin extension points。
6. **Python-first, multi-runtime**：R 是补充执行引擎，不推翻 Python 数据工程主线。
7. **方法服从研究设计**：先 question / estimand / assumptions，再选择 estimator。
8. **可追溯优先于自动化**：表、图、结论都必须能回到 dataset、code、run、result 和来源。
9. **增量执行必须可解释**：不仅知道 stale，还要知道为什么 stale。
10. **Archive 与 Release 分离**：内部快照和对外 replication package 使用不同安全门槛。
11. **向后兼容优先**：Schema 升级提供迁移路径，V1 项目不能因为 V2 重构直接失效。
12. **V2 先做 Project Engine**：V2.0 完成以前，不以增加大量统计包作为主要开发目标。

最终目标不是把 DSH Research 做成“带很多科研包的 Docker 镜像”，而是形成：

```text
AI Agent
   +
Research Project Engine
   +
Reproducible Data / Pipeline / Results
   +
Economics Research Workflows
   +
Replication Release
```

即一个以文件协议、可复现性和研究设计为核心的 **AI-native Research Environment**。
