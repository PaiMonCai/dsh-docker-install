#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const npmRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();

const targets = [
  {
    packageName: '@deepseek-ai/dsh-client-ui-settings',
    description: 'settings persistence',
    expectedMin: 1,
  },
  {
    packageName: '@deepseek-ai/dsh-client-ui-settings-general',
    description: 'settings document controller',
    expectedMin: 1,
  },
];

function walk(dir, wantedSuffix, results) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, wantedSuffix, results);
    } else if (entry.isFile() && full.endsWith(wantedSuffix)) {
      results.push(full);
    }
  }
}

function patchPackage(target) {
  const suffix = path.join(
    '@deepseek-ai',
    target.packageName.split('/')[1],
    'lib',
    'client.js',
  );
  const files = [];
  walk(npmRoot, suffix, files);

  if (files.length === 0) {
    throw new Error(
      `Remote Settings patch: cannot find ${target.packageName}/lib/client.js under ${npmRoot}`,
    );
  }

  let replacements = 0;

  for (const file of files) {
    const before = fs.readFileSync(file, 'utf8');

    // The upstream browser code gates durable Settings on
    // ctx.remote.$host.isLoopback. In this Docker image the Web UI is intended
    // to be used behind token auth + Trusted Hosts + HTTPS reverse proxy, so
    // keep Settings persistence enabled for remote browser sessions too.
    const pattern = /\b[A-Za-z_$][\w$]*\.remote\.\$host\.isLoopback\b/g;
    let count = 0;
    const after = before.replace(pattern, () => {
      count += 1;
      return 'true';
    });

    if (count > 0) {
      fs.writeFileSync(file, after);
      replacements += count;
      process.stdout.write(
        `patched ${target.description}: ${file} (${count} replacement(s))\n`,
      );
    }
  }

  if (replacements < target.expectedMin) {
    throw new Error(
      `Remote Settings patch: expected at least ${target.expectedMin} replacement(s) in ${target.packageName}, got ${replacements}`,
    );
  }
}

for (const target of targets) {
  patchPackage(target);
}

process.stdout.write('Remote Settings patch applied successfully.\n');
