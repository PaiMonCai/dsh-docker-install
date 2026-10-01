#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const npmRoot = process.env.DSH_PATCH_NPM_ROOT
  || execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
const packageSuffix = path.join(
  '@deepseek-ai',
  'dsh-host-directory-picker-browse',
  'lib',
  'index.js',
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
    `Workspace picker patch: cannot find ${packageSuffix} under ${npmRoot}`,
  );
}

const alreadyPatched = /process\.env\.DSH_WORKSPACE_ROOT/;
const homePattern = /\b(const|let|var)\s+home\s*=\s*homedir\(\)\s*;/g;

let replacements = 0;
let already = 0;

for (const file of files) {
  const before = fs.readFileSync(file, 'utf8');
  if (alreadyPatched.test(before)) {
    already += 1;
    continue;
  }

  let count = 0;
  const after = before.replace(homePattern, (_match, decl) => {
    count += 1;
    return `${decl} home = process.env.DSH_WORKSPACE_ROOT || "/workspace";`;
  });

  if (count === 0) continue;
  fs.writeFileSync(file, after);
  replacements += count;
  process.stdout.write(
    `patched workspace picker home: ${file} (${count})\n`,
  );
}

if (replacements === 0 && already === 0) {
  throw new Error(
    'Workspace picker patch: homedir() assignment was not found; upstream layout may have changed.',
  );
}

process.stdout.write(
  replacements > 0
    ? `Workspace picker patch applied successfully: ${replacements} replacement(s).\n`
    : `Workspace picker patch already applied: ${already} file(s).\n`,
);
