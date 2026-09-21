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

## V1 设计原则

1. 不 fork DSH 核心，Research Edition 继承标准镜像。
2. 原始数据默认不可变，代码输出进入 processed/results。
3. 每次正式分析留下命令、环境、Git 状态和输入/输出 hash。
4. 文献综述优先维护 Evidence Matrix，而不是只生成自由文本总结。
5. 项目可独立归档，方便论文复核、复现和交付。

R、Zotero 同步、领域扩展包（Economics / Finance / ML）留到后续版本。
