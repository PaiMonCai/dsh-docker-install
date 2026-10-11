/* DSH Plugins > Web Search: secure write-only Brave key.
 * No browser storage, DOM patching, or direct Docker/socket access.
 */
window.__ModuleLoader__.load({
  id: 'dsh-docker-web-search',
  factory(require) {
    const React = require('react')
    const { useState, useEffect } = React
    const h = React.createElement
    const styles = {
      root: { padding: '12px', maxWidth: '620px', color: 'inherit' },
      description: { color: 'var(--dsw-alias-label-secondary, #777)', fontSize: '12px', lineHeight: 1.6 },
      field: { border: '1px solid var(--dsw-alias-separator-primary, #8886)', background:'transparent',
        color:'inherit', borderRadius:'7px', padding:'8px', width:'100%', boxSizing:'border-box' },
      btn: { border:'1px solid var(--dsw-alias-separator-primary, #8886)',
        background:'transparent', color:'inherit', cursor:'pointer', borderRadius:'7px', padding:'7px 12px' },
    }
    function KeyCard({ view, remote }) {
      const [value, setValue] = useState('')
      const [info, setInfo] = useState(null)
      const [busy, setBusy] = useState(false)
      const [message, setMessage] = useState('')
      useEffect(() => {
        let live = true
        remote.describe(['BRAVE_SEARCH_API_KEY']).then(result => {
          if (live && result.ok) setInfo(result.value.BRAVE_SEARCH_API_KEY)
        }).catch(() => {})
        return () => { live = false }
      }, [remote])
      if (view === 'summary') return '自部署 SearXNG 主搜索 · Brave 可选备用 · 12 秒超时'
      const reload = async () => {
        const r = await remote.describe(['BRAVE_SEARCH_API_KEY'])
        if (r.ok) setInfo(r.value.BRAVE_SEARCH_API_KEY)
      }
      const save = async () => {
        if (!value) return
        setBusy(true); setMessage('')
        try {
          const r = await remote.set('BRAVE_SEARCH_API_KEY', value)
          setValue('')
          setMessage(r.ok ? 'Brave API Key 已安全保存。' : '保存失败，请查看 DSH 凭据设置。')
          await reload()
        } catch { setValue(''); setMessage('保存失败。') }
        finally { setBusy(false) }
      }
      const clear = async () => {
        if (!info?.configured || !window.confirm('确认清除 Brave API Key？')) return
        setBusy(true); setMessage('')
        try {
          const r = await remote.unset('BRAVE_SEARCH_API_KEY')
          setMessage(r.ok ? '已清除 Brave API Key。' : '清除失败。')
          await reload()
        } catch { setMessage('清除失败。') }
        finally { setBusy(false) }
      }
      return h('div', { style: styles.root },
        h('h3', null, 'DSH Web Search'),
        h('p', { style: styles.description },
          '主搜索：SearXNG · 备用：Brave（需要手动启用）· 缓存：15 分钟 · 单次搜索：12 秒。'),
        h('p', { style: styles.description },
          '实际容器启停及费用回退开关请使用 dshd search 命令；浏览器端只负责安全配置 Brave 凭据。'),
        h('div', { style: { marginTop:'14px',fontSize:'12px' } },
          'Brave 凭据：', info?.configured ? '已配置' : '未配置',
          info && !info.writable ? '（只读：来源为运行环境）' : ''),
        h('div',{style:{marginTop:'8px'}},
          h('input',{type:'password', style:styles.field, value, disabled:busy || info?.writable === false,
            placeholder:'输入新 Brave Search API Key（仅写入，不显示已有密钥）',
            'aria-label':'Brave Search API Key', onChange:e=>setValue(e.target.value)})),
        h('div',{style:{display:'flex',gap:'8px',marginTop:'10px'}},
          h('button',{type:'button',style:styles.btn,disabled:busy||!value||info?.writable===false,onClick:()=>{void save()}},'保存凭据'),
          h('button',{type:'button',style:styles.btn,disabled:busy||!info?.configured||info?.writable===false,
            onClick:()=>{void clear()}},'清除凭据')),
        h('p',{role:'status',style:styles.description},message),
        h('p',{style:styles.description},'启用备用：dshd search brave enable · 查询：dshd search status · 验证：dshd search test'),
      )
    }
    return {
      inject: ['slots', 'remote', 'remote.credentials'],
      apply(ctx) {
        ctx.slots.inject('plugins.item', () => ctx.slots.register({
          name: 'plugins.item', id: 'dsh-docker-web-search', order: 80,
          label: () => 'DSH Web Search',
        }, props => h(KeyCard, { ...props, remote: ctx.remote.credentials })))
      },
    }
  },
})
