/* Independent DSH Web shortcut dock.
 * Other plugins register a descriptor, not a sidebar slot. The dock exclusively
 * owns icon layout, visibility and ordering; preference storage is browser-local.
 */
window.__ModuleLoader__.load({
  id: 'dsh-docker-icon-dock',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const KEY = 'dsh-docker-icon-dock:v1'
    const entries = new Map()
    const nativePanels = new Map()
    let nativeComplete = false
    let selectedPanel = null
    const listeners = new Set()
    const emit = () => {
      revision++
      for (const fn of listeners) fn()
    }
    let revision = 0
    const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn) }
    const snapshot = () => revision

    function normalize(value) {
      const input = value && typeof value === 'object' ? value : {}
      const hidden = {}
      if (input.hidden && typeof input.hidden === 'object') {
        for (const [id, flag] of Object.entries(input.hidden)) {
          if (/^[a-z0-9][a-z0-9._-]{1,100}$/i.test(id) && flag === true) hidden[id] = true
        }
      }
      const order = Array.isArray(input.order)
        ? [...new Set(input.order.filter(id =>
          typeof id === 'string' && /^[a-z0-9][a-z0-9._-]{1,100}$/i.test(id)))].slice(0, 100)
        : []
      const size = [18, 20, 22, 24].includes(input.size) ? input.size : 20
      const captureNative = input.captureNative !== false
      const location = {}
      if (input.location && typeof input.location === 'object') {
        for (const [id, position] of Object.entries(input.location)) {
          if (/^[a-z0-9][a-z0-9._-]{1,100}$/i.test(id)
            && ['dock', 'more', 'hidden'].includes(position)) location[id] = position
        }
      }
      // Existing hidden preferences continue working after the editor upgrade.
      for (const id of Object.keys(hidden)) {
        if (!Object.hasOwn(location, id)) location[id] = 'hidden'
      }
      return { hidden, order, size, captureNative, location }
    }
    function readSaved() {
      try { return normalize(JSON.parse(window.localStorage?.getItem(KEY) || '{}')) }
      catch { return normalize({}) }
    }
    let settings = readSaved()
    function save(next) {
      settings = normalize(next)
      try { window.localStorage?.setItem(KEY, JSON.stringify(settings)) }
      catch { /* browser storage is optional; controls still work this session */ }
      emit()
    }
    function getAll() {
      const sorted = [...entries.values(), ...(settings.captureNative ? nativePanels.values() : [])].sort((a, b) =>
        a.order - b.order || a.label.localeCompare(b.label, 'zh-CN') || a.id.localeCompare(b.id))
      const place = new Map(settings.order.map((id, i) => [id, i]))
      return sorted.sort((a, b) => (place.has(a.id) ? place.get(a.id) : 1000) -
        (place.has(b.id) ? place.get(b.id) : 1000) ||
        a.order - b.order || a.id.localeCompare(b.id))
    }
    const locationOf = id => settings.location[id] ||
      (settings.hidden[id] ? 'hidden' : 'dock')
    function getDockLayout(wide) {
      const limit = wide ? 9 : 3
      const available = getAll().filter(item => locationOf(item.id) !== 'hidden')
      const pinned = available.filter(item => locationOf(item.id) !== 'more')
      const primary = pinned.slice(0, limit)
      const primaryIds = new Set(primary.map(item => item.id))
      const more = available.filter(item => !primaryIds.has(item.id))
      return { primary, more, limit }
    }
    let menuOpen = false
    let dragId = null
    let pointerDrag = null
    function setMenuOpen(next) {
      if (menuOpen === next) return
      menuOpen = next
      emit()
    }
    const registry = {
      version: 1, subscribe, snapshot, getAll, getDockLayout,
      locationOf,
      isMoreOpen: () => menuOpen,
      setMenuOpen,
      getSettings: () => settings,
      getNativeCount: () => nativePanels.size,
      getSelectedPanel: () => selectedPanel,
      getNativeCaptured: () => nativeComplete && settings.captureNative && nativePanels.size > 0,
      syncNative(rows, navigate) {
        if (!Array.isArray(rows) || typeof navigate !== 'function') return
        const next = new Map()
        let complete = true
        for (const panel of rows) {
          const id = panel?.id
          const label = panel?.label
          if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,100}$/i.test(id)
            || typeof label !== 'string' || !label.trim()) {
            complete = false
            continue
          }
          const dockId = 'native-panel.' + id
          // StoredEntry.component is the SAME icon React component rendered
          // by upstream SidebarRoot for this panel (not an SVG copy).
          // The original slot renderer would synthesize extra props for
          // entries with inject/store/locale/children. Reuse directly only
          // when none of those runtime-only dependencies are declared.
          const nativeIcon = typeof panel.component === 'function'
            && !panel.hasExtraProps ? panel.component : null
          next.set(dockId, {
            id: dockId, label: label.trim().slice(0, 80),
            icon: 'grid', nativeIcon, nativePanel: true, panelId: id,
            order: 10 + (Number.isFinite(panel.order) ? panel.order : 0),
            onClick: () => navigate(id),
          })
        }
        const prev = [...nativePanels.values()]
        const nextValues = [...next.values()]
        if (complete === nativeComplete && prev.length === nextValues.length &&
          prev.every((item, i) => item.id === nextValues[i].id &&
            item.label === nextValues[i].label && item.order === nextValues[i].order &&
            item.nativeIcon === nextValues[i].nativeIcon)) return
        nativePanels.clear()
        for (const [id, entry] of next) nativePanels.set(id, entry)
        nativeComplete = complete
        emit()
      },
      register(entry) {
        if (!entry || typeof entry.id !== 'string' ||
            !/^[a-z0-9][a-z0-9._-]{1,100}$/i.test(entry.id) ||
            typeof entry.label !== 'string' || !entry.label.trim() ||
            typeof entry.onClick !== 'function') {
          return false
        }
        entries.set(entry.id, {
          id: entry.id, label: entry.label.trim().slice(0, 80),
          icon: typeof entry.icon === 'string' ? entry.icon : 'grid',
          renderIcon: typeof entry.renderIcon === 'function' ? entry.renderIcon : null,
          order: Number.isFinite(entry.order) ? entry.order : 500,
          onClick: entry.onClick,
        })
        emit()
        return true
      },
      unregister(id) { if (entries.delete(id)) emit() },
      setLocation(id, position) {
        if (!['dock', 'more', 'hidden'].includes(position)
          || !getAll().some(entry => entry.id === id)) return
        const location = { ...settings.location, [id]: position }
        const hidden = { ...settings.hidden }
        if (position === 'hidden') hidden[id] = true
        else delete hidden[id]
        save({ ...settings, location, hidden })
      },
      setVisible(id, visible) {
        registry.setLocation(id, visible ? 'dock' : 'hidden')
      },
      arrange(id, beforeId, destination) {
        const all = getAll().map(item => item.id)
        const source = all.indexOf(id)
        if (source < 0 || (beforeId && !all.includes(beforeId))) return
        if (destination && !['dock', 'more'].includes(destination)) return
        const order = all.filter(item => item !== id)
        if (beforeId && beforeId !== id) {
          const insert = order.indexOf(beforeId)
          order.splice(insert, 0, id)
        } else if (beforeId !== id) order.push(id)
        const location = { ...settings.location }
        const hidden = { ...settings.hidden }
        if (destination) {
          location[id] = destination
          delete hidden[id]
        }
        save({ ...settings, order, location, hidden })
      },
      move(id, direction) {
        const ordered = getAll().map(item => item.id)
        const index = ordered.indexOf(id)
        const next = index + direction
        if (index < 0 || next < 0 || next >= ordered.length) return
        ;[ordered[index], ordered[next]] = [ordered[next], ordered[index]]
        save({ ...settings, order: ordered })
      },
      setSize(size) { save({ ...settings, size }) },
      setNativeCapture(captureNative) { save({ ...settings, captureNative: Boolean(captureNative) }) },
      setSelectedPanel(id) {
        if (selectedPanel === id) return
        selectedPanel = id
        emit()
      },
      reset() { save({}) },
    }
    // Plugin evaluation order is not specified by DSH. Providers loaded first
    // enqueue their descriptors; the dock drains that queue exactly once.
    window.__dshDockerIconDockV1 = registry
    const pending = window.__dshDockerIconDockPendingV1 || []
    window.__dshDockerIconDockPendingV1 = []
    for (const item of pending) registry.register(item)
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('storage', event => {
        if (event.key !== KEY) return
        settings = readSaved()
        emit()
      })
    }

    const separator = 'var(--dsw-alias-separator-primary,rgba(128,128,128,.25))'
    const muted = 'var(--dsw-alias-label-secondary,#7b8390)'
    const styleTag = [
      '.dsh-icon-dock button{color:inherit}',
      '.dsh-icon-dock button:hover{background:var(--dsw-alias-bg-secondary,rgba(128,128,128,.12))!important}',
      '.dsh-icon-dock button:focus-visible,.dsh-icon-settings button:focus-visible,.dsh-icon-settings input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:-2px}',
      '.dsh-icon-dock .dsh-icon-menu{box-shadow:0 12px 36px rgba(0,0,0,.2)}',
      '.dsh-icon-dock .dsh-icon-menu button:hover{background:var(--dsw-alias-bg-secondary,rgba(128,128,128,.12))!important}',
      '.dsh-icon-editor [draggable="true"]{cursor:grab;touch-action:none}',
      '.dsh-icon-editor [draggable="true"]:active{cursor:grabbing}',
      '.dsh-icon-editor [data-dock-drop]:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe)}',
    ].join('\n')

    function SvgIcon({ entry, size }) {
      const base = {
        width: size, height: size, viewBox: '0 0 24 24',
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
        strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true',
      }
      // Native sidebar icons take precedence over every generated fallback.
      // Render as a React component, never invoke the function manually:
      // this preserves upstream component identity and React hook semantics.
      if (entry.nativeIcon) return h(entry.nativeIcon, {
        size, active: entry.panelId === selectedPanel,
      })
      if (entry.renderIcon) {
        try { return entry.renderIcon({ size, h }) }
        catch { /* a broken third-party icon must not hide the entire dock */ }
      }
      if (entry.icon === 'trash') return h('svg', base,
        h('rect', { x: 4.6, y: 7, width: 14.8, height: 13.5, rx: 2 }),
        h('path', { d: 'M3 7h18M9 4h6M10 11v5.5M14 11v5.5' }))
      if (entry.icon === 'search') return h('svg', base,
        h('circle', { cx: 10.8, cy: 10.8, r: 6.8 }),
        h('path', { d: 'm16 16 4.6 4.6' }))
      if (entry.icon === 'settings') return h('svg', base,
        h('circle', { cx: 12, cy: 12, r: 3.4 }),
        h('path', { d: 'M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2.2 2.2M16.8 16.8 19 19M5 19l2.2-2.2M16.8 7.2 19 5' }))
      if (entry.icon === 'terminal') return h('svg', base,
        h('rect', { x: 2.5, y: 4, width: 19, height: 16, rx: 2 }),
        h('path', { d: 'm6 9 3 3-3 3M12 16h5' }))
      if (entry.icon === 'link') return h('svg', base,
        h('path', { d: 'M10 13a5 5 0 0 0 7.2.2l2-2a5 5 0 0 0-7.1-7.1l-2 2M14 11a5 5 0 0 0-7.2-.2l-2 2a5 5 0 0 0 7.1 7.1l2-2' }))
      return h('svg', base,
        h('rect', { x: 3, y: 3, width: 7, height: 7, rx: 1.5 }),
        h('rect', { x: 14, y: 3, width: 7, height: 7, rx: 1.5 }),
        h('rect', { x: 3, y: 14, width: 7, height: 7, rx: 1.5 }),
        h('rect', { x: 14, y: 14, width: 7, height: 7, rx: 1.5 }))
    }
    function MoreIcon({ size }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24',
        stroke: 'currentColor', fill: 'currentColor', 'aria-hidden': 'true',
      }, ...[5, 12, 19].map(cx => h('circle', { key: cx, cx, cy: 12, r: 1.7 })))
    }
    function IconDock({ wide }) {
      React.useSyncExternalStore(subscribe, snapshot, snapshot)
      const { primary, more } = getDockLayout(wide)
      const takingOver = registry.getNativeCaptured()
      if (!primary.length && !more.length && !takingOver) return null
      const activeIcon = item => h('button', {
        key: item.id, type: 'button',
        'aria-label': item.label, title: item.label,
        'aria-current': item.nativePanel && selectedPanel === item.panelId ? 'page' : undefined,
        onClick: () => {
          setMenuOpen(false)
          item.onClick()
        },
        style: {
          width: '100%', minWidth: 0, height: wide ? 36 : 30,
          border: 'none', borderRadius: 9,
          background: item.nativePanel && selectedPanel === item.panelId
            ? 'var(--dsw-alias-bg-secondary,rgba(128,128,128,.14))' : 'transparent',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          padding: 0, cursor: 'pointer',
        },
      }, h(SvgIcon, { entry: item, size: wide ? settings.size : 16 }))
      return h('div', {
        className: 'dsh-icon-dock', role: 'group', 'aria-label': '快捷入口',
        onKeyDown: event => {
          if (event.key === 'Escape' && menuOpen) {
            event.preventDefault()
            setMenuOpen(false)
          }
        },
        style: {
          position: 'relative',
          width: wide ? '100%' : '36px',
          minWidth: wide ? 0 : '36px',
          boxSizing: 'border-box',
          padding: wide ? '2px 6px' : 0,
        },
      },
      h('style', null, styleTag +
        (takingOver
          ? '\ndiv:has(> [class*="footArea"] .dsh-icon-dock) > nav[class*="panelList"]{display:none!important}'
          : '')),
      h('div', {
        className: 'dsh-icon-grid',
        style: {
          display: 'grid',
          gridTemplateColumns: wide ? 'repeat(5, minmax(0, 1fr))' : 'repeat(2, minmax(0, 1fr))',
          gridAutoRows: wide ? 36 : 30,
          gap: wide ? '5px 4px' : '2px',
          maxHeight: wide ? 77 : 62,
        },
      },
      ...primary.map(activeIcon),
      more.length ? h('button', {
        type: 'button', 'aria-label': '更多',
        title: '更多（' + more.length + '）',
        'aria-haspopup': 'menu', 'aria-expanded': menuOpen,
        onClick: () => setMenuOpen(!menuOpen),
        style: {
          width: '100%', minWidth: 0,
          height: wide ? 36 : 30,
          border: 'none', borderRadius: 9, background: 'transparent',
          color: 'inherit', display: 'inline-flex', alignItems: 'center',
          justifyContent: 'center', cursor: 'pointer', padding: 0,
        },
      }, h(MoreIcon, { size: wide ? settings.size : 16 })) : null),
      more.length && menuOpen ? h('div', {
        className: 'dsh-icon-menu', role: 'menu', 'aria-label': '更多快捷入口',
        style: {
          position: 'absolute', bottom: 'calc(100% + 8px)', left: 0,
          width: 234, maxWidth: 'calc(100vw - 24px)',
          maxHeight: 'min(330px, 55vh)', overflowY: 'auto', zIndex: 1000,
          borderRadius: 12, padding: 7,
          border: '1px solid ' + separator,
          color: 'var(--dsw-alias-label-primary,inherit)',
          background: 'var(--dsw-alias-bg-primary,var(--surface-primary,#fff))',
        },
      },
        h('div', { style: { padding: '6px 9px', color: muted, fontSize: 12 } },
          '更多快捷入口 · ' + more.length),
        ...more.map(item => h('button', {
          key: item.id, type: 'button', role: 'menuitem',
          title: item.label,
          onClick: () => {
            setMenuOpen(false)
            item.onClick()
          },
          style: {
            width: '100%', minHeight: 38, display: 'flex', alignItems: 'center',
            gap: 10, border: 'none', borderRadius: 8, padding: '6px 10px',
            color: 'inherit', background: 'transparent', cursor: 'pointer',
            textAlign: 'left', fontSize: 13,
          },
        },
          h(SvgIcon, { entry: item, size: 18 }),
          h('span', { style: { whiteSpace: 'nowrap', overflow: 'hidden',
            textOverflow: 'ellipsis' } }, item.label)))) : null)
    }
    // Pointer-down outside closes the menu; menu clicks themselves remain
    // inside the dock. The listener is disposable through DSH's effect scope.
    function bindMenuDismissal() {
      if (typeof document === 'undefined') return () => {}
      const outside = event => {
        if (menuOpen && !event.target?.closest?.('.dsh-icon-dock')) setMenuOpen(false)
      }
      const escape = event => {
        if (event.key === 'Escape' && menuOpen) setMenuOpen(false)
      }
      document.addEventListener('pointerdown', outside)
      document.addEventListener('keydown', escape)
      return () => {
        document.removeEventListener('pointerdown', outside)
        document.removeEventListener('keydown', escape)
      }
    }
    function ManagerCard({ view }) {
      React.useSyncExternalStore(subscribe, snapshot, snapshot)
      if (view === 'summary') return '统一管理侧边栏插件图标的显示、顺序和大小'
      const sorted = getAll()
      const allVisible = sorted.filter(item => !settings.hidden[item.id]).length
      const btn = { padding: '6px 10px', minHeight: 30, background: 'transparent',
        border: '1px solid ' + separator, color: 'inherit', borderRadius: 7,
        fontSize: 12, cursor: 'pointer' }
      return h('div', {
        className: 'dsh-icon-settings',
        style: { padding: '12px', maxWidth: 700, color: 'inherit', fontSize: 13 },
      },
      h('h3', { style: { margin: '0 0 8px', fontSize: 16 } }, '快捷入口管理'),
      h('p', { style: { color: muted, lineHeight: 1.7, margin: '0 0 14px', fontSize: 12 } },
        '集中控制侧边栏底部的插件图标。只显示当前已注册的插件，隐藏图标不会停用插件功能。'),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 12,
        justifyContent: 'space-between', flexWrap: 'wrap', padding: '10px 0',
        borderBottom: '1px solid ' + separator } },
        h('span', null, '已启用图标 ' + allVisible + ' / ' + sorted.length),
        h('button', { type: 'button', style: btn, onClick: () => registry.reset() }, '恢复默认')),
      sorted.length ? sorted.map((entry, index) => h('div', {
        key: entry.id,
        style: { display: 'flex', alignItems: 'center', gap: 11,
          padding: '12px 0', borderBottom: '1px solid ' + separator },
      },
      h('div', { style: { width: 28, flexShrink: 0 } },
        h(SvgIcon, { entry, size: settings.size })),
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('div', { style: { fontWeight: 600 } }, entry.label),
        h('div', { style: { color: muted, fontSize: 11, overflow: 'hidden',
          whiteSpace: 'nowrap', textOverflow: 'ellipsis' } }, entry.id)),
      h('label', { style: { display: 'inline-flex', gap: 6,
        alignItems: 'center', cursor: 'pointer', fontSize: 12 } },
        h('input', { type: 'checkbox', checked: !settings.hidden[entry.id],
          'aria-label': '显示 ' + entry.label,
          onChange: event => registry.setVisible(entry.id, event.target.checked) }),
        '显示'),
      h('button', { type: 'button', style: btn, disabled: index === 0,
        'aria-label': '上移 ' + entry.label,
        onClick: () => registry.move(entry.id, -1) }, '↑'),
      h('button', { type: 'button', style: btn, disabled: index === sorted.length - 1,
        'aria-label': '下移 ' + entry.label,
        onClick: () => registry.move(entry.id, 1) }, '↓')))
        : h('p', { style: { color: muted, padding: '16px 0' } },
          '暂时没有已注册的快捷入口。安装支持图标坞的插件后会自动出现在这里。'),
      h('label', { style: { display: 'flex', alignItems: 'center', gap: 9,
        padding: '14px 0 8px', borderBottom: '1px solid ' + separator,
        cursor: 'pointer' } },
        h('input', { type: 'checkbox', checked: settings.captureNative,
          'aria-label': '接管官方导航',
          onChange: event => registry.setNativeCapture(event.target.checked) }),
        h('span', null, '接管官方导航（插件、自动化任务等）')),
      h('p', { style: { color: muted, margin: '4px 0 12px', fontSize: 11 } },
        '关闭后恢复侧边栏原生文字导航。管理器仅复制导航入口，不替换官方页面。'),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 } },
        h('label', { htmlFor: 'dsh-icon-size' }, '图标大小'),
        h('select', { id: 'dsh-icon-size', value: settings.size,
          'aria-label': '图标大小',
          style: { border: '1px solid ' + separator, borderRadius: 7,
            padding: '7px 10px', color: 'inherit', background: 'transparent' },
          onChange: event => registry.setSize(Number(event.target.value)) },
          ...[18, 20, 22, 24].map(n => h('option', { key: n, value: n }, n + 'px')))),
      h('p', { style: { color: muted, fontSize: 11, lineHeight: 1.6, marginTop: 15 } },
        '设置保存在当前浏览器中；不同浏览器或设备可以分别安排快捷入口。'))
    }
    return {
      inject: ['slots', 'layout', 'locale'],
      apply(ctx) {
        if (typeof ctx.effect === 'function') {
          ctx.effect(bindMenuDismissal, 'icon-dock: more menu dismiss')
        } else bindMenuDismissal()
        const syncNativePanels = () => {
          if (typeof ctx.slots.entriesOfSlot !== 'function') return
          const records = ctx.slots.entriesOfSlot('sidebar.panellist')
          const list = records.map(entry => {
            const { options } = entry
            let label = options.label
            try { label = typeof label === 'function' ? label() : label }
            catch { label = null }
            return {
              id: options.id, label,
              order: options.order,
              component: entry.component,
              hasExtraProps: Boolean(entry.inject || entry.store ||
                entry.locale || entry.children),
            }
          })
          registry.syncNative(list, id => ctx.layout.selectPanel(id))
        }
        // Watch the official public list slot, rather than duplicating fixed
        // panel IDs or DOM click handlers. The native pages remain untouched.
        if (typeof ctx.slots.subscribe === 'function') {
          const offPanels = ctx.slots.subscribe('sidebar.panellist', syncNativePanels)
          const offLocale = ctx.locale?.subscribe?.(syncNativePanels)
          if (typeof ctx.effect === 'function') ctx.effect(() => () => {
            offPanels?.()
            offLocale?.()
          }, 'icon-dock: native sidebar mirror')
        }
        syncNativePanels()
        const info = ctx.layout?.panelInfo
        if (info?.getSnapshot && info?.subscribe) {
          const updateSelection = () => {
            registry.setSelectedPanel(info.getSnapshot()?.activePanelId ?? null)
          }
          const offInfo = info.subscribe(updateSelection)
          updateSelection()
          if (typeof ctx.effect === 'function') ctx.effect(
            () => () => offInfo?.(), 'icon-dock: active native panel')
        }
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action', id: 'dsh-docker.icon-dock', order: 440,
        }, IconDock))
        ctx.slots.inject('plugins.item', () => ctx.slots.register({
          name: 'plugins.item', id: 'dsh-docker.icon-dock-settings', order: 81,
          label: () => '快捷入口管理',
        }, ManagerCard))
      },
    }
  },
})
