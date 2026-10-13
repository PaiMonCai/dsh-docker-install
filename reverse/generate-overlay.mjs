/**
 * Relocate the COMPLETE pinned dsh-purge Cordis overlay into this edition.
 * Preserve every upstream row and setting, including global prompt and
 * approval patches; the separate container is the isolation boundary.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
const root=process.env.DSH_REVERSE_ROOT || '/opt/dsh-reverse'
const purge=join(root,'purge')
const source=readFileSync(join(purge,'cordis.patch.yml'),'utf8')
// Each Loader plugin MUST have its own package root. Loading six source files
// under dsh-purge/package.json directly makes client-modules reject the image:
// "package dsh-purge resolves from multiple active Loader sources".
const modules=[
  ["name: 'dsh-purge'",'core','lib/index.js'],
  ['name: dsh-purge/redteam','redteam','lib/redteam/index.js'],
  ['name: dsh-purge/reverse','reverse','lib/reverse/index.js'],
  ['name: dsh-purge/reverse/ui','reverse-ui','lib/reverse/ui.js'],
  ['name: dsh-purge/redteam/store','redteam-store','lib/redteam/store.js'],
  ['name: dsh-purge/redteam/ui','redteam-ui','lib/redteam/ui.js'],
]
const mappings=modules.map(([from,id])=>[from,'name: ./host-modules/'+id+'/index.js'])
for(const [,id,sourceFile] of modules){
  const upstream=join(purge,sourceFile)
  if(!existsSync(upstream))throw Error('Missing upstream module: '+sourceFile)
  const location=join(root,'host-modules',id)
  mkdirSync(location,{recursive:true})
  const entry='../../purge/'+sourceFile
  // CI observes the REAL registered preset through agentPresets.list().
  // This probe is inert in production; source.apply remains untouched.
  const extra=id==='reverse' ? [
    'export const inject = [\'agentPresets\']',
    'export function apply(ctx){',
    // Declarative adapter registers the preset; keep source asset bootstrap.
    '  source.prepareReverseAssets()',
    '  if(process.env.DSH_REVERSE_CI_VERIFY_PRESET===\'1\')process.stdout.write(\'DSH_REVERSE_CI_PLUGIN_APPLIED\\n\')',
    '  if(process.env.DSH_REVERSE_CI_VERIFY_PRESET!==\'1\')return',
    '  ctx.effect(()=>{',
    '    let stopped=false',
    '    let announced=false',
    '    let checks=0',
    '    const check=async()=>{',
    '      if(stopped||announced)return',
    '      let r=null',
    '      try{r=ctx.agentPresets?.register?ctx.agentPresets:ctx.get?.(\'agentPresets\')}catch{}',
    '      if(!r?.list){if(++checks===10)process.stdout.write(\'DSH_REVERSE_CI_REGISTRY_MISSING\\n\');return}',
    '      const rows=await r.list()',
    '      const preset=rows?.find(x=>x.id===\'reverse-engineering\')',
    '      if(!preset||preset.broken)return',
    '      announced=true',
    '      clearInterval(timer)',
    '      process.stdout.write(\'DSH_REVERSE_CI_PRESET_REGISTERED\\n\')',
    '    }',
    '    const timer=setInterval(()=>void check().catch(()=>{}),500)',
    '    timer.unref?.()',
    '    void check().catch(()=>{})',
    '    return()=>{stopped=true;clearInterval(timer)}',
    '  },\'CI-only reverse preset registration audit\')',
    '}',
    'export default { ...(source.default ?? source), inject, apply }',
  ]:id==='redteam' ? [
    'export const inject = [\'agentPresets\']',
    'export default { ...(source.default ?? source), inject }',
  ]:[
    'export default source.default ?? { name: source.name, inject: source.inject, apply: source.apply }',
  ]
  const adapter=[
    'import * as source from '+JSON.stringify(entry),
    'export * from '+JSON.stringify(entry),
    ...extra,
    '',
  ].join('\n')
  writeFileSync(join(location,'index.js'),adapter)
  writeFileSync(join(location,'package.json'),JSON.stringify({
    name:'dsh-reverse-'+id,
    version:'1.0.0',
    private:true,
    type:'module',
    main:'./index.js',
    exports:{'.':'./index.js','./package.json':'./package.json'},
  },null,2)+'\n')
}
let patch=source
for(const [from,to] of mappings.sort((a,b)=>b[0].length-a[0].length)){
  const lines=patch.split('\n')
  const count=lines.filter(s=>s.trim()===from).length
  if(count!==1)throw new Error('Pinned dsh-purge overlay drift: '+from+' matches '+count)
  patch=lines.map(s=>s.trim()===from?s.replace(from,to):s).join('\n')
}
if(!patch.includes('includeHarnessIdentity: false') ||
   !patch.includes('name: ./host-modules/core/index.js') ||
   !patch.includes('name: ./host-modules/reverse/index.js'))
  throw new Error('dsh-purge overlay failed full contract validation')
patch+='\n# Docker-native frontend for the original full dsh-purge dock.\n'+
  '- insert:\n    - id: dsh-reverse-purge-ui\n      name: ./purge-ui/index.js\n    - id: dsh-reverse-skill-bootstrap\n      name: ./skills-bootstrap.mjs\n'
writeFileSync(join(root,'cordis.patch.yml'),patch)
for(const [file,from,to] of [
  ['presets/reverse-engineering/agent.cordis.yml',
   'name: dsh-purge/reverse/tools','name: ../../lib/reverse/tools.js'],
  ['presets/redteam/agent.cordis.yml',
   'name: dsh-purge/redteam/tools','name: ../../lib/redteam/tools.js'],
]){
  const p=join(purge,file)
  const content=readFileSync(p,'utf8')
  if(content.split(from).length!==2)throw Error('Pinned Agent tools drift: '+file)
  writeFileSync(p,content.replace(from,to))
}
// DSH 0.2+ understands declarative Agent presets. Embed all of the upstream
// reverse preset tools as a normal DSH registry declaration.
const presetDirectory=join(purge,'presets','reverse-engineering')
const presetBody=readFileSync(join(presetDirectory,'agent.cordis.yml'),'utf8').trimEnd()
const display=readFileSync(join(presetDirectory,'preset.yml'),'utf8')
const field=(key)=>{
  const row=display.split('\n').find(line=>line.startsWith(key+':'))
  if(!row)throw Error('Upstream reverse preset metadata lacks '+key)
  const value=row.slice(key.length+1).trim()
  return value.replace(/^['"]|['"]$/g,'')
}
const pluginLines=presetBody.split('\n')
  .map(line=>line.trim()?'          '+line:'')
  .join('\n')
const embedded=pluginLines.replace(
  'name: ../../lib/reverse/tools.js',
  'name: file:///opt/dsh-reverse/purge/lib/reverse/tools.js'
)
if(embedded===pluginLines)throw Error('Reverse tool file URL was not adapted')
patch+=[
  '',
  '# Declarative reverse preset for the current DSH Agent Preset Registry.',
  '- insert:',
  '    - id: dsh-reverse-preset-declaration',
  "      name: '@deepseek-ai/dsh-agent-preset'",
  '      config:',
  '        id: reverse-engineering',
  '        name: '+JSON.stringify(field('name')),
  '        description: '+JSON.stringify(field('description')),
  '        order: '+Number(field('order')),
  '        plugins:',
  embedded,
  '',
].join('\n')
writeFileSync(join(root,'cordis.patch.yml'),patch)

const old='window.__ModuleLoader__.load({ id: "dsh-purge", factory:'
const input=readFileSync(join(purge,'client.js'),'utf8')
if(!input.startsWith(old)||input.split(old).length!==2)
  throw Error('Pinned dsh-purge UI bundle has changed')
writeFileSync(join(root,'purge-ui','client.js'),
 input.replace(old,'window.__ModuleLoader__.load({ id: "dsh-reverse-purge-ui", factory:'))
console.log('Full dsh-purge composition, declarative Agent and browser UI embedded')
