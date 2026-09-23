/* DSH Docker custom-model reasoning editor.
 *
 * This client package uses the official settings.models.provider-card slot and
 * remote.settings API. It never edits a parallel config source.
 */
window.__ModuleLoader__.load({
  id: 'dsh-docker-reasoning-editor',
  factory(require) {
    const React = require('react')
    const { useCallback, useEffect, useMemo, useState } = React
    const h = React.createElement

    const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

    const palette = {
      panel: {
        marginTop: '8px',
        padding: '10px 12px',
        border: '1px solid var(--dsw-alias-separator-primary, rgba(128,128,128,.28))',
        borderRadius: '10px',
        background: 'var(--dsw-alias-bg-secondary, rgba(128,128,128,.04))',
      },
      head: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
      title: { fontWeight: 600, fontSize: '13px' },
      hint: { color: 'var(--dsw-alias-label-secondary, #777)', fontSize: '12px', lineHeight: 1.45 },
      button: {
        border: '1px solid var(--dsw-alias-separator-primary, rgba(128,128,128,.35))',
        borderRadius: '7px',
        background: 'transparent',
        color: 'inherit',
        padding: '4px 9px',
        cursor: 'pointer',
        fontSize: '12px',
      },
      primary: {
        border: '1px solid transparent',
        borderRadius: '7px',
        background: 'var(--dsw-alias-brand-primary, #4d6bfe)',
        color: '#fff',
        padding: '5px 11px',
        cursor: 'pointer',
        fontSize: '12px',
      },
      model: {
        marginTop: '10px',
        paddingTop: '10px',
        borderTop: '1px solid var(--dsw-alias-separator-primary, rgba(128,128,128,.22))',
      },
      modelTitle: { fontWeight: 600, fontSize: '13px', wordBreak: 'break-all' },
      row: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '7px' },
      select: {
        border: '1px solid var(--dsw-alias-separator-primary, rgba(128,128,128,.35))',
        borderRadius: '7px',
        background: 'var(--dsw-alias-bg-primary, transparent)',
        color: 'inherit',
        padding: '4px 7px',
        fontSize: '12px',
      },
      slider: {
        position: 'relative',
        height: '54px',
        margin: '8px 12px 12px',
      },
      sliderRail: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: '15px',
        height: '6px',
        borderRadius: '999px',
        background: 'linear-gradient(90deg, rgba(77,107,254,.18), rgba(77,107,254,.8))',
      },
      sliderStop: {
        position: 'absolute',
        top: '5px',
        transform: 'translateX(-50%)',
        width: '28px',
        height: '36px',
        padding: 0,
        border: 0,
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
      },
      sliderDot: {
        display: 'block',
        width: '16px',
        height: '16px',
        margin: '7px auto 0',
        borderRadius: '50%',
        boxSizing: 'border-box',
        background: 'var(--dsw-alias-bg-primary, #fff)',
        border: '2px solid var(--dsw-alias-separator-primary, #aaa)',
      },
      sliderLabel: {
        display: 'block',
        marginTop: '5px',
        fontSize: '10px',
        whiteSpace: 'nowrap',
        transform: 'translateX(-25%)',
      },
      defaultSlider: {
        width: '100%',
        accentColor: 'var(--dsw-alias-brand-primary, #4d6bfe)',
      },
      mapping: {
        display: 'grid',
        gridTemplateColumns: '82px minmax(120px, 1fr)',
        gap: '7px',
        alignItems: 'center',
        marginTop: '6px',
      },
      input: {
        minWidth: 0,
        border: '1px solid var(--dsw-alias-separator-primary, rgba(128,128,128,.35))',
        borderRadius: '7px',
        background: 'transparent',
        color: 'inherit',
        padding: '4px 7px',
        fontSize: '12px',
      },
      error: { color: 'var(--dsw-alias-state-error-primary, #d43a3a)', fontSize: '12px', marginTop: '7px' },
      ok: { color: 'var(--dsw-alias-state-success-primary, #16803a)', fontSize: '12px', marginTop: '7px' },
    }

    function isRecord(value) {
      return value !== null && typeof value === 'object' && !Array.isArray(value)
    }

    function at(root, path) {
      let current = root
      for (const key of path || []) {
        if (!isRecord(current)) return undefined
        current = current[key]
      }
      return current
    }

    function cloneJson(value) {
      return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
    }

    function draftOf(model) {
      const declared = model && model.reasoningEfforts
      if (declared === false) return { mode: 'disabled', values: {} }
      if (isRecord(declared)) {
        const values = {}
        for (const level of LEVELS) {
          if (!Object.prototype.hasOwnProperty.call(declared, level)) continue
          const value = declared[level]
          values[level] = value === null ? '' : String(value)
        }
        return { mode: 'custom', values }
      }
      return { mode: 'inherit', values: {} }
    }

    function encodedDraft(draft) {
      if (!draft || draft.mode === 'inherit') return { kind: 'unset' }
      if (draft.mode === 'disabled') return { kind: 'set', value: false }

      const selected = Object.keys(draft.values || {}).filter(level => LEVELS.includes(level))
      if (!selected.some(level => level !== 'off')) {
        return { kind: 'error', message: 'custom-requires-thinking-level' }
      }

      const value = {}
      for (const level of LEVELS) {
        if (!selected.includes(level)) continue
        const wire = String(draft.values[level] ?? '').trim()
        if (level === 'off') value[level] = wire.length === 0 ? null : wire
        else value[level] = wire.length === 0 ? level : wire
      }
      return { kind: 'set', value }
    }

    function applyDesired(models, desiredById) {
      return models.map((model) => {
        if (!isRecord(model) || typeof model.id !== 'string') return model
        if (!Object.prototype.hasOwnProperty.call(desiredById, model.id)) return model
        const desired = desiredById[model.id]
        const next = { ...model }
        if (desired.kind === 'unset') delete next.reasoningEfforts
        else next.reasoningEfforts = cloneJson(desired.value)
        return next
      })
    }

    function localeText() {
      const language = String(document.documentElement.lang || navigator.language || '').toLowerCase()
      const zh = language.startsWith('zh')
      return zh ? {
        title: '推理等级',
        edit: '配置',
        close: '收起',
        loading: '正在读取模型配置…',
        empty: '这个自定义提供方没有可编辑的显式模型列表。',
        inherited: '未声明（由端点默认决定）',
        disabled: '声明为非推理模型',
        custom: '自定义推理等级',
        mode: '模式',
        wire: '发送值',
        save: '保存推理等级',
        saving: '保存中…',
        saved: '已写入 DSH 官方 reasoningEfforts 配置。',
        readOnly: '当前 settings 为只读，无法修改。',
        rawMissing: '该 provider 的 models 不在用户配置层。为避免把继承目录复制成第二份配置，这里保持只读；先通过官方模型编辑器保存一次模型列表。',
        customError: '“自定义推理等级”至少要选择一个非 Off 档位；仅需禁用推理时请选择“非推理模型”。',
        conflict: '配置同时被其他页面修改，已重读并重试；仍冲突，请重新打开后再保存。',
        missingModel: '保存时模型列表已变化；请重新打开后再保存。',
        offHint: 'Off 留空表示不发送 reasoning_effort。默认思考的 DeepSeek 兼容端点若需要显式关闭，仍应配置 compat.thinkingFormat: deepseek。',
        levelHint: '点击滑轨节点启用或关闭 DSH 中要显示的档位。',
        advanced: '高级映射',
        mappingHint: '仅当网关使用不同拼写时修改；留空使用标准档位名。',
        genericError: '读取或保存失败',
      } : {
        title: 'Reasoning effort',
        edit: 'Configure',
        close: 'Collapse',
        loading: 'Loading model configuration…',
        empty: 'This custom provider has no explicit editable model list.',
        inherited: 'Undeclared (endpoint default)',
        disabled: 'Declare as non-reasoning',
        custom: 'Custom reasoning levels',
        mode: 'Mode',
        wire: 'Wire value',
        save: 'Save reasoning levels',
        saving: 'Saving…',
        saved: 'Saved to DSH canonical reasoningEfforts settings.',
        readOnly: 'Settings are read-only.',
        rawMissing: 'This provider has no models array in the user layer. To avoid materializing inherited catalog state, save its model list once with the official editor first.',
        customError: 'Custom reasoning levels require at least one non-Off level. Choose non-reasoning if the model should not reason.',
        conflict: 'Settings changed concurrently. The retry also conflicted; reopen and save again.',
        missingModel: 'The model list changed while saving. Reopen and save again.',
        offHint: 'A blank Off sends no reasoning_effort. DeepSeek-compatible endpoints that reason by default still need compat.thinkingFormat: deepseek for explicit disable.',
        levelHint: 'Click slider stops to enable or disable the levels DSH should offer.',
        advanced: 'Advanced mapping',
        mappingHint: 'Override only when the gateway uses different spelling; blank uses the standard level name.',
        genericError: 'Unable to read or save settings',
      }
    }

    function findNamespace(describe) {
      return describe && Array.isArray(describe.namespaces)
        ? describe.namespaces.find(item => item && item.ns === 'llm-pi-ai')
        : undefined
    }

    function rawModels(namespace, path) {
      const route = at(namespace && namespace.user, path)
      return isRecord(route) && Array.isArray(route.models) ? route.models : undefined
    }

    function resolvedModels(namespace, path) {
      const route = at(namespace && namespace.value, path)
      return isRecord(route) && Array.isArray(route.models) ? route.models : []
    }

    function ReasoningSlot(props) {
      const provider = props.provider
      if (!provider || provider.settingsNs !== 'llm-pi-ai' || provider.declared !== true || !props.configured) {
        return null
      }

      const pathKey = JSON.stringify(provider.settingsPath || [])
      const copy = useMemo(localeText, [])
      const [open, setOpen] = useState(false)
      const [loading, setLoading] = useState(false)
      const [saving, setSaving] = useState(false)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [writable, setWritable] = useState(false)
      const [models, setModels] = useState([])
      const [rawAvailable, setRawAvailable] = useState(false)
      const [drafts, setDrafts] = useState({})
      const [mappingOpen, setMappingOpen] = useState({})

      const read = useCallback(async () => {
        setLoading(true)
        setError('')
        setNotice('')
        try {
          const response = await props.settings.describe()
          if (!response.ok) throw new Error(response.error && response.error.message || copy.genericError)
          const namespace = findNamespace(response.value)
          if (!namespace) throw new Error('llm-pi-ai settings namespace is unavailable')

          const raw = rawModels(namespace, provider.settingsPath)
          const display = raw === undefined ? resolvedModels(namespace, provider.settingsPath) : raw
          const normalized = display.filter(model => isRecord(model) && typeof model.id === 'string').map(cloneJson)
          const nextDrafts = {}
          for (const model of normalized) nextDrafts[model.id] = draftOf(model)

          setWritable(Boolean(response.value.writable))
          setRawAvailable(raw !== undefined)
          setModels(normalized)
          setDrafts(nextDrafts)
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason))
        } finally {
          setLoading(false)
        }
      }, [copy.genericError, props.settings, provider.provider, pathKey])

      useEffect(() => {
        if (open) void read()
      }, [open, read])

      const setMode = (id, mode) => {
        setDrafts(current => ({
          ...current,
          [id]: {
            mode,
            values: mode === 'custom' && current[id] && current[id].mode === 'custom'
              ? current[id].values
              : {},
          },
        }))
        setNotice('')
      }

      const toggleLevel = (id, level, checked) => {
        setDrafts(current => {
          const draft = current[id] || { mode: 'custom', values: {} }
          const values = { ...(draft.values || {}) }
          if (checked) values[level] = values[level] ?? ''
          else delete values[level]
          return { ...current, [id]: { mode: 'custom', values } }
        })
        setNotice('')
      }

      const setWire = (id, level, value) => {
        setDrafts(current => {
          const draft = current[id] || { mode: 'custom', values: {} }
          return {
            ...current,
            [id]: { mode: 'custom', values: { ...(draft.values || {}), [level]: value } },
          }
        })
        setNotice('')
      }

      const save = async () => {
        const desiredById = {}
        for (const model of models) {
          const desired = encodedDraft(drafts[model.id])
          if (desired.kind === 'error') {
            setError(copy.customError)
            return
          }
          desiredById[model.id] = desired
        }

        setSaving(true)
        setError('')
        setNotice('')
        try {
          for (let attempt = 0; attempt < 2; attempt++) {
            const described = await props.settings.describe()
            if (!described.ok) throw new Error(described.error && described.error.message || copy.genericError)
            const namespace = findNamespace(described.value)
            if (!namespace) throw new Error('llm-pi-ai settings namespace is unavailable')
            if (!described.value.writable) throw new Error(copy.readOnly)

            const current = rawModels(namespace, provider.settingsPath)
            if (current === undefined) throw new Error(copy.rawMissing)

            const currentIds = new Set(current.filter(isRecord).map(model => model.id))
            const missing = Object.keys(desiredById).find(id => !currentIds.has(id))
            if (missing !== undefined) throw new Error(copy.missingModel)

            const nextModels = applyDesired(current, desiredById)
            const response = await props.settings.mutate(
              'llm-pi-ai',
              [{ op: 'set', path: [...provider.settingsPath, 'models'], value: nextModels }],
              namespace.revision,
            )
            if (response.ok) {
              setNotice(copy.saved)
              await read()
              return
            }
            if (response.error && response.error.code === 'settings/conflict' && attempt === 0) continue
            if (response.error && response.error.code === 'settings/conflict') throw new Error(copy.conflict)
            throw new Error(response.error && response.error.message || copy.genericError)
          }
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason))
        } finally {
          setSaving(false)
        }
      }

      const levelEditor = (model) => {
        const draft = drafts[model.id] || { mode: 'inherit', values: {} }
        const selectedLevels = LEVELS.filter(level =>
          Object.prototype.hasOwnProperty.call(draft.values || {}, level))
        const showMapping = Boolean(mappingOpen[model.id])

        return h('div', { key: model.id, style: palette.model },
          h('div', { style: palette.modelTitle }, model.name ? model.name + ' · ' + model.id : model.id),
          h('div', { style: palette.row },
            h('span', { style: palette.hint }, copy.mode),
            h('select', {
              style: palette.select,
              value: draft.mode,
              disabled: saving || !writable || !rawAvailable,
              onChange: event => setMode(model.id, event.target.value),
            },
            h('option', { value: 'inherit' }, copy.inherited),
            h('option', { value: 'disabled' }, copy.disabled),
            h('option', { value: 'custom' }, copy.custom)),
          ),
          draft.mode !== 'custom' ? null : h('div', null,
            h('div', { style: { ...palette.hint, marginTop: '7px' } }, copy.levelHint),
            h('div', { style: palette.slider, role: 'group', 'aria-label': copy.title },
              h('div', { style: palette.sliderRail }),
              ...LEVELS.map((level, index) => {
                const selected = Object.prototype.hasOwnProperty.call(draft.values || {}, level)
                const left = LEVELS.length === 1 ? 50 : (index / (LEVELS.length - 1)) * 100
                return h('button', {
                  key: level,
                  type: 'button',
                  style: {
                    ...palette.sliderStop,
                    left: left + '%',
                    opacity: saving || !writable || !rawAvailable ? .45 : 1,
                  },
                  disabled: saving || !writable || !rawAvailable,
                  'aria-pressed': selected,
                  'aria-label': level,
                  onClick: () => toggleLevel(model.id, level, !selected),
                },
                h('span', {
                  style: {
                    ...palette.sliderDot,
                    background: selected
                      ? 'var(--dsw-alias-brand-primary, #4d6bfe)'
                      : 'var(--dsw-alias-bg-primary, #fff)',
                    borderColor: selected
                      ? 'var(--dsw-alias-brand-primary, #4d6bfe)'
                      : 'var(--dsw-alias-separator-primary, #aaa)',
                  },
                }),
                h('span', { style: palette.sliderLabel }, level))
              }),
            ),
            h('div', { style: palette.row },
              h('span', { style: palette.hint },
                selectedLevels.length > 0 ? selectedLevels.join(' · ') : '—'),
              h('button', {
                type: 'button',
                style: palette.button,
                onClick: () => setMappingOpen(current => ({
                  ...current,
                  [model.id]: !current[model.id],
                })),
              }, copy.advanced),
            ),
            !showMapping ? null : h('div', null,
              h('div', { style: { ...palette.hint, marginTop: '7px' } }, copy.mappingHint),
              ...selectedLevels.map(level =>
                h('div', { key: level, style: palette.mapping },
                  h('label', { style: { fontSize: '12px' } }, level),
                  h('input', {
                    type: 'text',
                    style: palette.input,
                    value: String(draft.values[level] ?? ''),
                    placeholder: level === 'off' ? copy.wire : level,
                    disabled: saving || !writable || !rawAvailable,
                    'aria-label': level + ' ' + copy.wire,
                    onChange: event => setWire(model.id, level, event.target.value),
                  }),
                )),
            ),
            h('div', { style: { ...palette.hint, marginTop: '7px' } }, copy.offHint),
          ),
        )
      }

      return h('div', { style: palette.panel },
        h('div', { style: palette.head },
          h('span', { style: palette.title }, copy.title),
          h('span', { style: { ...palette.hint, flex: 1 } }, 'reasoningEfforts'),
          h('button', {
            type: 'button',
            style: palette.button,
            onClick: () => setOpen(value => !value),
          }, open ? copy.close : copy.edit),
        ),
        !open ? null : h('div', null,
          loading ? h('div', { style: { ...palette.hint, marginTop: '8px' } }, copy.loading) : null,
          !loading && !rawAvailable && !error
            ? h('div', { style: { ...palette.hint, marginTop: '8px' } }, copy.rawMissing)
            : null,
          !loading && rawAvailable && models.length === 0 && !error
            ? h('div', { style: { ...palette.hint, marginTop: '8px' } }, copy.empty)
            : null,
          ...(!loading ? models.map(levelEditor) : []),
          error ? h('div', { role: 'alert', style: palette.error }, error) : null,
          notice ? h('div', { role: 'status', style: palette.ok }, notice) : null,
          !loading && models.length > 0
            ? h('div', { style: { ...palette.row, marginTop: '10px' } },
                h('button', {
                  type: 'button',
                  style: { ...palette.primary, opacity: saving || !writable || !rawAvailable ? .5 : 1 },
                  disabled: saving || !writable || !rawAvailable,
                  onClick: () => { void save() },
                }, saving ? copy.saving : copy.save),
                !writable ? h('span', { style: palette.hint }, copy.readOnly) : null,
              )
            : null,
        ),
      )
    }

    return {
      inject: ['slots', 'remote', 'remote.settings'],
      apply(ctx) {
        ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register(
          { name: 'settings.models.provider-card', key: 'llm-pi-ai' },
          (ownerProps) => h(ReasoningSlot, { ...ownerProps, settings: ctx.remote.settings }),
        ))
      },
    }
  },
})
