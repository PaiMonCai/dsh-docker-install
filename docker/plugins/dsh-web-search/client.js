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
    // Shared shell overlay state, matching the built-in recycle-bin shortcut.
    const listeners = new Set()
    let opened = false
    const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn) }
    const snapshot = () => opened
    function setOpened(value) {
      if (opened === value) return
      opened = value
      for (const fn of listeners) fn()
    }
    const overlayCss = [
      '.dsh-search-overlay,.dsh-search-overlay *{box-sizing:border-box}',
      '.dsh-search-panel{width:min(820px,96vw);max-height:min(800px,calc(100dvh - 48px));border-radius:16px}',
      '.dsh-search-close:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:2px}',
      '@media(max-width:640px){.dsh-search-overlay{padding:0!important}.dsh-search-panel{width:100%;height:100dvh;max-height:100dvh;border-radius:0}.dsh-search-settings{padding:12px 18px 26px!important}}',
    ].join('\n')
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
    function SearchCard({ view, remote, spacious = false }) {
      const [settings, setSettings] = useState(null)
      const [running, setRunning] = useState(false)
      const [activeProvider, setActiveProvider] = useState('searxng')
      const [pendingRestart, setPendingRestart] = useState(false)
      const [info, setInfo] = useState(null)
      const [secret, setSecret] = useState('')
      const [busy, setBusy] = useState(false)
      const [message, setMessage] = useState('')
      // Plugin list summary rows must not fetch runtime settings or credentials.
      // Keep the Settings client ref current without re-reading and discarding
      // unsaved form inputs if DSH recreates its remote proxy while rendering.
      const credentialsRef = React.useRef(remote)
      credentialsRef.current = remote
      useEffect(() => {
        if (view === 'summary') return undefined
        let live = true
        api().then(value => {
          if (live) {
            setSettings(value.settings)
            setRunning(value.running)
            setActiveProvider(value.activeProvider || 'searxng')
            setPendingRestart(Boolean(value.pendingRestart))
            if (value.error) setMessage(value.error)
          }
        }).catch(e => { if (live) setMessage(e.message) })
        credentialsRef.current.describe(['BRAVE_SEARCH_API_KEY']).then(result => {
          if (live && result.ok) setInfo(result.value.BRAVE_SEARCH_API_KEY)
        }).catch(() => {})
        return () => { live = false }
      }, [view])
      if (view === 'summary') return 'DeepSeek 官方 / 内置 SearXNG · 可切换提供方 · Brave 可选备用'
      const refreshStatus = async () => {
        setBusy(true); setMessage('')
        try {
          const value = await api()
          if (value.settings) setSettings(value.settings)
          setRunning(Boolean(value.running))
          setActiveProvider(value.activeProvider || 'searxng')
          setPendingRestart(Boolean(value.pendingRestart))
          setMessage(value.error || '状态已刷新。')
        } catch (e) { setMessage(e.message || '状态刷新失败。') }
        finally { setBusy(false) }
      }
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
          if (result.activeProvider) setActiveProvider(result.activeProvider)
          if (result.pendingRestart !== undefined) setPendingRestart(Boolean(result.pendingRestart))
          setMessage(type === 'test'
            ? (result.healthy ? '搜索正常：找到 ' + result.results + ' 条结果'
              : '连接成功，但返回 0 条结果。请检查代理出口和搜索引擎。')
            : type === 'restart' ? 'SearXNG 进程已重启。' : result.pendingRestart
              ? '设置已保存。请在宿主机执行 dshd search restart 以切换搜索提供方。' : '设置已保存。')
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
      return h('div', {
        className: spacious ? 'dsh-search-settings' : undefined,
        style: { ...styles.root, ...(spacious ? { maxWidth: 'none', padding: '16px 26px 28px' } : {}) },
      },
        h('h3', { style: { marginTop: 0 } }, spacious ? '搜索服务设置' : 'Web Search · 提供方管理'),
        h('p', { style: styles.hint },
          '可选择 DeepSeek 官方搜索或自建 SearXNG。自建引擎只监听容器内 127.0.0.1:18788，共享 DSH 网络及代理出口。'),
        settings && h('div', { style: styles.section },
          h('h4', { style: styles.heading }, '默认搜索提供方'),
          h('label', { style: { ...styles.row, justifyContent: 'space-between' } },
            h('span', null, '搜索方式'),
            h('select', { value: settings.provider || 'searxng', disabled: busy,
              'aria-label': '搜索提供方',
              style: { ...styles.field, width: 'min(320px,100%)' },
              onChange: e => setSettings(current => ({ ...current, provider: e.target.value })) },
            h('option', { value: 'official' }, 'DeepSeek 官方搜索'),
            h('option', { value: 'searxng' }, 'SearXNG 自建搜索'))),
          h('p', { style: styles.hint }, '当前生效：',
            activeProvider === 'official' ? 'DeepSeek 官方搜索' : 'SearXNG 自建搜索',
            '。更换提供方需先保存，再重启 DSH。'),
          pendingRestart && h('p', { role: 'status', style: styles.hint },
            '存在待生效的切换。请在宿主机执行 dshd search restart；当前搜索服务会持续使用原有提供方。')),
        h('div', { style: styles.section },
          h('div', { style: styles.row },
            h('strong', null, 'SearXNG 状态：', running ? '运行中' : '未运行'),
            h('button', { type: 'button', style: styles.btn, disabled: busy,
              onClick: () => { void refreshStatus() } },
              '刷新'),
            h('button', { type: 'button', style: styles.btn, disabled: busy || activeProvider !== 'searxng',
              onClick: () => { void action('test') } }, '测试搜索'),
            h('button', { type: 'button', style: styles.btn, disabled: busy || activeProvider !== 'searxng',
              onClick: () => { void action('restart') } }, '重启搜索')),
          h('p', { style: styles.hint },
            '关闭自建引擎后，保存并重启 DSH 即使用官方搜索；dshd search disable 则会完全卸载自建插件补丁。')),
        settings && h('div', { style: styles.section },
          h('h4', { style: styles.heading }, '搜索与缓存'),
          toggle('enabled', '启用 SearXNG 后端（关闭后重启切回官方）'),
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

    function SearchOverlay({ remote }) {
      const active = React.useSyncExternalStore(subscribe, snapshot, snapshot)
      const dialogRef = React.useRef(null)
      const close = () => setOpened(false)
      React.useEffect(() => {
        if (!active) return undefined
        const previous = document.activeElement
        const oldOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        dialogRef.current?.focus()
        function onKeyDown(event) {
          if (event.key === 'Escape') { event.preventDefault(); close(); return }
          if (event.key !== 'Tab' || !dialogRef.current) return
          const focusable = [...dialogRef.current.querySelectorAll(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])',
          )].filter(node => node.getClientRects().length > 0)
          if (!focusable.length) { event.preventDefault(); dialogRef.current.focus(); return }
          const first = focusable[0]
          const last = focusable[focusable.length - 1]
          if (event.shiftKey && (document.activeElement === first ||
            document.activeElement === dialogRef.current)) {
            event.preventDefault(); last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault(); first.focus()
          }
        }
        document.addEventListener('keydown', onKeyDown)
        return () => {
          document.removeEventListener('keydown', onKeyDown)
          document.body.style.overflow = oldOverflow
          if (previous && typeof previous.focus === 'function') previous.focus()
        }
      }, [active])
      if (!active) return null
      return h('div', {
        className: 'dsh-search-overlay', role: 'presentation',
        onMouseDown: event => {
          if (event.target === event.currentTarget) close()
        },
        style: {
          position: 'fixed', inset: 0, zIndex: 10000, padding: 24,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(7,13,24,.55)', backdropFilter: 'blur(5px)',
        },
      },
      h('style', null, overlayCss),
      h('section', {
        ref: dialogRef, role: 'dialog', 'aria-modal': 'true',
        'aria-labelledby': 'dsh-search-title', tabIndex: -1,
        className: 'dsh-search-panel',
        style: {
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          border: '1px solid var(--dsw-alias-separator-primary, rgba(128,128,128,.25))',
          background: 'var(--dsw-alias-bg-primary, var(--surface-primary, #fff))',
          color: 'inherit', boxShadow: '0 24px 80px rgba(0,0,0,.22)',
        },
      },
      h('header', {
        style: {
          display: 'flex', alignItems: 'flex-start', gap: 12,
          padding: '20px 26px 16px',
          borderBottom: '1px solid var(--dsw-alias-separator-primary, rgba(128,128,128,.25))',
        },
      },
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('h2', { id: 'dsh-search-title',
          style: { fontSize: 21, fontWeight: 650, margin: 0 } }, '网络搜索'),
        h('p', { style: { fontSize: 12, margin: '7px 0 0',
          color: 'var(--dsw-alias-label-secondary, #777)' } },
        '切换 DeepSeek 官方搜索与 SearXNG，管理缓存和 Brave 备用搜索')),
      h('button', {
        type: 'button', className: 'dsh-search-close',
        'aria-label': '关闭网络搜索', title: '关闭',
        onClick: close,
        style: {
          border: 'none', background: 'transparent', color: 'inherit',
          borderRadius: 8, fontSize: 22, cursor: 'pointer',
          height: 36, width: 36,
        },
      }, '×')),
      h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto' } },
        h(SearchCard, { remote, spacious: true }))))
    }
    function registerDockShortcut() {
      const entry = {
        id: 'dsh-docker.web-search', label: '网络搜索',
        icon: 'search', order: 200,
        onClick: () => setOpened(true),
      }
      const dock = window.__dshDockerIconDockV1
      if (dock) dock.register(entry)
      else (window.__dshDockerIconDockPendingV1 ||= []).push(entry)
    }
    return {
      inject: ['slots', 'remote', 'remote.credentials'],
      apply(ctx) {
        registerDockShortcut()
        ctx.slots.inject('plugins.item', () => ctx.slots.register({
          name: 'plugins.item', id: 'dsh-docker-web-search', order: 80,
          label: () => 'DSH Web Search',
        }, props => h(SearchCard, { ...props, remote: ctx.remote.credentials })))
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay', id: 'dsh-docker.search-panel',
        }, () => h(SearchOverlay, { remote: ctx.remote.credentials })))
      },
    }
  },
})
