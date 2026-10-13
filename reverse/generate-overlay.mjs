/**
 * Relocate the COMPLETE pinned dsh-purge Cordis overlay into this edition.
 * Preserve every upstream row and setting, including global prompt and
 * approval patches; the separate container is the isolation boundary.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const root='/opt/dsh-reverse'
const purge=join(root,'purge')
const source=readFileSync(join(purge,'cordis.patch.yml'),'utf8')
const mappings=[
  ["name: 'dsh-purge'",'name: ./purge/lib/index.js'],
  ['name: dsh-purge/redteam','name: ./purge/lib/redteam/index.js'],
  ['name: dsh-purge/reverse','name: ./purge/lib/reverse/index.js'],
  ['name: dsh-purge/reverse/ui','name: ./purge/lib/reverse/ui.js'],
  ['name: dsh-purge/redteam/store','name: ./purge/lib/redteam/store.js'],
  ['name: dsh-purge/redteam/ui','name: ./purge/lib/redteam/ui.js'],
]
let patch=source
for(const [from,to] of mappings.sort((a,b)=>b[0].length-a[0].length)){
  const lines=patch.split('\n')
  const count=lines.filter(s=>s.trim()===from).length
  if(count!==1)throw new Error('Pinned dsh-purge overlay drift: '+from+' matches '+count)
  patch=lines.map(s=>s.trim()===from?s.replace(from,to):s).join('\n')
}
if(!patch.includes('includeHarnessIdentity: false') ||
   !patch.includes('name: ./purge/lib/index.js') ||
   !patch.includes('name: ./purge/lib/reverse/index.js'))
  throw new Error('dsh-purge overlay failed full contract validation')
patch+='\n# Docker-native frontend for the original full dsh-purge dock.\n'+
  '- insert:\n    - id: dsh-reverse-purge-ui\n      name: ./purge-ui/index.js\n'
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
const old='window.__ModuleLoader__.load({ id: "dsh-purge", factory:'
const input=readFileSync(join(purge,'client.js'),'utf8')
if(!input.startsWith(old)||input.split(old).length!==2)
  throw Error('Pinned dsh-purge UI bundle has changed')
writeFileSync(join(root,'purge-ui','client.js'),
 input.replace(old,'window.__ModuleLoader__.load({ id: "dsh-reverse-purge-ui", factory:'))
console.log('Full dsh-purge composition and browser UI embedded')
