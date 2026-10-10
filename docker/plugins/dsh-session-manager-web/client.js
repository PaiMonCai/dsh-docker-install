/* DSH Docker Web session deletion action, via official UI slots. */
window.__ModuleLoader__.load({
  id: 'dsh-docker-session-manager',
  factory(require) {
    const React = require('react')
    const { MenuItemButton, Modal } = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement
    const ENDPOINT = '/api/dsh-docker-session-manager/delete'

    function locale() {
      const zh = (document.documentElement.lang || navigator.language || '').toLowerCase().startsWith('zh')
      return zh ? {
        action: '删除会话…', title: '删除会话', cancel: '取消', confirm: '删除并重启',
        caution: '会话将移入回收区，工作区文件不会被删除。为避免损坏正在写入的历史记录，DSH 需要重启。fork 子会话不会自动删除。',
        pending: '正在提交删除请求…', accepted: '删除请求已保存。DSH 将重启并移入回收区。',
        manual: '删除请求已保存，需执行 dshd restart 才能生效。',
        failed: '提交删除请求失败。请检查服务器日志。',
      } : {
        action: 'Delete session…', title: 'Delete session', cancel: 'Cancel', confirm: 'Delete and restart',
        caution: 'The session will be moved to trash. Workspace files are untouched. DSH must restart to avoid removing active history. Forks are not deleted automatically.',
        pending: 'Submitting deletion request…', accepted: 'Deletion queued. DSH will restart and move it to trash.',
        manual: 'Deletion queued. Run dshd restart for it to take effect.',
        failed: 'Unable to queue deletion. Check server logs.',
      }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        let request = null
        const listeners = new Set()
        const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener) }
        const snapshot = () => request
        const setRequest = value => { request = value; for (const notify of listeners) notify() }
        const copy = locale()

        function SessionDeleteMenu({ sessionId, displayTitle, useMenuOpenState }) {
          const [, setMenuOpen] = useMenuOpenState()
          return h(MenuItemButton, {
            separatorBefore: true,
            onSelect: () => {
              setMenuOpen(false)
              setRequest({ sessionId, displayTitle })
            },
          }, copy.action)
        }

        function SessionDeleteModal() {
          const selected = React.useSyncExternalStore(subscribe, snapshot, snapshot)
          const [state, setState] = React.useState({ submitting: false, message: '', error: '' })
          React.useEffect(() => { setState({ submitting: false, message: '', error: '' }) }, [selected?.sessionId])
          if (!selected) return null
          const close = () => { if (!state.submitting) setRequest(null) }
          const submit = async () => {
            setState({ submitting: true, message: '', error: '' })
            try {
              const result = await fetch(ENDPOINT, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ sessionId: selected.sessionId }),
              })
              const payload = await result.json()
              if (!result.ok || !payload.queued) throw new Error(payload.error || 'request-failed')
              setState({
                submitting: false,
                message: payload.restartScheduled ? copy.accepted : copy.manual,
                error: '',
              })
            } catch (reason) {
              setState({ submitting: false, message: '', error: copy.failed + ' (' + String(reason) + ')' })
            }
          }
          const button = (label, action, disabled, style) => h('button', {
            type: 'button', onClick: action, disabled,
            style: { cursor: disabled ? 'wait' : 'pointer', padding: '7px 12px',
              border: '1px solid rgba(128,128,128,.4)', borderRadius: '8px',
              background: 'transparent', color: 'inherit', ...style },
          }, label)
          return h(Modal, {
            open: true,
            onClose: close,
            closeLabel: copy.cancel,
            title: copy.title,
            description: selected.displayTitle || selected.sessionId,
            footer: h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end' } },
              button(copy.cancel, close, state.submitting),
              state.message ? null : button(copy.confirm, submit, state.submitting, { color: '#dc2626' })),
          },
          h('p', { style: { fontSize: '13px', lineHeight: 1.6 } }, copy.caution),
          state.submitting ? h('p', { role: 'status' }, copy.pending) : null,
          state.message ? h('p', { role: 'status' }, state.message) : null,
          state.error ? h('p', { role: 'alert', style: { color: '#dc2626' } }, state.error) : null)
        }

        ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register(
          { name: 'sidebar.workspaces.session.menu.item', id: 'dsh-docker.delete-session', order: 700 },
          SessionDeleteMenu,
        ))
        ctx.slots.inject('shell.overlay', () => ctx.slots.register(
          { name: 'shell.overlay', id: 'dsh-docker.session-delete' },
          SessionDeleteModal,
        ))
      },
    }
  },
})
