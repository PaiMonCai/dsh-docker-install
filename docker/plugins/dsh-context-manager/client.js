/* Native DSH Settings surface; persisted desired policy is not a live engine. */
window.__ModuleLoader__.load({
  id: 'dsh-docker-context-manager',
  factory(require) {
    const React = require('react')
    const { createElement: h, useEffect, useState } = React
    const color = 'var(--dsw-alias-label-secondary, #777)'
    const border = 'var(--dsw-alias-separator-primary, rgba(128,128,128,.25))'
    const bg = 'var(--dsw-alias-bg-secondary, rgba(128,128,128,.06))'
    const styles = {
      root: { maxWidth: 760, padding: '6px 0 18px', display: 'grid', gap: 14, fontSize: 13 },
      section: { display: 'grid', gap: 10, padding: '12px 0', borderBottom: '1px solid ' + border },
      row: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
      muted: { fontSize: 12, margin: 0, lineHeight: 1.55, color },
      input: { minHeight: 32, padding: '5px 9px', maxWidth: '100%', color: 'inherit',
        border: '1px solid ' + border, borderRadius: 7, background: 'transparent' },
      button: { padding: '7px 12px', borderRadius: 8, cursor: 'pointer',
        border: '1px solid ' + border, color: 'inherit', background: 'transparent' },
      chip: { fontSize: 12, padding: '4px 8px', borderRadius: 7, background: bg },
      h3: { fontSize: 14, fontWeight: 650, margin: 0 },
    }
    function Button({ children, onClick, disabled, primary }) {
      return h('button', { type: 'button', disabled, onClick, style: {
        ...styles.button, opacity: disabled ? .5 : 1,
        ...(primary ? { background: 'var(--dsw-alias-bg-accent, #2878e4)', borderColor: 'transparent', color: 'white' } : {}),
      } }, children)
    }
    function Field({ label, children, hint }) {
      return h('label', { style: { display: 'grid', gap: 5, flex: '1 1 145px', minWidth: 125 } },
        h('span', null, label), children,
        hint ? h('span', { style: styles.muted }, hint) : null)
    }
    function Input({ value, onChange, ...props }) {
      return h('input', { ...props, value, onChange: e => onChange(e.target.value), style: styles.input })
    }
    function Select({ value, onChange, options, disabled }) {
      return h('select', { disabled, value, onChange: e => onChange(e.target.value), style: styles.input },
        ...options.map(o => h('option', { key: o[0], value: o[0] }, o[1])))
    }
    const MODES = [['basic','DSH 原生'],['tiered','分层压缩（预留）'],['off','关闭压缩（预留）']]
    const INHERIT = [['inherit','继承全局'], ...MODES]
    function Panel({ call }) {
      const [remote, setRemote] = useState(null)
      const [draft, setDraft] = useState(null)
      const [revision, setRevision] = useState('')
      const [saving, setSaving] = useState(false)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [tab, setTab] = useState('config')
      const [details, setDetails] = useState(false)
      const [windowTokens, setWindowTokens] = useState(200000)
      const [outputTokens, setOutputTokens] = useState(16000)
      async function load() {
        setError('')
        try {
          const result = await call('settings', {})
          if (!result?.ok) throw Error(result?.error?.message || '无法读取上下文设置')
          setRemote(result.value)
          setDraft(JSON.parse(JSON.stringify(result.value.settings)))
          setRevision(result.value.revision)
          setNotice('')
        } catch (e) { setError(String(e?.message || e)) }
      }
      useEffect(() => { void load() }, [])
      function update(fn) { setDraft(current => fn(JSON.parse(JSON.stringify(current)))) }
      const setTop = (field, val) => update(d => ({ ...d, [field]: val }))
      const setBasic = (field, val) => update(d => {
        d.basic[field] = val
        if (d.basic.retainRatio >= d.basic.thresholdRatio)
          d.basic.retainRatio = Math.max(.05, +(d.basic.thresholdRatio - .05).toFixed(2))
        return d
      })
      const setTiered = (field, val) => update(d => ({ ...d, tiered: { ...d.tiered, [field]: val } }))
      function changePolicy(kind, index, field, value) {
        update(d => { d[kind][index][field] = value; return d })
      }
      function changeOverride(kind, index, field, value) {
        update(d => {
          d[kind][index].basic ||= {}
          if (value === '') delete d[kind][index].basic[field]
          else d[kind][index].basic[field] = Number(value) / 100
          if (!Object.keys(d[kind][index].basic).length) delete d[kind][index].basic
          return d
        })
      }
      function append(kind) {
        update(d => {
          if (d[kind].length >= 32) return d
          d[kind].push(kind === 'agentPolicies'
            ? { agentId: '', engine: 'inherit' }
            : { provider: '', model: '', engine: 'inherit' })
          return d
        })
      }
      const drop = (kind, index) => update(d => { d[kind].splice(index, 1); return d })
      async function save() {
        if (!draft || saving) return
        setSaving(true); setError(''); setNotice('')
        try {
          const response = await call('save', { settings: draft, revision })
          if (!response?.ok) throw Error(response?.error?.message || '保存失败')
          setRevision(response.value.revision)
          setDraft(JSON.parse(JSON.stringify(response.value.settings)))
          setRemote(previous => ({ ...previous, ...response.value }))
          setNotice('设置已持久化。当前版本不会自动改写正在运行的压缩引擎。')
        } catch (e) { setError(String(e?.message || e)) }
        finally { setSaving(false) }
      }
      const current = draft?.basic
      const validPreview = current && Number.isFinite(windowTokens) && Number.isFinite(outputTokens)
        && windowTokens > outputTokens && windowTokens >= 1024 && outputTokens > 0
      const threshold = validPreview
        ? Math.max(0, Math.floor(Math.min(windowTokens * current.thresholdRatio,
          windowTokens - outputTokens - current.headroomTokens))) : null
      const retain = validPreview
        ? Math.floor((windowTokens - outputTokens) * current.retainRatio) : null
      const percent = n => Math.round(n * 100)
      const layout = {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
      }
      const tabButton = (key, title) => h(Button, { onClick: () => setTab(key) }, title)
      function policies(kind, label) {
        return h('div', { style: { display: 'grid', gap: 9 } },
          h('div', { style: layout },
            h('strong', null, label + '（' + draft[kind].length + '）'),
            h(Button, { onClick: () => append(kind), disabled: draft[kind].length >= 32 }, '+ 添加规则')),
          h('p', { style: styles.muted }, kind === 'agentPolicies'
            ? '按 Agent ID 覆盖。未填写的参数继承全局设置。'
            : '按 provider + model 精确匹配。优先级高于 Agent 规则。'),
          ...draft[kind].map((rule, i) => h('div', {
            key: kind + ':' + i,
            style: { display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap',
              padding: '9px 10px', background: bg, borderRadius: 8 },
          },
          ...(kind === 'agentPolicies'
            ? [h(Field, { key: 'id', label: 'Agent ID' },
              h(Input, { value: rule.agentId, placeholder: 'reverse-engineering',
                onChange: v => changePolicy(kind, i, 'agentId', v) }))]
            : [
              h(Field, { key: 'p', label: 'Provider' },
                h(Input, { value: rule.provider, placeholder: 'provider',
                  onChange: v => changePolicy(kind, i, 'provider', v) })),
              h(Field, { key: 'm', label: 'Model' },
                h(Input, { value: rule.model, placeholder: 'model',
                  onChange: v => changePolicy(kind, i, 'model', v) })),
            ]),
          h(Field, { label: '压缩模式' }, h(Select, { value: rule.engine || 'inherit',
            onChange: v => changePolicy(kind, i, 'engine', v), options: INHERIT })),
          h(Field, { label: '触发 %（可选）' },
            h(Input, { type: 'number', min: 40, max: 90, step: 5,
              placeholder: '继承', value: rule.basic?.thresholdRatio === undefined
                ? '' : percent(rule.basic.thresholdRatio),
              onChange: v => changeOverride(kind, i, 'thresholdRatio', v) })),
          h(Field, { label: '保留 %（可选）' },
            h(Input, { type: 'number', min: 5, max: 40, step: 5,
              placeholder: '继承', value: rule.basic?.retainRatio === undefined
                ? '' : percent(rule.basic.retainRatio),
              onChange: v => changeOverride(kind, i, 'retainRatio', v) })),
          h(Button, { onClick: () => drop(kind, i) }, '删除'))))
      }
      return h('section', { style: styles.root },
        h('div', { style: layout },
          h('div', null, h('strong', { style: { fontSize: 15 } }, '上下文管理'),
            h('p', { style: styles.muted }, '配置中心 · DSH 原生压缩 · 分层策略预留')),
          h(Button, { onClick: () => void load() }, '刷新')),
        h('div', { style: styles.row },
          tabButton('config', '压缩策略'), tabButton('runtime', '运行状态'), tabButton('rules', '高级规则')),
        error ? h('div', { role: 'alert', style: { color: '#c64242', fontSize: 12 } }, error) : null,
        notice ? h('div', { role: 'status', style: styles.muted }, notice) : null,
        !draft ? h('p', null, '正在读取设置…') : null,
        draft && tab === 'config' ? h(React.Fragment, null,
          h('div', { style: styles.section },
            h('h3', { style: styles.h3 }, '压缩引擎（目标配置）'),
            h('div', { style: styles.row }, ...MODES.map(([value, title]) =>
              h('label', { key: value, style: { ...styles.chip, cursor: 'pointer' } },
                h('input', { type: 'radio', name: 'context-engine', checked: draft.engine === value,
                  onChange: () => setTop('engine', value) }), ' ', title))),
            h('p', { style: styles.muted },
              '模式选择仅保存目标策略。当前版本未接管实际压缩服务，不能把“关闭”或“分层”当作已生效。')),
          h('div', { style: styles.section },
            h('div', { style: layout }, h('h3', { style: styles.h3 }, 'DSH 原生压缩参数'),
              h('span', { style: styles.chip }, '均衡配置')),
            h('div', { style: styles.row },
              h(Field, { label: '触发比例 · ' + percent(current.thresholdRatio) + '%' },
                h('input', { type: 'range', min: 40, max: 90, step: 5,
                  value: percent(current.thresholdRatio),
                  onChange: e => setBasic('thresholdRatio', Number(e.target.value) / 100) })),
              h(Field, { label: '保留近期历史 · ' + percent(current.retainRatio) + '%' },
                h('input', { type: 'range', min: 5, max: 40, step: 5,
                  value: percent(current.retainRatio),
                  onChange: e => setBasic('retainRatio',
                    Math.min(Number(e.target.value) / 100, current.thresholdRatio - .05)) }))),
            h('div', { style: styles.row },
              h(Field, { label: '安全余量（Tokens）' },
                h(Input, { type: 'number', min: 0, max: 262144, step: 1024,
                  value: current.headroomTokens,
                  onChange: v => setBasic('headroomTokens', Number(v)) })),
              h(Field, { label: '自动压缩' },
                h('label', { style: styles.chip },
                  h('input', { type: 'checkbox', checked: current.auto,
                    onChange: e => setBasic('auto', e.target.checked) }), ' 启用（目标值）'))),
            h('div', { style: styles.row },
              h(Button, { onClick: () => update(d => { d.basic = {
                auto: true, thresholdRatio: .65, retainRatio: .10, headroomTokens: 65536 }; return d }) },
                '节省 Token'),
              h(Button, { onClick: () => update(d => { d.basic = {
                auto: true, thresholdRatio: .75, retainRatio: .20, headroomTokens: 65536 }; return d }) },
                '均衡'),
              h(Button, { onClick: () => update(d => { d.basic = {
                auto: true, thresholdRatio: .85, retainRatio: .25, headroomTokens: 65536 }; return d }) },
                '保留更多')),
            h('details', { open: details, onToggle: e => setDetails(e.currentTarget.open) },
              h('summary', { style: { cursor: 'pointer' } }, '上下文预算估算'),
              h('div', { style: { ...styles.row, padding: '10px 0' } },
                h(Field, { label: '模型上下文窗口' },
                  h(Input, { type: 'number', min: 1024, value: windowTokens,
                    onChange: v => setWindowTokens(Number(v)) })),
                h(Field, { label: '输出预留 Tokens' },
                  h(Input, { type: 'number', min: 1, value: outputTokens,
                    onChange: v => setOutputTokens(Number(v)) }))),
              h('p', { style: styles.muted }, validPreview
                ? '预计触发：' + threshold.toLocaleString() + ' Tokens；近期保留约 '
                  + retain.toLocaleString() + ' Tokens。'
                : '请输入有效的窗口与输出预算。'),
              h('p', { style: styles.muted },
                '仅为官方公式的预算估算；不代表压缩后的最终比例或已探测到模型窗口。'))),
          h('div', { style: styles.section },
            h('h3', { style: styles.h3 }, '分层压缩（后续接入）'),
            h('p', { style: styles.muted }, '先保存 ACP 风格策略；T1/T2/T3、回取与提醒引擎尚未激活。'),
            h('div', { style: styles.row },
              h(Field, { label: '增长提醒间隔（Tokens）' },
                h(Input, { type: 'number', min: 1000, max: 200000, step: 1000,
                  value: draft.tiered.nudgeGrowthTokens,
                  onChange: v => setTiered('nudgeGrowthTokens', Number(v)) })),
              h(Field, { label: '近期消息保留条数' },
                h(Input, { type: 'number', min: 0, max: 50,
                  value: draft.tiered.preserveRecentMessages,
                  onChange: v => setTiered('preserveRecentMessages', Number(v)) })),
              h(Field, { label: '近期内容预算（Tokens）' },
                h(Input, { type: 'number', min: 0, max: 100000, step: 500,
                  value: draft.tiered.preserveRecentTokens,
                  onChange: v => setTiered('preserveRecentTokens', Number(v)) }))),
            h('div', { style: styles.row },
              ...[['tiers','开启 T1/T2/T3'], ['retrievalEnabled','允许历史回取']].map(([key,label]) =>
                h('label', { key, style: styles.chip },
                  h('input', { type: 'checkbox', checked: draft.tiered[key],
                    onChange: e => setTiered(key, e.target.checked) }), ' ', label)))) )
          : null,
        draft && tab === 'rules' ? h('div', { style: styles.section },
          h('h3', { style: styles.h3 }, 'Agent 与模型覆盖规则'),
          policies('agentPolicies', 'Agent 策略'),
          policies('modelPolicies', '模型策略'),
          h('p', { style: styles.muted },
            '应用优先级：全局 → Agent ID → Provider/Model。策略已保存不等于实际 Agent 已加载。'))
          : null,
        draft && tab === 'runtime' ? h('div', { style: styles.section },
          h('h3', { style: styles.h3 }, '实际压缩状态'),
          h('p', { role: 'status', style: { ...styles.muted, color: '#b27920' } },
            '压缩接管尚未验证；当前插件不修改 DSH 压缩服务，实际行为由现有 DSH 和已安装的外部插件决定。'),
          h('div', { style: styles.row },
            h('span', { style: styles.chip }, '目标：' + draft.engine),
            h('span', { style: styles.chip }, '实际：' + (remote?.runtime?.effectiveEngine || '未知')),
            h('span', { style: styles.chip },
              remote?.runtime?.restartPending ? '已保存变更，待重新读取' : '无启动后配置差异')),
          h('p', { style: styles.muted }, '累计观测压缩开始：' + (remote?.events?.['compaction/start'] ?? 0)
            + '；摘要：' + (remote?.events?.['compaction/summary'] ?? 0)
            + '；结束：' + (remote?.events?.['compaction/end'] ?? 0)),
          h('div', { style: { display: 'grid', gap: 5 } },
            ...(remote?.nativePresets?.presets || []).map((p, i) => h('div', {
              key: p.id + i, style: { ...styles.row, padding: '7px 0',
                borderBottom: '1px solid ' + border } },
              h('strong', null, p.id), h('span', { style: styles.muted },
                (p.mounted ? '已挂载' : '仅声明') + ' · ' + p.ownership
                + ' · 原生运行 ' + p.basic.active + ' / ' + p.basic.configured)))),
          h('p', { style: styles.muted },
            '此处仅显示预设级插件的 Fiber 状态。host 全局服务、模型网关代理与手动压缩链路的唯一所有权尚需独立验收。'))
          : null,
        draft ? h('div', { style: { ...styles.row, position: 'sticky', bottom: 0, zIndex: 1,
          background: 'var(--dsw-alias-bg-primary, white)', borderTop: '1px solid ' + border, padding: '10px 0' } },
          h(Button, { onClick: () => void save(), primary: true, disabled: saving },
            saving ? '保存中…' : '保存目标策略'),
          h(Button, { onClick: () => void load(), disabled: saving }, '丢弃未保存修改'),
          h('span', { style: styles.muted }, '持久化至 DSH_HOME；尚未接管运行中引擎'))
          : null)
    }
    return {
      inject: ['slots', 'connection'],
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'dsh-docker-context-manager', order: 37,
          label: () => '上下文管理',
          inject: () => ({ call: (method, payload) => ctx.connection.rpc.call('/dsh-docker-context-manager', method, payload) }),
        }, Panel))
      },
    }
  },
})
