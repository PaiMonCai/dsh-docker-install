/* Native DSH Client module, no DOM replacement or external UI library. */
window.__ModuleLoader__.load({
  id:'dsh-reverse-prompt-web',
  factory(require) {
    const exports={}
    const React=require('react')
    const {createElement:h,useEffect,useState}=React
    const css={
      shell:{display:'flex',flexDirection:'column',gap:12,color:'var(--dsw-alias-label-primary)'},
      line:{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'},
      card:{border:'1px solid var(--dsw-alias-border-l2)',borderRadius:10,padding:12,
        background:'var(--dsw-alias-bg-module-platform)',display:'flex',flexDirection:'column',gap:9},
      input:{border:'1px solid var(--dsw-alias-border-l2)',borderRadius:7,padding:'7px 9px',
        background:'transparent',color:'inherit',minWidth:130,flexGrow:1,font:'inherit'},
      button:{padding:'6px 10px',borderRadius:7,cursor:'pointer',
        border:'1px solid var(--dsw-alias-border-l2)',color:'inherit',background:'transparent',font:'inherit'},
      muted:{fontSize:12,color:'var(--dsw-alias-label-tertiary)',lineHeight:1.5},
      pre:{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:300,overflow:'auto',
        fontSize:12,fontFamily:'monospace',color:'var(--dsw-alias-label-secondary)'},
    }
    function Control({children,onClick,disabled}) {
      return h('button',{type:'button',style:css.button,onClick,disabled},children)
    }
    function Field({value,onChange,placeholder,multiline}) {
      return multiline ? h('textarea',{value,onChange:e=>onChange(e.target.value),
        placeholder,rows:7,style:{...css.input,width:'100%',resize:'vertical'}})
        : h('input',{value,onChange:e=>onChange(e.target.value),placeholder,style:css.input})
    }
    function Section({title,children}) {
      return h('section',{style:css.card},h('strong',null,title),...React.Children.toArray(children))
    }
    function CallGraph({data,selected,onSelect}) {
      const nodes=(data.nodes||[]).slice(0,24)
      const lookup=new Map(nodes.map((node,i)=>[node.address,i]))
      const edges=(data.edges||[]).filter(edge=>lookup.has(edge.source)&&lookup.has(edge.target)).slice(0,48)
      const cols=4, stepX=190, stepY=82, width=770
      const height=Math.ceil(nodes.length/cols)*stepY+30
      return h('div',{style:{overflowX:'auto',border:'1px solid var(--dsw-alias-border-l2)',borderRadius:8}},
        h('svg',{role:'img','aria-label':'函数调用关系图，点击节点查看函数',
          viewBox:'0 0 '+width+' '+Math.max(height,100),style:{width:'100%',minWidth:680,height:Math.max(height,100)}},
          ...edges.map((edge,i)=>{
            const a=lookup.get(edge.source),b=lookup.get(edge.target)
            const x1=95+(a%cols)*stepX,y1=32+Math.floor(a/cols)*stepY
            const x2=95+(b%cols)*stepX,y2=32+Math.floor(b/cols)*stepY
            return h('line',{key:'e'+i,x1,y1,x2,y2,stroke:'var(--dsw-alias-label-tertiary)',
              strokeWidth:1,opacity:.55})
          }),
          ...nodes.map((node,i)=>{
            const x=10+(i%cols)*stepX,y=10+Math.floor(i/cols)*stepY
            return h('g',{key:node.address,onClick:()=>onSelect(node.address),
              role:'button',tabIndex:0,onKeyDown:e=>{if(e.key==='Enter'||e.key===' ')onSelect(node.address)},
              style:{cursor:'pointer'}},
              h('rect',{x,y,width:170,height:45,rx:7,
                fill:'var(--dsw-alias-bg-module-platform)',stroke:node.address===selected?
                  'var(--dsw-alias-label-primary)':'var(--dsw-alias-border-l2)',strokeWidth:node.address===selected?2:1}),
              h('text',{x:x+8,y:y+18,fill:'var(--dsw-alias-label-primary)',fontSize:11},
                node.name.slice(0,22)),
              h('text',{x:x+8,y:y+33,fill:'var(--dsw-alias-label-tertiary)',fontSize:10},
                node.address.slice(0,22)))
          })
        ))
    }
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
      const [message,setMessage]=useState('')
      const [jobs,setJobs]=useState([])
      const [selectedJob,setSelectedJob]=useState(null)
      const [reportPath,setReportPath]=useState('reverse-index.json')
      const [openedReport,setOpenedReport]=useState(null)
      const [selectedFunction,setSelectedFunction]=useState('')
      const [functionSearch,setFunctionSearch]=useState('')
      const [busy,setBusy]=useState(false)
      async function invoke(method,args={}) {
        const result=await call('reverse-prompt/'+method,args)
        if(!result?.ok) throw Error(result?.error?.message || 'Prompt Manager RPC unavailable')
        return result.value
      }
      async function refresh(){
        const [next,list,diag]=await Promise.all([invoke('state'),invoke('list'),invoke('inspect')])
        setState(next);setPresets(list);setInspection(diag)
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
        h(Section,{title:'逆向分析工作台 · 只读'},
          h('p',{style:css.muted},'展示持久化任务与静态证据报告。运行、重试、删除等操作暂未开放 Web 控制。'),
          h('div',{style:css.line},
            h(Control,{disabled:busy,onClick:()=>run(async()=>{
              setJobs(await invoke('workbenchTasks'))
            })},'刷新任务列表'),
            h('span',{style:css.muted},'最近任务：'+jobs.length)),
          ...jobs.slice(0,30).map(job=>h('div',{key:job.id,style:css.line},
            h('code',null,job.kind+' · '+job.state),
            h('span',{style:css.muted},job.id.slice(0,8)),
            h(Control,{disabled:busy,onClick:()=>run(async()=>{
              setSelectedJob(await invoke('workbenchTaskDetail',{id:job.id}))
            })},'查看状态'))),
          selectedJob ? h('pre',{style:css.pre},JSON.stringify(selectedJob,null,2)) : null,
          h('div',{style:css.line},
            h(Field,{value:reportPath,onChange:setReportPath,placeholder:'工作区内 JSON 报告相对路径'}),
            h(Control,{disabled:busy,onClick:()=>run(async()=>{
              setOpenedReport(await invoke('workbenchReport',{path:reportPath}))
            })},'打开报告')),
          openedReport ? h('div',{style:css.card},
            h('strong',null,'报告：'+openedReport.schema),
            openedReport.schema==='dsh-reverse-ghidra/v2'
              ? h('div',null,
                h('p',{style:css.muted},'函数 '+openedReport.functions.length+' · 调用边 '+openedReport.edges.length),
                h('p',{style:css.muted},'图中最多显示 24 个函数、48 条调用边；完整数据可在函数列表和报告中检查。连线表示静态分析发现的调用关系。'),
                h(CallGraph,{data:openedReport,selected:selectedFunction,onSelect:setSelectedFunction}),
                h('div',{style:css.line},h(Field,{value:functionSearch,onChange:setFunctionSearch,placeholder:'按函数名称或地址筛选'})),
                ...openedReport.functions.filter(fn=>
                  (!functionSearch||fn.name.toLowerCase().includes(functionSearch.toLowerCase())||
                    fn.address.toLowerCase().includes(functionSearch.toLowerCase())) &&
                  (!selectedFunction||selectedFunction===fn.address)
                ).slice(0,100).map(fn=>h('details',{key:fn.address,open:selectedFunction===fn.address},
                  h('summary',{onClick:()=>setSelectedFunction(fn.address)},fn.name+' @ '+fn.address),
                  h('p',{style:css.muted},'调用：'+openedReport.edges.filter(e=>e.source===fn.address)
                    .map(e=>e.target).slice(0,20).join(', ')),
                  h('p',{style:css.muted},'被调用：'+openedReport.edges.filter(e=>e.target===fn.address)
                    .map(e=>e.source).slice(0,20).join(', ')),
                  h('p',{style:css.muted},'入口引用：'+(openedReport.references||[])
                    .filter(e=>e.target===fn.address).slice(0,20)
                    .map(e=>e.from+' ['+e.type+']').join(', ')),
                  h('pre',{style:css.pre},fn.signature+'\n'+fn.pseudocode))),
                selectedFunction?h(Control,{onClick:()=>setSelectedFunction('')},'显示全部函数'):null)
              : h('pre',{style:css.pre},JSON.stringify(openedReport,null,2))
          ) : null
        ),
        message?h('p',{role:'status',style:{color:'var(--dsw-alias-state-warn-label)',fontSize:12}},message):null
      )
    }
    function apply(ctx){
      ctx.slots.inject('settings.section',()=>ctx.slots.register({
        name:'settings.section',id:'reverse-prompt-manager',order:30,
        label:()=> '逆向提示词',
        inject:()=>({call:(method,payload)=>ctx.connection.rpc.call('/api',method,payload)})
      },Panel))
    }
    exports.apply=apply
    exports.inject=['slots','connection']
    return exports
  }
})
