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
