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
      const [taskCaseId,setTaskCaseId]=useState('')
      const [activeSection,setActiveSection]=useState('project')
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
        h('nav',{style:{...css.line,gap:6},'aria-label':'逆向工作台导航'},
          ...[['project','项目与任务'],['cases','案件关系'],['knowledge','经验检索'],['reports','证据与报告']]
          .map(([value,label])=>h('button',{
            key:value,type:'button','aria-current':activeSection===value?'page':undefined,
            onClick:()=>setActiveSection(value),
            style:{...css.button,borderRadius:8,fontWeight:activeSection===value?700:400,
              background:activeSection===value?'var(--dsw-alias-bg-module-platform)':'transparent',
              borderColor:activeSection===value?'var(--dsw-alias-label-tertiary)':'var(--dsw-alias-border-l2)'}
          },label))),
        activeSection==='project'&&h(Section,{title:'分析项目'},
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
              h('select',{style:css.input,value:taskCaseId,'aria-label':'关联案件',
                onChange:e=>setTaskCaseId(e.target.value)},
                h('option',{value:''},'不关联案件'),
                ...(projectLinks?.entries||[]).filter(e=>e.kind==='case'&&e.valid)
                  .map(e=>h('option',{key:e.ref,value:e.ref},'案件 '+e.ref.slice(0,8)))),
              h(Control,{disabled:busy||!taskInputs.trim(),onClick:()=>run(async()=>{
                const inputs=taskInputs.split('\n').map(s=>s.trim()).filter(Boolean)
                const created=await invoke('workbenchProjectTaskCreate',{id:activeProject.id,kind:taskKind,inputs,
                  caseId:taskCaseId||undefined})
                setProjectLinks(await invoke('workbenchProjectLinks',{id:activeProject.id}))
                setJobs(await invoke('workbenchTasks'))
                setTaskInputs('')
                setMessage('任务已排队：'+created.id+'，尚未执行')
              })},'添加到队列')),
            h('div',{style:css.line},
              h('select',{style:css.input,value:linkKind,onChange:e=>setLinkKind(e.target.value)},
                h('option',{value:'sample'},'样本文件'),
                h('option',{value:'task'},'分析任务 UUID'),
                h('option',{value:'evidence'},'证据 JSON'),
                h('option',{value:'case'},'逆向案件 UUID')),
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
              entry.kind==='case'&&entry.valid?h(Control,{disabled:busy,onClick:()=>run(async()=>{
                setActiveCase(await invoke('workbenchCase',{id:entry.ref}))
                setActiveSection('cases')
              })},'查看案件'):null,
              entry.kind==='evidence'&&entry.valid?h(Control,{disabled:busy,onClick:()=>run(async()=>{
                setReportPath(entry.ref)
                setOpenedReport(await invoke('workbenchReport',{path:entry.ref}))
              })},'查看证据'):null))
          ):null
        ),
        activeSection==='knowledge'&&h(Section,{title:'逆向经验检索 · 只读'},
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
        activeSection==='cases'&&h(Section,{title:'逆向案件关系 · 只读'},
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
        activeSection==='reports'&&h(Section,{title:'逆向分析工作台 · 只读'},
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
