#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const npmRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();

function walk(dir, files) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (entry.isFile() && /\.(?:js|mjs|cjs)$/.test(entry.name)) {
      files.push(full);
    }
  }
}

const files = [];
walk(npmRoot, files);

// Upstream Settings chooses durable host persistence only for loopback browser
// sessions. Patch only this exact ternary; other isLoopback checks remain intact.
const persistencePattern =
  /\b[A-Za-z_$][\w$]*\.remote\.\$host\.isLoopback\s*\?\s*(['"])host\1\s*:\s*(['"])memory\2/g;

let totalReplacements = 0;
let webDistReplacements = 0;
const patchedFiles = [];

for (const file of files) {
  let before;
  try {
    before = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  let count = 0;
  const after = before.replace(persistencePattern, (_match, q1) => {
    count += 1;
    return `${q1}host${q1}`;
  });

  if (count === 0) continue;

  fs.writeFileSync(file, after);
  totalReplacements += count;
  if (
    file.includes('@deepseek-ai/dsh-web-frontend') &&
    file.includes(`${path.sep}dist${path.sep}`)
  ) {
    webDistReplacements += count;
  }
  patchedFiles.push({ file, count });
}

if (totalReplacements === 0) {
  throw new Error(
    'Remote Settings patch: Settings persistence ternary was not found in the installed DSH packages.',
  );
}

if (webDistReplacements === 0) {
  const webDistFiles = files.filter(
    file =>
      file.includes('@deepseek-ai/dsh-web-frontend') &&
      file.includes(`${path.sep}dist${path.sep}`),
  );
  process.stderr.write(
    `Remote Settings patch diagnostic: found ${webDistFiles.length} web frontend JS asset(s).\n`,
  );
  for (const file of webDistFiles) {
    let source = '';
    try {
      source = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    let start = 0;
    let shown = 0;
    while (shown < 4) {
      const index = source.indexOf('isLoopback', start);
      if (index < 0) break;
      const left = Math.max(0, index - 240);
      const right = Math.min(source.length, index + 360);
      process.stderr.write(
        `--- ${file} :: isLoopback snippet ---\n${source.slice(left, right)}\n`,
      );
      start = index + 'isLoopback'.length;
      shown += 1;
    }
  }
  throw new Error(
    'Remote Settings patch: no dsh-web-frontend/dist asset was patched; see diagnostics above.',
  );
}

for (const item of patchedFiles) {
  process.stdout.write(`patched remote Settings: ${item.file} (${item.count})\n`);
}
process.stdout.write(
  `Remote Settings patch applied: ${totalReplacements} replacement(s), ${webDistReplacements} in web frontend dist.\n`,
);
