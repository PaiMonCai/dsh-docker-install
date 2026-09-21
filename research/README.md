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

这些示例公式只是脚手架。Research Agent 被明确要求先定义 estimand 和识别策略，不能因为某个规格“显著”就把它升级为基准模型。

## V1 设计原则

1. 不 fork DSH 核心，Research Edition 继承标准镜像。
2. 原始数据默认不可变，代码输出进入 processed/results。
3. 每次正式分析留下命令、环境、Git 状态和输入/输出 hash。
4. 文献综述优先维护 Evidence Matrix，而不是只生成自由文本总结。
5. 项目可独立归档，方便论文复核、复现和交付。

R、Zotero 同步、Finance / ML 等领域扩展包留到后续版本；Economics Pack 已进入 V1。
