/* DSH Plugins > Web Search: local search, runtime controls and write-only Brave key.
 * All settings actions use the authenticated DSH connection/request route.
 */
window.__ModuleLoader__.load({
  id: 'dsh-docker-web-search',
  factory(require) {
    const React = require('react')
    const { useState, useEffect } = React
    const h = React.createElement
    const ENDPOINT = '/api/dsh-docker-web-search'
    const styles = {
      root: { padding: '12px', maxWidth: '620px', color: 'inherit', fontSize: '13px' },
      hint: { color: 'var(--dsw-alias-label-secondary, #777)', fontSize: '12px', lineHeight: 1.6 },
      row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '9px', marginTop: '10px' },
      field: { border: '1px solid var(--dsw-alias-separator-primary, #8886)', background: 'transparent',
        color: 'inherit', borderRadius: '7px', padding: '8px', width: '100%', boxSizing: 'border-box' },
      btn: { border: '1px solid var(--dsw-alias-separator-primary, #8886)',
        background: 'transparent', color: 'inherit', cursor: 'pointer', borderRadius: '7px', padding: '7px 12px' },
      section: { padding: '12px 0', borderBottom: '1px solid var(--dsw-alias-separator-primary, #8883)' },
      heading: { fontSize: '13px', fontWeight: 600, margin: '0 0 8px' },
    }
    async function api(action, settings) {
      const isGet = !action
      const response = await fetch(ENDPOINT, {
        method: isGet ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
        ...(isGet ? {} : { headers: {
          'content-type': 'application/json', 'x-dsh-search-settings': '1',
        }, body: JSON.stringify({ action, ...(settings ? { settings } : {}) }) }),
      })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error || '搜索设置请求失败')
      return json
    }
    function SearchCard({ view, remote }) {
      const [settings, setSettings] = useState(null)
      const [running, setRunning] = useState(false)
      const [info, setInfo] = useState(null)
      const [secret, setSecret] = useState('')
      const [busy, setBusy] = useState(false)
      const [message, setMessage] = useState('')
      useEffect(() => {
        let live = true
        api().then(value => {
          if (live) { setSettings(value.settings); setRunning(value.running); if (value.error) setMessage(value.error) }
        }).catch(e => { if (live) setMessage(e.message) })
        remote.describe(['BRAVE_SEARCH_API_KEY']).then(result => {
          if (live && result.ok) setInfo(result.value.BRAVE_SEARCH_API_KEY)
        }).catch(() => {})
        return () => { live = false }
      }, [remote])
      if (view === 'summary') return '内置 SearXNG · 共享 DSH 网络与代理 · Brave 可选备用'
      const reloadKey = async () => {
        const result = await remote.describe(['BRAVE_SEARCH_API_KEY'])
        if (result.ok) setInfo(result.value.BRAVE_SEARCH_API_KEY)
      }
      const action = async (type, next) => {
        setBusy(true); setMessage('')
        try {
          const result = await api(type, next)
          if (result.settings) setSettings(result.settings)
          if (result.running !== undefined) setRunning(result.running)
          setMessage(type === 'test'
            ? (result.healthy ? '搜索正常：找到 ' + result.results + ' 条结果'
              : '连接成功，但返回 0 条结果。请检查代理出口和搜索引擎。')
            : type === 'restart' ? '搜索进程已重启。' : '设置已保存。')
        } catch (e) { setMessage(e.message || '操作失败') }
        finally { setBusy(false) }
      }
      const keyAction = async clear => {
        if (clear && !window.confirm('确认清除 Brave API Key？')) return
        if (!clear && !secret) return
        setBusy(true); setMessage('')
        try {
          const result = clear
            ? await remote.unset('BRAVE_SEARCH_API_KEY')
            : await remote.set('BRAVE_SEARCH_API_KEY', secret)
          setMessage(result.ok ? '凭据已更新。' : '凭据更新失败。')
          setSecret('')
          await reloadKey()
        } catch { setSecret(''); setMessage('凭据更新失败。') }
        finally { setBusy(false) }
      }
      const toggle = (key, label) => h('label', { style: { ...styles.row, cursor: busy ? 'default' : 'pointer' } },
        h('input', { type: 'checkbox', checked: settings?.[key] === true, disabled: busy,
          onChange: e => setSettings(value => ({ ...value, [key]: e.target.checked })) }),
        h('span', null, label))
      return h('div', { style: styles.root },
        h('h3', { style: { marginTop: 0 } }, 'Web Search · 内置搜索'),
        h('p', { style: styles.hint },
          'SearXNG 随 DSH 镜像预装，仅在搜索插件启用时运行。监听容器内 127.0.0.1:18788，共享 DSH 的 sing-box/HTTP 代理出口。'),
        h('div', { style: styles.section },
          h('div', { style: styles.row },
            h('strong', null, '运行状态：', running ? '运行中' : '未运行'),
            h('button', { type: 'button', style: styles.btn, disabled: busy,
              onClick: () => { void api().then(result => { setRunning(result.running);setSettings(result.settings) }) } },
              '刷新'),
            h('button', { type: 'button', style: styles.btn, disabled: busy || !settings?.enabled,
              onClick: () => { void action('test') } }, '测试搜索'),
            h('button', { type: 'button', style: styles.btn, disabled: busy || !settings?.enabled,
              onClick: () => { void action('restart') } }, '重启搜索')),
          h('p', { style: styles.hint },
            '关闭本插件的运行开关会停止内置搜索；完全卸载搜索 Provider 仍可使用 dshd search disable。')),
        settings && h('div', { style: styles.section },
          h('h4', { style: styles.heading }, '搜索与缓存'),
          toggle('enabled', '启动内置 SearXNG'),
          toggle('cacheEnabled', '启用内存搜索缓存（最长 15 分钟）'),
          toggle('braveEnabled', '允许 Brave API 作为故障备用（可能产生费用）'),
          h('label', { style: { ...styles.row, justifyContent: 'space-between' } },
            h('span', null, 'Brave 每日调用上限'),
            h('input', { type: 'number', min: 0, max: 10000, step: 1,
              value: settings.braveDailyLimit, disabled: busy,
              'aria-label': 'Brave 每日调用上限',
              style: { ...styles.field, width: '112px' },
              onChange: e => setSettings(current => ({
                ...current, braveDailyLimit: Number(e.target.value),
              })) })),
          h('div', { style: styles.row },
            h('button', { type: 'button', style: styles.btn, disabled: busy,
              onClick: () => { void action('save', settings) } }, '保存设置')),
          h('p', { style: styles.hint }, '0 表示禁止备用调用。开关和额度保存在 DSH 持久化目录，重建容器后保留。')),
        h('div', { style: { paddingTop: '12px' } },
          h('h4', { style: styles.heading }, 'Brave API Key'),
          h('p', { style: styles.hint }, '状态：', info?.configured ? '已配置' : '未配置',
            info && !info.writable ? '（只读：来自运行环境）' : '',
            ' · 密钥只写入凭据存储，不返回浏览器。'),
          h('input', { type: 'password', style: styles.field, value: secret,
            disabled: busy || info?.writable === false,
            placeholder: '输入新的 Brave Search API Key',
            'aria-label': 'Brave Search API Key', onChange: e => setSecret(e.target.value) }),
          h('div', { style: styles.row },
            h('button', { type: 'button', style: styles.btn,
              disabled: busy || !secret || info?.writable === false,
              onClick: () => { void keyAction(false) } }, '保存凭据'),
            h('button', { type: 'button', style: styles.btn,
              disabled: busy || !info?.configured || info?.writable === false,
              onClick: () => { void keyAction(true) } }, '清除凭据'))),
        h('p', { role: 'status', style: { ...styles.hint, marginTop: '12px' } }, message),
      )
    }
    return {
      inject: ['slots', 'remote', 'remote.credentials'],
      apply(ctx) {
        ctx.slots.inject('plugins.item', () => ctx.slots.register({
          name: 'plugins.item', id: 'dsh-docker-web-search', order: 80,
          label: () => 'DSH Web Search',
        }, props => h(SearchCard, { ...props, remote: ctx.remote.credentials })))
      },
    }
  },
})
