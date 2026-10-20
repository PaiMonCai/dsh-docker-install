import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { validate, OPERATION_CONTRACT_VERSION, SUPPORTED_OPERATIONS } from '../docker/plugins/dsh-instance-manager/index.js'

// Design-time inventory, checked against both runtime allowlists. Neither
// runtime loads editable policy JSON from the Web container or request queue.
const manifest = JSON.parse(readFileSync(new URL('../docker/management-operations.json', import.meta.url), 'utf8'))
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const names = manifest.operations.map(entry => entry.id)

test('the inventory has unique names and an explicit versioned shape', () => {
  assert.equal(manifest.schema, 'dsh-web-management-operations/v1')
  assert.equal(manifest.version, OPERATION_CONTRACT_VERSION)
  assert.equal(new Set(names).size, names.length)
  assert.deepEqual([...names].sort(), [...SUPPORTED_OPERATIONS])
  assert.deepEqual(manifest.taskStates, ['queued', 'running', 'succeeded', 'failed', 'interrupted'])
  for (const item of manifest.operations) {
    assert.ok(['read', 'write', 'destructive'].includes(item.risk), item.id)
    assert.ok(['版本与更新', '运行管理', '网络与服务'].includes(item.category), item.id)
    assert.equal(typeof item.confirmInWeb, 'boolean', item.id)
    assert.equal(Object.getPrototypeOf(item.exampleArguments), Object.prototype, item.id)
  }
})

test('both Web and host allow only the exact inventoried operations and argument shapes', () => {
  for (const item of manifest.operations) {
    assert.doesNotThrow(() => validate(item.id, item.exampleArguments), item.id)
    assert.throws(() => validate(item.id, { ...item.exampleArguments, instance: 'other' }), item.id)
  }
  for (const action of ['shell', 'uninstall', 'install', 'instance-add', 'docker-socket']) {
    assert.throws(() => validate(action, {}), action)
  }

  const script = String.raw`import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location("manager", Path("docker/dsh-web-manager.py"))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
contract = json.loads(Path("docker/management-operations.json").read_text())
for item in contract["operations"]:
    args = item["exampleArguments"]
    if item["id"] == "settings":
        worker.Manager.validate_settings(args)
    else:
        worker.command_for(item["id"], args)
    extra = dict(args, instance="other")
    try:
        if item["id"] == "settings":
            worker.Manager.validate_settings(extra)
        else:
            worker.command_for(item["id"], extra)
    except ValueError:
        pass
    else:
        raise AssertionError("host accepted extra args: " + item["id"])
for action in ("shell", "uninstall", "install", "instance-add", "docker-socket"):
    try:
        worker.command_for(action, {})
    except ValueError:
        pass
    else:
        raise AssertionError("host accepted forbidden action: " + action)
print(json.dumps({"version": worker.OPERATION_CONTRACT_VERSION, "operations": list(worker.SUPPORTED_OPERATIONS)}))
`
  const host = JSON.parse(execFileSync('python3', ['-c', script], { cwd: root, encoding: 'utf8' }))
  assert.equal(host.version, manifest.version)
  assert.deepEqual(host.operations, [...SUPPORTED_OPERATIONS])
})
