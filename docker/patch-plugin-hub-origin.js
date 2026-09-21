#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROUTE_MARKER = 'DSH_TRUSTED_HOSTS';
const routePattern = /const localHostnames = new Set\(\['localhost', '127\\.0\\.0\\.1', '\\[::1\\]'\]\);?\s*return url\.host === host && localHostnames\.has\(url\.hostname\);?/m;
const pnpmPolicyPattern = /ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION\|Minimum release age\|untrusted origin/g;

function patchRouteText(before) {
  if (before.includes(ROUTE_MARKER) && before.includes('trustedHosts.has(host)')) {
    return { text: before, changed: false, alreadyPatched: true };
  }

  let changed = false;
  const text = before.replace(routePattern, (match) => {
    changed = true;
    const semicolon = match.includes(';') ? ';' : '';
    return [
      "const localHostnames = new Set(['localhost', '127.0.0.1', '[::1]'])" + semicolon,
      "        const trustedHosts = new Set(",
      "            (process.env.DSH_TRUSTED_HOSTS ?? '')",
      "                .split(/[,\\s]+/)",
      "                .map((value) => value.trim())",
      "                .filter(Boolean),",
      "        )" + semicolon,
      "        return url.host === host",
      "            && (localHostnames.has(url.hostname) || trustedHosts.has(host))" + semicolon,
    ].join('\\n        ');
  });

  return { text, changed, alreadyPatched: false };
}

function patchFailureText(before) {
  const text = before.replace(
    pnpmPolicyPattern,
    'ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION|Minimum release age|ERR_PNPM_UNTRUSTED_ORIGIN',
  );
  return { text, changed: text !== before };
}

function atomicWrite(file, content) {
  const stat = fs.statSync(file);
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.dsh-patch-${process.pid}-${Date.now()}`,
  );
  fs.writeFileSync(tmp, content, { mode: stat.mode });
  fs.renameSync(tmp, file);
}

function applyTextPatch(file, transform, label, required = false) {
  if (!fs.existsSync(file)) {
    if (required) return { ok: false, changed: false, reason: `${label}: missing ${file}` };
    return { ok: true, changed: false, skipped: true };
  }

  const before = fs.readFileSync(file, 'utf8');
  const result = transform(before);
  if (result.alreadyPatched) {
    return { ok: true, changed: false, alreadyPatched: true };
  }
  if (!result.changed) {
    if (required) {
      return {
        ok: false,
        changed: false,
        reason: `${label}: expected upstream expression not found in ${file}`,
      };
    }
    return { ok: true, changed: false, skipped: true };
  }

  atomicWrite(file, result.text);
  return { ok: true, changed: true };
}

function profilePackageRoots(dshHome) {
  const profiles = path.join(dshHome, 'profiles');
  let entries = [];
  try {
    entries = fs.readdirSync(profiles, { withFileTypes: true });
  } catch {
    return [];
  }

  const roots = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const root = path.join(profiles, entry.name, 'node_modules', 'dsh-plugin');
    if (fs.existsSync(path.join(root, 'package.json'))) {
      roots.push({ profile: entry.name, root });
    }
  }
  return roots;
}

function selfTest() {
  const js = `function isSameOrigin(request) {
    const origin = request.headers.origin;
    const host = request.headers.host;
    if (origin === undefined || host === undefined) return false;
    try {
        const url = new URL(origin);
        const localHostnames = new Set(['localhost', '127.0.0.1', '[::1]']);
        return url.host === host && localHostnames.has(url.hostname);
    } catch {
        return false;
    }
}`;
  const ts = `const localHostnames = new Set(['localhost', '127.0.0.1', '[::1]'])
    return url.host === host && localHostnames.has(url.hostname)`;
  const failure = `if (/ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION|Minimum release age|untrusted origin/i.test(message)) return 'pnpmPolicy'`;

  const jsPatched = patchRouteText(js);
  const tsPatched = patchRouteText(ts);
  const failurePatched = patchFailureText(failure);

  if (!jsPatched.changed || !jsPatched.text.includes('trustedHosts.has(host)')) {
    throw new Error('self-test: failed to patch JS route');
  }
  if (!tsPatched.changed || !tsPatched.text.includes('DSH_TRUSTED_HOSTS')) {
    throw new Error('self-test: failed to patch TS route');
  }
  if (!failurePatched.changed
      || !failurePatched.text.includes('ERR_PNPM_UNTRUSTED_ORIGIN')
      || failurePatched.text.includes('|untrusted origin')) {
    throw new Error('self-test: failed to patch pnpm error classification');
  }
  if (patchRouteText(jsPatched.text).changed) {
    throw new Error('self-test: route patch is not idempotent');
  }

  process.stdout.write('Plugin Hub reverse-proxy patch self-test passed.\\n');
}

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }

  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const roots = profilePackageRoots(dshHome);
  if (roots.length === 0) {
    process.stdout.write('Plugin Hub patch: no installed dsh-plugin profile found; nothing to do.\\n');
    return;
  }

  let failures = 0;
  for (const { profile, root } of roots) {
    const targets = [
      {
        file: path.join(root, 'lib', 'http', 'routes.js'),
        transform: patchRouteText,
        label: 'server route',
        required: true,
      },
      {
        file: path.join(root, 'src', 'server', 'http', 'routes.ts'),
        transform: patchRouteText,
        label: 'server source',
        required: false,
      },
      {
        file: path.join(root, 'src', 'client', 'logic', 'failures.ts'),
        transform: patchFailureText,
        label: 'client failure classifier',
        required: false,
      },
    ];

    let changed = 0;
    for (const target of targets) {
      const result = applyTextPatch(
        target.file,
        target.transform,
        target.label,
        target.required,
      );
      if (!result.ok) {
        failures += 1;
        process.stderr.write(`Plugin Hub patch [${profile}] WARNING: ${result.reason}\\n`);
      } else if (result.changed) {
        changed += 1;
        process.stdout.write(`Plugin Hub patch [${profile}]: patched ${target.file}\\n`);
      }
    }

    if (changed === 0 && failures === 0) {
      process.stdout.write(`Plugin Hub patch [${profile}]: already applied.\\n`);
    }
  }

  if (failures > 0) process.exitCode = 2;
}

main();
