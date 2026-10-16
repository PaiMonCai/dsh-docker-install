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
        ...(data.tasks||[]).slice(0,20).map(t=>h('div',{key:t.id,style:css.line},
          h('code',null,'任务 '+t.id.slice(0,8)),
          h('span',{style:css.muted},t.kind+' · '+t.state))),
        ...evidence.slice(0,30).map(e=>h('div',{key:e.id,style:{...css.line,fontSize:12}},
          h('code',null,e.id),h('span',{style:css.muted},e.grade+' · '+e.artifact_path))),
        !hypotheses.length?h('p',{style:css.muted},'暂无假设，可通过 reverse-case hypothesis 添加。'):null)
    }
