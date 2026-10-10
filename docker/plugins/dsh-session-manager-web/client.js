/* Web-only session lifecycle controls. Chinese-first, delete to trash,
 * then force purge from trash. No Docker restart or direct list purge. */
window.__ModuleLoader__.load({
  id: 'dsh-docker-session-manager',
  factory(require) {
    const React = require('react')
    const { MenuItemButton, Modal } = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement
    const ENDPOINT = '/api/dsh-docker-session-manager'
    const listeners = new Set()
    let overlay = null
    const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn) }
    const snapshot = () => overlay
    const show = value => { overlay = value; for (const fn of listeners) fn() }
    // This deployment is Chinese-first regardless of browser/system locale.
    const t = {
      trash: '删除会话', permanent: '永久删除', recycle: '回收站',
      dangerTitle: '确定永久删除此会话？',
      dangerHint: '会话及其历史记录将被强制清除，无法恢复。若该会话正在运行，相关任务也会被终止；其他会话和工作区文件不受影响。无需重启 Docker。',
      cancel: '取消', confirm: '永久删除', restore: '恢复',
      empty: '回收站是空的', loading: '加载中…', close: '关闭',
      done: '操作已完成', failed: '操作失败',
      firstTrash: '请先删除会话，将其移入回收站，再执行永久删除。',
      unavailable: '会话管理暂不可用，请检查服务器日志。',
    }

    async function api(action, sessionId, title) {
      const response = await fetch(ENDPOINT, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, sessionId, ...(title ? { title } : {}) }),
      })
      const data = await response.json()
      if (!response.ok) {
        const code = data?.error
        throw new Error(code === 'delete-to-trash-first' ? t.firstTrash
          : String(code || t.failed))
      }
      return data
    }
    async function loadTrash() {
      const response = await fetch(ENDPOINT, { credentials: 'same-origin', cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || t.unavailable)
      return data.items || []
    }
    let toastTimer = null
    function notice(message) {
      show({ type: 'toast', message })
      if (toastTimer) clearTimeout(toastTimer)
      toastTimer = setTimeout(() => {
        if (overlay?.type === 'toast') show(null)
      }, 3200)
    }
    function move(id, title) {
      api('trash', id, title).then(() => notice(t.done)).catch(e => show({ type: 'error', message: e.message }))
    }
    function menu(label, click, props, danger = false, separatorBefore = false) {
      const [, setOpen] = props.useMenuOpenState()
      return h(MenuItemButton, {
        danger, separatorBefore,
        onSelect: () => { setOpen(false); click() },
      }, label)
    }
    function TrashMenu(props) {
      return menu(t.trash, () => move(props.sessionId, props.displayTitle), props, false, true)
    }
    function RecycleFooter({ wide }) {
      return h('button', {
        type: 'button', title: t.recycle, 'aria-label': t.recycle,
        onClick: () => show({ type: 'recycle' }),
        style: {
          width: '100%', display: 'flex', gap: '10px', alignItems: 'center',
          justifyContent: wide ? 'flex-start' : 'center',
          border: 'none', borderRadius: '8px', cursor: 'pointer',
          background: 'transparent', color: 'inherit', padding: '9px 12px',
          fontSize: '13px',
        },
      }, h('span', { 'aria-hidden': 'true', style: { fontSize: '17px' } }, '♻'),
      wide ? h('span', null, t.recycle) : null)
    }
    const button = (text, onClick, disabled, danger = false) => h('button', {
      type: 'button', onClick, disabled,
      style: { border: '1px solid rgba(128,128,128,.35)', borderRadius: '8px',
        padding: '7px 12px', background: 'transparent', color: danger ? '#dc2626' : 'inherit',
        cursor: disabled ? 'wait' : 'pointer', fontSize: '13px' },
    }, text)

    function Dialog() {
      const selected = React.useSyncExternalStore(subscribe, snapshot, snapshot)
      const [items, setItems] = React.useState([])
      const [loading, setLoading] = React.useState(false)
      const [pending, setPending] = React.useState(false)
      const [error, setError] = React.useState('')
      React.useEffect(() => {
        if (selected?.type !== 'recycle') return
        let cancelled = false
        setLoading(true); setError('')
        loadTrash().then(value => { if (!cancelled) setItems(value) })
          .catch(e => { if (!cancelled) setError(e.message) })
          .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
      }, [selected?.type])
      if (!selected) return null
      if (selected.type === 'toast') {
        return h('div', { role: 'status', style: { position: 'fixed', bottom: 24, right: 24,
          background: 'var(--surface-primary, #222)', color: 'inherit',
          padding: '10px 16px', border: '1px solid rgba(128,128,128,.35)',
          borderRadius: 10, zIndex: 9999 } }, selected.message)
      }
      const close = () => { if (!pending) { setError(''); show(null) } }
      const act = async (action, id) => {
        setPending(true); setError('')
        try {
          await api(action, id)
          if (selected.type === 'recycle') {
            setItems(await loadTrash())
          } else {
            setPending(false)
            if (selected.returnToTrash) show({ type: 'recycle' })
            else notice(t.done)
            return
          }
        } catch (e) { setError(e.message || t.failed) }
        finally { setPending(false) }
      }
      if (selected.type === 'error') return h(Modal, {
        open: true, onClose: close, closeLabel: t.close, title: t.failed,
        footer: button(t.close, close, false),
      }, h('p', { role: 'alert' }, selected.message))
      if (selected.type === 'confirm') return h(Modal, {
        open: true, onClose: close, closeLabel: t.cancel,
        title: t.dangerTitle, description: selected.title,
        footer: h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' } },
          button(t.cancel, close, pending), button(t.confirm,
            () => act(selected.action, selected.sessionId), pending, true)),
      }, h('p', { style: { lineHeight: 1.6, fontSize: '13px' } }, t.dangerHint),
      error && h('p', { role: 'alert', style: { color: '#dc2626' } }, error))
      return h(Modal, {
        open: true, onClose: close, closeLabel: t.close, title: t.recycle,
        footer: button(t.close, close, pending),
      },
      loading ? h('p', { role: 'status' }, t.loading)
        : items.length === 0 ? h('p', null, t.empty)
          : h('div', { style: { maxHeight: '55vh', overflowY: 'auto' } },
            ...items.map(item => h('div', {
              key: item.sessionId,
              style: { display: 'flex', alignItems: 'center', gap: 8,
                borderBottom: '1px solid rgba(128,128,128,.2)', padding: '10px 0' },
            },
            h('div', { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { wordBreak: 'break-word', fontSize: 13 } }, item.title),
              h('div', { style: { color: 'gray', fontSize: 11 } },
                new Date(item.deletedAt).toLocaleString('zh-CN', { hour12: false }))),
            button(t.restore, () => act('restore', item.sessionId), pending),
            button(t.permanent, () => show({ type: 'confirm', title: item.title,
              sessionId: item.sessionId, action: 'purge', returnToTrash: true }), pending, true)))),
      error && h('p', { role: 'alert', style: { color: '#dc2626' } }, error))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.workspaces.session.menu.item', function* () {
          yield ctx.slots.register({ name: 'sidebar.workspaces.session.menu.item',
            id: 'dsh-docker.trash', order: 700 }, TrashMenu)
        })
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action', id: 'dsh-docker.recycle-footer', order: 450,
        }, RecycleFooter))
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay', id: 'dsh-docker.session-lifecycle',
        }, Dialog))
      },
    }
  },
})
