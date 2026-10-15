'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.resolve(__dirname, '../docker/patch-remote-settings.js');
const legacy = [
  'function apply(ctx) {',
  '  const schema = new SettingsSchemaService(ctx);',
  '  const persistence = ctx.remote.$host.isLoopback ? "host" : "memory";',
  '  const mirror = new SettingsDescribeMirror(ctx, persistence);',
  '  new ConfigForms(ctx, { mirror, schema, persistence });',
  '}',
].join('\n');
const upstreamHostOnly = [
  'function apply(ctx) {',
  '  const schema = new SettingsSchemaService(ctx);',
  '  const mirror = new SettingsDescribeMirror(ctx);',
  '  new ConfigForms(ctx, { mirror, schema });',
  '}',
].join('\n');

function runWithSource(source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-settings-patch-'));
  const target = path.join(root, '@deepseek-ai/dsh-client-ui-settings/lib/client.js');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, source);
  try {
    const result = spawnSync(process.execPath, [script], {
      env: { ...process.env, DSH_SETTINGS_NPM_ROOT: root },
      encoding: 'utf8',
    });
    return { result, after: fs.readFileSync(target, 'utf8') };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('patches loopback-dependent persistence in legacy DSH', () => {
  const { result, after } = runWithSource(legacy);
  assert.equal(result.status, 0, result.stderr);
  assert.match(after, /const persistence = "host";/);
  assert.doesNotMatch(after, /\$host\.isLoopback\s*\?/);
});

test('accepts new upstream Host-only settings without modifying them', () => {
  const { result, after } = runWithSource(upstreamHostOnly);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(after, upstreamHostOnly);
  assert.match(result.stdout, /upstream persists through Host/);
});

test('rejects unknown upstream Settings structure, leaving it untouched', () => {
  const unknown = 'const persistence = selectStorage(ctx);';
  const { result, after } = runWithSource(unknown);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unrecognized Settings persistence layout/);
  assert.equal(after, unknown);
});

test('rejects removed gate without confirmed Host-only forms wiring', () => {
  const suspicious = upstreamHostOnly.replace(
    'new ConfigForms(ctx, { mirror, schema });',
    'new ConfigForms(ctx, { mirror, schema, persistence: "memory" });',
  );
  const { result, after } = runWithSource(suspicious);
  assert.equal(result.status, 1);
  assert.equal(after, suspicious);
});
