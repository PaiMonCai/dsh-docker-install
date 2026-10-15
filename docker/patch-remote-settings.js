#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const npmRoot = process.env.DSH_SETTINGS_NPM_ROOT || execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
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

// alpha.3 removed the browser-origin persistence gate upstream: both the
// mirror and forms now always use authenticated Host settings. Only accept that
// exact host-only composition when the legacy expression is absent.
const hostOnlyMirrorPattern = /\bnew\s+SettingsDescribeMirror\s*\(\s*[A-Za-z_$][\w$]*\s*\)/;
const hostOnlyFormsPattern = /\bnew\s+ConfigForms\s*\(\s*[A-Za-z_$][\w$]*\s*,\s*\{\s*mirror\s*,\s*schema\s*\}\s*\)/;

let replacements = 0;
let upstreamHostOnly = 0;
const patchedFiles = [];

for (const file of files) {
  const before = fs.readFileSync(file, 'utf8');
  let count = 0;
  const after = before.replace(persistencePattern, (_match, q1) => {
    count += 1;
    return `${q1}host${q1}`;
  });

  if (count === 0) {
    if (hostOnlyMirrorPattern.test(before) && hostOnlyFormsPattern.test(before)
      && !/\.\$host\.isLoopback\s*\?/.test(before)) {
      upstreamHostOnly += 1;
      process.stdout.write(`Remote Settings patch not needed: upstream persists through Host (${file}).\\n`);
      continue;
    }
    throw new Error(`Remote Settings patch: unrecognized Settings persistence layout in ${file}; refusing to skip compatibility check.`);
  }
  replacements += count;
  patchedFiles.push({ file, count, after });
}

if (replacements === 0 && upstreamHostOnly === 0) {
  throw new Error(
    'Remote Settings patch: Settings persistence expression was not found; upstream layout may have changed.',
  );
}

for (const item of patchedFiles) {
  fs.writeFileSync(item.file, item.after);
  process.stdout.write(
    `patched remote Settings persistence: ${item.file} (${item.count})\n`,
  );
}

process.stdout.write(
  `Remote Settings compatibility verified: ${replacements} replacement(s), ${upstreamHostOnly} upstream host-only file(s).\\n`,
);
