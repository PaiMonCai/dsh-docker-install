window.__ModuleLoader__.load({
  id: 'dsh-docker-instance-manager',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const ENDPOINT = '/api/dsh-docker-instance-manager'
    const LOGS_ENDPOINT = ENDPOINT + '/logs'
    const listeners = new Set()
    let opened = false
    let requestedTab = 'overview'
    const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn) }
    const open = (value, tab = 'overview') => {
      if (value) requestedTab = tab
      opened = value
      for (const fn of listeners) fn()
    }
    const labels = {
      check: '检查更新', update: '更新镜像', restart: '重启 DSH', recreate: '重建容器',
      rollback: '回滚版本', cleanup: '清理旧容器与镜像', settings: '保存检查设置',
      'proxy-start': '开启代理', 'proxy-stop': '关闭代理', 'proxy-restart': '重载 sing-box',
      'proxy-test': '测试出口', 'proxy-test-all': '全部节点测速', 'proxy-refresh': '刷新全部订阅',
      'proxy-use': '切换节点', 'proxy-add': '导入节点', 'proxy-subscribe': '添加订阅',
      'edition-standard': '切换 Standard', 'edition-research': '切换 Research',
      'pack-none': '切换 Research Core', 'pack-economics': '启用 Economics Pack',
      'diagnose-environment': '检查开发环境', 'diagnose-storage': '检查持久化存储',
      'diagnose-plugins': '诊断内置插件', 'dashboard-start': '启动 Dashboard',
      'dashboard-stop': '停止 Dashboard', pending: '等待执行',
    }
    // One navigation model for overlay, Plugin Hub embed and task deep-links.
    const pages = [
      { id: 'overview', label: '总览', description: '当前实例状态、健康检查与快捷操作', icon: '◫' },
      { id: 'instances', label: '实例', description: '当前绑定实例与管理边界', icon: '▣' },
      { id: 'versions', label: '版本与更新', description: '镜像检查、升级、回滚和 Edition', icon: '↻' },
      { id: 'network', label: '网络与服务', description: 'sing-box、节点订阅与 Research Dashboard', icon: '◎' },
      { id: 'diagnostics', label: '配置与诊断', description: '只读设置摘要与环境健康检查', icon: '⚙' },
      { id: 'tasks', label: '任务记录', description: '执行进度、结果和历史任务', icon: '☷' },
      { id: 'logs', label: '运行日志', description: '实时事件、级别过滤与自动重连', icon: '≡' },
    ]
    const states = { queued: '等待执行', running: '正在执行', succeeded: '已完成', failed: '失败', interrupted: '执行中断' }
    const errors = {
      'instance-busy': '当前实例已有任务，请等待完成。',
      'host-executor-offline': '宿主机后台未连接，请使用 dshd web status 检查。',
      'management-unavailable': '管理数据暂不可用，请检查宿主机后台。',
      'host-operation-unavailable': '宿主机管理器尚不支持此操作，请更新 dshd 并执行 dshd web enable。',
      'unsupported-operation': '此操作暂未被管理器授权。',
      'invalid-arguments': '操作参数有误，请检查输入。',
      'same-origin-request-required': '安全校验失败，请从当前 DSH 页面重新操作。',
    }
    const css = `
      .dsh-manage{--dm-line:var(--dsw-alias-separator-primary,rgba(128,128,128,.23));--dm-muted:var(--dsw-alias-label-secondary,#787e86);--dm-accent:var(--dsw-alias-brand-primary,#168577);--dm-soft:rgba(128,128,128,.075);color:inherit;font:inherit}
      .dsh-manage *{box-sizing:border-box}.dsh-manage button,.dsh-manage input,.dsh-manage select{font:inherit;color:inherit}
      .dsh-manage button{cursor:pointer;padding:8px 13px;border:1px solid var(--dm-line);border-radius:7px;background:transparent;line-height:1.5}
      .dsh-manage button:disabled{opacity:.45;cursor:default}.dsh-manage button:focus-visible,.dsh-manage input:focus-visible,.dsh-manage select:focus-visible{outline:2px solid var(--dm-accent);outline-offset:3px}
      .dsh-manage .dm-primary{background:var(--dm-accent);color:white;border-color:var(--dm-accent)}
      .dm-head{display:flex;align-items:flex-start;gap:12px;padding:23px 26px 18px;border-bottom:1px solid var(--dm-line)}.dm-head h2{font-size:21px;font-weight:650;margin:0}.dm-head p{color:var(--dm-muted);font-size:12px;margin:7px 0 0}
      .dm-workspace{display:grid;grid-template-columns:196px minmax(0,1fr);min-height:0;flex:1}
      .dm-tabs{display:flex;flex-direction:column;gap:4px;padding:15px 11px;border-right:1px solid var(--dm-line);min-width:0}
      .dm-tabs button{display:flex;align-items:center;gap:10px;border:0;border-radius:8px;padding:10px 12px;text-align:left;font-size:13px;width:100%;white-space:nowrap}
      .dm-tabs button[aria-selected=true]{background:var(--dm-soft);color:var(--dm-accent);font-weight:650}
      .dm-tabs button:focus-visible{outline-offset:-2px}
      .dm-nav-icon{display:inline-flex;align-items:center;justify-content:center;flex:0 0 22px;width:22px;height:22px;border-radius:6px;background:var(--dm-soft);font-size:14px}
      .dm-main{display:flex;flex-direction:column;min-height:0;min-width:0}
      .dm-page-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 16px}
      .dm-page-head h3{margin:0;font-size:18px}.dm-page-head p{margin:5px 0 0}
      .dm-statusbar{display:flex;flex-wrap:wrap;align-items:center;gap:9px 18px;padding:10px 0;margin-bottom:16px;border-bottom:1px solid var(--dm-line);font-size:12px}
      .dm-statusitem{display:inline-flex;align-items:center;gap:6px;color:var(--dm-muted)}
      .dm-statusitem strong{color:inherit;font-weight:650}
      .dm-task-jump{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 13px;background:var(--dm-soft);border-radius:9px;margin:0 0 15px;font-size:12px}
      .dm-task-jump button{margin-left:auto;padding:5px 9px}
      .dm-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:17px}
      .dm-mini{min-width:0;padding:13px;border:1px solid var(--dm-line);border-radius:9px}
      .dm-mini .dm-muted{margin-bottom:5px}.dm-mini strong{font-size:15px;overflow-wrap:anywhere}
      .dm-empty{padding:23px 15px;text-align:center;border:1px dashed var(--dm-line);border-radius:9px;color:var(--dm-muted);font-size:13px}
      .dm-confirm{padding:15px;border:1px solid var(--dm-line);border-radius:10px;margin-bottom:16px;background:var(--dm-soft)}
      .dm-confirm h4{margin:0 0 8px;font-size:14px}.dm-confirm p{font-size:12px;line-height:1.7;margin:6px 0 10px}
      .dm-confirm input{width:min(320px,100%);padding:8px 10px;border:1px solid var(--dm-line);border-radius:7px;background:transparent}
      .dm-danger{border-color:rgba(190,100,65,.48)!important;color:#bb6943!important}
      .dm-task-filter{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:6px 0 9px}
      .dm-task-filter input,.dm-task-filter select{padding:8px 10px;border:1px solid var(--dm-line);border-radius:7px;background:transparent}
      .dm-task-filter input{flex:1;min-width:150px}
      .dm-content{padding:18px 24px;overflow:auto;min-height:0;flex:1}.dm-content h3{font-size:15px;font-weight:650;margin:0 0 13px}
      .dm-summary{display:flex;justify-content:space-between;gap:16px;align-items:center;padding-bottom:20px;border-bottom:1px solid var(--dm-line);margin-bottom:20px}.dm-state{display:flex;align-items:center;gap:8px;font-size:17px}.dm-dot{width:9px;height:9px;background:var(--dm-accent);border-radius:50%}.dm-dot[data-online=false]{background:#b47f32}
      .dm-muted{color:var(--dm-muted);font-size:12px;line-height:1.7}.dm-grid{display:grid;grid-template-columns:110px minmax(0,1fr);gap:10px 16px;font-size:13px;margin:16px 0 23px}.dm-grid dt{color:var(--dm-muted)}.dm-grid dd{margin:0;overflow-wrap:anywhere}
      .dm-actions{display:flex;gap:9px;flex-wrap:wrap}.dm-section{margin:0 0 20px}.dm-section+.dm-section{padding-top:18px;border-top:1px solid var(--dm-line)}
      .dm-banner{font-size:13px;padding:13px 15px;line-height:1.7;background:rgba(128,128,128,.08);border-left:3px solid var(--dm-accent);margin-bottom:18px;overflow-wrap:anywhere}.dm-banner[data-error=true]{border-left-color:#bc6b42}
      .dm-inputs{display:grid;grid-template-columns:1fr 1fr;gap:13px}.dm-inputs label{display:flex;flex-direction:column;gap:7px;font-size:12px}.dm-inputs input,.dm-inputs select,.dm-setting select{min-width:0;width:100%;padding:9px 10px;border:1px solid var(--dm-line);border-radius:6px;background:transparent}.dm-wide{grid-column:1/-1}
      .dm-setting{display:flex;justify-content:space-between;align-items:center;gap:16px;font-size:13px}.dm-setting select{width:auto;max-width:55%}
      .dm-task{padding:13px 0;border-bottom:1px solid var(--dm-line)}.dm-task-head{display:flex;gap:12px;justify-content:space-between;font-size:13px}.dm-task-head button{padding:0;border:0;text-align:left}.dm-task time{font-size:11px;color:var(--dm-muted)}
      .dm-log{white-space:pre-wrap;overflow-wrap:anywhere;padding:15px;font:12px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace;background:rgba(128,128,128,.08);border-radius:6px;max-height:340px;overflow:auto;margin:12px 0}
      .dm-log-console{display:flex;flex-direction:column;gap:12px;min-width:0}
      .dm-log-toolbar{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
      .dm-log-toolbar label{display:flex;align-items:center;gap:6px;font-size:12px}
      .dm-log-toolbar input[type=search],.dm-log-toolbar select{padding:8px 10px;border:1px solid var(--dm-line);border-radius:7px;background:transparent}
      .dm-log-toolbar input[type=search]{max-width:100%;width:240px}
      .dm-log-toolbar input[type=checkbox]{accent-color:var(--dm-accent)}
      .dm-log-stream{height:min(54dvh,540px);min-height:230px;max-height:none;white-space:pre;overflow:auto}
      .dm-log-meta{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;color:var(--dm-muted);font-size:12px}
      .dm-dialog{width:min(1040px,100%);height:min(840px,94dvh);display:flex;flex-direction:column;border:1px solid var(--dsw-alias-separator-primary,rgba(128,128,128,.25));border-radius:14px;background:var(--dsw-alias-bg-primary,var(--surface-primary,#fff));box-shadow:0 25px 85px rgba(0,0,0,.23)}
      .dm-overlay{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:22px;background:rgba(7,13,24,.5);backdrop-filter:blur(4px)}
      @media(max-width:780px){.dm-workspace{display:flex;flex-direction:column}.dm-tabs{flex-direction:row;overflow-x:auto;gap:4px;padding:8px 12px;border-right:0;border-bottom:1px solid var(--dm-line);flex-shrink:0}.dm-tabs button{width:auto;flex:0 0 auto;padding:9px 11px}.dm-main{flex:1}.dm-cards{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:600px){.dm-overlay{padding:8px}.dm-dialog{height:96dvh;border-radius:10px}.dm-head{padding:15px 16px}.dm-content{padding:15px 16px}.dm-inputs{grid-template-columns:1fr}.dm-summary{align-items:flex-start}.dm-grid{grid-template-columns:95px minmax(0,1fr);gap:9px}.dm-actions button{flex:1 1 auto}.dm-setting{align-items:flex-start;flex-direction:column}.dm-setting select{width:100%;max-width:100%}.dm-cards{grid-template-columns:1fr 1fr}.dm-statusbar{gap:8px 12px}.dm-nav-icon{display:none}}
    `
    async function request(data, signal) {
      const response = await fetch(ENDPOINT, {
        credentials: 'same-origin', cache: 'no-store', signal,
        ...(data ? { method: 'POST', headers: { 'content-type': 'application/json', 'x-dsh-management': '1' },
          body: JSON.stringify(data) } : {}),
      })
      const result = await response.json()
      if (!response.ok) throw Error(errors[result.error] || result.error || '请求失败')
      return result
    }
    function currentRelease(data) {
      const status = data?.status
      const release = status?.release
      if (!release || release.current && release.current !== status.container?.imageId
        || release.target && release.target !== status.instance?.image) return null
      return release.error || typeof release.current === 'string'
        && release.current === status.container?.imageId ? release : null
    }
    function shortDigest(value) {
      return typeof value === 'string' ? value.replace(/^sha256:/, '').slice(0, 12) : ''
    }
    function formatTime(value) {
      return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '尚未检查'
    }
    function taskId() {
      if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
      // LAN HTTP origins expose getRandomValues but may not expose randomUUID.
      const bytes = crypto.getRandomValues(new Uint8Array(16))
      bytes[6] = (bytes[6] & 15) | 64
      bytes[8] = (bytes[8] & 63) | 128
      const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
      return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-')
    }

    function LogConsole({ logs, updatedAt, online, refresh }) {
      const [query, setQuery] = React.useState('')
      const [level, setLevel] = React.useState('all')
      const [maxLines, setMaxLines] = React.useState(200)
      const [paused, setPaused] = React.useState(false)
      const [frozen, setFrozen] = React.useState('')
      const [follow, setFollow] = React.useState(true)
      const [streamLines, setStreamLines] = React.useState([])
      const [streamUpdated, setStreamUpdated] = React.useState('')
      const [streamState, setStreamState] = React.useState('connecting')
      const [streamSeen, setStreamSeen] = React.useState(false)
      const [reload, setReload] = React.useState(0)
      const preRef = React.useRef(null)
      const cursorRef = React.useRef({ generation: '', seq: -1 })
      React.useEffect(() => {
        if (typeof EventSource !== 'function') {
          setStreamState('unsupported')
          return undefined
        }
        let alive = true
        setStreamState('connecting')
        const stream = new EventSource(LOGS_ENDPOINT, { withCredentials: true })
        stream.onopen = () => { if (alive) setStreamState('live') }
        stream.onerror = () => { if (alive) setStreamState('reconnecting') }
        stream.addEventListener('status', event => {
          if (!alive) return
          try {
            const data = JSON.parse(event.data)
            setStreamState(data.state === 'error' ? 'error' : 'waiting')
          } catch { setStreamState('error') }
        })
        stream.addEventListener('logs', event => {
          if (!alive) return
          let payload
          try { payload = JSON.parse(event.data) } catch { return }
          if (!payload || !Array.isArray(payload.lines) || payload.lines.length > 200
              || payload.lines.some(line => typeof line !== 'string')
              || !Number.isSafeInteger(payload.seq) || typeof payload.generation !== 'string') return
          const previous = cursorRef.current
          if (previous.generation === payload.generation && payload.seq <= previous.seq) return
          const snapshot = payload.mode === 'snapshot' || previous.generation !== payload.generation
          setStreamLines(current => (snapshot ? payload.lines : current.concat(payload.lines)).slice(-200))
          cursorRef.current = { generation: payload.generation, seq: payload.seq }
          setStreamUpdated(payload.updatedAt || '')
          setStreamSeen(true)
          setStreamState('live')
        })
        return () => { alive = false; stream.close() }
      }, [reload])
      const incoming = streamSeen ? streamLines.join('\n') : (logs || '')
      const content = paused ? frozen : incoming
      const lines = content.split(/\r?\n/).filter((line, index, array) => line || index < array.length - 1)
      const filtered = lines.filter(line => {
        if (query && !line.toLowerCase().includes(query.toLowerCase())) return false
        if (level === 'error') return /\b(error|fatal|exception|traceback|failed)\b/i.test(line)
        if (level === 'warn') return /\b(warn|warning)\b/i.test(line)
        return true
      })
      const displayed = filtered.slice(-maxLines).join('\n')
      React.useEffect(() => {
        if (follow && preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight
      }, [displayed, follow])
      const statusText = paused ? '已暂停显示'
        : streamState === 'live' ? 'SSE 实时连接'
          : streamState === 'reconnecting' ? '连接中断 · 自动重连中'
            : streamState === 'waiting' ? '等待宿主机日志采集 · 升级后请执行 dshd web enable'
              : streamState === 'error' ? '日志流暂不可用 · 自动重试'
                : streamState === 'unsupported' ? '不支持 SSE，使用兼容快照自动刷新'
                  : !online ? '宿主机离线 · 等待连接' : '正在连接 SSE…'
      return h('section', { className: 'dm-log-console', 'aria-label': 'DSH 实时运行日志' },
        h('div', { className: 'dm-log-meta' },
          h('strong', null, statusText),
          h('span', null, '最近更新：',
            streamSeen ? formatTime(streamUpdated) : updatedAt ? formatTime(updatedAt) : '尚未获取')),
        h('div', { className: 'dm-log-toolbar' },
          h('input', { type: 'search', value: query, 'aria-label': '搜索运行日志',
            placeholder: '搜索日志内容…', onChange: e => setQuery(e.target.value) }),
          h('label', null, '级别', h('select', { value: level, 'aria-label': '日志级别',
            onChange: e => setLevel(e.target.value) },
            h('option', { value: 'all' }, '全部'),
            h('option', { value: 'error' }, '错误'),
            h('option', { value: 'warn' }, '警告'))),
          h('label', null, '行数', h('select', { value: maxLines, 'aria-label': '日志行数',
            onChange: e => setMaxLines(Number(e.target.value)) },
            ...[50, 100, 200].map(n => h('option', { key: n, value: n }, String(n))))),
          h('button', { type: 'button', onClick: () => {
            if (!paused) setFrozen(incoming)
            setPaused(!paused)
          } }, paused ? '继续显示' : '暂停显示'),
          h('button', { type: 'button', onClick: () => {
            setStreamState('connecting')
            cursorRef.current = { generation: '', seq: -1 }
            setStreamSeen(false)
            setReload(n => n + 1)
            void refresh()
          } }, '重新连接'),
          h('label', null, h('input', { type: 'checkbox', checked: follow,
            onChange: e => setFollow(e.target.checked) }), '自动滚动')),
        h('pre', { ref: preRef, className: 'dm-log dm-log-stream',
          'aria-label': 'DSH 运行日志', role: 'log', 'aria-live': 'off' },
          displayed || (content ? '没有匹配的日志。' : '暂无运行日志。')),
        h('div', { className: 'dm-log-meta' },
          h('span', null, '匹配 ', filtered.length, ' 行 · 最多显示 ', maxLines, ' 行'),
          h('span', null, 'SSE 自动重连 · 仅保留最近 200 行 · 宿主机脱敏读取')))
    }
    const confirmations = {
      update: '镜像拉取完成后会重启 DSH。页面将暂时断开，恢复后自动读取更新结果。',
      restart: '重启会中断当前运行中的会话任务。页面恢复连接后可查看结果。',
      recreate: '将按当前宿主机配置重建容器，页面会暂时断开。',
      rollback: '仅恢复旧版容器，持久化数据不会回滚；旧版可能不兼容新版写入的数据。',
      cleanup: '清理当前实例停止的回滚容器及未使用旧镜像，清理后将失去这些回滚点。',
      'proxy-start': '首次开启代理可能重建 DSH，页面会暂时断开。',
      'proxy-stop': '关闭代理会恢复直连，并可能重建 DSH。',
      'edition-standard': '将下载并切换到 Standard 镜像，停止当前会话后进行健康检查。Reverse 必须保持独立实例。',
      'edition-research': '将下载并切换到 Research Core，容器会重建，数据卷不回滚。',
      'pack-none': '将切换到 Research Core，可能中断当前任务。',
      'pack-economics': '将切换到 Economics Pack，拉取镜像并重建容器；数据卷不回滚。',
      'dashboard-start': '将为当前 Research 实例启动只读 Dashboard Sidecar。默认仅绑定宿主机回环地址。',
      'dashboard-stop': '将停止并删除当前 Research Dashboard Sidecar，不删除工作区。',

    }
    function Panel({ embedded = false }) {
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState('')
      const [disconnected, setDisconnected] = React.useState(false)
      const [tab, setTab] = React.useState(() => embedded ? 'overview' : requestedTab)
      const [sending, setSending] = React.useState(false)
      const submitting = React.useRef(false)
      const [confirmation, setConfirmation] = React.useState(null)
      const [confirmationInput, setConfirmationInput] = React.useState('')
      const [taskFilter, setTaskFilter] = React.useState('all')
      const [taskQuery, setTaskQuery] = React.useState('')
      const [selected, setSelected] = React.useState(() => {
        try { return localStorage.getItem('dsh-management-task') || '' } catch { return '' }
      })
      const [node, setNode] = React.useState('')
      const [importName, setImportName] = React.useState('')
      const [importURL, setImportURL] = React.useState('')
      const [importKind, setImportKind] = React.useState('proxy-add')
      React.useEffect(() => {
        let alive = true
        let timer
        const controller = new AbortController()
        const poll = async () => {
          try {
            const next = await request(null, AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]))
            if (alive) { setData(next); setDisconnected(false) }
          } catch {
            if (alive) {
              setDisconnected(true)
            }
          }
          if (alive) timer = setTimeout(poll, 3000)
        }
        void poll()
        return () => { alive = false; controller.abort(); clearTimeout(timer) }
      }, [])
      const refreshStatus = async () => {
        try {
          const next = await request(null, AbortSignal.timeout(12000))
          setData(next); setDisconnected(false); setError('')
        } catch (failure) {
          setDisconnected(true)
          setError('读取最新运行日志失败：' + failure.message)
        }
      }
      const status = data?.status
      const jobs = data?.jobs || []
      const page = pages.find(item => item.id === tab) || pages[0]
      const activeJob = jobs.find(job => ['queued', 'running'].includes(job.state))
      const lastJob = jobs[0]
      const completedJobs = jobs.filter(job => (taskFilter === 'all' || job.state === taskFilter)
        && (!taskQuery || (labels[job.action] || job.action || '').toLowerCase().includes(taskQuery.toLowerCase())
          || String(job.id).toLowerCase().includes(taskQuery.toLowerCase())))
      const navigate = next => {
        if (!pages.some(item => item.id === next)) return
        setConfirmation(null)
        setConfirmationInput('')
        setTab(next)
      }
      const busy = sending || jobs.some(job => ['queued', 'running'].includes(job.state))
      const enabled = Boolean(data?.online) && !busy && !disconnected
      // A newer Web image may briefly talk to an older host manager. The host
      // remains authoritative; absent metadata preserves existing deployments.
      const phaseTwoActions = new Set(['edition-standard', 'edition-research', 'pack-none', 'pack-economics',
        'diagnose-environment', 'diagnose-storage', 'diagnose-plugins', 'dashboard-start', 'dashboard-stop'])
      const supports = action => status?.management
        ? (status.management.schema === 1 && Array.isArray(status.management.operations)
          && status.management.operations.includes(action))
        : !phaseTwoActions.has(action)
      async function submit(action, args = {}) {
        if (submitting.current || !enabled) return
        if (!supports(action)) { setError('宿主机管理器尚不支持此操作，请更新 dshd 并执行 dshd web enable。'); return }
        const id = taskId()
        submitting.current = true
        setSending(true); setError(''); setConfirmation(null)
        try {
          const result = await request({ id, action, arguments: args }, AbortSignal.timeout(15000))
          setSelected(result.id)
          try { localStorage.setItem('dsh-management-task', result.id) } catch {}
          setData(current => ({ ...current, jobs: [{ id: result.id, action, state: result.state }, ...(current?.jobs || [])] }))
          if (['proxy-add', 'proxy-subscribe'].includes(action)) { setImportURL(''); setImportName('') }
          navigate('tasks')
        } catch (failure) {
          // The host may have accepted a task before the connection disappeared.
          setSelected(id)
          try { localStorage.setItem('dsh-management-task', id) } catch {}
          setError(failure.message + '。如连接中断，请先查看任务记录再重试。')
        } finally { submitting.current = false; setSending(false) }
      }
      function actionButton(action, args = {}, primary = false) {
        const unavailable = !supports(action)
        return h('button', { type: 'button', disabled: !enabled || unavailable,
          title: unavailable ? '当前宿主机管理器不支持该操作' : undefined,
          className: (primary ? 'dm-primary' : '') + (action === 'cleanup' || action === 'dashboard-stop' ? ' dm-danger' : ''),
          onClick: () => confirmations[action] ? (setConfirmation({ action, args }), setConfirmationInput('')) : void submit(action, args),
        }, labels[action])
      }
      const selectedJob = jobs.find(job => job.id === selected) || jobs[0]
      const release = currentRelease(data)
      const healthText = status?.container?.health || '未知'
      const stateText = status?.container?.state === 'running' ? '运行中' : status?.container?.state || '不可用'
      const instanceName = status?.instance?.name || '未连接'
      const selectedTaskState = activeJob || lastJob
      const confirmationNeedsName = confirmation?.action === 'cleanup'
      const confirmationReady = !confirmationNeedsName || confirmationInput === instanceName
      const section = (title, ...children) => h('section', { className: 'dm-section' }, h('h3', null, title), ...children)
      const details = entries => h('dl', { className: 'dm-grid' }, ...entries.flatMap(([key, value]) => [
        h('dt', { key: key + '-label' }, key), h('dd', { key }, value || '—'),
      ]))
      return h('div', { className: 'dsh-manage', style: { display: 'flex', flexDirection: 'column', minHeight: 0, height: embedded ? undefined : '100%' } },
        h('style', null, css),
        h('header', { className: 'dm-head' },
          h('div', { style: { flex: 1, minWidth: 0 } },
            h('h2', { id: embedded ? undefined : 'dsh-management-title' }, 'DSH 管理中心'),
            h('p', null, '当前实例的运行、版本、网络和维护操作')),
          !embedded && h('button', { type: 'button', onClick: () => open(false),
            'aria-label': '关闭实例管理' }, '关闭')),
        h('div', { className: 'dm-workspace' },
          h('nav', { className: 'dm-tabs', role: 'tablist', 'aria-label': '管理中心导航',
            'aria-orientation': 'vertical' },
            ...pages.map((item, index) => h('button', { key: item.id, id: 'dm-nav-' + item.id,
              type: 'button', role: 'tab', 'aria-selected': tab === item.id,
              'aria-controls': 'dm-page-panel', tabIndex: tab === item.id ? 0 : -1,
              onClick: () => navigate(item.id),
              onKeyDown: event => {
                const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1
                  : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0
                if (!step && event.key !== 'Home' && event.key !== 'End') return
                event.preventDefault()
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? pages.length - 1
                  : (index + step + pages.length) % pages.length
                navigate(pages[next].id)
                event.currentTarget?.parentElement?.querySelectorAll('[role="tab"]')?.[next]?.focus?.()
              } },
              h('span', { className: 'dm-nav-icon', 'data-icon': item.icon, 'aria-hidden': true }),
              item.label))),
          h('div', { className: 'dm-main' },
            h('div', { className: 'dm-content', id: 'dm-page-panel', role: 'tabpanel',
              'aria-labelledby': 'dm-nav-' + tab, tabIndex: 0, 'aria-live': 'polite' },
              h('div', { className: 'dm-page-head' },
                h('div', null, h('h3', null, page.label),
                  h('p', { className: 'dm-muted' }, page.description))),
              status && h('div', { className: 'dm-statusbar', 'aria-label': '当前实例状态' },
                h('span', { className: 'dm-statusitem' },
                  h('span', { className: 'dm-dot', 'data-online': data.online && !disconnected }),
                  h('strong', null, instanceName), ' · ', stateText),
                h('span', { className: 'dm-statusitem' }, '健康：', h('strong', null, healthText)),
                h('span', { className: 'dm-statusitem' }, 'Edition：', h('strong', null, status.instance.edition)),
                h('span', { className: 'dm-statusitem' }, '执行器：', data.online && !disconnected ? '在线' : '离线')),
              selectedTaskState && tab !== 'tasks' && h('div', { className: 'dm-task-jump', role: 'status' },
                h('span', null, labels[selectedTaskState.action] || selectedTaskState.action, ' · ',
                  states[selectedTaskState.state] || selectedTaskState.state),
                h('button', { type: 'button', onClick: () => navigate('tasks') }, '查看任务')),
              disconnected && h('div', { className: 'dm-banner', role: 'status' },
                '连接暂时断开，正在自动重连。后台已接收的任务会继续执行。'),
              data && !data.configured && h('div', { className: 'dm-banner' },
                '此实例尚未启用 Web 管理。请在宿主机执行 dshd web enable；命名实例使用 dshd -i 实例ID web enable。'),
              data?.configured && !data.online && h('div', { className: 'dm-banner', 'data-error': true },
                '宿主机后台未连接。请运行 dshd web status 检查；必要时用 dshd web enable 修复。'),
              error && h('div', { className: 'dm-banner', 'data-error': true, role: 'alert' }, error),
              confirmation && h('div', { className: 'dm-confirm', role: 'group', 'aria-label': '确认管理操作' },
                h('h4', null, '确认操作 · ', labels[confirmation.action]),
                h('p', null, confirmations[confirmation.action]),
                h('p', { className: 'dm-muted' }, '目标实例：', instanceName,
                  '。任务提交到宿主机后即使页面断开，仍会在后台继续执行。'),
                confirmationNeedsName && h('label', null,
                  '请输入实例名称以确认清理：',
                  h('input', { value: confirmationInput, autoComplete: 'off',
                    'aria-label': '输入实例名称确认清理', placeholder: instanceName,
                    onChange: event => setConfirmationInput(event.target.value) })),
                h('div', { className: 'dm-actions', style: { marginTop: 12 } },
                  h('button', { type: 'button', className: 'dm-primary', disabled: !enabled
                      || !supports(confirmation.action) || !confirmationReady,
                    onClick: () => void submit(confirmation.action, confirmation.args) },
                    '确认' + labels[confirmation.action]),
                  h('button', { type: 'button', onClick: () => {
                    setConfirmation(null); setConfirmationInput('')
                  } }, '取消'))),
              !data && !disconnected && h('p', { className: 'dm-muted' }, '正在读取实例状态…'),
          tab === 'overview' && status && h(React.Fragment, null,
            h('div', { className: 'dm-cards' },
              h('div', { className: 'dm-mini' },
                h('div', { className: 'dm-muted' }, '运行状态'),
                h('strong', null, stateText)),
              h('div', { className: 'dm-mini' },
                h('div', { className: 'dm-muted' }, '当前 DSH 版本'),
                h('strong', null, status.container?.version || '未知')),
              h('div', { className: 'dm-mini' },
                h('div', { className: 'dm-muted' }, '健康检查'),
                h('strong', null, healthText))),
            section('当前实例',
              details([['容器名称', instanceName], ['Edition', status.instance.edition],
                ['Research Pack', status.instance.researchPack || 'none'],
                ['镜像', status.instance.image], ['出口模式',
                  status.instance.proxyEnabled === 'true' ? 'sing-box' : '直连']])),
            section('升级状态',
              h('p', { className: 'dm-muted' },
                release?.error ? '更新检查失败：' + release.error
                  : release?.available === true ? '检测到可用更新，安装前请查看版本页面的操作说明。'
                    : release?.available === false ? '当前运行镜像与远端一致。'
                      : status.release ? '运行镜像或更新源已变化，请重新检查更新。' : '尚未完成更新检查。'),
              h('div', { className: 'dm-actions' },
                h('button', { type: 'button', onClick: () => navigate('versions') }, '打开版本与更新'),
                actionButton('restart'))),
            section('快捷入口',
              h('div', { className: 'dm-actions' },
                h('button', { type: 'button', onClick: () => navigate('network') }, '网络与服务'),
                h('button', { type: 'button', onClick: () => navigate('diagnostics') }, '配置与诊断'),
                h('button', { type: 'button', onClick: () => navigate('logs') }, '运行日志')))),
          tab === 'instances' && status && h(React.Fragment, null,
            section('当前绑定实例',
              details([['实例 ID', status.instance.id || 'default'],
                ['容器名称', instanceName], ['运行状态', stateText],
                ['健康状态', healthText], ['Edition', status.instance.edition],
                ['当前镜像', status.instance.image]]),
              h('div', { className: 'dm-actions' }, actionButton('restart'),
                h('button', { type: 'button', onClick: () => navigate('versions') }, '管理版本'))),
            section('多实例与权限边界',
              h('p', { className: 'dm-muted' },
                '当前 Web 控制台只管理宿主机执行器绑定的这一实例，不会通过浏览器输入切换其他实例。'),
              h('p', { className: 'dm-muted' },
                '其他实例的列表、创建与授权暂由宿主机执行 dshd instances / dshd instance add ID 完成。'),
              h('div', { className: 'dm-empty' }, '跨实例统一管理尚未开放；需要独立宿主机授权后才能启用。'))),
          tab === 'versions' && status && h(React.Fragment, null,
            section('镜像与更新',
              details([['当前 DSH 版本', status.container?.version], ['镜像', status.instance.image],
                ['当前镜像标识', shortDigest(status.container?.imageId)], ['远端镜像标识', shortDigest(release?.latest)],
                ['健康检查', status.container?.health], ['最近检查', formatTime(release?.checkedAt)]]),
              h('div', { className: 'dm-banner', 'data-error': Boolean(release?.error) },
                release?.error ? '更新检查失败：' + release.error
                  : release?.available === true ? '检测到可用更新。点击「更新镜像」并确认后，后台才会拉取镜像并重启；结果可在任务记录查看。'
                    : release?.available === false ? '当前运行镜像与远端一致。'
                      : status.release ? '运行镜像或更新源已变化，请重新检查更新。' : '尚未完成更新检查。'),
              h('p', { className: 'dm-muted' }, '按当前平台的镜像内容检查更新。DSH 版本号相同，镜像内的插件与修复仍可能有更新。'),
              h('div', { className: 'dm-actions' }, actionButton('check'), actionButton('update', {}, true)),
              h('div', { className: 'dm-setting', style: { marginTop: 18 } },
                h('label', { htmlFor: embedded ? 'dm-check-embedded' : 'dm-check' }, '自动检查更新'),
                h('select', { id: embedded ? 'dm-check-embedded' : 'dm-check', disabled: !enabled,
                  value: status.settings.checkInterval,
                  onChange: event => void submit('settings', { checkInterval: Number(event.target.value) }) },
                ...[[0, '关闭'], [3600, '每小时'], [21600, '每 6 小时'], [86400, '每天']].map(([value, title]) =>
                  h('option', { value, key: value }, title)))),
              h('p', { className: 'dm-muted' }, '宿主机后台定时检测，关闭页面后继续；结果仅在此处显示，不弹窗。安装更新需点击「更新镜像」并确认。')),
            section('维护',
              h('p', { className: 'dm-muted' }, '升级成功后默认清理旧容器。回滚仅在仍有保留的回滚容器时可用，且不会恢复历史数据。'),
              h('div', { className: 'dm-actions' }, actionButton('recreate'), actionButton('rollback'), actionButton('cleanup'))),
            status.instance.edition !== 'reverse' && section('Edition / Research Pack',
              details([['当前 Edition', status.instance.edition], ['Research Pack', status.instance.researchPack || 'none']]),
              h('p', { className: 'dm-muted' }, '固定镜像目标、先拉取再进行安全替换。Reverse 为独立实例，不能在此切换。'),
              h('div', { className: 'dm-actions' }, actionButton('edition-standard'),
                actionButton('edition-research'), actionButton('pack-economics')))),
          tab === 'network' && status && h(React.Fragment, null,
            section('sing-box',
              details([['代理出口', status.instance.proxyEnabled === 'true' ? '已开启' : '直连'],
                ['sing-box', status.proxy.running ? '运行中' : '已停止'], ['当前节点', status.instance.proxyNode]]),
              h('div', { className: 'dm-actions' }, actionButton('proxy-start'), actionButton('proxy-stop'),
                actionButton('proxy-restart'), actionButton('proxy-test'))),
            section('节点与订阅',
              h('div', { className: 'dm-inputs' },
                h('label', { className: 'dm-wide' }, '选择节点',
                  h('select', { value: node, 'aria-label': '选择节点', disabled: !enabled, onChange: event => setNode(event.target.value) },
                    h('option', { value: '' }, '请选择节点'),
                    ...status.proxy.nodes.map(name => h('option', { key: name, value: name }, name)))),
                h('div', { className: 'dm-actions dm-wide' },
                  h('button', { type: 'button', disabled: !enabled || !node, onClick: () => void submit('proxy-use', { name: node }) }, '切换节点'),
                  actionButton('proxy-refresh'), actionButton('proxy-test-all'))),
              !status.proxy.nodes.length && h('p', { className: 'dm-muted' }, '尚未添加节点，可在下方导入节点链接或订阅。')),
            section('导入',
              h('form', { className: 'dm-inputs', onSubmit: event => { event.preventDefault(); void submit(importKind, { name: importName, url: importURL }) } },
                h('label', null, '类型', h('select', { value: importKind, disabled: !enabled, onChange: event => setImportKind(event.target.value) },
                  h('option', { value: 'proxy-add' }, '节点链接'), h('option', { value: 'proxy-subscribe' }, 'HTTP(S) 订阅'))),
                h('label', null, '名称', h('input', { required: true, pattern: '[A-Za-z0-9][A-Za-z0-9_.\\-]{0,63}', maxLength: 64,
                  value: importName, disabled: !enabled, autoComplete: 'off', placeholder: '例如 hk-01', onChange: event => setImportName(event.target.value) })),
                h('label', { className: 'dm-wide' }, '链接', h('input', { required: true, type: 'password', autoComplete: 'off',
                  value: importURL, disabled: !enabled, maxLength: 8192, placeholder: '粘贴节点或订阅链接', onChange: event => setImportURL(event.target.value) })),
                h('div', { className: 'dm-actions dm-wide' }, h('button', { type: 'submit', className: 'dm-primary',
                  disabled: !enabled || !importName || !importURL }, labels[importKind])))),
            status.instance.edition === 'research' && section('Research Dashboard',
              details([['状态', status.dashboard?.running ? '运行中' : '未运行'],
                ['宿主机端口', status.instance.dashboardPort || '8765']]),
              h('p', { className: 'dm-muted' }, 'Dashboard 仅绑定宿主机 127.0.0.1；远程访问建议使用受控反代或 SSH 隧道。'),
              h('div', { className: 'dm-actions' }, actionButton('dashboard-start'), actionButton('dashboard-stop')))),
          tab === 'diagnostics' && status && h(React.Fragment, null,
            section('当前配置摘要',
              details([['Edition', status.instance.edition], ['Research Pack', status.instance.researchPack || 'none'],
                ['存储模式', status.instance.storageMode], ['API 接入模式', status.instance.apiMode],
                ['API Key', status.instance.apiKeyConfigured === 'true' ? '已配置（不显示明文）' : '未配置'],
                ['容器 Docker 权限', status.instance.dockerAccess === 'true' ? '已启用（高风险）' : '未启用']]),
              h('p', { className: 'dm-muted' }, '这里只显示非敏感摘要；API Key、Trusted Hosts 写入与 Docker Socket 授权仍需要宿主机 CLI。')),
            section('环境与插件诊断',
              h('p', { className: 'dm-muted' }, '诊断在当前实例宿主机执行，结果脱敏后保存在任务记录。不会开放 Shell、配置文件路径或任意命令参数。'),
              h('div', { className: 'dm-actions' }, actionButton('diagnose-environment'),
                actionButton('diagnose-storage'), actionButton('diagnose-plugins'))),
            status.instance.edition === 'research' && section('Research Pack',
              h('p', { className: 'dm-muted' }, '可以切换到通用科研包或经济学计量工具链。操作需要下载镜像并重建容器。'),
              h('div', { className: 'dm-actions' }, actionButton('pack-none'), actionButton('pack-economics')))),
          tab === 'tasks' && h(React.Fragment, null,
            selectedJob && section('当前任务',
              h('div', { className: 'dm-task-head' }, h('strong', null, labels[selectedJob.action] || selectedJob.action),
                h('span', null, states[selectedJob.state] || selectedJob.state)),
              h('p', { className: 'dm-muted' }, formatTime(selectedJob.startedAt), ' · ', selectedJob.id),
              selectedJob.error && h('div', { className: 'dm-banner', 'data-error': true }, selectedJob.error),
              h('pre', { className: 'dm-log', 'aria-label': '任务日志' }, selectedJob.log
                || (['queued', 'running'].includes(selectedJob.state) ? '任务已记录，正在等待后台结果…' : '本任务没有额外执行日志。'))),
            section('最近任务', ...jobs.map(job => h('div', { className: 'dm-task', key: job.id },
              h('div', { className: 'dm-task-head' },
                h('button', { type: 'button', onClick: () => setSelected(job.id) }, labels[job.action] || job.action),
                h('span', null, states[job.state] || job.state)),
              h('time', null, formatTime(job.startedAt || job.finishedAt))))),
            !jobs.length && h('p', { className: 'dm-muted' }, '暂无管理任务。更新、重启及代理操作的执行结果会保存在这里。')),
          tab === 'logs' && h(LogConsole, { logs: status?.logs, updatedAt: status?.logsUpdatedAt
            || status?.heartbeat, online: Boolean(data?.online) && !disconnected,
            refresh: refreshStatus })))))
    }
    function Overlay() {
      const active = React.useSyncExternalStore(subscribe, () => opened)
      const ref = React.useRef(null)
      React.useEffect(() => {
        if (!active) return
        const previous = document.activeElement
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        ref.current?.focus()
        const keydown = event => {
          if (event.key === 'Escape') { event.stopPropagation(); open(false) }
          if (event.key !== 'Tab') return
          const nodes = [...(ref.current?.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]') || [])]
            .filter(node => node.getClientRects().length)
          if (!nodes.length) { event.preventDefault(); return }
          const first = nodes[0], last = nodes[nodes.length - 1]
          if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
            event.preventDefault(); last.focus()
          } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) {
            event.preventDefault(); first.focus()
          }
        }
        document.addEventListener('keydown', keydown)
        return () => {
          document.removeEventListener('keydown', keydown)
          document.body.style.overflow = previousOverflow
          previous?.focus?.()
        }
      }, [active])
      if (!active) return null
      return h('div', { className: 'dm-overlay', onMouseDown: event => { if (event.target === event.currentTarget) open(false) } },
        h('style', null, css),
        h('section', { ref, className: 'dm-dialog', role: 'dialog', 'aria-modal': 'true',
          'aria-labelledby': 'dsh-management-title', tabIndex: -1 }, h(Panel)))
    }
    return {
      inject: ['slots'],
      apply(ctx) {
        const entry = { id: 'dsh-docker.instance-manager', label: '实例管理', icon: 'settings', order: 90,
          onClick: () => open(true, 'overview') }
        const logsEntry = { id: 'dsh-docker.runtime-logs', label: '运行日志', icon: 'terminal', order: 95,
          onClick: () => open(true, 'logs') }
        const dock = window.__dshDockerIconDockV1
        if (dock) { dock.register(entry); dock.register(logsEntry) }
        else (window.__dshDockerIconDockPendingV1 ||= []).push(entry, logsEntry)
        ctx.slots.inject('plugins.item', () => ctx.slots.register({
          name: 'plugins.item', id: 'dsh-docker-instance-manager', order: 79, label: () => '实例管理',
        }, (props = {}) => props.view === 'summary' ? '管理 DSH 更新、运行状态与网络出口' : h(Panel, { embedded: true })))
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay', id: 'dsh-docker.instance-manager-panel',
        }, Overlay))
      },
    }
  },
})
