# syntax=docker/dockerfile:1
# Isolated Reverse edition: native Agent preset and dedicated analysis tools.
ARG BASE_IMAGE=ghcr.io/paimoncai/dsh-docker-install:latest
FROM ${BASE_IMAGE}
ARG TARGETARCH
ARG REA_VERSION=6.4.0
ARG GHIDRA_VERSION=12.1.4
ARG GHIDRA_RELEASE_DATE=20260921
ARG GHIDRA_SHA256=ddac49f903da9d5bac833e5cc79395098b9c33cfd3279be5f31bd00387d2d4db
ARG JADX_VERSION=1.5.3
ARG JADX_MCP_VERSION=0.7.1
ARG JADX_MCP_SHA256=6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75
ARG JADX_SHA256=8280f3799c0273fe797a2bcd90258c943e451fd195f13d05400de5e6451d15ec
LABEL io.caicailo.dsh.edition="reverse" \
      org.opencontainers.image.title="DeepSeek Harness Reverse Edition" \
      org.opencontainers.image.description="Native Reverse Agent, REA, Ghidra, JADX, GDB and Frida in a dedicated DSH container" \
      org.opencontainers.image.source="https://github.com/PaiMonCai/dsh-docker-install"
ENV DSH_REVERSE_AGENT_PATCH=/opt/dsh-reverse/cordis.patch.yml \
    DSH_REVERSE_EDITION=true \
    GHIDRA_INSTALL_DIR=/opt/ghidra \
    REA_JADX_MCP_JAR=/opt/jadx-headless-mcp/jadx-headless-mcp.jar \
    JAVA_HOME=/usr/lib/jvm/java-21-openjdk-${TARGETARCH} \
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
      "lief==1.0.0" "flare-capa==9.4.0" \
 && /opt/dsh-reverse/venv/bin/python -c "import pwn, frida; print('reverse Python tools ready')" \
 && /opt/dsh-reverse/venv/bin/frida --version \
 && /opt/dsh-reverse/venv/bin/python -c "import lief, capa; print('static triage engines ready')"

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

# REA 6.4.0 uses the audited JADX headless MCP fat JAR (separate from CLI).
RUN set -eux; \
    mkdir -p /opt/jadx-headless-mcp; \
    curl -fsSL --retry 4 \
      "https://github.com/1013503897/jadx-headless-mcp/releases/download/v${JADX_MCP_VERSION}/jadx-headless-mcp-${JADX_MCP_VERSION}-all.jar" \
      -o /opt/jadx-headless-mcp/jadx-headless-mcp.jar; \
    echo "${JADX_MCP_SHA256}  /opt/jadx-headless-mcp/jadx-headless-mcp.jar" | sha256sum -c -; \
    test -s /opt/jadx-headless-mcp/jadx-headless-mcp.jar

# Native Reverse Agent declaration and bundled static skills.
# The build no longer fetches third-party Agent source or Web bundles.
COPY reverse/cordis.patch.yml /opt/dsh-reverse/cordis.patch.yml
COPY reverse/skills/ /opt/dsh-reverse/skills/
COPY reverse/skills-bootstrap.mjs /opt/dsh-reverse/skills-bootstrap.mjs
COPY reverse/prompt-manager/ /opt/dsh-reverse/prompt-manager/
COPY reverse/preset-smoke.mjs /opt/dsh-reverse/preset-smoke.mjs
COPY reverse/service-health.mjs /opt/dsh-reverse/service-health.mjs
COPY reverse/reverse-healthcheck.cjs /opt/dsh-reverse/reverse-healthcheck.cjs
COPY --chmod=0755 reverse/bin/reverse-triage /usr/local/bin/reverse-triage
COPY --chmod=0755 reverse/bin/reverse-ghidra /usr/local/bin/reverse-ghidra
COPY --chmod=0755 reverse/bin/reverse-js-triage /usr/local/bin/reverse-js-triage
COPY reverse/ghidra-scripts/ /opt/dsh-reverse/ghidra-scripts/
COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/dsh-entrypoint
RUN ln -s /opt/dsh-reverse/prompt-manager/cli.mjs /usr/local/bin/reverse-prompt \
 && chmod 0755 /opt/dsh-reverse/prompt-manager/cli.mjs
RUN node --check /opt/dsh-reverse/skills-bootstrap.mjs \
 && node --check /opt/dsh-reverse/prompt-manager/core.mjs \
 && node --check /opt/dsh-reverse/prompt-manager/index.mjs \
 && node --check /opt/dsh-reverse/prompt-manager/cli.mjs \
 && node --check /opt/dsh-reverse/prompt-manager/inspect.mjs \
 && reverse-prompt list >/dev/null \
 && node --check /opt/dsh-reverse/preset-smoke.mjs \
 && node --check /opt/dsh-reverse/service-health.mjs \
 && node --check /opt/dsh-reverse/reverse-healthcheck.cjs \
 && python3 -m py_compile /usr/local/bin/reverse-triage /usr/local/bin/reverse-ghidra \
 && reverse-triage --help >/dev/null \
 && reverse-ghidra --help >/dev/null \
 && reverse-js-triage --help >/dev/null \
 && node --input-type=module -e "import('/opt/dsh-reverse/skills-bootstrap.mjs').then(async m=>{const fs=await import('node:fs');const home=fs.mkdtempSync('/tmp/dsh-reverse-skill-smoke-');m.installSkills(home);for(const n of m.SKILLS){if(!fs.existsSync(home+'/reverse-engineering/skills/'+n+'/SKILL.md'))process.exit(1)}})" \
 && bash -n /usr/local/bin/dsh-entrypoint \
 && test ! -e /opt/dsh-reverse/purge \
 && test ! -e /opt/dsh-reverse/purge-ui \
 && DSH_HOME="$(mktemp -d)" dsh --profile web \
       --patch /opt/dsh-reverse/cordis.patch.yml --dump-config > /tmp/reverse-config.yml \
 && grep -Fq 'dsh-reverse-preset-declaration' /tmp/reverse-config.yml \
 && grep -Fq 'dsh-reverse-prompt-manager' /tmp/reverse-config.yml \
 && grep -Fq 'session-controller' /tmp/reverse-config.yml \
 && grep -Fq 'rea-mcp' /tmp/reverse-config.yml \
 && ! grep -Eiq 'dsh-purge|dsh-reverse-redteam' /tmp/reverse-config.yml \
 && command -v rea && command -v jadx && command -v gdb \
 && test -f /opt/ghidra/support/analyzeHeadless
WORKDIR /workspace
VOLUME ["/root/.dsh"]
EXPOSE 3080

# Reverse must report unhealthy when sessionController fails to activate.
HEALTHCHECK --interval=30s --timeout=7s --start-period=45s --retries=3 \
  CMD ["node", "/opt/dsh-reverse/reverse-healthcheck.cjs"]
