import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { Session, SessionId, appendPluginRecord } from '../ci/acp-kernel-audit/compatibility.mjs'
import { AcpRuntime } from '../docker/plugins/dsh-context-manager/acp-runtime.mjs'

test('native kernel distribution is pinned to the verified source and lockfile', async () => {
  const root = new URL('../docker/plugins/dsh-context-manager/', import.meta.url)
  const provenance = JSON.parse(await readFile(new URL('vendor/provenance.json', root), 'utf8'))
  const lock = JSON.parse(await readFile(new URL('package-lock.json', root), 'utf8'))
  const data = await readFile(new URL('vendor/' + provenance.artifact, root))
  assert.equal(createHash('sha256').update(data).digest('hex'), provenance.sha256)
  assert.equal(lock.packages['node_modules/acp-kernel'].integrity, provenance.integrity)
  assert.equal(provenance.upstream.commit, 'bc4a3f87e2dc98e82df6f707d362e75492fdf3d1')
  assert.equal(provenance.reproducibleCleanBuild, true)
})

function populated(id, content) {
  const session = Session.create(SessionId(id))
  for(let i=0;i<7;i++) session.append('user/message', {
    id: id+'-'+i, role:'user', source:{kind:'user'},
    content: i===1&&content?content:[{type:'text',text:'Original native safety evidence. '.repeat(90)}],
  }, {surfaceOp:'append'})
  return session
}

test('native range refuses media before writing an intent or mutating the surface', () => {
  const session=populated('m1-media',[{type:'image',url:'https://example.invalid/synthetic.png'}])
  const runtime=new AcpRuntime({appendRecord:appendPluginRecord})
  const {refs}=runtime.status(session)
  const before=JSON.stringify(session.snapshotEvents())
  assert.throws(()=>runtime.propose(session,{startRef:refs[0].ref,endRef:refs[3].ref,
    summary:'Preserve the full original native evidence and the image without silently hiding non-text data. '.repeat(2)}), /protected|kernel rejected/)
  assert.equal(JSON.stringify(session.snapshotEvents()),before)
})

test('upstream parser accepts legacy boundary spellings without mutating request arguments', () => {
  const session=populated('m1-parser')
  const runtime=new AcpRuntime({appendRecord:appendPluginRecord})
  const {refs}=runtime.status(session)
  const args={startId:refs[0].ref,endId:refs[2].ref,
    summary:'Original native evidence is preserved by the upstream parser and an explicitly bounded DSH transaction. '.repeat(2)}
  const before=JSON.stringify(args)
  assert.equal(runtime.propose(session,args).accepted,true)
  assert.equal(JSON.stringify(args),before)
})
