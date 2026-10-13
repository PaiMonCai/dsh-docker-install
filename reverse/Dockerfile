# syntax=docker/dockerfile:1
# Independent container/volume: the full host-level purge patch NEVER runs in Standard.
ARG BASE_IMAGE=ghcr.io/paimoncai/dsh-docker-install:latest
FROM ${BASE_IMAGE}
ARG PURGE_COMMIT=28c8eaf5b5de70d53795387d01faae9498a83d63
ARG REA_VERSION=6.4.0
ARG GHIDRA_VERSION=11.4.2
ARG GHIDRA_RELEASE_DATE=20250826
ARG GHIDRA_SHA256=795a02076af16257bd6f3f4736c4fc152ce9ff1f95df35cd47e2adc086e037a6
ARG JADX_VERSION=1.5.3
ARG JADX_SHA256=8280f3799c0273fe797a2bcd90258c943e451fd195f13d05400de5e6451d15ec
LABEL io.caicailo.dsh.edition="reverse" \
      org.opencontainers.image.title="DeepSeek Harness Reverse Edition" \
      org.opencontainers.image.description="Full dsh-purge, REA, Ghidra, JADX, GDB and Frida in a dedicated DSH container" \
      org.opencontainers.image.source="https://github.com/PaiMonCai/dsh-docker-install"
ENV DSH_REVERSE_PURGE_PATCH=/opt/dsh-reverse/cordis.patch.yml \
    DSH_REVERSE_AGENT_ENABLED=false \
    DSH_REVERSE_EDITION=true \
    GHIDRA_INSTALL_DIR=/opt/ghidra \
    PATH=/opt/dsh-reverse/venv/bin:/usr/local/bin:${PATH}
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      openjdk-21-jdk-headless gdb gdb-multiarch binutils file strace ltrace \
      apktool xxd patchelf libmagic1 libffi-dev libssl-dev \
 && rm -rf /var/lib/apt/lists/* \
 && java -version && gdb --version | head -1 && apktool --version

# Only the reverse-edition build modifies npm. No installation at startup.
RUN npm install --global --no-audit --no-fund "rea-agents@${REA_VERSION}" \
 && command -v rea \
 && npm ls --global --depth=0 rea-agents | grep -F "rea-agents@${REA_VERSION}" \
 && rm -rf "${NPM_CONFIG_CACHE}"

RUN uv venv --seed /opt/dsh-reverse/venv \
 && UV_NO_CACHE=1 uv pip install --python /opt/dsh-reverse/venv/bin/python \
      "pwntools==4.15.0" "frida-tools==14.11.0" \
 && /opt/dsh-reverse/venv/bin/python -c "import pwn, frida; print('reverse Python tools ready')" \
 && /opt/dsh-reverse/venv/bin/frida --version

# Pin official release files to publisher SHA-256.
RUN set -eux; \
    curl -fsSL --retry 4 \
      "https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_${GHIDRA_VERSION}_build/ghidra_${GHIDRA_VERSION}_PUBLIC_${GHIDRA_RELEASE_DATE}.zip" -o /tmp/ghidra.zip; \
    echo "${GHIDRA_SHA256}  /tmp/ghidra.zip" | sha256sum -c -; \
    mkdir -p /opt/dsh-reverse/ghidra-dist; \
    unzip -q /tmp/ghidra.zip -d /opt/dsh-reverse/ghidra-dist; \
    test -f "/opt/dsh-reverse/ghidra-dist/ghidra_${GHIDRA_VERSION}_PUBLIC/support/analyzeHeadless"; \
    ln -s "/opt/dsh-reverse/ghidra-dist/ghidra_${GHIDRA_VERSION}_PUBLIC" /opt/ghidra; \
    rm -f /tmp/ghidra.zip

RUN set -eux; \
    curl -fsSL --retry 4 \
      "https://github.com/skylot/jadx/releases/download/v${JADX_VERSION}/jadx-${JADX_VERSION}.zip" -o /tmp/jadx.zip; \
    echo "${JADX_SHA256}  /tmp/jadx.zip" | sha256sum -c -; \
    mkdir -p /opt/jadx; \
    unzip -q /tmp/jadx.zip -d /opt/jadx; \
    test -f /opt/jadx/bin/jadx; \
    chmod +x /opt/jadx/bin/jadx; \
    ln -s /opt/jadx/bin/jadx /usr/local/bin/jadx; \
    rm -f /tmp/jadx.zip; \
    jadx --version

# A complete pinned dsh-purge snapshot; no runtime git clone.
RUN set -eux; \
    mkdir -p /opt/dsh-reverse/purge; \
    git init /tmp/dsh-purge; \
    git -C /tmp/dsh-purge remote add origin https://github.com/ANRCM0/dsh-purge.git; \
    git -C /tmp/dsh-purge fetch --depth=1 origin "${PURGE_COMMIT}"; \
    test "$(git -C /tmp/dsh-purge rev-parse FETCH_HEAD)" = "${PURGE_COMMIT}"; \
    git -C /tmp/dsh-purge archive "${PURGE_COMMIT}" | tar -xf - -C /opt/dsh-reverse/purge; \
    test -f /opt/dsh-reverse/purge/cordis.patch.yml; \
    test -f /opt/dsh-reverse/purge/client.js; \
    rm -rf /tmp/dsh-purge

COPY reverse/generate-overlay.mjs /opt/dsh-reverse/generate-overlay.mjs
COPY reverse/purge-ui/ /opt/dsh-reverse/purge-ui/
# Reverse only: install the edition-aware entrypoint from this tree. The
# Standard published image and its persistent DSH_HOME remain untouched.
COPY docker/entrypoint.sh /usr/local/bin/dsh-entrypoint
RUN node /opt/dsh-reverse/generate-overlay.mjs \
 && node --check /opt/dsh-reverse/purge/lib/index.js \
 && node --check /opt/dsh-reverse/purge-ui/client.js \
 && node --check /opt/dsh-reverse/purge/lib/redteam/index.js \
 && node --check /opt/dsh-reverse/purge/lib/reverse/index.js \
 && bash -n /usr/local/bin/dsh-entrypoint \
 && DSH_HOME="$(mktemp -d)" dsh --profile web \
       --patch /opt/dsh-reverse/cordis.patch.yml --dump-config | grep -Fq 'dsh-purge' \
 && command -v rea && command -v jadx && command -v gdb \
 && test -f /opt/ghidra/support/analyzeHeadless
WORKDIR /workspace
VOLUME ["/root/.dsh"]
EXPOSE 3080
