/* Phase 1: native, read-only DSH settings diagnostics. */
window.__ModuleLoader__.load({
  id: 'dsh-docker-context-manager',
  factory(require) {
    const React = require('react')
    const { createElement: h, useEffect, useState } = React
    function Panel({ call }) {
      const [result, setResult] = useState(null)
      const [error, setError] = useState('')
      async function refresh() {
        try {
          const response = await call('status', {})
          if (!response?.ok) throw Error(response?.error?.message || '兼容性状态读取失败')
          setResult(response.value); setError('')
        } catch (reason) { setError(String(reason?.message || reason)) }
      }
      useEffect(() => { void refresh() }, [])
      return h('section', { style: { padding: '10px 0', display: 'grid', gap: 10 } },
        h('p', { style: { margin: 0, fontSize: 12, opacity: .7 } },
          '第一批：只读兼容性检测。不会启用压缩或修改现有会话。'),
        h('button', { type: 'button', onClick: () => void refresh(),
          style: { width: 'fit-content', padding: '7px 12px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'inherit' } },
          '刷新检测'),
        error ? h('p', { role: 'alert' }, error) : null,
        result ? h('div', { style: { display: 'grid', gap: 5, fontSize: 13 } },
          h('div', null, '压缩所有权：未验证（只读）'),
          h('div', null, '观察到的 Agent Preset 配置：' + result.hooks.presetConfigsObserved),
          h('div', null, '观察到的压缩事件：' + result.hooks.sessionEventsObserved),
          h('div', null, '宿主压缩服务：' + (result.hostCompaction.available ? '可见' : '未见到；可能在 Agent 内部作用域')),
          h('div', null, '官方 Agent 运行时清单：' +
            (result.nativePresets?.available ? result.nativePresets.count + ' 个预设' : '暂不可用')),
          ...(result.nativePresets?.presets || []).map((preset, i) =>
            h('div', { key: preset.id + i, style: { padding: '7px 0', borderTop: '1px solid var(--dsw-alias-border-l2)', display: 'grid', gap: 3 } },
              h('strong', null, preset.id),
              h('span', null, '状态：' + (preset.mounted ? '已挂载' : '仅声明') + '；预设级压缩：' + preset.ownership),
              h('span', null, '原生压缩 ' + preset.basic.active + '/' + preset.basic.configured
                + ' 已运行/已配置；外部插件 ' + preset.external.active + '/' + preset.external.configured))),
          ...(result.warnings || []).map((warning, i) =>
            h('p', { key: i, role: 'status', style: { color: 'var(--dsw-alias-label-secondary)', margin: 0, overflowWrap: 'anywhere' } }, warning)))
          : h('p', null, '正在读取兼容性状态…'))
    }
    return {
      inject: ['slots', 'connection'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'dsh-docker-context-manager', order: 37,
          label: () => '上下文管理（检测）',
          inject: () => ({ call: (method, payload) => ctx.connection.rpc.call('/dsh-docker-context-manager', method, payload) }),
        }, Panel))
      },
    }
  },
})
