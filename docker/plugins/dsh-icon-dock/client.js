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
        // Selecting "快捷栏" for an item in More should actually promote it
        // into the nine immediately visible slots, not leave it at the end.
        if (position === 'dock' && locationOf(id) !== 'dock') {
          const pinned = getAll().filter(item =>
            item.id !== id && locationOf(item.id) === 'dock')
          if (pinned.length >= 9) {
            registry.arrange(id, pinned[8].id, 'dock')
            return
          }
        }
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
        if (beforeId === id) {
          if (destination) registry.setLocation(id, destination)
          return
        }
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
      '.dsh-icon-editor [draggable="true"]{cursor:grab}',
      '.dsh-icon-preview [draggable="true"]{touch-action:none}',
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
      const layout = getDockLayout(wide)
      const { primary } = layout
      const more = [...layout.more]
      // A hidden Plugins page must never lock the user out of the manager
      // that controls its visibility. Offer a recovery action inside More,
      // not as a pinned icon, while the native sidebar is being replaced.
      const nativePlugins = nativePanels.get('native-panel.plugins')
      const nativeAvailable = registry.getNativeCaptured()
      if (nativeAvailable && nativePlugins &&
        locationOf(nativePlugins.id) === 'hidden') {
        more.push({
          ...nativePlugins, id: 'icon-dock.recovery',
          label: '插件设置（恢复入口）',
        })
      }
      const takingOver = nativeAvailable &&
        (primary.length > 0 || more.length > 0 || Boolean(nativePlugins))
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
    function beginDrag(event, id) {
      dragId = id
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', id)
      }
    }
    function dropDrag(event, targetId, destination) {
      event.preventDefault()
      if (dragId) registry.arrange(dragId, targetId, destination)
      dragId = null
    }
    function startPointerDrag(event, id) {
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return
      pointerDrag = {
        id, startX: event.clientX, startY: event.clientY, moved: false,
      }
      event.currentTarget.setPointerCapture?.(event.pointerId)
    }
    function movePointerDrag(event) {
      if (!pointerDrag) return
      if (Math.hypot(event.clientX - pointerDrag.startX,
        event.clientY - pointerDrag.startY) > 8) pointerDrag.moved = true
    }
    function finishPointerDrag(event) {
      if (!pointerDrag) return
      const { id, moved } = pointerDrag
      pointerDrag = null
      if (!moved || typeof document === 'undefined') return
      // Hit testing is against the underlying target, even when the dragged
      // preview button holds pointer capture.
      const node = document.elementFromPoint?.(event.clientX, event.clientY)
        ?.closest?.('[data-dock-drop]')
      if (!node) return
      const destination = node.getAttribute('data-dock-zone')
      const targetId = node.getAttribute('data-dock-drop')
      if (destination === 'more') registry.arrange(id, null, 'more')
      else if (destination === 'dock') registry.arrange(id, targetId || null, 'dock')
      else if (destination === 'list') registry.arrange(id, targetId || null)
      event.preventDefault()
    }
    function ManagerCard({ view }) {
      React.useSyncExternalStore(subscribe, snapshot, snapshot)
      if (view === 'summary') return '统一管理侧边栏图标的排列、收纳和显示'
      const sorted = getAll()
      const { primary, more } = getDockLayout(true)
      const hiddenCount = sorted.filter(item => locationOf(item.id) === 'hidden').length
      const overflowIds = new Set(more.map(item => item.id))
      const iconButtonStyle = {
        width: '100%', minHeight: 55, padding: '7px 4px',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 4, borderRadius: 9,
        border: '1px solid ' + separator, color: 'inherit',
        background: 'var(--dsw-alias-bg-secondary,rgba(128,128,128,.05))',
        cursor: 'grab',
      }
      const smallButton = {
        display: 'inline-flex', justifyContent: 'center', alignItems: 'center',
        width: 31, height: 31, borderRadius: 8, border: '1px solid ' + separator,
        background: 'transparent', color: 'inherit', cursor: 'pointer',
      }
      const preview = []
      for (let index = 0; index < 10; index++) {
        const item = primary[index]
        if (item) {
          preview.push(h('button', {
            key: item.id, type: 'button',
            draggable: true, 'data-dock-drop': item.id, 'data-dock-zone': 'dock',
            'aria-label': '拖动排序 ' + item.label, title: item.label,
            onDragStart: event => beginDrag(event, item.id),
            onDragOver: event => event.preventDefault(),
            onDrop: event => dropDrag(event, item.id, 'dock'),
            onDragEnd: () => { dragId = null },
            onPointerDown: event => startPointerDrag(event, item.id),
            onPointerMove: movePointerDrag,
            onPointerUp: finishPointerDrag,
            onPointerCancel: () => { pointerDrag = null },
            style: iconButtonStyle,
          },
            h(SvgIcon, { entry: item, size: settings.size }),
            h('span', {
              style: { fontSize: 10, maxWidth: '100%', whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis' },
            }, item.label)))
        } else if (index === 9) {
          preview.push(h('button', {
            key: 'more-drop', type: 'button',
            'data-dock-drop': '', 'data-dock-zone': 'more',
            'aria-label': '更多收纳区', title: '拖动至此放入更多',
            onDragOver: event => event.preventDefault(),
            onDrop: event => dropDrag(event, null, 'more'),
            style: {
              ...iconButtonStyle, cursor: 'default',
              borderStyle: more.length ? 'solid' : 'dashed',
            },
          },
            h(MoreIcon, { size: settings.size }),
            h('span', { style: { fontSize: 10 } },
              more.length ? '更多 (' + more.length + ')' : '更多')))
        } else {
          preview.push(h('div', { key: 'empty-' + index,
            'aria-hidden': 'true', style: {
              minHeight: 55, borderRadius: 9,
              border: '1px dashed ' + separator, opacity: .45,
            },
          }))
        }
      }
      return h('div', {
        className: 'dsh-icon-editor',
        style: {
          padding: '14px 16px 24px', maxWidth: 740,
          color: 'inherit', fontSize: 13,
        },
      },
      h('div', { style: {
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 12, flexWrap: 'wrap', marginBottom: 14,
      } },
        h('div', null,
          h('h3', { style: { margin: '0 0 5px', fontSize: 17 } }, '快捷入口管理'),
          h('p', { style: { color: muted, lineHeight: 1.6, margin: 0, fontSize: 12 } },
            '拖动预览图标调整顺序，或在下方选择快捷栏、更多、隐藏。')),
        h('button', { type: 'button', style: {
          border: '1px solid ' + separator, background: 'transparent',
          color: 'inherit', padding: '7px 11px', borderRadius: 8,
          cursor: 'pointer', fontSize: 12,
        }, onClick: () => registry.reset() }, '恢复默认')),
      h('section', {
        className: 'dsh-icon-preview',
        'aria-label': '快捷栏布局预览',
        style: {
          border: '1px solid ' + separator, borderRadius: 12,
          padding: '14px', marginBottom: 18,
          background: 'var(--dsw-alias-bg-secondary,rgba(128,128,128,.03))',
        },
      },
        h('div', { style: {
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: 8, marginBottom: 12, flexWrap: 'wrap',
        } },
          h('strong', null, '侧边栏快捷栏 · 实时预览'),
          h('span', { style: { color: muted, fontSize: 11 } },
            '最多 2 行 × 5 列 · 9 个入口 + 更多')),
        h('div', {
          style: { maxWidth: 450, width: '100%', marginInline: 'auto',
            display: 'grid', gridTemplateColumns: 'repeat(5,minmax(0,1fr))',
            gridTemplateRows: 'repeat(2,auto)', gap: 7 },
        }, ...preview),
        h('p', { style: {
          fontSize: 11, color: muted, margin: '12px 0 0', lineHeight: 1.6,
        } }, more.length
          ? '另有 ' + more.length + ' 个入口在「更多」中。将图标拖到第 10 格即可收纳。'
          : '拖动图标调整顺序；第 10 格是「更多」收纳区，超出 9 个会自动进入其中。')),
      h('section', { 'aria-label': '完整快捷入口列表' },
        h('div', { style: {
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: 8, marginBottom: 6,
        } },
          h('strong', null, '全部已注册入口'),
          h('span', { style: { color: muted, fontSize: 11 } },
            '共 ' + sorted.length + ' · 快捷栏 ' + primary.length +
              ' · 更多 ' + more.length + ' · 隐藏 ' + hiddenCount)),
        sorted.length
          ? sorted.map((entry, index) => {
            const location = locationOf(entry.id)
            const autoOverflow = location === 'dock' && overflowIds.has(entry.id)
            return h('div', {
              key: entry.id, role: 'listitem', draggable: true,
              'data-dock-drop': entry.id, 'data-dock-zone': 'list',
              onDragStart: event => beginDrag(event, entry.id),
              onDragOver: event => event.preventDefault(),
              onDrop: event => dropDrag(event, entry.id),
              onDragEnd: () => { dragId = null },
              style: {
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '9px 0', borderBottom: '1px solid ' + separator,
                minWidth: 0,
              },
            },
              h('span', { title: '拖动排序', style: {
                color: muted, fontSize: 15, cursor: 'grab', userSelect: 'none',
              } }, '⠿'),
              h('span', { style: { flexShrink: 0, width: 28,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              } }, h(SvgIcon, { entry, size: settings.size })),
              h('div', { style: { flex: 1, minWidth: 70 } },
                h('div', { style: { fontWeight: 600, fontSize: 12 } }, entry.label),
                h('div', { style: {
                  color: muted, fontSize: 10, whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis', overflow: 'hidden',
                } }, autoOverflow ? '超过 9 个，自动收纳到更多' : entry.id)),
              h('select', {
                'aria-label': '显示位置 ' + entry.label,
                value: location, onChange: event =>
                  registry.setLocation(entry.id, event.target.value),
                style: {
                  flexShrink: 0, minWidth: 76, maxWidth: 105,
                  border: '1px solid ' + separator, borderRadius: 7,
                  padding: '6px 4px', background: 'transparent',
                  color: 'inherit', fontSize: 11,
                },
              },
                h('option', { value: 'dock' }, '快捷栏'),
                h('option', { value: 'more' }, '更多'),
                h('option', { value: 'hidden' }, '隐藏')),
              h('button', { type: 'button',
                'aria-label': '上移 ' + entry.label, title: '上移',
                style: { ...smallButton, opacity: index === 0 ? .35 : 1 },
                disabled: index === 0,
                onClick: () => registry.move(entry.id, -1),
              }, '↑'),
              h('button', { type: 'button',
                'aria-label': '下移 ' + entry.label, title: '下移',
                style: { ...smallButton, opacity: index === sorted.length - 1 ? .35 : 1 },
                disabled: index === sorted.length - 1,
                onClick: () => registry.move(entry.id, 1),
              }, '↓'))
          })
          : h('p', { style: {
            color: muted, padding: '16px 0', lineHeight: 1.6,
          } }, '暂无已注册入口；支持 Icon Dock 的新插件安装后会自动出现。')),
      h('div', { style: {
        marginTop: 18, paddingTop: 13,
        borderTop: '1px solid ' + separator,
        display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 20,
      } },
        h('label', { style: {
          display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer',
        } },
          h('input', {
            type: 'checkbox', checked: settings.captureNative,
            'aria-label': '接管官方导航',
            onChange: event => registry.setNativeCapture(event.target.checked),
          }),
          '接管官方导航'),
        h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 8 } },
          '图标大小',
          h('select', {
            id: 'dsh-icon-size', value: settings.size, 'aria-label': '图标大小',
            onChange: event => registry.setSize(Number(event.target.value)),
            style: { padding: '6px 9px', borderRadius: 7,
              border: '1px solid ' + separator,
              background: 'transparent', color: 'inherit' },
          }, ...[18, 20, 22, 24].map(n => h('option', { key: n, value: n }, n + 'px'))))),
      h('p', { style: { color: muted, fontSize: 11,
        lineHeight: 1.65, margin: '12px 0 0' } },
        '在快捷栏/更多/隐藏之间切换不会停用插件。收起侧边栏时使用 2×2 图标格，超出的入口同样进入「更多」。排序保存在当前浏览器中。'))
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
