/**
 * CI-only: prove a real DSH Session append-only log persists across complete
 * Docker container replacement. No LLM or user session is touched.
 * A synthetic *well-shaped* compaction transaction exercises provenance
 * replay, but does NOT claim that real /compact was run.
 */
import { randomUUID } from 'node:crypto'
import { indexCompactions, originalPage } from './history-index.mjs'
const MODES=new Set(['seed','verify'])
const PREFIX='DSH_CONTEXT_MANAGER_CI_REPLAY_'
const EVIDENCE='CI context manager replay native log evidence '+ 'x'.repeat(2000)
function isSafeId(s){return typeof s==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(s)}
export function installReplaySmoke(ctx) {
  const mode=process.env.DSH_CONTEXT_MANAGER_CI_REPLAY_MODE
  if(!MODES.has(mode)) return
  if (process.env.DSH_CONTEXT_MANAGER_CI_REPLAY_CONFIRM !== 'isolated-test-volume')
    throw Error('CI replay requires explicit isolated test-volume confirmation')
  const preset=process.env.DSH_CONTEXT_MANAGER_CI_REPLAY_PRESET||'standard'
  if(!isSafeId(preset))throw Error('invalid CI replay preset')
  ctx.inject(['sessionController', 'sessions'], c=>{
    c.effect(()=>{
      let running=false,complete=false,attempts=0
      const check=async()=>{
        if(running||complete)return
        running=true
        try {
          if(mode==='seed'){
            // Agent presets may be registered after sessionController is mounted.
            // Do not race session creation against the Reverse preset loader.
            const registry=ctx.get?.('agentPresets')
            const rows=typeof registry?.list==='function' ? await registry.list() : []
            if(!rows.some(row=>row.id===preset && !row.broken)) {
              if(++attempts<70)return
              throw Error('native CI replay preset unavailable')
            }
            const created=await c.sessionController.create({cwd:process.cwd(),agentPreset:preset})
            const sessionId=created?.sessionId
            if(!isSafeId(sessionId))throw Error('invalid created native session id')
            const session=c.sessions.get(sessionId)
            if(!session)throw Error('created session is not attached')
            const origin=session.append('user/message',{id:randomUUID(),role:'user',
              source:{kind:'user'},content:[{type:'text',text:EVIDENCE}]},
            {surfaceOp:'append'})
            const compactionId=randomUUID()
            const begin=session.append('compaction/start',{compactionId,turn:null})
            const summaryText='## Context Tier: T1\n## User Goals\n- Persist evidence across Docker recreate'
            const summary=session.append('compaction/summary',{
              compactionId,summary:[{type:'text',text:summaryText}],
              shadowedRange:{start:origin.seq,end:origin.seq},
              shadowedSeqs:[origin.seq],shadowedTokenCount:650,
              provider:'ci-offline',model:'synthetic-fixture',
            })
            session.append('user/message',{
              id:randomUUID(),role:'user',
              source:{kind:'compact-checkpoint',compactionId},
              content:[{type:'text',text:'<compacted-summary>\n'+summaryText+'\n</compacted-summary>'}],
            },{
              surfaceOp:{op:'replace',startSeq:origin.seq,endSeq:origin.seq},
              sourceEventSeqs:[begin.seq,summary.seq,origin.seq],
            })
            session.append('compaction/end',{compactionId,turn:null})
            await c.sessions.flush(session)
            const inspection=await c.sessionController.inspect(sessionId)
            const index=indexCompactions(inspection)
            if(index.total!==1 || index.incomplete!==0 || index.rows[0].sourceCount!==1)
              throw Error('seed index does not represent a native transaction')
            process.stdout.write(PREFIX+'SEEDED '+sessionId+'\n')
          } else {
            const sessionId=process.env.DSH_CONTEXT_MANAGER_CI_REPLAY_SESSION
            if(!isSafeId(sessionId))throw Error('CI replay session identity missing')
            // This is a freshly booted Web host. No Agent activation is
            // requested, and persisted inspection must reconstruct the events.
            const inspection=await c.sessionController.inspect(sessionId)
            if(inspection?.meta?.id!==sessionId)throw Error('cold native Session inspection mismatch')
            const index=indexCompactions(inspection)
            if(index.total!==1||index.incomplete!==0)
              throw Error('native Session compaction evidence missing after restore')
            const row=index.rows[0]
            const page=originalPage(inspection,index,{
              summarySeq:row.summarySeq,revision:index.revision,offset:0,limit:1,
            })
            if(!page?.items?.[0]?.text?.startsWith('CI context manager replay native log evidence'))
              throw Error('original source event lost across container recreate')
            const cold=c.sessions.get(sessionId)===undefined
            if(!cold)throw Error('replay unexpectedly activated live Agent')
            process.stdout.write(PREFIX+'VERIFIED '+sessionId+' cold=true\n')
          }
          complete=true
          clearInterval(timer)
        }catch(error){
          // Readiness races with session services at first boot.
          if(mode==='verify' && /unavailable|not found|loading|not ready/i.test(String(error?.message))
            && ++attempts<30)return
          complete=true
          clearInterval(timer)
          process.stderr.write(PREFIX+'FAILED '+String(error?.message??error).slice(0,160)+'\n')
        }finally{running=false}
      }
      const timer=setInterval(()=>void check(),500)
      timer.unref?.()
      void check()
      return ()=>{complete=true;clearInterval(timer)}
    },'CI isolated native Session replay across Docker recreate')
  })
}
