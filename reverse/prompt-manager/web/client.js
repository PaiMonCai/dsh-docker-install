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

    function CaseGraph({data}) {
      const [focus,setFocus]=useState('')
      const evidence=data.evidence||[],hypotheses=data.hypotheses||[],experiments=data.experiments||[]
      return h('div',{style:{display:'flex',flexDirection:'column',gap:8}},
        h('p',{style:css.muted},'关系：假设 → 实验 → 证据。这里只显示状态和引用编号；完整记录可在本地用 reverse-case show 查看。'),
        h('div',{style:css.line},...['G1','G2','G3','G4'].map(g=>
          h('span',{key:g,style:{...css.muted,padding:'3px 7px',
            border:'1px solid var(--dsw-alias-border-l2)',borderRadius:6}},
            g+' · '+((data.gates||{})[g]||'unknown')))),
        ...hypotheses.slice(0,40).map(hyp=>
          h('div',{key:hyp.id,style:{borderLeft:'2px solid var(--dsw-alias-border-l2)',
            padding:'6px 8px',display:'flex',flexDirection:'column',gap:5}},
            h('div',{style:css.line},
              h('strong',null,hyp.id+' · '+hyp.state),
              h(Control,{onClick:()=>setFocus(focus===hyp.id?'':hyp.id)},
                focus===hyp.id?'收起关联':'展开关联')),
            focus===hyp.id?h('div',{style:{paddingLeft:14,display:'flex',flexDirection:'column',gap:5}},
              ...experiments.filter(e=>e.hypothesis_id===hyp.id).slice(0,15)
                .map(e=>h('div',{key:e.id,style:css.line},
                  h('code',null,'↳ '+e.id+' · '+e.state),
                  h('span',{style:css.muted},(e.evidence_ids||[]).length?
                    '证据 '+e.evidence_ids.join(', '):'尚无实验证据'))),
              ...(hyp.evidence_ids||[]).slice(0,20).map(id=>
                h('span',{key:id,style:css.muted},'↳ 证据 '+id)),
              !(hyp.evidence_ids||[]).length?h('span',{style:css.muted},'尚无关联证据'):null
            ):null)),
        h('p',{style:css.muted},
          '证据 '+evidence.length+' · 假设 '+hypotheses.length+
          ' · 实验 '+experiments.length+' · 任务 '+(data.tasks||[]).length),
        ...evidence.slice(0,30).map(e=>h('div',{key:e.id,style:{...css.line,fontSize:12}},
          h('code',null,e.id),h('span',{style:css.muted},e.grade+' · '+e.artifact_path))),
        !hypotheses.length?h('p',{style:css.muted},'暂无假设，可通过 reverse-case hypothesis 添加。'):null)
    }
    function WorkbenchPanel({call}) {
      const [projects,setProjects]=useState([])
      const [projectName,setProjectName]=useState('')
      const [activeProject,setActiveProject]=useState(null)
      const [projectLinks,setProjectLinks]=useState(null)
      const [linkKind,setLinkKind]=useState('sample')
      const [linkRef,setLinkRef]=useState('')
      const [taskKind,setTaskKind]=useState('triage')
      const [taskInputs,setTaskInputs]=useState('')
      const [runConfirm,setRunConfirm]=useState('')
      const [orphanStatus,setOrphanStatus]=useState(null)
      const [jobs,setJobs]=useState([])
      const [cases,setCases]=useState([])
      const [activeCase,setActiveCase]=useState(null)
      const [knowledgeQuery,setKnowledgeQuery]=useState('')
      const [knowledgePlatform,setKnowledgePlatform]=useState('all')
      const [knowledgeResults,setKnowledgeResults]=useState([])
      const [knowledgeItem,setKnowledgeItem]=useState(null)
      const [selectedJob,setSelectedJob]=useState(null)
      const [reportPath,setReportPath]=useState('reverse-index.json')
      const [manifest,setManifest]=useState(null)
      const [openedReport,setOpenedReport]=useState(null)
      const [selectedFunction,setSelectedFunction]=useState('')
      const [functionSearch,setFunctionSearch]=useState('')
      const [busy,setBusy]=useState(false)
      const [message,setMessage]=useState('')
      async function invoke(method,args={}) {
        const result=await call(method,args)
        if (!result?.ok) throw Error(result?.error?.message||'Reverse Workbench RPC unavailable')
        return result.value
      }
      async function run(work) {
        setBusy(true);setMessage('')
        try { await work() }
        catch (error) { setMessage(String(error?.message??error)) }
        finally { setBusy(false) }
      }
      useEffect(()=>{invoke('workbenchProjects').then(setProjects).catch(error=>setMessage(String(error?.message??error)))},[])
      useEffect(()=>{invoke('workbenchTasks').then(setJobs)
        .catch(error=>setMessage(String(error?.message??error)))},[])
      useEffect(()=>{invoke('workbenchCases').then(setCases)
        .catch(error=>setMessage(String(error?.message??error)))},[])
      useEffect(()=>{invoke('workbenchKnowledgeSearch',{query:'',platform:'all'}).then(setKnowledgeResults)
        .catch(error=>setMessage(String(error?.message??error)))},[])
      return h('div',{style:css.shell},
        h(Section,{title:'分析项目'},
          h('p',{style:css.muted},'项目元数据持久保存于 Reverse 工作区；样本与报告目前仍按工作区路径管理。'),
          h('div',{style:css.line},
            h(Field,{value:projectName,onChange:setProjectName,placeholder:'新项目名称'}),
            h(Control,{disabled:busy||!projectName.trim(),onClick:()=>run(async()=>{
              const created=await invoke('workbenchProjectCreate',{name:projectName})
              setActiveProject(created);setProjectLinks(await invoke('workbenchProjectLinks',{id:created.id}));setProjectName('')
              setProjects(await invoke('workbenchProjects'))
            })},'创建项目'),
            h(Control,{disabled:busy,onClick:()=>run(async()=>setProjects(await invoke('workbenchProjects')))},'刷新')),
          ...projects.slice(0,30).map(p=>h('div',{key:p.id,style:css.line},
            h('strong',null,p.name),
            h('span',{style:css.muted},p.created_at),
            h(Control,{disabled:busy,onClick:()=>run(async()=>{setActiveProject(p);setProjectLinks(await invoke('workbenchProjectLinks',{id:p.id}))})},'查看'))),
          activeProject?h('div',{style:css.card},
            h('p',{style:css.muted},'当前项目：'+activeProject.name+' · '+activeProject.id),
            h('strong',null,'新建静态分析任务'),
            h('p',{style:css.muted},'仅创建待执行任务；执行仍需使用 reverse-task run-once。diff 填两条工作区相对路径，以换行分隔。'),
            h('div',{style:css.line},
              h('select',{style:css.input,value:taskKind,onChange:e=>setTaskKind(e.target.value)},
                ...['triage','js-triage','ghidra','diff','verify'].map(k=>h('option',{value:k,key:k},k))),
              h(Field,{value:taskInputs,onChange:setTaskInputs,placeholder:'工作区相对输入路径'}),
              h(Control,{disabled:busy||!taskInputs.trim(),onClick:()=>run(async()=>{
                const inputs=taskInputs.split('\n').map(s=>s.trim()).filter(Boolean)
                const created=await invoke('workbenchProjectTaskCreate',{id:activeProject.id,kind:taskKind,inputs})
                setProjectLinks(await invoke('workbenchProjectLinks',{id:activeProject.id}))
                setJobs(await invoke('workbenchTasks'))
                setTaskInputs('')
                setMessage('任务已排队：'+created.id+'，尚未执行')
              })},'添加到队列')),
            h('div',{style:css.line},
              h('select',{style:css.input,value:linkKind,onChange:e=>setLinkKind(e.target.value)},
                h('option',{value:'sample'},'样本文件'),
                h('option',{value:'task'},'分析任务 UUID'),
                h('option',{value:'evidence'},'证据 JSON')),
              h(Field,{value:linkRef,onChange:setLinkRef,placeholder:'工作区相对路径或任务 UUID'}),
              h(Control,{disabled:busy||!linkRef.trim(),onClick:()=>run(async()=>{
                setProjectLinks(await invoke('workbenchProjectAttach',{id:activeProject.id,kind:linkKind,ref:linkRef.trim()}))
                setLinkRef('')
              })},'关联到项目')),
            h(Control,{disabled:busy,onClick:()=>run(async()=>{
              setOrphanStatus(await invoke('workbenchOrphanTasks'))
            })},'检查孤儿暂存任务'),
            orphanStatus?h('p',{style:css.muted},
              '未关联 '+orphanStatus.orphan.length+' · 已关联暂存 '+orphanStatus.linked_staged.length+' · 无效记录 '+orphanStatus.invalid.length):null,
            orphanStatus?h('pre',{style:css.pre},JSON.stringify(orphanStatus,null,2)):null,
            h(Control,{disabled:busy,onClick:()=>run(async()=>{
              const recovery=await invoke('workbenchProjectTasksRecover',{id:activeProject.id})
              setProjectLinks(await invoke('workbenchProjectLinks',{id:activeProject.id}))
              setJobs(await invoke('workbenchTasks'))
              setMessage('已恢复暂存任务 '+recovery.recovered.length+' 个，跳过 '+recovery.skipped.length+' 个')
            })},'恢复中断的任务登记'),
            h(Control,{disabled:busy,onClick:()=>run(async()=>{
              const results=await invoke('workbenchProjectResultsSync',{id:activeProject.id})
              setProjectLinks(results.links)
              setMessage('已同步 '+results.added.length+' 份报告；未找到 '+results.skipped.length+' 份')
            })},'同步已完成任务的证据'),
            h('p',{style:css.muted},'Web 执行默认关闭。部署者开启后，在下方输入 EXECUTE_ONE_PROJECT_TASK 才能手动执行全局队首的项目任务。'),
            h(Field,{value:runConfirm,onChange:setRunConfirm,placeholder:'执行确认短语'}),
            ...(projectLinks?.entries||[]).map((entry,i)=>h('div',{key:entry.kind+entry.ref+i,style:css.line},
              h('span',{style:css.muted},entry.kind+' · '+(entry.valid?'有效':'失效')),
              h('code',null,entry.ref),
              entry.kind==='task'&&entry.valid&&entry.state==='queued'?h(Control,{
                disabled:busy||runConfirm!=='EXECUTE_ONE_PROJECT_TASK',
                onClick:()=>run(async()=>{
                  const result=await invoke('workbenchProjectRunOnce',{id:activeProject.id,
                    taskId:entry.ref,confirmation:runConfirm})
                  setProjectLinks(await invoke('workbenchProjectLinks',{id:activeProject.id}))
                  setJobs(await invoke('workbenchTasks'))
                  setRunConfirm('')
                  setMessage('任务执行结果：'+result.state)
                })},'执行队首任务'):null,
              entry.kind==='evidence'&&entry.valid?h(Control,{disabled:busy,onClick:()=>run(async()=>{
                setReportPath(entry.ref)
                setOpenedReport(await invoke('workbenchReport',{path:entry.ref}))
              })},'查看证据'):null))
          ):null
        ),
        h(Section,{title:'逆向经验检索 · 只读'},
          h('p',{style:css.muted},'内置条目只提供排查方向；个案经验也不是已独立验证的通用结论。'),
          h('div',{style:css.line},
            h(Field,{value:knowledgeQuery,onChange:setKnowledgeQuery,placeholder:'搜索症状或原因'}),
            h('select',{value:knowledgePlatform,style:css.input,
              onChange:e=>setKnowledgePlatform(e.target.value),'aria-label':'知识平台'},
              ...['all','android','elf','pe','macho','electron','javascript','web','network','firmware','wasm']
                .map(x=>h('option',{key:x,value:x},x))),
            h(Control,{disabled:busy,onClick:()=>run(async()=>{
              setKnowledgeResults(await invoke('workbenchKnowledgeSearch',{
                query:knowledgeQuery,platform:knowledgePlatform}))
              setKnowledgeItem(null)
            })},'检索')),
          h('p',{style:css.muted},'匹配 '+knowledgeResults.length+' 条（显示前 8 条）'),
          ...knowledgeResults.slice(0,8).map(item=>h('div',{key:item.id,style:css.line},
            h('span',{style:{fontWeight:600,fontSize:13}},item.title),
            h('span',{style:css.muted},item.platforms.join(' / ')+' · '+item.origin),
            h(Control,{disabled:busy,onClick:()=>run(async()=>{
              setKnowledgeItem(await invoke('workbenchKnowledgeEntry',{id:item.id}))
            })},'排查步骤'))),
          knowledgeItem?h('div',{style:{...css.card,padding:10}},
            h('strong',null,knowledgeItem.title),
            h('p',{style:css.muted},knowledgeItem.summary),
            h('p',{style:css.muted},'路线：'+knowledgeItem.route+' · 可信度：'+knowledgeItem.confidence),
            h('strong',null,'首先检查'),
            ...knowledgeItem.checks.map((s,i)=>h('div',{key:'check'+i,style:css.muted},(i+1)+'. '+s)),
            h('strong',null,'竞争性解释'),
            ...knowledgeItem.alternatives.map((s,i)=>h('div',{key:'alt'+i,style:css.muted},'· '+s)),
            h('p',{style:css.muted},'验证：'+knowledgeItem.verification),
            h('p',{style:css.muted},'局限：'+knowledgeItem.limitations),
            knowledgeItem.case_id?h('code',null,'来源案件：'+knowledgeItem.case_id):null):null
        ),
        h(Section,{title:'逆向案件关系 · 只读'},
          h('div',{style:css.line},
            h('p',{style:css.muted},'案件 '+cases.length+' 个 · Gate / 假设 / 实验 / 证据引用'),
            h(Control,{disabled:busy,onClick:()=>run(async()=>{
              setCases(await invoke('workbenchCases'))
              if(activeCase)setActiveCase(await invoke('workbenchCase',{id:activeCase.id}))
            })},'刷新案件')),
          ...cases.slice(0,8).map(item=>h('div',{key:item.id,style:css.line},
            h('span',{style:{fontSize:13,fontWeight:600}},item.goal.slice(0,70)),
            h('span',{style:css.muted},'证据 '+item.evidence_count+' · 假设 '+item.hypothesis_count),
            h(Control,{disabled:busy,onClick:()=>run(async()=>{
              setActiveCase(await invoke('workbenchCase',{id:item.id}))
            })},'查看关系'))),
          activeCase?h('div',{style:{...css.card,padding:10}},
            h('div',{style:css.line},
              h('strong',null,activeCase.goal),
              h('code',null,activeCase.id.slice(0,8)+' · rev '+activeCase.revision)),
            h(CaseGraph,{data:activeCase})
          ):null),
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
            h(Control,{disabled:busy,onClick:()=>run(async()=>{
              setManifest(await invoke('workbenchManifest',{path:reportPath}))
            })},'读取并校验证据索引'),
            manifest ? h('span',{style:css.muted},'已验证 '+manifest.verified+' / '+manifest.total) : null),
          manifest ? h('div',{style:css.card},
            ...manifest.reports.map(row=>h('div',{key:row.path,style:css.line},
              h('span',{style:css.muted},(row.verified?'校验通过':'校验失败')+' · '+row.schema),
              h('code',null,row.path),
              h(Control,{disabled:busy||!row.verified,onClick:()=>run(async()=>{
                setSelectedFunction('');setFunctionSearch('')
                setReportPath(row.path)
                setOpenedReport(await invoke('workbenchReport',{path:row.path}))
              })},'打开证据')))) : null,
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
        inject:()=>({call:(method,payload)=>ctx.connection.rpc.call('/reverse-prompt',method,payload)})
      },Panel))
      ctx.slots.inject('settings.section',()=>ctx.slots.register({
        name:'settings.section',id:'reverse-workbench',order:31,
        label:()=> '逆向工作台',
        inject:()=>({call:(method,payload)=>ctx.connection.rpc.call('/reverse-prompt',method,payload)})
      },WorkbenchPanel))
    }
    exports.apply=apply
    exports.inject=['slots','connection']
    return exports
  }
})
