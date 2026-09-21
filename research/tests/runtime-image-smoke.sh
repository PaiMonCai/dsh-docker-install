#!/usr/bin/env bash
set -Eeuo pipefail

echo "==> Research runtime smoke"
echo "pack=${DSH_RESEARCH_PACK:-none}"
echo "memory.max=$(cat /sys/fs/cgroup/memory.max 2>/dev/null || echo unknown)"

required=(
  python
  pip
  uv
  quarto
  pandoc
  xelatex
  lualatex
  luaotfload-tool
  Rscript
  chrome-headless-shell
  research-init
  research-run
)
for cmd in "${required[@]}"; do
  command -v "$cmd" >/dev/null || { echo "missing command: $cmd" >&2; exit 1; }
done

test -n "${VIRTUAL_ENV:-}"
case "$VIRTUAL_ENV" in
  "$DSH_HOME"/*|/tmp/dsh-research-runtime/*) ;;
  *) echo "runtime venv is not on a writable runtime path: $VIRTUAL_ENV" >&2; exit 1 ;;
esac

for var in UV_CACHE_DIR PIP_CACHE_DIR XDG_CACHE_HOME XDG_DATA_HOME MPLCONFIGDIR NUMBA_CACHE_DIR JUPYTER_RUNTIME_DIR DENO_DIR TEXMFCACHE TEXMFVAR TEXMFCONFIG R_LIBS_USER; do
  dir="${!var}"
  mkdir -p "$dir"
  probe="$dir/.write-test"
  printf ok > "$probe"
  rm -f "$probe"
done

site_dir="$(python - <<'PY'
import site
print(site.getsitepackages()[0])
PY
)"
printf ok > "$site_dir/.write-test"
rm -f "$site_dir/.write-test"

python - <<'PY'
import numpy, pandas, scipy, statsmodels, sklearn, sympy, pyarrow, duckdb
print("python research stack ok")
PY

mkdir -p /workspace/runtime-pkg/dsh_runtime_probe
cat > /workspace/runtime-pkg/setup.py <<'PY'
from setuptools import setup
setup(name="dsh-runtime-probe", version="0.0.1", packages=["dsh_runtime_probe"])
PY
printf '__version__ = "0.0.1"\n' > /workspace/runtime-pkg/dsh_runtime_probe/__init__.py
python -m pip install --no-index --no-build-isolation /workspace/runtime-pkg >/tmp/pip-runtime-smoke.log
uv pip install --python "$VIRTUAL_ENV/bin/python" --no-index --no-build-isolation --reinstall /workspace/runtime-pkg >/tmp/uv-runtime-smoke.log
python -c 'import dsh_runtime_probe; assert dsh_runtime_probe.__version__ == "0.0.1"'

Rscript --version
Rscript -e 'stopifnot(requireNamespace("knitr", quietly=TRUE)); stopifnot(requireNamespace("rmarkdown", quietly=TRUE)); cat("R research stack ok\n")'

luaotfload-tool --version | head -1
chrome-headless-shell --version
quarto check

cat > /workspace/quarto-html-smoke.qmd <<'QMD'
---
title: "Runtime HTML Smoke"
format: html
---

Research runtime smoke.
QMD
quarto render /workspace/quarto-html-smoke.qmd --to html
test -s /workspace/quarto-html-smoke.html

cat > /workspace/quarto-lua-smoke.qmd <<'QMD'
---
title: "LuaLaTeX Runtime Smoke"
lang: zh-CN
format:
  pdf:
    pdf-engine: lualatex
mainfont: "Noto Serif CJK SC"
---

中文 LuaLaTeX smoke test。
QMD
quarto render /workspace/quarto-lua-smoke.qmd --to pdf
test -s /workspace/quarto-lua-smoke.pdf

cat > /workspace/quarto-r-smoke.qmd <<'QMD'
---
title: "R Runtime Smoke"
format: html
engine: knitr
---

```{r}
stopifnot(sum(1:3) == 6)
summary(cars)
```
QMD
quarto render /workspace/quarto-r-smoke.qmd --to html
test -s /workspace/quarto-r-smoke.html

if [[ "${DSH_RESEARCH_PACK:-none}" == "economics" ]]; then
  for cmd in research-econ-data research-econ-model research-econ-did; do
    command -v "$cmd" >/dev/null || { echo "missing economics command: $cmd" >&2; exit 1; }
  done
  research-econ-data --self-test
  DSH_RESEARCH_SKIP_QUARTO_SMOKE=1 research-econ-model --self-test
  research-econ-did --self-test
fi

if [[ -r /sys/fs/cgroup/memory.peak ]]; then
  echo "memory.peak=$(cat /sys/fs/cgroup/memory.peak)"
fi

echo "[✓] Research runtime smoke passed"
