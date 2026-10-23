const counter=value=>Number.isSafeInteger(value)&&value>=0?value:null
const sum=(...values)=>values.every(v=>v!==null)?counter(values.reduce((a,b)=>a+b,0)):null

/** Provider adapters must select a schema; field spelling never guesses it. */
export function normalizeProviderUsage(usage,{schema='dsh'}={}) {
  const value=usage&&typeof usage==='object'?usage:{}
  let input=null,cached=null,output=null,cacheWrite=null,reason=null
  if(schema==='dsh') {
    const fresh=counter(value.inputTokens)
    cached=counter(value.cacheReadTokens);cacheWrite=counter(value.cacheWriteTokens)
    output=counter(value.outputTokens)
    const total=counter(value.totalTokens)
    const inclusive=total!==null&&output!==null&&total>=output?total-output:null
    const separated=sum(fresh,cached,cacheWrite)
    input=inclusive??separated
    if(inclusive!==null&&separated!==null&&inclusive!==separated)reason='inconsistent-native-total'
    if(input!==null&&fresh!==null&&cached!==null&&input<fresh+cached)reason='inconsistent-native-input'
  } else if(schema==='openai-chat') {
    input=counter(value.prompt_tokens);output=counter(value.completion_tokens)
    cached=counter(value.prompt_tokens_details?.cached_tokens)
  } else if(schema==='openai-responses') {
    input=counter(value.input_tokens);output=counter(value.output_tokens)
    cached=counter(value.input_tokens_details?.cached_tokens)
  } else if(schema==='anthropic') {
    cached=counter(value.cache_read_input_tokens);cacheWrite=counter(value.cache_creation_input_tokens)
    input=sum(counter(value.input_tokens),cached,cacheWrite);output=counter(value.output_tokens)
  } else throw Error('unknown provider usage schema')
  const fields=schema==='dsh'?[value.inputTokens,value.cacheReadTokens,value.cacheWriteTokens,value.outputTokens,value.totalTokens]
    :schema==='openai-chat'?[value.prompt_tokens,value.completion_tokens,value.prompt_tokens_details?.cached_tokens]
    :schema==='openai-responses'?[value.input_tokens,value.output_tokens,value.input_tokens_details?.cached_tokens]
    :[value.input_tokens,value.cache_read_input_tokens,value.cache_creation_input_tokens,value.output_tokens]
  if(fields.some(n=>n!==undefined&&counter(n)===null))reason='invalid-provider-counter'
  if(input!==null&&cached!==null&&cached>input)reason='cached-exceeds-input'
  if(reason)input=cached=null
  const known=input!==null&&cached!==null&&output!==null
  return {schema,input,cached,output,cacheWrite,known,
    reason:reason??(known?null:input===null?'input-total-unknown':cached===null?'cache-read-unknown':'output-unknown')}
}

