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
      restore: '恢复',
      empty: '回收站是空的', loading: '加载中…', close: '关闭',
      done: '操作已完成', failed: '操作失败',
      firstTrash: '请先删除会话，将其移入回收站，再执行永久删除。',
      unavailable: '会话管理暂不可用，请检查服务器日志。',
      subtitle: '管理已删除的会话，可恢复或彻底清除。',
      search: '搜索会话名称或 ID', range: '删除时间',
      all: '全部时间', week: '近 7 天', month: '近 30 天',
      newest: '最近删除', oldest: '最早删除', byName: '名称排序',
      sort: '排序方式', refresh: '刷新', refreshHint: '刷新回收站列表',
      total: '全部会话', recent: '近 7 天', selected: '已选择',
      selectVisible: '选择当前结果', deselectVisible: '取消选择当前结果',
      clearSelection: '清空选择', restoreSelected: '恢复选中',
      deleteSelected: '永久删除选中', searchEmpty: '没有匹配的会话',
      searchEmptyHint: '可尝试其他关键词，或重置筛选条件。',
      emptyHint: '删除的会话会暂存在这里，可恢复或永久删除。',
      resetFilters: '清除筛选', sessionId: '会话 ID',
      deletedAt: '删除于', retry: '重试', processing: '正在处理',
      doneCount: '已成功处理', failCount: '项失败',
      selectSession: '选择会话', closeHint: '关闭回收站',
      moveSelected: '移入回收站', selectList: '选择当前列表',
      batchLabel: '批量管理会话', batchDone: '已移入回收站',
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
    const batchListeners = new Set()
    let batch = { items: [], pending: false, progress: '', error: '', status: '' }
    const subscribeBatch = fn => { batchListeners.add(fn); return () => batchListeners.delete(fn) }
    const batchSnapshot = () => batch
    const updateBatch = patch => {
      batch = { ...batch, ...patch }
      for (const fn of batchListeners) fn()
    }
    const titleOf = (id, title) => String(title || id).slice(0, 160)
    const forgetSelection = id => updateBatch({
      items: batch.items.filter(item => item.sessionId !== id),
    })
    function selectSession(id, title, checked) {
      if (batch.pending) return
      const items = batch.items.filter(item => item.sessionId !== id)
      if (checked) items.push({ sessionId: id, title: titleOf(id, title) })
      updateBatch({ items, error: '', status: '' })
    }
    async function move(id, title) {
      if (batch.pending) return
      try {
        await api('trash', id, titleOf(id, title))
        forgetSelection(id)
        notice(t.done)
      } catch (e) { show({ type: 'error', message: e.message }) }
    }
    async function moveSelected() {
      if (batch.pending || !batch.items.length) return
      const targets = [...batch.items]
      updateBatch({ pending: true, progress: '', error: '', status: '' })
      const failed = []
      let done = 0
      for (const [index, item] of targets.entries()) {
        updateBatch({ progress: t.processing + ' ' + (index + 1) + ' / ' + targets.length })
        try {
          await api('trash', item.sessionId, item.title)
          done++
          forgetSelection(item.sessionId)
        } catch (reason) {
          failed.push(item.sessionId + ' (' + (reason.message || t.failed) + ')')
        }
      }
      updateBatch({
        pending: false, progress: '',
        status: t.batchDone + ' ' + done + ' / ' + targets.length,
        error: failed.length ? t.failCount + ' ' + failed.length + '：' + failed.slice(0, 3).join('，') : '',
      })
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
    function SessionCheckbox({ sessionId, displayTitle }) {
      const state = React.useSyncExternalStore(subscribeBatch, batchSnapshot, batchSnapshot)
      return h('input', {
        className: 'dsh-session-select', type: 'checkbox',
        'aria-label': t.selectSession + ' ' + sessionId,
        'data-session-id': sessionId, 'data-session-title': titleOf(sessionId, displayTitle),
        checked: state.items.some(item => item.sessionId === sessionId),
        disabled: state.pending,
        onChange: event => selectSession(sessionId, displayTitle, event.target.checked),
        onClick: event => event.stopPropagation(),
        onDoubleClick: event => event.stopPropagation(),
        onPointerDown: event => event.stopPropagation(),
        onKeyDown: event => {
          if (event.key === ' ' || event.key === 'Enter') event.stopPropagation()
        },
        style: { width: 16, height: 16, margin: '0 2px', flexShrink: 0,
          cursor: state.pending ? 'wait' : 'pointer', accentColor: 'var(--dsw-alias-brand-primary,#4d6bfe)' },
      })
    }
    const ui = {
      edge: 'var(--dsw-alias-separator-primary, rgba(125,135,155,.24))',
      surface: 'var(--dsw-alias-bg-primary, var(--surface-primary, #fff))',
      muted: 'var(--dsw-alias-label-secondary, #737c8d)',
      accent: 'var(--dsw-alias-brand-primary, #4d6bfe)',
      secondary: 'var(--dsw-alias-bg-secondary, rgba(128,128,128,.045))',
    }
    const panelCss = [
      '.dsh-trash-overlay,.dsh-trash-overlay *{box-sizing:border-box}',
      '.dsh-trash-panel{width:min(980px,96vw);height:min(790px,calc(100dvh - 48px));min-height:0;border-radius:16px}',
      '.dsh-trash-toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center}',
      '.dsh-trash-search{flex:1 1 290px}',
      '.dsh-trash-row{display:grid;grid-template-columns:24px minmax(0,1fr) auto;align-items:center;gap:16px}',
      '.dsh-trash-actions{display:flex;gap:8px;align-items:center}',
      '.dsh-trash-button:hover:not(:disabled):not(.dsh-trash-primary){background:var(--dsw-alias-bg-tertiary,rgba(110,130,160,.1))!important}',
      '.dsh-trash-primary:hover:not(:disabled){filter:brightness(.92)}',
      '.dsh-trash-button:focus-visible,.dsh-trash-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:2px}',
      '.dsh-trash-row:hover{background:var(--dsw-alias-bg-secondary,rgba(130,135,150,.055))}',
      '@media(max-width:640px){.dsh-trash-overlay{padding:0!important}.dsh-trash-panel{width:100%;height:100dvh;max-height:100dvh;border-radius:0}.dsh-trash-row{grid-template-columns:22px minmax(0,1fr);gap:9px}.dsh-trash-actions{grid-column:2;justify-content:flex-start}.dsh-trash-search{flex-basis:100%}.dsh-trash-toolbar{gap:8px}.dsh-trash-hide-mobile{display:none!important}}',
    ].join('\n')
    const button = (text, onClick, disabled = false, danger = false, primary = false, extra = {}) =>
      h('button', {
        type: 'button', onClick, disabled, className: 'dsh-trash-button' + (primary ? ' dsh-trash-primary' : ''),
        style: {
          display: 'inline-flex', justifyContent: 'center', alignItems: 'center',
          gap: '6px', whiteSpace: 'nowrap', minHeight: '34px',
          border: '1px solid ' + (primary ? 'transparent' : ui.edge),
          borderRadius: '8px', padding: '6px 12px', fontSize: '12px',
          background: primary ? ui.accent : 'transparent',
          color: primary ? '#fff' : danger ? '#dc5555' : 'inherit',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? .48 : 1,
          ...extra.style,
        },
        ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== 'style')),
      }, text)
    const inputStyle = {
      border: '1px solid ' + ui.edge, borderRadius: '9px', padding: '9px 11px',
      minHeight: '38px', minWidth: 0, background: ui.surface,
      color: 'inherit', fontSize: '13px',
    }
    const formatDate = value => {
      const date = new Date(value)
      return Number.isNaN(date.getTime()) ? String(value || '—')
        : date.toLocaleString('zh-CN', { hour12: false })
    }
    const selectionCss = [
      // The official row-action strip is hover-only. Keep our checkbox visible
      // without depending on upstream CSS module names or hiding status dots.
      '[data-row-key^="session:"]>span:has(.dsh-session-select){display:inline-flex!important;gap:8px}',
      '[data-row-key^="session:"]:not(:hover):not(:focus-within)>span:has(.dsh-session-select)>:not(.dsh-session-select):not(:has(.dsh-session-select)){display:none}',
      '.dsh-session-batch{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);width:min(600px,calc(100vw - 32px));z-index:9900;padding:14px 16px;border-radius:12px;box-shadow:0 10px 36px rgba(0,0,0,.18)}',
      '.dsh-session-batch-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '@media(max-width:640px){.dsh-session-batch{bottom:12px;width:calc(100vw - 24px);padding:12px}.dsh-session-batch-controls{gap:7px}}',
    ].join('\n')
    function BatchToolbar() {
      const state = React.useSyncExternalStore(subscribeBatch, batchSnapshot, batchSnapshot)
      const currentOverlay = React.useSyncExternalStore(subscribe, snapshot, snapshot)
      const selectVisible = () => {
        if (batch.pending) return
        const items = new Map(batch.items.map(item => [item.sessionId, item]))
        for (const input of document.querySelectorAll('.dsh-session-select')) {
          if (input.disabled || !input.getClientRects().length) continue
          const id = input.dataset.sessionId
          items.set(id, { sessionId: id, title: input.dataset.sessionTitle })
        }
        updateBatch({ items: [...items.values()], status: '', error: '' })
      }
      const clear = () => {
        if (!batch.pending) updateBatch({ items: [], status: '', error: '' })
      }
      const visible = (state.items.length || state.status || state.error) &&
        (!currentOverlay || currentOverlay.type === 'toast')
      return h('div', { style: { display: 'contents' } },
        h('style', null, selectionCss),
        visible ? h('section', {
          className: 'dsh-session-batch', 'aria-label': t.batchLabel, 'aria-busy': state.pending,
          style: { border: '1px solid ' + ui.edge, background: ui.surface, color: 'inherit' },
        },
        h('div', { className: 'dsh-session-batch-controls' },
          h('strong', { style: { flex: '1 1 100px', fontSize: 13 } },
            t.selected + ' ' + state.items.length),
          button(t.selectList, selectVisible, state.pending),
          button(state.items.length ? t.clearSelection : t.close, clear, state.pending),
          button(t.moveSelected, () => { void moveSelected() },
            state.pending || state.items.length === 0, false, true)),
        (state.error || state.progress || state.status) ? h('div', {
          role: state.error ? 'alert' : 'status',
          style: { marginTop: 10, fontSize: 12, color: state.error ? '#dc5555' : ui.muted },
        }, state.error || state.progress || state.status) : null) : null)
    }

    function Dialog() {
      const selected = React.useSyncExternalStore(subscribe, snapshot, snapshot)
      const kind = selected?.type
      const [items, setItems] = React.useState([])
      const [loading, setLoading] = React.useState(false)
      const [pending, setPending] = React.useState(false)
      const [progress, setProgress] = React.useState('')
      const [error, setError] = React.useState('')
      const [status, setStatus] = React.useState('')
      const [query, setQuery] = React.useState('')
      const [range, setRange] = React.useState('all')
      const [sort, setSort] = React.useState('newest')
      const [selectedIds, setSelectedIds] = React.useState([])
      const panelRef = React.useRef(null)
      const pendingRef = React.useRef(false)
      const refreshId = React.useRef(0)
      pendingRef.current = pending

      const close = () => {
        if (!pendingRef.current) {
          setError('')
          show(null)
        }
      }
      const refresh = async (preserveError = false) => {
        const seq = ++refreshId.current
        setLoading(true)
        if (!preserveError) setError('')
        try {
          const result = await loadTrash()
          if (seq !== refreshId.current) return
          setItems(result)
          const valid = new Set(result.map(item => item.sessionId))
          setSelectedIds(ids => ids.filter(id => valid.has(id)))
        } catch (reason) {
          if (seq === refreshId.current) setError(reason.message || t.unavailable)
        } finally {
          if (seq === refreshId.current) setLoading(false)
        }
      }
      React.useEffect(() => {
        if (kind === 'recycle') void refresh(selected?.preserveError === true)
        else refreshId.current++
      }, [kind])
      React.useEffect(() => {
        if (kind !== 'recycle') return undefined
        const prior = document.activeElement
        const oldOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        panelRef.current?.focus()
        const keydown = event => {
          if (event.key === 'Escape') {
            event.preventDefault()
            if (!pendingRef.current) show(null)
          }
          if (event.key !== 'Tab' || !panelRef.current) return
          const focusable = [...panelRef.current.querySelectorAll(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])',
          )].filter(element => element.getClientRects().length > 0)
          if (!focusable.length) { event.preventDefault(); panelRef.current.focus(); return }
          const first = focusable[0]
          const last = focusable[focusable.length - 1]
          if (event.shiftKey && (document.activeElement === first
            || document.activeElement === panelRef.current)) {
            event.preventDefault(); last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault(); first.focus()
          }
        }
        document.addEventListener('keydown', keydown)
        return () => {
          document.removeEventListener('keydown', keydown)
          document.body.style.overflow = oldOverflow
          if (prior && typeof prior.focus === 'function') prior.focus()
        }
      }, [kind])

      // Every mutation still calls the original single-session API; no new
      // server-side mass-delete endpoint or filesystem bypass is introduced.
      // A partial failure leaves unsuccessful IDs selected for retry.
      const act = async (action, ids) => {
        const targets = [...new Set(ids)]
        if (!targets.length || pendingRef.current) return
        pendingRef.current = true
        setPending(true); setError(''); setStatus('')
        const failed = []
        let done = 0
        for (const id of targets) {
          setProgress(t.processing + ' ' + (done + failed.length + 1) + ' / ' + targets.length)
          try { await api(action, id); forgetSelection(id); done++ }
          catch (reason) { failed.push({ id, message: reason.message || t.failed }) }
        }
        setSelectedIds(failed.map(item => item.id))
        setProgress('')
        if (done) setStatus(t.doneCount + ' ' + done + ' / ' + targets.length)
        await refresh()
        setPending(false)
        pendingRef.current = false
        if (failed.length) {
          setError(t.failCount + ' ' + failed.length + '：' +
            failed.slice(0, 3).map(item => item.id + ' (' + item.message + ')').join('，'))
        }
      }

      const now = Date.now()
      const needle = query.trim().toLocaleLowerCase()
      const recentCount = items.filter(item => now - Date.parse(item.deletedAt) <= 7 * 86400000).length
      const filtered = items.filter(item => {
        if (needle && !(String(item.title || '') + ' ' + item.sessionId)
          .toLocaleLowerCase().includes(needle)) return false
        if (range !== 'all') {
          const age = now - Date.parse(item.deletedAt)
          if (!Number.isFinite(age) || age < 0 || age > (range === '7' ? 7 : 30) * 86400000) return false
        }
        return true
      }).sort((a, b) => sort === 'title'
        ? String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN')
        : sort === 'oldest'
          ? String(a.deletedAt).localeCompare(String(b.deletedAt))
          : String(b.deletedAt).localeCompare(String(a.deletedAt)))
      const chosen = new Set(selectedIds)
      const checkedShown = filtered.length > 0 && filtered.every(item => chosen.has(item.sessionId))
      const toggleOne = (id, checked) => setSelectedIds(current =>
        checked ? [...new Set([...current, id])] : current.filter(value => value !== id))
      const toggleShown = () => {
        const ids = new Set(filtered.map(item => item.sessionId))
        setSelectedIds(current => checkedShown
          ? current.filter(id => !ids.has(id))
          : [...new Set([...current, ...ids])])
      }
      if (!selected) return null
      if (kind === 'toast') {
        return h('div', { role: 'status', style: { position: 'fixed', bottom: 24, right: 24,
          background: ui.surface, color: 'inherit',
          padding: '10px 16px', border: '1px solid ' + ui.edge,
          borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,.14)', zIndex: 9999 } }, selected.message)
      }
      if (kind === 'error') return h(Modal, {
        open: true, onClose: close, closeLabel: t.close, title: t.failed,
        footer: button(t.close, close),
      }, h('p', { role: 'alert' }, selected.message))
      return h('div', {
        className: 'dsh-trash-overlay', role: 'presentation',
        onMouseDown: event => {
          if (event.target === event.currentTarget && !pendingRef.current) close()
        },
        style: {
          position: 'fixed', inset: 0, zIndex: 10000,
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          background: 'rgba(7,13,24,.55)', backdropFilter: 'blur(5px)',
          padding: '24px',
        },
      },
      h('style', null, panelCss),
      h('section', {
        ref: panelRef, className: 'dsh-trash-panel',
        role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dsh-trash-title',
        tabIndex: -1,
        style: {
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          border: '1px solid ' + ui.edge, background: ui.surface,
          color: 'inherit', boxShadow: '0 24px 80px rgba(0,0,0,.23)',
        },
      },
      h('header', { style: { padding: '22px 26px 18px', borderBottom: '1px solid ' + ui.edge,
        display: 'flex', alignItems: 'flex-start', gap: 14 } },
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('h2', { id: 'dsh-trash-title', style: { margin: 0, fontSize: '21px',
            fontWeight: 650, letterSpacing: '-.025em' } }, t.recycle),
          h('p', { style: { margin: '7px 0 0', fontSize: '12px', lineHeight: 1.5,
            color: ui.muted } }, t.subtitle)),
        button('×', close, pending, false, false,
          { 'aria-label': t.closeHint, style: { fontSize: '21px', minWidth: '36px',
            minHeight: '36px', padding: 0, border: 'none' } })),
      h('div', { style: { display: 'flex', flexDirection: 'column',
        gap: 15, padding: '18px 26px 15px', borderBottom: '1px solid ' + ui.edge } },
        h('div', { style: { display: 'flex', gap: 9, flexWrap: 'wrap' } },
          ...[
            [t.total, items.length],
            [t.recent, recentCount],
            [t.selected, selectedIds.length],
          ].map(([label, value]) => h('div', { key: label,
            style: { display: 'inline-flex', gap: 8, alignItems: 'center',
              borderRadius: '8px', padding: '6px 11px', background: ui.secondary,
              border: '1px solid ' + ui.edge, fontSize: '12px' } },
            h('span', { style: { color: ui.muted } }, label),
            h('strong', { style: { fontSize: '14px', fontWeight: 650 } }, value)))),
        h('div', { className: 'dsh-trash-toolbar' },
          h('input', {
            className: 'dsh-trash-input dsh-trash-search',
            'aria-label': t.search, placeholder: t.search,
            type: 'search', value: query, disabled: pending,
            onChange: event => setQuery(event.target.value),
            style: inputStyle,
          }),
          h('select', {
            className: 'dsh-trash-input', 'aria-label': t.range,
            value: range, disabled: pending,
            onChange: event => setRange(event.target.value),
            style: inputStyle,
          },
          h('option', { value: 'all' }, t.all),
          h('option', { value: '7' }, t.week),
          h('option', { value: '30' }, t.month)),
          h('select', {
            className: 'dsh-trash-input', 'aria-label': t.sort,
            value: sort, disabled: pending,
            onChange: event => setSort(event.target.value),
            style: inputStyle,
          },
          h('option', { value: 'newest' }, t.newest),
          h('option', { value: 'oldest' }, t.oldest),
          h('option', { value: 'title' }, t.byName)),
          button('↻ ' + t.refresh, () => { void refresh() }, pending || loading,
            false, false, { 'aria-label': t.refreshHint })),
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, flexWrap: 'wrap', fontSize: '12px' } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
            h('label', { style: { display: 'inline-flex', gap: 8, alignItems: 'center',
              cursor: pending || filtered.length === 0 ? 'default' : 'pointer' } },
              h('input', { type: 'checkbox', checked: checkedShown,
                disabled: pending || filtered.length === 0,
                'aria-label': t.selectVisible,
                onChange: toggleShown }),
              checkedShown ? t.deselectVisible : t.selectVisible),
            h('span', { style: { color: ui.muted } },
              filtered.length + ' / ' + items.length)),
          selectedIds.length ? button(t.clearSelection, () => setSelectedIds([]), pending)
            : null)),
      h('main', { style: { flex: 1, minHeight: 0, overflowY: 'auto',
        padding: filtered.length ? '3px 16px 12px' : '38px 24px' },
        'aria-busy': loading || pending },
        loading && items.length === 0
          ? h('div', { role: 'status', style: { textAlign: 'center',
            color: ui.muted, padding: 28 } }, t.loading)
          : filtered.length === 0
            ? h('div', { style: { display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', textAlign: 'center',
              gap: 12, paddingTop: 22 } },
              h('span', { 'aria-hidden': 'true', style: { fontSize: '32px',
                color: ui.muted } }, '▤'),
              h('strong', { style: { fontSize: 14 } }, items.length ? t.searchEmpty : t.empty),
              h('p', { style: { fontSize: 12, color: ui.muted, margin: 0 } },
                items.length ? t.searchEmptyHint : t.emptyHint),
              items.length ? button(t.resetFilters, () => { setQuery(''); setRange('all') })
                : null)
            : filtered.map(item => h('div', {
              className: 'dsh-trash-row', key: item.sessionId,
              style: { padding: '13px 12px', borderBottom: '1px solid ' + ui.edge,
                borderRadius: '6px', transition: 'background .15s' },
            },
            h('input', {
              type: 'checkbox', checked: chosen.has(item.sessionId), disabled: pending,
              'aria-label': t.selectSession + ' ' + item.sessionId,
              onChange: event => toggleOne(item.sessionId, event.target.checked),
            }),
            h('div', { style: { minWidth: 0, overflow: 'hidden' } },
              h('div', { title: item.title,
                style: { fontSize: '13px', lineHeight: 1.5, fontWeight: 600,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                item.title || item.sessionId),
              h('div', { style: { color: ui.muted, fontSize: '11px',
                display: 'flex', flexWrap: 'wrap', gap: '6px 13px', marginTop: 5 } },
                h('span', { title: t.sessionId + ': ' + item.sessionId },
                  t.sessionId + ': ' + item.sessionId),
                h('span', null, t.deletedAt + ' ' + formatDate(item.deletedAt)))),
            h('div', { className: 'dsh-trash-actions' },
              button('↶ ' + t.restore, () => { void act('restore', [item.sessionId]) },
                pending, false, true),
              button(t.permanent, () => { void act('purge', [item.sessionId]) }, pending, true)),
          )),
      ),
      (error || status || progress) ? h('div', {
        style: { borderTop: '1px solid ' + ui.edge, padding: '9px 26px',
          color: error ? '#dc5555' : ui.muted, fontSize: '12px' },
        role: error ? 'alert' : 'status',
      }, error || progress || status) : null,
      h('footer', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, flexWrap: 'wrap', padding: '14px 26px',
        borderTop: '1px solid ' + ui.edge } },
        h('span', { style: { fontSize: '12px', color: ui.muted } },
          selectedIds.length ? t.selected + ' ' + selectedIds.length : t.subtitle),
        h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap',
          justifyContent: 'flex-end' } },
          button(t.deleteSelected, () => { void act('purge', selectedIds) },
            pending || selectedIds.length === 0, true),
          button(t.restoreSelected, () => { void act('restore', selectedIds) },
            pending || selectedIds.length === 0, false, true)),
      ),
      ))
    }

    function registerDockShortcut() {
      const entry = {
        id: 'dsh-docker.session-recycle', label: '回收站',
        icon: 'trash', order: 100,
        onClick: () => show({ type: 'recycle' }),
      }
      const dock = window.__dshDockerIconDockV1
      if (dock) dock.register(entry)
      else (window.__dshDockerIconDockPendingV1 ||= []).push(entry)
    }
    return {
      inject: ['slots'],
      apply(ctx) {
        registerDockShortcut()
        ctx.slots.inject('sidebar.workspaces.session.menu.item', function* () {
          yield ctx.slots.register({ name: 'sidebar.workspaces.session.menu.item',
            id: 'dsh-docker.trash', order: 700 }, TrashMenu)
        })
        ctx.slots.inject('sidebar.workspaces.session.row.action', () => ctx.slots.register({
          name: 'sidebar.workspaces.session.row.action', id: 'dsh-docker.session-select', order: 300,
        }, SessionCheckbox))
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay', id: 'dsh-docker.session-batch',
        }, BatchToolbar))
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay', id: 'dsh-docker.session-lifecycle',
        }, Dialog))
      },
    }
  },
})
