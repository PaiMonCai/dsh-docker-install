#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const npmRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
const packageSuffix = path.join(
  '@deepseek-ai',
  'dsh-client-ui-settings',
  'lib',
  'client.js',
);

function walk(dir, results) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, results);
    } else if (entry.isFile() && full.endsWith(packageSuffix)) {
      results.push(full);
    }
  }
}

const files = [];
walk(npmRoot, files);

if (files.length === 0) {
  throw new Error(
    `Remote Settings patch: cannot find ${packageSuffix} under ${npmRoot}`,
  );
}

// This is intentionally narrow. Only the Settings mirror persistence decision
// is changed. Other isLoopback checks retain their upstream behavior.
const persistencePattern =
  /\b[A-Za-z_$][\w$]*\.remote\.\$host\.isLoopback\s*\?\s*(['"])host\1\s*:\s*(['"])memory\2/g;

let replacements = 0;
const patchedFiles = [];

for (const file of files) {
  const before = fs.readFileSync(file, 'utf8');
  let count = 0;
  const after = before.replace(persistencePattern, (_match, q1) => {
    count += 1;
    return `${q1}host${q1}`;
  });

  if (count === 0) continue;
  fs.writeFileSync(file, after);
  replacements += count;
  patchedFiles.push({ file, count });
}

if (replacements === 0) {
  throw new Error(
    'Remote Settings patch: Settings persistence expression was not found; upstream layout may have changed.',
  );
}

for (const item of patchedFiles) {
  process.stdout.write(
    `patched remote Settings persistence: ${item.file} (${item.count})\n`,
  );
}

process.stdout.write(
  `Remote Settings patch applied successfully: ${replacements} replacement(s).\n`,
);
