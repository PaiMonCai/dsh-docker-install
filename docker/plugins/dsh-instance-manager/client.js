window.__ModuleLoader__.load({
  id: 'dsh-docker-instance-manager',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const ENDPOINT = '/api/dsh-docker-instance-manager'
    const listeners = new Set()
    let opened = false
    const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn) }
    const open = value => { opened = value; for (const fn of listeners) fn() }
    const labels = {
      check: '检查更新', update: '更新镜像', restart: '重启 DSH', recreate: '重建容器',
      rollback: '回滚版本', cleanup: '清理旧容器与镜像', settings: '保存检查设置',
      'proxy-start': '开启代理', 'proxy-stop': '关闭代理', 'proxy-restart': '重载 sing-box',
      'proxy-test': '测试出口', 'proxy-test-all': '全部节点测速', 'proxy-refresh': '刷新全部订阅',
      'proxy-use': '切换节点', 'proxy-add': '导入节点', 'proxy-subscribe': '添加订阅', pending: '等待执行',
    }
    const states = { queued: '等待执行', running: '正在执行', succeeded: '已完成', failed: '失败', interrupted: '执行中断' }
    const errors = {
      'instance-busy': '当前实例已有任务，请等待完成。',
      'host-executor-offline': '宿主机后台未连接，请使用 dshd web status 检查。',
      'management-unavailable': '管理数据暂不可用，请检查宿主机后台。',
    }
    const css = `
      .dsh-manage{--dm-line:var(--dsw-alias-separator-primary,rgba(128,128,128,.23));--dm-muted:var(--dsw-alias-label-secondary,#787e86);--dm-accent:#168577;color:inherit;font:inherit}
      .dsh-manage *{box-sizing:border-box}.dsh-manage button,.dsh-manage input,.dsh-manage select{font:inherit;color:inherit}
      .dsh-manage button{cursor:pointer;padding:8px 13px;border:1px solid var(--dm-line);border-radius:7px;background:transparent;line-height:1.5}
      .dsh-manage button:disabled{opacity:.45;cursor:default}.dsh-manage button:focus-visible,.dsh-manage input:focus-visible,.dsh-manage select:focus-visible{outline:2px solid var(--dm-accent);outline-offset:3px}
      .dsh-manage .dm-primary{background:var(--dm-accent);color:white;border-color:var(--dm-accent)}
      .dm-head{display:flex;align-items:flex-start;gap:12px;padding:23px 26px 18px;border-bottom:1px solid var(--dm-line)}.dm-head h2{font-size:21px;font-weight:650;margin:0}.dm-head p{color:var(--dm-muted);font-size:12px;margin:7px 0 0}
      .dm-tabs{display:flex;gap:20px;padding:0 26px;border-bottom:1px solid var(--dm-line)}.dm-tabs button{border:0;border-radius:0;padding:13px 0;border-bottom:2px solid transparent}.dm-tabs button[aria-selected=true]{border-bottom-color:var(--dm-accent);color:var(--dm-accent)}
      .dm-content{padding:22px 26px;overflow:auto;min-height:0;flex:1}.dm-content h3{font-size:15px;font-weight:650;margin:0 0 13px}
      .dm-summary{display:flex;justify-content:space-between;gap:16px;align-items:center;padding-bottom:20px;border-bottom:1px solid var(--dm-line);margin-bottom:20px}.dm-state{display:flex;align-items:center;gap:8px;font-size:17px}.dm-dot{width:9px;height:9px;background:var(--dm-accent);border-radius:50%}.dm-dot[data-online=false]{background:#b47f32}
      .dm-muted{color:var(--dm-muted);font-size:12px;line-height:1.7}.dm-grid{display:grid;grid-template-columns:110px minmax(0,1fr);gap:10px 16px;font-size:13px;margin:16px 0 23px}.dm-grid dt{color:var(--dm-muted)}.dm-grid dd{margin:0;overflow-wrap:anywhere}
      .dm-actions{display:flex;gap:9px;flex-wrap:wrap}.dm-section{margin:0 0 25px}.dm-section+.dm-section{padding-top:22px;border-top:1px solid var(--dm-line)}
      .dm-banner{font-size:13px;padding:13px 15px;line-height:1.7;background:rgba(128,128,128,.08);border-left:3px solid var(--dm-accent);margin-bottom:18px;overflow-wrap:anywhere}.dm-banner[data-error=true]{border-left-color:#bc6b42}
      .dm-inputs{display:grid;grid-template-columns:1fr 1fr;gap:13px}.dm-inputs label{display:flex;flex-direction:column;gap:7px;font-size:12px}.dm-inputs input,.dm-inputs select,.dm-setting select{min-width:0;width:100%;padding:9px 10px;border:1px solid var(--dm-line);border-radius:6px;background:transparent}.dm-wide{grid-column:1/-1}
      .dm-setting{display:flex;justify-content:space-between;align-items:center;gap:16px;font-size:13px}.dm-setting select{width:auto;max-width:55%}
      .dm-task{padding:13px 0;border-bottom:1px solid var(--dm-line)}.dm-task-head{display:flex;gap:12px;justify-content:space-between;font-size:13px}.dm-task-head button{padding:0;border:0;text-align:left}.dm-task time{font-size:11px;color:var(--dm-muted)}
      .dm-log{white-space:pre-wrap;overflow-wrap:anywhere;padding:15px;font:12px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace;background:rgba(128,128,128,.08);border-radius:6px;max-height:340px;overflow:auto;margin:12px 0}
      .dm-dialog{width:min(900px,100%);height:min(790px,92dvh);display:flex;flex-direction:column;border:1px solid var(--dsw-alias-separator-primary,rgba(128,128,128,.25));border-radius:14px;background:var(--dsw-alias-bg-primary,var(--surface-primary,#fff));box-shadow:0 25px 85px rgba(0,0,0,.23)}
      .dm-overlay{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:22px;background:rgba(7,13,24,.5);backdrop-filter:blur(4px)}
      @media(max-width:600px){.dm-overlay{padding:8px}.dm-dialog{height:96dvh;border-radius:10px}.dm-head{padding:18px 16px}.dm-tabs{padding:0 16px;gap:18px}.dm-content{padding:18px 16px}.dm-inputs{grid-template-columns:1fr}.dm-summary{align-items:flex-start}.dm-grid{grid-template-columns:80px minmax(0,1fr);gap:10px}.dm-actions button{flex:1 1 auto}.dm-setting{align-items:flex-start;flex-direction:column}.dm-setting select{width:100%;max-width:100%}}
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
    const confirmations = {
      update: '镜像拉取完成后会重启 DSH。页面将暂时断开，恢复后自动读取更新结果。',
      restart: '重启会中断当前运行中的会话任务。页面恢复连接后可查看结果。',
      recreate: '将按当前宿主机配置重建容器，页面会暂时断开。',
      rollback: '仅恢复旧版容器，持久化数据不会回滚；旧版可能不兼容新版写入的数据。',
      cleanup: '清理当前实例停止的回滚容器及未使用旧镜像，清理后将失去这些回滚点。',
      'proxy-start': '首次开启代理可能重建 DSH，页面会暂时断开。',
      'proxy-stop': '关闭代理会恢复直连，并可能重建 DSH。',
    }
    function Panel({ embedded = false }) {
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState('')
      const [disconnected, setDisconnected] = React.useState(false)
      const [tab, setTab] = React.useState('overview')
      const [sending, setSending] = React.useState(false)
      const submitting = React.useRef(false)
      const [confirmation, setConfirmation] = React.useState(null)
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
            if (alive) setDisconnected(true)
          }
          if (alive) timer = setTimeout(poll, 3000)
        }
        void poll()
        return () => { alive = false; controller.abort(); clearTimeout(timer) }
      }, [])
      const status = data?.status
      const jobs = data?.jobs || []
      const busy = sending || jobs.some(job => ['queued', 'running'].includes(job.state))
      const enabled = Boolean(data?.online) && !busy && !disconnected
      async function submit(action, args = {}) {
        if (submitting.current) return
        const id = taskId()
        submitting.current = true
        setSending(true); setError(''); setConfirmation(null)
        try {
          const result = await request({ id, action, arguments: args }, AbortSignal.timeout(15000))
          setSelected(result.id)
          try { localStorage.setItem('dsh-management-task', result.id) } catch {}
          setData(current => ({ ...current, jobs: [{ id: result.id, action, state: result.state }, ...(current?.jobs || [])] }))
          if (['proxy-add', 'proxy-subscribe'].includes(action)) { setImportURL(''); setImportName('') }
          setTab('tasks')
        } catch (failure) {
          // The host may have accepted a task before the connection disappeared.
          setSelected(id)
          try { localStorage.setItem('dsh-management-task', id) } catch {}
          setError(failure.message + '。如连接中断，请先查看任务记录再重试。')
        } finally { submitting.current = false; setSending(false) }
      }
      function actionButton(action, args = {}, primary = false) {
        return h('button', { type: 'button', disabled: !enabled,
          className: primary ? 'dm-primary' : '',
          onClick: () => confirmations[action] ? setConfirmation({ action, args }) : void submit(action, args),
        }, labels[action])
      }
      const selectedJob = jobs.find(job => job.id === selected) || jobs[0]
      const release = status?.release
      const section = (title, ...children) => h('section', { className: 'dm-section' }, h('h3', null, title), ...children)
      const details = entries => h('dl', { className: 'dm-grid' }, ...entries.flatMap(([key, value]) => [
        h('dt', { key: key + '-label' }, key), h('dd', { key }, value || '—'),
      ]))
      return h('div', { className: 'dsh-manage', style: { display: 'flex', flexDirection: 'column', minHeight: 0, height: embedded ? undefined : '100%' } },
        h('style', null, css),
        h('header', { className: 'dm-head' },
          h('div', { style: { flex: 1 } }, h('h2', { id: embedded ? undefined : 'dsh-management-title' }, '实例管理'),
            h('p', null, '管理 DSH 更新、运行状态与网络出口')),
          !embedded && h('button', { type: 'button', onClick: () => open(false), 'aria-label': '关闭实例管理' }, '关闭')),
        h('nav', { className: 'dm-tabs', role: 'tablist', 'aria-label': '实例管理页面' },
          ...[['overview', '运行与更新'], ['network', '国际网络'], ['tasks', '任务记录'], ['logs', '运行日志']].map(([id, title]) =>
            h('button', { key: id, type: 'button', role: 'tab', 'aria-selected': tab === id, onClick: () => setTab(id) }, title))),
        h('div', { className: 'dm-content', role: 'tabpanel', 'aria-live': 'polite' },
          disconnected && h('div', { className: 'dm-banner' }, '连接暂时断开，正在自动重连。后台已接收的任务会继续执行。'),
          data && !data.configured && h('div', { className: 'dm-banner' }, '此实例尚未启用 Web 管理。请在宿主机执行 dshd web enable；命名实例使用 dshd -i 实例ID web enable。'),
          data?.configured && !data.online && h('div', { className: 'dm-banner', 'data-error': true },
            '宿主机后台未连接。请运行 dshd web status 检查；必要时用 dshd web enable 修复。'),
          error && h('div', { className: 'dm-banner', 'data-error': true, role: 'alert' }, error),
          confirmation && h('div', { className: 'dm-banner' },
            h('p', null, confirmations[confirmation.action]),
            h('div', { className: 'dm-actions' },
              h('button', { type: 'button', className: 'dm-primary', disabled: !enabled,
                onClick: () => void submit(confirmation.action, confirmation.args) }, '确认' + labels[confirmation.action]),
              h('button', { type: 'button', onClick: () => setConfirmation(null) }, '取消'))),
          !data && !disconnected && h('p', { className: 'dm-muted' }, '正在读取实例状态…'),
          tab === 'overview' && status && h(React.Fragment, null,
            h('div', { className: 'dm-summary' },
              h('div', null, h('div', { className: 'dm-state' },
                h('span', { className: 'dm-dot', 'data-online': data.online }),
                status.instance.name, ' · ', status.container?.state === 'running' ? '运行中' : status.container?.state || '不可用'),
              h('p', { className: 'dm-muted', style: { margin: '6px 0 0' } }, status.instance.edition)),
              actionButton('restart')),
            section('镜像与更新',
              details([['当前版本', status.container?.version], ['镜像', status.instance.image],
                ['健康检查', status.container?.health], ['最近检查', formatTime(release?.checkedAt)]]),
              h('div', { className: 'dm-banner', 'data-error': Boolean(release?.error) },
                release?.error ? '更新检查失败：' + release.error
                  : release?.available === true ? '检测到可用更新。更新将在后台执行，重启后可在任务记录查看结果。'
                    : release?.available === false ? '当前运行镜像与远端一致。' : '尚未完成更新检查。'),
              h('div', { className: 'dm-actions' }, actionButton('check'), actionButton('update', {}, true)),
              h('div', { className: 'dm-setting', style: { marginTop: 18 } },
                h('label', { htmlFor: embedded ? 'dm-check-embedded' : 'dm-check' }, '自动检查更新'),
                h('select', { id: embedded ? 'dm-check-embedded' : 'dm-check', disabled: !enabled,
                  value: status.settings.checkInterval,
                  onChange: event => void submit('settings', { checkInterval: Number(event.target.value) }) },
                ...[[0, '关闭'], [3600, '每小时'], [21600, '每 6 小时'], [86400, '每天']].map(([value, title]) =>
                  h('option', { value, key: value }, title))))),
            section('维护',
              h('p', { className: 'dm-muted' }, '升级成功后默认清理旧容器。回滚仅在仍有保留的回滚容器时可用，且不会恢复历史数据。'),
              h('div', { className: 'dm-actions' }, actionButton('recreate'), actionButton('rollback'), actionButton('cleanup')))),
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
                  disabled: !enabled || !importName || !importURL }, labels[importKind]))))),
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
          tab === 'logs' && h('pre', { className: 'dm-log', 'aria-label': 'DSH 运行日志' },
            status?.logs || '暂无运行日志。')))
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
    function UpdateNotice() {
      const [update, setUpdate] = React.useState(null)
      React.useEffect(() => {
        let alive = true
        const poll = async () => {
          try {
            const data = await request(null, AbortSignal.timeout(12000))
            const release = data.status?.release
            const key = 'dsh-management-notice-' + data.status?.instance?.id
            let dismissed
            try { dismissed = sessionStorage.getItem(key) } catch {}
            if (alive) setUpdate(data.online && release?.available && dismissed !== release.latest
              ? { latest: release.latest, key } : null)
          } catch { /* Instance may be restarting; the open panel handles reconnection. */ }
        }
        void poll()
        const timer = setInterval(poll, 60000)
        return () => { alive = false; clearInterval(timer) }
      }, [])
      if (!update) return null
      return h('aside', { className: 'dsh-manage', 'aria-label': 'DSH 更新提醒',
        style: { position: 'fixed', right: 18, bottom: 18, zIndex: 9000, padding: 12, borderRadius: 10,
          border: '1px solid var(--dsw-alias-separator-primary,rgba(128,128,128,.25))',
          background: 'var(--dsw-alias-bg-primary,var(--surface-primary,#fff))' } },
      h('style', null, css),
      h('span', { style: { fontSize: 13, marginRight: 12 } }, 'DSH 有可用镜像更新'),
      h('button', { type: 'button', onClick: () => { open(true); setUpdate(null) } }, '查看更新'),
      h('button', { type: 'button', 'aria-label': '稍后提醒', style: { marginLeft: 8 }, onClick: () => {
        try { sessionStorage.setItem(update.key, update.latest) } catch {}
        setUpdate(null)
      } }, '稍后'))
    }
    return {
      inject: ['slots'],
      apply(ctx) {
        const entry = { id: 'dsh-docker.instance-manager', label: '实例管理', icon: 'settings', order: 90,
          onClick: () => open(true) }
        const dock = window.__dshDockerIconDockV1
        if (dock) dock.register(entry)
        else (window.__dshDockerIconDockPendingV1 ||= []).push(entry)
        ctx.slots.inject('plugins.item', () => ctx.slots.register({
          name: 'plugins.item', id: 'dsh-docker-instance-manager', order: 79, label: () => '实例管理',
        }, () => h(Panel, { embedded: true })))
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay', id: 'dsh-docker.instance-manager-panel',
        }, Overlay))
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay', id: 'dsh-docker.instance-manager-update-notice',
        }, UpdateNotice))
      },
    }
  },
})
