# syntax=docker/dockerfile:1
ARG BASE_IMAGE=ghcr.io/paimoncai/dsh-docker-install:latest
FROM ${BASE_IMAGE} AS research-core

ARG TARGETARCH
ARG QUARTO_VERSION=1.10.18
ARG RESEARCH_VERSION=0.9.0-rc.2

LABEL org.opencontainers.image.title="DeepSeek Harness Research Edition" \
      org.opencontainers.image.description="DSH research environment with Python, Jupyter, Quarto, LaTeX and reproducible research helpers" \
      org.opencontainers.image.source="https://github.com/PaiMonCai/dsh-docker-install" \
      org.opencontainers.image.version="${RESEARCH_VERSION}" \
      io.caicailo.dsh.edition="research" \
      io.caicailo.dsh.research.pack="none"

ENV DEBIAN_FRONTEND=noninteractive \
    DSH_RESEARCH_HOME=/opt/dsh-research \
    DSH_RESEARCH_VENV=/opt/dsh-research/venv \
    DSH_RESEARCH_VERSION=${RESEARCH_VERSION} \
    DSH_RESEARCH_ADAPTER_PATCH=/opt/dsh-research/adapter/cordis.patch.yml \
    PYTHONPATH=/opt/dsh-research \
    PATH=/opt/dsh-research/venv/bin:${PATH}

USER root

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      fonts-noto-cjk \
      graphviz \
      latexmk \
      lmodern \
      pandoc \
      poppler-utils \
      qpdf \
      ripgrep \
      rsync \
      sqlite3 \
      texlive-fonts-recommended \
      texlive-latex-base \
      texlive-latex-extra \
      texlive-latex-recommended \
      texlive-lang-chinese \
      texlive-xetex \
 && rm -rf /var/lib/apt/lists/*

# Quarto ships official amd64 + arm64 Debian packages. Pin both release and SHA256.
RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) QUARTO_ARCH=amd64; QUARTO_SHA256=4bdf5a17df300003beb2f8f0e4dfe568e2ca0ff91318220c8537d2655015c430 ;; \
      arm64) QUARTO_ARCH=arm64; QUARTO_SHA256=ed3f70f63ee12b290ea1e38da08aa7c74c6843f6bed6df828e1e1652ef6d7d98 ;; \
      *) echo "Unsupported TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    url="https://github.com/quarto-dev/quarto-cli/releases/download/v${QUARTO_VERSION}/quarto-${QUARTO_VERSION}-linux-${QUARTO_ARCH}.deb"; \
    curl -fsSL --retry 3 "${url}" -o /tmp/quarto.deb; \
    echo "${QUARTO_SHA256}  /tmp/quarto.deb" | sha256sum -c -; \
    apt-get update; \
    apt-get install -y --no-install-recommends /tmp/quarto.deb; \
    rm -f /tmp/quarto.deb; \
    rm -rf /var/lib/apt/lists/*; \
    quarto --version

COPY research/python-requirements.txt /opt/dsh-research/python-requirements.txt

RUN uv venv --seed /opt/dsh-research/venv \
 && uv pip install --python /opt/dsh-research/venv/bin/python \
      -r /opt/dsh-research/python-requirements.txt \
 && python --version \
 && python -c "import numpy, pandas, scipy, statsmodels, sklearn, sympy, pyarrow, duckdb" \
 && jupyter --version

COPY research/dsh_research/ /opt/dsh-research/dsh_research/
COPY research/bin/ /usr/local/bin/
COPY research/templates/ /opt/dsh-research/templates/
COPY research/adapter/ /opt/dsh-research/adapter/
COPY research/adapter/dsh-wrapper /opt/dsh-research/venv/bin/dsh

RUN chmod 0755 \
      /opt/dsh-research/venv/bin/dsh \
      /opt/dsh-research/adapter/smoke-web.sh \
      /usr/local/bin/research-init \
      /usr/local/bin/research-run \
      /usr/local/bin/research-archive \
      /usr/local/bin/research-literature \
      /usr/local/bin/research-status \
      /usr/local/bin/research-migrate \
      /usr/local/bin/research-check \
      /usr/local/bin/research-data \
      /usr/local/bin/research-pipeline \
      /usr/local/bin/research-result \
      /usr/local/bin/research-dashboard \
 && python -c "import dsh_research; from dsh_research.project import ResearchProject; print('Research engine import passed')" \
 && research-init --self-test \
 && research-run --self-test \
 && research-archive --self-test \
 && research-literature --self-test \
 && research-status --self-test \
 && research-migrate --self-test \
 && research-check --self-test \
 && research-data --self-test \
 && research-pipeline --self-test \
 && research-result --self-test \
 && research-dashboard --self-test \
 && node --check /opt/dsh-research/adapter/index.js \
 && bash -n /opt/dsh-research/venv/bin/dsh \
 && tmp_home="$(mktemp -d)" \
 && DSH_HOME="$tmp_home" dsh --profile web --dump-config | grep -q '/opt/dsh-research/adapter/index.js' \
 && DSH_HOME="$tmp_home" dsh --profile headless --dump-config | grep -q '/opt/dsh-research/adapter/index.js' \
 && rm -rf "$tmp_home" \
 && /opt/dsh-research/adapter/smoke-web.sh \
 && pandoc --version | head -1 \
 && xelatex --version | head -1 \
 && latexmk -v | head -1 \
 && printf '%s\n' \
      '---' \
      'title: "科研环境测试"' \
      'format: pdf' \
      'pdf-engine: xelatex' \
      'mainfont: "Noto Serif CJK SC"' \
      '---' \
      '' \
      '中文排版 smoke test。' > /tmp/research-smoke.qmd \
 && quarto render /tmp/research-smoke.qmd --to pdf \
 && test -s /tmp/research-smoke.pdf \
 && rm -f /tmp/research-smoke.qmd /tmp/research-smoke.pdf

WORKDIR /workspace

FROM research-core AS research-economics

ENV DSH_RESEARCH_PACK=economics

LABEL io.caicailo.dsh.edition="research" \
      io.caicailo.dsh.research.pack="economics"

COPY research/packs/economics/python-requirements.txt /opt/dsh-research/economics-requirements.txt
COPY research/packs/economics/bin/research-econ-data /usr/local/bin/research-econ-data
COPY research/packs/economics/bin/research-econ-model /usr/local/bin/research-econ-model
COPY research/packs/economics/bin/research-econ-did /usr/local/bin/research-econ-did

RUN chmod 0755 /usr/local/bin/research-econ-data /usr/local/bin/research-econ-model /usr/local/bin/research-econ-did \
 && uv pip install --python /opt/dsh-research/venv/bin/python \
      -r /opt/dsh-research/economics-requirements.txt \
 && python -c "import pyfixest, linearmodels, arch, wbgapi, pandas_datareader; print('Economics Research Pack ready')" \
 && research-econ-data --self-test \
 && research-econ-model --self-test \
 && research-econ-did --self-test \
 && tmp="$(mktemp -d)" \
 && research-init --template economics economics-smoke "Economics Smoke Test" "$tmp/project" \
 && grep -q 'template: "economics"' "$tmp/project/research.yaml" \
 && grep -q 'Economics research rules' "$tmp/project/AGENTS.md" \
 && python "$tmp/project/src/econometrics.py" \
 && rm -rf "$tmp"

WORKDIR /workspace

# 默认本地构建仍得到通用 Research 版；CI 可显式 --target research-economics。
FROM research-core AS research-final
WORKDIR /workspace
