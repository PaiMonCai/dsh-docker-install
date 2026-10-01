#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ENV_NAME = 'DSH_DOCKER_RESTART';
const ENV_VALUE = 'container';
const TRUST_MARKER = 'DSH Docker restart adapter: trust container peer';
const SCHEDULE_MARKER = 'DSH Docker restart adapter: delegate restart to Docker';

function patchTrustedRestartText(before) {
  if (before.includes(TRUST_MARKER)) {
    return { text: before, changed: false, alreadyPatched: true };
  }

  const patterns = [
    /const address = request\.socket\.remoteAddress;\s*if \(address !== '127\.0\.0\.1' && address !== '::1' && address !== '::ffff:127\.0\.0\.1'\) return false;/m,
    /const address = request\.socket\.remoteAddress\s*\n\s*if \(address !== '127\.0\.0\.1' && address !== '::1' && address !== '::ffff:127\.0\.0\.1'\) return false/m,
  ];

  for (const pattern of patterns) {
    if (!pattern.test(before)) continue;
    const replacement = [
      'const address = request.socket.remoteAddress;',
      `  // ${TRUST_MARKER}.`,
      '  // Docker\'s published loopback port reaches the container through the bridge,',
      '  // so the socket peer is not 127.0.0.1 even though the browser used a loopback',
      `  // Host/Origin. Only the installer-set ${ENV_NAME} flag enables this exception;`,
      '  // the existing forwarding-header and loopback Host/Origin checks below still apply.',
      `  const dockerManaged = process.env.${ENV_NAME} === '${ENV_VALUE}';`,
      "  const loopbackPeer = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';",
      '  let dockerPeer = false;',
      '  if (dockerManaged && address !== undefined) {',
      '    try {',
      "      const routeText = process.getBuiltinModule('fs')?.readFileSync('/proc/net/route', 'utf8');",
      "      const route = typeof routeText === 'string' ? routeText",
      "        .split('\\n')",
      "        .map((line) => line.trim().split(/\\s+/u))",
      "        .find((fields) => fields.length > 3 && fields[1] === '00000000' && (Number.parseInt(fields[3], 16) & 0x2) !== 0) : undefined;",
      '      const hex = route?.[2];',
      '      if (hex !== undefined && /^[0-9A-Fa-f]{8}$/u.test(hex)) {',
      "        const gateway = [hex.slice(6, 8), hex.slice(4, 6), hex.slice(2, 4), hex.slice(0, 2)]",
      "          .map((part) => String(Number.parseInt(part, 16))).join('.');",
      "        dockerPeer = address === gateway || address === `::ffff:${gateway}`;",
      '      }',
      '    } catch {}',
      '  }',
      '  if (!loopbackPeer && !dockerPeer) return false;',
    ].join('\n');
    return { text: before.replace(pattern, replacement), changed: true, alreadyPatched: false };
  }

  return {
    text: before,
    changed: false,
    alreadyPatched: false,
    reason: 'trustedRestartRequest peer guard not found',
  };
}

function patchScheduleRestartText(before) {
  if (before.includes(SCHEDULE_MARKER)) {
    return { text: before, changed: false, alreadyPatched: true };
  }

  const patterns = [
    /export function scheduleRestart\(port(?: = null)?, recovery\) \{\s*/m,
    /export function scheduleRestart\(port: number \| null = null, recovery\?: RecoveryHandoffConfig\): RestartResult \{\s*/m,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(before);
    if (match === null) continue;

    const body = [
      match[0].trimEnd(),
      '',
      `  // ${SCHEDULE_MARKER}.`,
      '  // The container is started with Docker\'s restart policy, so spawning another',
      '  // dsh inside the same container would race the current listener and fight the',
      '  // supervisor. Stop only this host; tini exits with it and Docker recreates the',
      '  // container process tree from the normal entrypoint.',
      `  if (process.env.${ENV_NAME} === '${ENV_VALUE}') {`,
      "    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);",
      "    const logOut = join(tmpdir(), `dsh-market-restart-${stamp}.out.log`);",
      "    const logErr = join(tmpdir(), `dsh-market-restart-${stamp}.err.log`);",
      "    setTimeout(() => process.kill(process.pid, 'SIGTERM'), 500);",
      '    return { pid: process.pid, helperPid: undefined, logOut, logErr, recovery: null };',
      '  }',
      '',
    ].join('\n');

    return {
      text: before.slice(0, match.index) + body + before.slice(match.index + match[0].length),
      changed: true,
      alreadyPatched: false,
    };
  }

  return {
    text: before,
    changed: false,
    alreadyPatched: false,
    reason: 'scheduleRestart function not found',
  };
}

function patchRestartText(before) {
  const trusted = patchTrustedRestartText(before);
  if (!trusted.changed && !trusted.alreadyPatched) return trusted;
  const scheduled = patchScheduleRestartText(trusted.text);
  if (!scheduled.changed && !scheduled.alreadyPatched) return scheduled;
  return {
    text: scheduled.text,
    changed: trusted.changed || scheduled.changed,
    alreadyPatched: trusted.alreadyPatched && scheduled.alreadyPatched,
  };
}

function atomicWrite(file, content) {
  const stat = fs.statSync(file);
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.dsh-docker-restart-${process.pid}-${Date.now()}`,
  );
  fs.writeFileSync(tmp, content, { mode: stat.mode });
  fs.renameSync(tmp, file);
}

function packageRoots(dshHome) {
  const profiles = path.join(dshHome, 'profiles');
  let entries = [];
  try {
    entries = fs.readdirSync(profiles, { withFileTypes: true });
  } catch {
    return [];
  }

  const roots = [];
  const seen = new Set();
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    for (const packageName of ['dshmarket', 'dsh-market']) {
      const linked = path.join(profiles, entry.name, 'node_modules', packageName);
      const manifest = path.join(linked, 'package.json');
      if (!fs.existsSync(manifest)) continue;
      let root = linked;
      try {
        root = fs.realpathSync(linked);
      } catch {}
      if (seen.has(root)) continue;
      seen.add(root);
      roots.push({ profile: entry.name, root });
    }
  }
  return roots;
}

function apply(file, required) {
  if (!fs.existsSync(file)) {
    if (required) return { ok: false, changed: false, reason: `missing ${file}` };
    return { ok: true, changed: false, skipped: true };
  }

  const before = fs.readFileSync(file, 'utf8');
  const result = patchRestartText(before);
  if (!result.changed && !result.alreadyPatched) {
    if (required) return { ok: false, changed: false, reason: `${result.reason}: ${file}` };
    return { ok: true, changed: false, skipped: true };
  }
  if (result.alreadyPatched) return { ok: true, changed: false, alreadyPatched: true };

  atomicWrite(file, result.text);
  return { ok: true, changed: true };
}

function selfTest() {
  const compiled = `
export function trustedRestartRequest(request) {
  const address = request.socket.remoteAddress;
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false;
  if (request.headers.forwarded !== undefined
    || request.headers['x-forwarded-for'] !== undefined
    || request.headers['x-real-ip'] !== undefined) return false;
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!loopbackAuthority(host)) return false;
  if (origin === undefined || host === undefined) return false;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host;
  } catch {
    return false;
  }
}
export function scheduleRestart(port = null, recovery) {
  const launch = restartLaunch();
  const spawned = respawnInvocation(launch);
}
`;
  const source = `
export function trustedRestartRequest(request: Pick<IncomingMessage, 'headers' | 'socket'>): boolean {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  if (request.headers.forwarded !== undefined) return false
  const origin = request.headers.origin
  const host = request.headers.host
  if (!loopbackAuthority(host)) return false
  if (origin === undefined || host === undefined) return false
  return new URL(origin).host === host
}
export function scheduleRestart(port: number | null = null, recovery?: RecoveryHandoffConfig): RestartResult {
  const launch = restartLaunch()
}
`;

  for (const sample of [compiled, source]) {
    const result = patchRestartText(sample);
    if (!result.changed) throw new Error(`self-test: patch did not change sample: ${result.reason ?? 'unknown'}`);
    if (!result.text.includes(`process.env.${ENV_NAME} === '${ENV_VALUE}'`)) {
      throw new Error('self-test: container environment gate missing');
    }
    if (!result.text.includes('if (!loopbackPeer && !dockerPeer) return false')) {
      throw new Error('self-test: Docker gateway peer exception missing');
    }
    if (!result.text.includes('request.headers.forwarded')) {
      throw new Error('self-test: forwarding-header guard was lost');
    }
    if (!result.text.includes('loopbackAuthority(host)')) {
      throw new Error('self-test: loopback Host/Origin guard was lost');
    }
    if (!result.text.includes("process.kill(process.pid, 'SIGTERM')")) {
      throw new Error('self-test: supervisor exit path missing');
    }
    const second = patchRestartText(result.text);
    if (second.changed || !second.alreadyPatched) {
      throw new Error('self-test: patch is not idempotent');
    }
  }

  process.stdout.write('dsh-market Docker restart patch self-test passed.\n');
}

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }

  if (process.env[ENV_NAME] !== ENV_VALUE) {
    process.stdout.write(`dsh-market Docker restart patch: ${ENV_NAME} is not ${ENV_VALUE}; skipped.\n`);
    return;
  }

  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const roots = packageRoots(dshHome);
  if (roots.length === 0) {
    process.stdout.write('dsh-market Docker restart patch: dshmarket is not installed; nothing to do.\n');
    return;
  }

  let failures = 0;
  for (const { profile, root } of roots) {
    const targets = [
      { file: path.join(root, 'lib', 'restart.js'), required: true },
      { file: path.join(root, 'src', 'restart.ts'), required: false },
    ];
    let changed = 0;
    for (const target of targets) {
      const result = apply(target.file, target.required);
      if (!result.ok) {
        failures += 1;
        process.stderr.write(`dsh-market Docker restart patch [${profile}] WARNING: ${result.reason}\n`);
      } else if (result.changed) {
        changed += 1;
        process.stdout.write(`dsh-market Docker restart patch [${profile}]: patched ${target.file}\n`);
      }
    }
    if (changed === 0 && failures === 0) {
      process.stdout.write(`dsh-market Docker restart patch [${profile}]: already applied.\n`);
    }
  }

  if (failures > 0) process.exitCode = 2;
}

main();
