    function Panel({call}) {
      const [state,setState]=useState({enabled:false,active:'evidence'})
      const [presets,setPresets]=useState([])
      const [selection,setSelection]=useState('evidence')
      const [current,setCurrent]=useState(null)
      const [draftName,setDraftName]=useState('my-reverse')
      const [draftText,setDraftText]=useState('')
      const [draftMode,setDraftMode]=useState('append')
      const [history,setHistory]=useState([])
      const [revision,setRevision]=useState('')
      const [inspection,setInspection]=useState(null)
      const [capture,setCapture]=useState(null)
      const [hookText,setHookText]=useState('')
      const [hookEnabled,setHookEnabled]=useState(false)
      const [message,setMessage]=useState('')
      const [jobs,setJobs]=useState([])
      const [selectedJob,setSelectedJob]=useState(null)
      const [reportPath,setReportPath]=useState('reverse-index.json')
      const [manifest,setManifest]=useState(null)
      const [openedReport,setOpenedReport]=useState(null)
      const [selectedFunction,setSelectedFunction]=useState('')
      const [functionSearch,setFunctionSearch]=useState('')
      const [busy,setBusy]=useState(false)
      async function invoke(method,args={}) {
        const result=await call(method,args)
        if(!result?.ok) throw Error(result?.error?.message || 'Prompt Manager RPC unavailable')
        return result.value
      }
      async function refresh(){
        const [next,list,diag]=await Promise.all([invoke('state'),invoke('list'),invoke('inspect')])
        setState(next);setPresets(list);setInspection(diag)
        const hook=await invoke('hookGet');setHookText(hook.text);setHookEnabled(hook.enabled)
      }
      useEffect(()=>{refresh().catch(e=>setMessage(String(e.message)))},[])
      async function run(work){
        setBusy(true);setMessage('')
        try { await work();await refresh() }
        catch(e){setMessage(String(e?.message??e))}
        finally{setBusy(false)}
      }
      function choose(name){
        setSelection(name)
        run(async()=>{
          const item=await invoke('get',{name})
          setCurrent(item);setDraftName(item.name)
          setDraftMode(item.mode)
          setDraftText(item.mode==='sections'?JSON.stringify(item.rules,null,2):item.text)
          const revisions=await invoke('history',{name})
          setHistory(revisions);setRevision(revisions[0]||'')
        })
      }
      const active=presets.find(p=>p.name===state.active)
      return h('div',{style:css.shell},
        h(Section,{title:'逆向工程 · System Prompt'},
          h('div',{style:css.line},
            h('span',null,state.enabled?'已启用':'默认提示词'),
            h('span',{style:css.muted},'当前预设：'+(active?.title||state.active)),
            h(Control,{disabled:busy,onClick:()=>run(async()=>invoke('disable'))},'恢复默认'),
            h(Control,{disabled:busy,onClick:()=>run(refresh)},'刷新')),
          h('div',{style:css.line},
            h('select',{style:css.input,value:selection,onChange:e=>choose(e.target.value)},
              ...presets.map(p=>h('option',{key:p.name,value:p.name},p.title+' · '+p.name))),
            h(Control,{disabled:busy,onClick:()=>run(async()=>invoke('activate',{name:selection}))},'启用所选')),
          h('p',{style:css.muted},'只作用于 Reverse Agent；更新在下一次 System Prompt 组装时生效。实际工具权限和审批不变。')),
        h(Section,{title:'预设与分块编辑'},
          h('div',{style:css.line},
            h(Field,{value:draftName,onChange:setDraftName,placeholder:'预设 ID'}),
            h('select',{style:css.input,value:draftMode,onChange:e=>setDraftMode(e.target.value)},
              h('option',{value:'append'},'追加指令'),
              h('option',{value:'replace-persona'},'替换逆向 Persona'),
              h('option',{value:'sections'},'分块规则 JSON'))),
          h(Field,{multiline:true,value:draftText,onChange:setDraftText,placeholder:'输入提示词，或 sections 规则数组'}),
          h('p',{style:css.muted},'仅允许编辑 Reverse Persona 或 reverse:user-* 自有指令分块。分块规则 JSON 使用 action、section、after、text。单份内容最长约 12 KiB。'),
          h('div',{style:css.line},
            h(Control,{disabled:busy,onClick:()=>run(async()=>{
              const payload={name:draftName,mode:draftMode}
              if(draftMode==='sections') payload.rules=JSON.parse(draftText)
              else payload.text=draftText
              await invoke('save',payload);setSelection(draftName)
            })},'保存预设'),
            h(Control,{disabled:busy||!current,onClick:()=>run(async()=>{
              await invoke('remove',{name:draftName});setCurrent(null)
            })},'删除预设')),
          h('div',{style:css.line},h('span',{style:css.muted},'历史版本：'),
            h('select',{style:css.input,value:revision,onChange:e=>setRevision(e.target.value)},
              ...history.map(x=>h('option',{key:x,value:x},x))),
            h(Control,{disabled:busy||history.length===0,onClick:()=>run(async()=>{
              await invoke('rollback',{name:draftName,revision})
              choose(draftName)
            })},'回滚选中版本'))),
        h(Section,{title:'Hook 级指令注入 · Reverse Agent'},
          h('p',{style:css.muted},'独立规则块注入 system-prompt/assemble，仅作用于逆向 Agent；不会替换工具定义、审批策略或模型服务商限制。默认关闭。'),
          h('label',null,h('input',{type:'checkbox',checked:hookEnabled,onChange:e=>setHookEnabled(e.target.checked)}),' 启用 Hook 注入'),
          h(Field,{multiline:true,value:hookText,onChange:setHookText,placeholder:'输入要插入 Reverse Agent System Prompt 的独立指令（最多 12 KiB）'}),
          h('div',{style:css.line},
            h(Control,{disabled:busy,onClick:()=>run(async()=>{
              await invoke('hookSave',{enabled:hookEnabled,text:hookText})
            })},'保存 Hook 配置'),
            h(Control,{disabled:busy,onClick:()=>run(async()=>{
              await invoke('hookSave',{enabled:false,text:hookText});setHookEnabled(false)
            })},'立即停用')),
          h('p',{style:css.muted},'配置在下一次逆向 Agent 提示词组装时生效；下方可采集真实注入后的分块进行核对。')),
        h(Section,{title:'真实组装检查'},
          h('p',{style:css.muted},'默认只显示实际 Reverse Agent 组装的分块名称、字节数与哈希，不保存完整文本。'),
          h('div',{style:css.line},
            h(Control,{disabled:busy,onClick:()=>run(async()=>setInspection(await invoke('inspect')))},'读取分块元数据'),
            h(Control,{disabled:busy,onClick:()=>run(async()=>{
              const result=await invoke('captureRequest')
              setMessage('等待下一次逆向 Agent 组装；有效期至 '+new Date(result.expiresAt).toLocaleTimeString())
            })},'采集下一次组装'),
            h(Control,{disabled:busy,onClick:()=>run(async()=>setCapture(await invoke('captureShow')))},'查看采集正文'),
            h(Control,{disabled:busy,onClick:()=>run(async()=>{
              await invoke('captureClear');setCapture(null)
            })},'清除正文')),
          h('pre',{style:css.pre},inspection?.available
            ? JSON.stringify({injected:inspection.injected,reason:inspection.reason,after:inspection.after},null,2)
            : '尚无真实组装记录'),
          capture?.available
            ? h('details',null,h('summary',null,'显示本地采集的实际分块（可能包含敏感内容）'),
                h('pre',{style:css.pre},JSON.stringify(capture.sections,null,2)))
            : null,
          h('p',{style:css.muted},'这里的分块在 DSH 模板变量插值前捕获，不等于完整最终模型请求。')),
        message?h('p',{role:'status',style:{color:'var(--dsw-alias-state-warn-label)',fontSize:12}},message):null
      )
    }

