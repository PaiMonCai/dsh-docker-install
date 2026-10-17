/* Native DSH settings module. React text nodes only; no global DOM patches. */
window.__ModuleLoader__.load({
  id: 'dsh-docker-prompt-manager',
  factory(require) {
    const React = require('react')
    const { createElement: h, useEffect, useState } = React
    const style = {
      section: { display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 },
      row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
      input: { width: '100%', boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 7, padding: 8, background: 'transparent', color: 'inherit', font: 'inherit' },
      muted: { fontSize: 12, lineHeight: 1.6, color: 'var(--dsw-alias-label-tertiary)' },
      button: { padding: '6px 12px', border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 7, color: 'inherit', background: 'transparent', cursor: 'pointer' },
      pre: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 240, overflow: 'auto', fontSize: 12 },
    }
    function Panel({ call }) {
      const [draft, setDraft] = useState(null)
      const [permissions, setPermissions] = useState({ available: false, sessions: [], options: [], tools: [] })
      const [diagnostic, setDiagnostic] = useState({ available: false })
      const [sessionId, setSessionId] = useState('')
      const [preset, setPreset] = useState('')
      const [busy, setBusy] = useState(false)
      const [message, setMessage] = useState('')
      const change = (key, value) => setDraft(previous => ({ ...previous, [key]: value }))
      function accept(value) { setDraft({ ...value, deniedText: value.deniedTools.join('\n') }) }
      async function invoke(method, payload = {}) {
        const response = await call(method, payload)
        if (!response?.ok) throw Error(response?.error?.message || '请求失败')
        return response.value
      }
      async function runtime() {
        const [access, inspect] = await Promise.all([invoke('permissions'), invoke('inspect')])
        setPermissions(access); setDiagnostic(inspect)
      }
      async function load() { accept(await invoke('state')); await runtime() }
      useEffect(() => { load().catch(error => setMessage(error.message)) }, [])
      async function run(action, success) {
        setBusy(true); setMessage('')
        try { await action(); if (success) setMessage(success) }
        catch (error) { setMessage(String(error?.message || error)) }
        finally { setBusy(false) }
      }
      function save(reset = false) {
        return run(async () => {
          const value = await invoke('save', { revision: draft.revision,
            globalEnabled: reset ? false : draft.globalEnabled,
            workspaceEnabled: reset ? false : draft.workspaceEnabled,
            globalText: draft.globalText,
            deniedTools: reset ? [] : draft.deniedText.split(/[\s,]+/).filter(Boolean) })
          accept(value); await runtime()
        }, reset ? '附加指令和工具禁用名单已停用；会话权限请在下方单独恢复。' : '已保存；附加指令在下次组装时生效，工具禁用名单在下次工具调用时生效。')
      }
      const selected = permissions.sessions.find(item => item.id === sessionId)
      const button = (label, onClick, disabled = false) => h('button', {
        type: 'button', style: style.button, disabled: busy || disabled, onClick,
      }, label)
      return h('div', { style: { padding: 12 } },
        h('p', { role: 'status', 'aria-live': 'polite' }, message),
        !draft ? h('p', null, '正在读取提示词与执行设置…') : h(React.Fragment, null,
          h('section', { style: style.section },
            h('h3', null, '附加系统指令'),
            h('label', null, h('input', { type: 'checkbox', checked: draft.globalEnabled,
              onChange: event => change('globalEnabled', event.target.checked) }), ' 启用全局附加指令'),
            h('textarea', { style: style.input, rows: 8, value: draft.globalText,
              'aria-label': '全局附加指令', onChange: event => change('globalText', event.target.value) }),
            h('label', null, h('input', { type: 'checkbox', checked: draft.workspaceEnabled,
              onChange: event => change('workspaceEnabled', event.target.checked) }), ' 启用工作区 DSH_PROMPT.md'),
            h('p', { style: style.muted }, '追加独立 System Prompt 分块，最多 16 KiB。工作区从 /workspace 到当前目录读取 DSH_PROMPT.md，按父目录到子目录顺序组合。原生 AGENTS.md 仍由 DSH 管理。'),
            h('p', { style: style.muted }, '设置作用于本实例各 Agent 的后续提示词组装；模板括号按原文保留。')),
          h('section', { style: style.section },
            h('h3', null, '工具执行控制'),
            h('label', null, '实例工具禁用名单（精确名称，每行一个）',
              h('textarea', { style: style.input, rows: 4, value: draft.deniedText,
                disabled: !draft.toolsAvailable, 'aria-label': '工具禁用名单',
                onChange: event => change('deniedText', event.target.value) })),
            !draft.toolsAvailable && h('p', { role: 'alert' }, '工具执行检查接口不可用。'),
            h('p', { style: style.muted }, '只阻止名单中的 DSH 工具调用，也检查子代理和 PTC 内部调用。未禁用工具仍遵循各自审批与沙箱；禁用某个工具不等于禁止其他工具完成同类操作。'),
            h('details', null, h('summary', null, '查看当前已加载工具名称'),
              h('pre', { style: style.pre }, permissions.tools.join('\n') || '暂无已加载工具'))),
          h('div', { style: style.row }, button('保存注入与工具设置', () => save()),
            button('停用附加设置', () => save(true)), button('重读已保存设置', () => run(load))),
          h('section', { style: { ...style.section, marginTop: 24 } },
            h('h3', null, '会话沙箱与审批'),
            h('p', { style: style.muted }, '切换 DSH 官方权限预设，写入所选会话日志并在重启后保留。完整文件访问通常对应 danger-full-access + never：关闭 DSH 文件沙箱，且不弹审批。never 会拒绝仍需审批的请求，并非自动批准。'),
            !permissions.available ? h('p', null, '官方权限服务当前不可用。') : h(React.Fragment, null,
              h('label', null, '选择已加载会话', h('select', { style: style.input, value: sessionId,
                onChange: event => { setSessionId(event.target.value); setPreset('') } },
              h('option', { value: '' }, '请选择会话'),
              ...permissions.sessions.map(item => h('option', { key: item.id, value: item.id }, item.title)))),
              selected && h('p', null, '实际模式：' + selected.sandbox + '；审批：' + selected.approval +
                '；预设：' + selected.preset + (selected.running ? '（运行中，请先停止）' : '')),
              h('label', null, '目标权限预设', h('select', { style: style.input, value: preset,
                onChange: event => setPreset(event.target.value) }, h('option', { value: '' }, '请选择预设'),
              ...permissions.options.map(item => h('option', { key: item.value, value: item.value }, item.name)))),
              h('div', { style: style.row }, button('应用到所选会话', () => run(async () => {
                await invoke('permissionSet', { sessionId, preset }); await runtime()
              }, '会话权限已更新。'), !selected || !preset || selected.running),
              button('恢复所选会话默认预设', () => run(async () => {
                await invoke('permissionSet', { sessionId, preset: permissions.defaultPreset }); await runtime()
              }, '所选会话已恢复部署默认预设。'), !selected || selected.running)))),
          h('section', { style: style.section }, h('h3', null, '注入诊断'),
            button('刷新运行状态', () => run(runtime)),
            h('p', { style: style.muted }, '显示最近一次组装 Hook 的分块大小、哈希及来源，不保存完整提示词或用户消息。该观察发生在最终渲染之前。'),
            h('pre', { style: style.pre }, diagnostic.available ? JSON.stringify(diagnostic, null, 2) : '尚未观察到提示词组装。'))))
    }
    function apply(ctx) {
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: 'dsh-docker-prompt-manager', order: 35,
        label: () => '提示词与执行',
        inject: () => ({ call: (method, payload) => ctx.connection.rpc.call('/dsh-docker-prompt-manager', method, payload) }),
      }, Panel))
    }
    return { inject: ['slots', 'connection'], apply }
  },
})
