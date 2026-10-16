/** Explicit Reverse Web queue policy. Does NOT intercept Bash, REA or native Agent tool calls. */
export const CONFIRMATION='EXECUTE_ONE_PROJECT_TASK'
export const QUEUE_KINDS=Object.freeze(['triage','js-triage','ghidra','diff','verify'])
export function webExecutionPolicy(env=process.env){
  const enabled=env.DSH_REVERSE_WEB_EXECUTION==='1'
  return {
    schema:'dsh-reverse-execution-policy/v1',
    scope:'web-queue-only',
    web_execution_enabled:enabled,
    confirmation_required:true,
    default_action:'deny',
    permitted_task_kinds:[...QUEUE_KINDS],
    worker:'reverse-task run-once',
    runtime_isolation:'Docker deployment dependent; no automatic sandbox guarantee',
    agent_direct_tools:'outside-this-policy'
  }
}
export function assertWebQueueExecution(confirmation,kind,env=process.env){
  if(!webExecutionPolicy(env).web_execution_enabled)
    throw Error('Web execution disabled; set DSH_REVERSE_WEB_EXECUTION=1 to enable')
  if(confirmation!==CONFIRMATION)throw Error('explicit execution confirmation required')
  if(kind!==undefined&&!QUEUE_KINDS.includes(kind))throw Error('unsupported Web execution task kind')
  return true
}
