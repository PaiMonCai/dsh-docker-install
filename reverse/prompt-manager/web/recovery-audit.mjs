/** Append-only bounded recovery audit using O_APPEND and a private file. */
import { openSync,writeSync,closeSync,fsyncSync,lstatSync,mkdirSync,existsSync } from 'node:fs'
import { join,resolve } from 'node:path'
const ROOT=resolve(process.env.DSH_REVERSE_WORKSPACE_ROOT||'/workspace')
const PATH=join(ROOT,'.reverse-tasks')
const AUDIT=join(PATH,'recovery-audit.jsonl')
export function auditRecovery(event) {
  if(!existsSync(PATH))mkdirSync(PATH,{mode:0o700})
  if(lstatSync(PATH).isSymbolicLink())throw Error('unsafe task store')
  if(existsSync(AUDIT)) {
    const stat=lstatSync(AUDIT)
    if(!stat.isFile()||stat.size>1024*1024)throw Error('recovery audit full or unsafe')
  }
  const record={schema:'dsh-reverse-recovery-audit/v1',
    time:new Date().toISOString(),project_id:event.project_id,
    recovered:event.recovered.slice(0,120),skipped:event.skipped.slice(0,120)}
  const fd=openSync(AUDIT,'a',0o600)
  try {writeSync(fd,JSON.stringify(record)+'\n');fsyncSync(fd)}
  finally {closeSync(fd)}
}
