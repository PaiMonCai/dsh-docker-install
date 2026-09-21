#!/usr/bin/env bash
set -Eeuo pipefail

export DSH_HOME="${DSH_HOME:-/root/.dsh}"

runtime_root="${DSH_RESEARCH_RUNTIME_ROOT:-$DSH_HOME/research-runtime}"
if ! mkdir -p "$runtime_root" 2>/dev/null || ! touch "$runtime_root/.write-test" 2>/dev/null; then
  runtime_root="/tmp/dsh-research-runtime"
  mkdir -p "$runtime_root"
fi
rm -f "$runtime_root/.write-test" 2>/dev/null || true

runtime_venv="${DSH_RESEARCH_RUNTIME_VENV:-$runtime_root/venv}"
base_venv="${DSH_RESEARCH_VENV:-/opt/dsh-research/venv}"
cache_root="${DSH_RESEARCH_CACHE_ROOT:-/tmp/dsh-research-cache}"

export UV_CACHE_DIR="${UV_CACHE_DIR:-$cache_root/uv}"
export PIP_CACHE_DIR="${PIP_CACHE_DIR:-$cache_root/pip}"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$cache_root/xdg}"
export XDG_DATA_HOME="${XDG_DATA_HOME:-$cache_root/xdg-data}"
export MPLCONFIGDIR="${MPLCONFIGDIR:-$cache_root/matplotlib}"
export NUMBA_CACHE_DIR="${NUMBA_CACHE_DIR:-$cache_root/numba}"
export JUPYTER_RUNTIME_DIR="${JUPYTER_RUNTIME_DIR:-$cache_root/jupyter-runtime}"
export IPYTHONDIR="${IPYTHONDIR:-$cache_root/ipython}"
export PYTHONPYCACHEPREFIX="${PYTHONPYCACHEPREFIX:-$cache_root/pycache}"
export DENO_DIR="${DENO_DIR:-$cache_root/deno}"
export TEXMFCACHE="${TEXMFCACHE:-$cache_root/texmf-cache}"
export TEXMFVAR="${TEXMFVAR:-$cache_root/texmf-var}"
export TEXMFCONFIG="${TEXMFCONFIG:-$cache_root/texmf-config}"
export R_LIBS_USER="${R_LIBS_USER:-$runtime_root/R/library}"

mkdir -p   "$UV_CACHE_DIR"   "$PIP_CACHE_DIR"   "$XDG_CACHE_HOME"   "$XDG_DATA_HOME"   "$MPLCONFIGDIR"   "$NUMBA_CACHE_DIR"   "$JUPYTER_RUNTIME_DIR"   "$IPYTHONDIR"   "$PYTHONPYCACHEPREFIX"   "$DENO_DIR"   "$TEXMFCACHE"   "$TEXMFVAR"   "$TEXMFCONFIG"   "$R_LIBS_USER"

system_python="/usr/bin/python3"
base_python="$base_venv/bin/python"

needs_recreate=0
system_python_version="$("$system_python" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
if [[ ! -x "$runtime_venv/bin/python" ]]; then
  needs_recreate=1
else
  runtime_python_version="$("$runtime_venv/bin/python" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || true)"
  [[ "$runtime_python_version" == "$system_python_version" ]] || needs_recreate=1
fi

if [[ "$needs_recreate" == "1" ]]; then
  rm -rf "$runtime_venv"
  "$system_python" -m venv "$runtime_venv"
fi

base_site="$("$base_python" - <<'PY'
import site
print(site.getsitepackages()[0])
PY
)"
runtime_site="$("$runtime_venv/bin/python" - <<'PY'
import site
print(site.getsitepackages()[0])
PY
)"

printf '%s\n' "$base_site" > "$runtime_site/dsh-research-base.pth"

export DSH_RESEARCH_RUNTIME_VENV="$runtime_venv"
export VIRTUAL_ENV="$runtime_venv"
export PATH="$runtime_venv/bin:$base_venv/bin:$PATH"
export QUARTO_PYTHON="$runtime_venv/bin/python"
export QUARTO_R="${QUARTO_R:-/usr/bin}"

exec /usr/local/bin/dsh-entrypoint "$@"
