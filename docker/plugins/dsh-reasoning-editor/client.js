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


    // Composer has no public slot for replacing the reasoning-effort pane.
    // Keep the DOM coupling limited to menu discovery/mounting; all model data
    // and mutations still ride DSH's per-session ModelDirectory contract.
    const COMPOSER_STYLE_ID = 'dsh-docker-reasoning-composer-style'

    function currentSessionId(ctx) {
      try {
        const sessions = ctx.get && ctx.get('sessions')
        const snapshot = sessions && sessions.list && sessions.list.getSnapshot
          ? sessions.list.getSnapshot()
          : undefined
        if (snapshot && typeof snapshot.current === 'string' && snapshot.current.length > 0) {
          return snapshot.current
        }

        const uiSession = ctx.get && ctx.get('uiSession')
        const bound = uiSession
          && uiSession.adapter
          && uiSession.adapter.current
          && uiSession.adapter.current.getSnapshot
          ? uiSession.adapter.current.getSnapshot().key
          : undefined
        if (typeof bound === 'string' && bound.length > 0) return bound

        const byId = snapshot && snapshot.byId && typeof snapshot.byId === 'object'
          ? snapshot.byId
          : {}
        for (const [key, row] of Object.entries(byId)) {
          if (!row || !row.retainedBy || Number(row.retainedBy.mainView || 0) <= 0) continue
          return typeof row.id === 'string' && row.id.length > 0 ? row.id : key
        }
      } catch {
        // Services can be absent during the client boot window.
      }
      return undefined
    }

    function currentDirectory(ctx) {
      const sessionId = currentSessionId(ctx)
      if (!sessionId) return undefined
      try {
        const directories = ctx.get && ctx.get('modelDirectories')
        return directories && directories.directoryFor
          ? directories.directoryFor(sessionId)
          : undefined
      } catch {
        return undefined
      }
    }

    function findComposerModelMenu(doc = document) {
      const card = doc.querySelector('[data-composer-card]')
      const scope = card || doc
      const triggers = Array.from(scope.querySelectorAll('button[aria-haspopup="menu"][aria-controls]'))
      for (const trigger of triggers) {
        const id = trigger.getAttribute('aria-controls')
        if (!id) continue
        const menu = doc.getElementById(id)
        if (menu && menu.getAttribute('role') === 'menu') return menu
      }

      const menus = card
        ? Array.from(card.querySelectorAll('[role="menu"]'))
        : Array.from(doc.querySelectorAll('[role="menu"]'))
      for (const menu of menus) {
        if (menu.previousElementSibling && menu.previousElementSibling.matches('button[aria-haspopup="menu"]')) {
          return menu
        }
      }
      return undefined
    }

    function composerModelState(directory) {
      const state = directory.store.getSnapshot()
      const current = state && state.current
      if (!current) return { state, current: null, model: undefined, levels: [], effective: undefined }

      const group = Array.isArray(state.groups)
        ? state.groups.find(candidate => candidate && candidate.id === current.provider)
        : undefined
      const model = group && Array.isArray(group.models)
        ? group.models.find(candidate => candidate && candidate.id === current.model)
        : undefined
      const reasoning = model && model.reasoning
      const levels = reasoning && Array.isArray(reasoning.efforts)
        ? reasoning.efforts.filter(level => level && typeof level.id === 'string')
        : []
      const effective = current.reasoningEffort !== undefined
        ? current.reasoningEffort
        : reasoning && reasoning.defaultEffort

      return { state, current, model, levels, effective }
    }

    function installComposerStyles() {
      const existing = document.getElementById(COMPOSER_STYLE_ID)
      if (existing) return () => {}

      const style = document.createElement('style')
      style.id = COMPOSER_STYLE_ID
      style.textContent = [
        '.dre-composer-body{min-width:340px;color:inherit}',
        '.dre-composer-slider-pad{padding:14px 14px 13px}',
        '.dre-composer-range-wrap{position:relative;height:50px;display:flex;align-items:center}',
        '.dre-composer-range{width:100%;height:48px;margin:0;appearance:none;-webkit-appearance:none;background:transparent;cursor:pointer;position:relative;z-index:2}',
        '.dre-composer-range:disabled{cursor:wait;opacity:.72}',
        '.dre-composer-range::-webkit-slider-runnable-track{height:48px;border-radius:999px;background:linear-gradient(90deg,rgba(230,243,255,.96) 0%,rgba(137,196,246,.92) 42%,rgba(43,116,201,.96) 100%);box-shadow:inset 0 0 0 7px rgba(238,247,255,.78),0 3px 12px rgba(55,104,157,.14)}',
        '.dre-composer-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:56px;height:56px;margin-top:-4px;border-radius:50%;border:1px solid rgba(130,170,215,.35);background:#fff;box-shadow:0 2px 9px rgba(53,92,139,.24),0 0 0 2px rgba(255,255,255,.72)}',
        '.dre-composer-range::-moz-range-track{height:48px;border-radius:999px;background:linear-gradient(90deg,rgba(230,243,255,.96) 0%,rgba(137,196,246,.92) 42%,rgba(43,116,201,.96) 100%);box-shadow:inset 0 0 0 7px rgba(238,247,255,.78),0 3px 12px rgba(55,104,157,.14)}',
        '.dre-composer-range::-moz-range-thumb{width:56px;height:56px;border-radius:50%;border:1px solid rgba(130,170,215,.35);background:#fff;box-shadow:0 2px 9px rgba(53,92,139,.24)}',
        'body[data-ds-dark-theme] .dre-composer-range::-webkit-slider-runnable-track{background:linear-gradient(90deg,rgba(41,54,88,.94),rgba(65,91,160,.96) 48%,rgba(83,68,206,.96));box-shadow:inset 0 0 0 7px rgba(31,39,67,.72),0 3px 14px rgba(10,14,31,.34)}',
        'body[data-ds-dark-theme] .dre-composer-range::-moz-range-track{background:linear-gradient(90deg,rgba(41,54,88,.94),rgba(65,91,160,.96) 48%,rgba(83,68,206,.96));box-shadow:inset 0 0 0 7px rgba(31,39,67,.72),0 3px 14px rgba(10,14,31,.34)}',
        '.dre-composer-levels{display:flex;justify-content:space-between;gap:4px;margin-top:7px;padding:0 7px;color:var(--dsw-alias-label-tertiary,#8b9099);font-size:10px}',
        '.dre-composer-levels span[data-active="true"]{color:var(--dsw-static-deepseek-500,#4d70ff);font-weight:600}',
        '.dre-composer-separator{height:1px;background:var(--dsw-alias-stroke-secondary,rgba(121,126,145,.16))}',
        '.dre-composer-model-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:8px;min-height:48px;padding:0 14px;width:100%;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}',
        '.dre-composer-model-row:hover{background:var(--dsw-alias-fill-tertiary,rgba(120,125,140,.09))}',
        '.dre-composer-model-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}',
        '.dre-composer-effort{color:var(--dsw-static-deepseek-500,#4d70ff);font-size:12px}',
        '.dre-composer-chevron{font-size:20px;line-height:1;opacity:.42}',
        '.dre-composer-hint{padding:14px;text-align:center;color:var(--dsw-alias-label-tertiary,#9296a0);font-size:12px}',
        '.dre-composer-error{margin:8px 12px 10px;padding:7px 9px;border-radius:8px;color:var(--dsw-alias-state-error-primary,#c83e4d);background:rgba(220,55,70,.08);font-size:11px}',
        '@media (prefers-reduced-motion:reduce){.dre-composer-range{scroll-behavior:auto}}',
      ].join('\n')
      document.head.appendChild(style)
      return () => style.remove()
    }

    function installComposerSlider(ctx) {
      const disposeStyle = installComposerStyles()
      let mounted
      let scheduled = false
      let disposed = false

      const directRootCells = menu => Array.from(menu.children).filter(element =>
        element instanceof HTMLButtonElement && element.getAttribute('role') === 'menuitem')

      const restoreCells = menu => {
        if (!menu) return
        for (const cell of directRootCells(menu)) {
          if (cell.dataset.dreOriginalDisplay !== undefined) {
            cell.style.display = cell.dataset.dreOriginalDisplay
            delete cell.dataset.dreOriginalDisplay
          } else {
            cell.style.display = ''
          }
        }
      }

      const teardownMount = () => {
        if (!mounted) return
        try { mounted.unsubscribe && mounted.unsubscribe() } catch {}
        restoreCells(mounted.menu)
        mounted.wrapper.remove()
        mounted = undefined
        window.dispatchEvent(new Event('resize'))
      }

      const render = mount => {
        if (disposed || mount !== mounted || !mount.wrapper.isConnected) return
        const { state, current, model, levels, effective } = composerModelState(mount.directory)
        const busy = state && state.status === 'selecting'
        const effectiveIndex = Math.max(0, levels.findIndex(level => level.id === effective))
        const selectedIndex = levels.length > 0
          ? (levels.findIndex(level => level.id === effective) >= 0 ? levels.findIndex(level => level.id === effective) : 0)
          : 0
        const modelLabel = model && model.name
          ? model.name
          : current
            ? current.model
            : 'Model'
        const effortLabel = levels[effectiveIndex] && levels[effectiveIndex].name
          ? levels[effectiveIndex].name
          : effective || 'Default'

        mount.wrapper.replaceChildren()
        mount.wrapper.className = 'dre-composer-body'

        if (levels.length >= 2 && current) {
          const pad = document.createElement('div')
          pad.className = 'dre-composer-slider-pad'

          const wrap = document.createElement('div')
          wrap.className = 'dre-composer-range-wrap'

          const input = document.createElement('input')
          input.type = 'range'
          input.className = 'dre-composer-range'
          input.min = '0'
          input.max = String(levels.length - 1)
          input.step = '1'
          input.value = String(selectedIndex)
          input.disabled = Boolean(busy)
          input.setAttribute('aria-label', 'Reasoning effort')
          input.setAttribute('aria-valuetext', effortLabel)

          const labels = document.createElement('div')
          labels.className = 'dre-composer-levels'

          const syncPreview = raw => {
            const index = Math.max(0, Math.min(levels.length - 1, Math.round(Number(raw))))
            input.value = String(index)
            const selected = levels[index]
            input.setAttribute('aria-valuetext', selected && (selected.name || selected.id) || '')
            for (const [position, label] of Array.from(labels.children).entries()) {
              label.dataset.active = position === index ? 'true' : 'false'
            }
            const rowEffort = mount.wrapper.querySelector('.dre-composer-effort')
            if (rowEffort) rowEffort.textContent = selected && (selected.name || selected.id) || ''
          }

          input.addEventListener('input', event => {
            syncPreview(event.currentTarget.value)
          })

          input.addEventListener('change', async event => {
            const index = Math.max(0, Math.min(levels.length - 1, Math.round(Number(event.currentTarget.value))))
            const chosen = levels[index]
            if (!chosen || !current || mount.committing) return
            mount.committing = true
            input.disabled = true
            mount.error = ''
            try {
              const result = await mount.directory.select({
                provider: current.provider,
                model: current.model,
                reasoningEffort: chosen.id,
              })
              if (result && result.ok === false) {
                throw new Error(result.error && result.error.message || 'Reasoning effort selection failed')
              }
            } catch (reason) {
              mount.error = reason instanceof Error ? reason.message : String(reason)
            } finally {
              mount.committing = false
              render(mount)
            }
          })

          wrap.appendChild(input)
          pad.appendChild(wrap)

          for (const [index, level] of levels.entries()) {
            const label = document.createElement('span')
            label.textContent = level.name || level.id
            label.dataset.active = index === selectedIndex ? 'true' : 'false'
            labels.appendChild(label)
          }
          pad.appendChild(labels)
          mount.wrapper.appendChild(pad)
        } else {
          const hint = document.createElement('div')
          hint.className = 'dre-composer-hint'
          hint.textContent = '当前模型没有可用的多个推理等级'
          mount.wrapper.appendChild(hint)
        }

        const separator = document.createElement('div')
        separator.className = 'dre-composer-separator'
        mount.wrapper.appendChild(separator)

        const row = document.createElement('button')
        row.type = 'button'
        row.role = 'menuitem'
        row.className = 'dre-composer-model-row'
        row.disabled = Boolean(busy)
        row.addEventListener('click', () => {
          const official = directRootCells(mount.menu)[0]
          if (official) official.click()
        })

        const name = document.createElement('span')
        name.className = 'dre-composer-model-name'
        name.textContent = modelLabel
        const effort = document.createElement('span')
        effort.className = 'dre-composer-effort'
        effort.textContent = effortLabel
        const chevron = document.createElement('span')
        chevron.className = 'dre-composer-chevron'
        chevron.setAttribute('aria-hidden', 'true')
        chevron.textContent = '›'
        row.append(name, effort, chevron)
        mount.wrapper.appendChild(row)

        const errorText = mount.error || (state && state.status === 'error' ? state.error : '')
        if (errorText) {
          const error = document.createElement('div')
          error.className = 'dre-composer-error'
          error.setAttribute('role', 'status')
          error.textContent = errorText
          mount.wrapper.appendChild(error)
        }
      }

      const mountInto = (menu, directory) => {
        teardownMount()
        const cells = directRootCells(menu)
        if (cells.length === 0) return
        for (const cell of cells) {
          cell.dataset.dreOriginalDisplay = cell.style.display || ''
          cell.style.display = 'none'
        }

        const wrapper = document.createElement('div')
        wrapper.dataset.dreComposerSlider = '1'
        menu.insertBefore(wrapper, menu.firstChild)

        mounted = {
          menu,
          directory,
          wrapper,
          unsubscribe: directory.store.subscribe(() => {
            if (mounted && mounted.directory === directory) render(mounted)
          }),
          committing: false,
          error: '',
        }
        render(mounted)
        Promise.resolve(directory.load()).catch(() => undefined)
        window.dispatchEvent(new Event('resize'))
      }

      const reconcile = () => {
        scheduled = false
        if (disposed) return

        const menu = findComposerModelMenu()
        if (!menu) {
          teardownMount()
          return
        }

        // Any radio item means the official menu drilled into either the model
        // list or the effort list. Our replica belongs only to the root pane.
        if (menu.querySelector('[role="menuitemradio"]')) {
          teardownMount()
          return
        }

        const directory = currentDirectory(ctx)
        if (!directory) return

        if (mounted
          && mounted.menu === menu
          && mounted.directory === directory
          && mounted.wrapper.isConnected) {
          if (menu.firstChild !== mounted.wrapper) menu.insertBefore(mounted.wrapper, menu.firstChild)
          for (const cell of directRootCells(menu)) cell.style.display = 'none'
          return
        }
        mountInto(menu, directory)
      }

      const schedule = () => {
        if (scheduled || disposed) return
        scheduled = true
        queueMicrotask(reconcile)
      }

      const observer = new MutationObserver(schedule)
      observer.observe(document.body, { subtree: true, childList: true })
      window.addEventListener('popstate', schedule)
      schedule()

      return () => {
        disposed = true
        observer.disconnect()
        window.removeEventListener('popstate', schedule)
        teardownMount()
        disposeStyle()
      }
    }

    return {
      inject: ['slots', 'remote', 'remote.settings'],
      apply(ctx) {
        ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register(
          { name: 'settings.models.provider-card', key: 'llm-pi-ai' },
          (ownerProps) => h(ReasoningSlot, { ...ownerProps, settings: ctx.remote.settings }),
        ))
        ctx.effect(
          () => installComposerSlider(ctx),
          'dsh-docker-reasoning-editor: composer slider',
        )
      },
    }
  },
})
