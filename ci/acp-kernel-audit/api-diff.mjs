import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

export const sha256 = value => createHash('sha256').update(value).digest('hex')
export const readJson = async path => JSON.parse(await readFile(path, 'utf8'))

export async function fileInventory(directory) {
  const output = []
  async function walk(path) {
    for (const item of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const full = resolve(path, item.name)
      if (item.isDirectory()) await walk(full)
      else output.push({ path: relative(directory, full).replaceAll('\\', '/'), sha256: sha256(await readFile(full)) })
    }
  }
  await walk(directory)
  return output
}

export async function describeApi(root, ts) {
  const pkg = await readJson(resolve(root, 'package.json'))
  const runtime = await import(pathToFileURL(resolve(root, 'dist/index.js')).href)
  const entry = resolve(root, 'dist/index.d.ts')
  const program = ts.createProgram([entry], { target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, skipLibCheck: true })
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(entry)
  const symbol = checker.getSymbolAtLocation(source)
  if (!symbol) throw Error('No declaration module for ' + pkg.version)
  const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed })
  const declarations = {}
  for (const exported of checker.getExportsOfModule(symbol).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const resolved = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported
    const nodes = resolved.getDeclarations() ?? []
    if (!nodes.length) throw Error('Unresolved export ' + exported.name)
    const text = nodes.map(node => printer.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile())).join('\n')
    declarations[exported.name] = { sha256: sha256(text), declaration: text }
  }
  return { version: pkg.version, engines: pkg.engines, exports: pkg.exports,
    dependencies: pkg.dependencies ?? {}, runtimeExports: Object.keys(runtime).sort(),
    declarations, initialState: runtime.createInitialState(), defaults: runtime.defaultConfig(200000),
    coreMethods: Object.keys(runtime.createCore()).sort() }
}

export function changedValues(before, after, path = '') {
  if (JSON.stringify(before) === JSON.stringify(after)) return []
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  if (object(before) && object(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().flatMap(key =>
      changedValues(before[key], after[key], path ? path + '.' + key : key))
  }
  return [{ path, before: before ?? null, after: after ?? null }]
}

export function compareApis(before, after) {
  const oldNames = new Set(before.runtimeExports), newNames = new Set(after.runtimeExports)
  const oldTypes = before.declarations, newTypes = after.declarations
  return {
    runtimeAdded: [...newNames].filter(name => !oldNames.has(name)),
    runtimeRemoved: [...oldNames].filter(name => !newNames.has(name)),
    declarationsAdded: Object.keys(newTypes).filter(name => !oldTypes[name]),
    declarationsRemoved: Object.keys(oldTypes).filter(name => !newTypes[name]),
    declarationsChanged: Object.keys(oldTypes).filter(name => newTypes[name] && oldTypes[name].sha256 !== newTypes[name].sha256)
      .map(name => ({ name, before: oldTypes[name], after: newTypes[name] })),
    defaultsChanged: changedValues(before.defaults, after.defaults),
    initialStateChanged: changedValues(before.initialState, after.initialState),
    coreMethodsChanged: changedValues(before.coreMethods, after.coreMethods),
    exportPathsChanged: changedValues(before.exports, after.exports),
  }
}
