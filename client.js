/**
 * Browser half of brief mode: one compact switch in the composer tool row.
 *
 * The switch reads the Host's `briefMode` projection through the standard
 * `useProjection` prop and writes through the `brief` command with
 * `ctx.remote.commands.execute`, exactly as a hand-typed `/brief off` would.
 * The Host computes the state from the Session log, so the control never keeps
 * its own copy of the answer.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-brief-mode',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace owned by this plugin. */
    const NS = 'briefMode'

    /** Simplified Chinese dictionary (the key-set source of truth). */
    const zh = {
      'chip.label': '简短回答',
      'chip.on': '开',
      'chip.off': '关',
      'chip.aria': '简短回答：{state}，按下切换',
      'chip.aria.unknown': '简短回答：状态未读取，按下尝试开启',
      'chip.title.on': '简短回答已开启，点击关闭（/brief off）',
      'chip.title.off': '简短回答已关闭，点击向上下文注入一句输出长度要求（/brief on）',
      'chip.title.unknown': '简短回答：状态未读取，按下会请 Host 开启（/brief on）',
      'chip.busy': '正在切换…',
    }

    /** English dictionary. */
    const en = {
      'chip.label': 'Brief replies',
      'chip.on': 'on',
      'chip.off': 'off',
      'chip.aria': 'Brief replies: {state}, press to switch',
      'chip.aria.unknown': 'Brief replies: state not read yet, press to try turning it on',
      'chip.title.on': 'Brief replies is on, click to turn off (/brief off)',
      'chip.title.off': 'Brief replies is off, click to inject an output-length sentence into the context (/brief on)',
      'chip.title.unknown': 'Brief replies: state not read yet, pressing asks the Host to turn it on (/brief on)',
      'chip.busy': 'Switching…',
    }

    // Unmounting the component removes this element, so the styles never
    // outlive the control. Only theme tokens are referenced. The control uses
    // the tool row's own two states: a quiet ghost while off (like the
    // permission control) and the tinted mode chip while on (like the plan
    // chip), so it carries no colors of its own.
    const STYLE = `
.dshb-wrap { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.dshb-chip {
  display: inline-flex; align-items: center; gap: 4px;
  height: 28px; min-width: 34px; padding: 0 8px;
  border: 0; border-radius: var(--dsw-radius-sm, 6px);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 13px; line-height: 20px; font-weight: 500;
  cursor: pointer;
  transition:
    background-color 140ms cubic-bezier(0.22, 1, 0.36, 1),
    color 140ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 140ms cubic-bezier(0.22, 1, 0.36, 1);
}
@media (hover: hover) {
  .dshb-chip:hover:not([data-pending]) {
    background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2));
    color: var(--dsw-alias-label-primary);
  }
}
.dshb-chip:active:not([data-pending]) { transform: scale(0.98); }
.dshb-chip:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary));
  outline-offset: 2px;
}
.dshb-chip[data-pending] { opacity: 0.75; cursor: progress; }
.dshb-chip[data-state='on'] {
  background: var(--dsw-alias-state-business-tertiary, var(--dsw-alias-bg-layer-2));
  color: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary));
}
.dshb-glyph { flex: 0 0 auto; display: block; }
.dshb-chip[data-state='unread'] .dshb-glyph { opacity: 0.55; }
.dshb-label { white-space: nowrap; }
.dshb-error {
  min-width: 0; max-width: 20ch;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px;
}
`

    /**
     * The control's glyph: a short line inside a frame — "one short answer",
     * drawn at the tool row's 14px / 1.5 stroke so it matches its neighbours.
     */
    function Glyph() {
      return h('svg', {
        className: 'dshb-glyph',
        viewBox: '0 0 16 16',
        width: 14,
        height: 14,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      },
      h('rect', { x: 2.75, y: 4.25, width: 10.5, height: 7.5, rx: 2.25 }),
      h('path', { d: 'M5.5 8h5' }))
    }

    /**
     * One Session's brief-mode switch.
     * @param props - Session scope props, the locale `t`, and `toggleBrief`.
     */
    function BriefToggle(props) {
      const { useProjection, t, toggleBrief } = props
      const projected = useProjection('briefMode')
      // An absent value means the Host has not served this key yet (or the Host
      // half is not mounted): the chip says so instead of claiming "off".
      const known = projected !== undefined && projected !== null
      const on = known && projected.on === true
      const [pending, setPending] = React.useState(false)
      const [failure, setFailure] = React.useState(null)
      const alive = React.useRef(true)
      React.useEffect(() => {
        alive.current = true
        return () => { alive.current = false }
      }, [])

      const toggle = () => {
        // A second click while the first is settling would invert the same
        // intent; ignore it instead of disabling the button, which would move
        // keyboard focus off the control mid-flight.
        if (pending) return
        setPending(true)
        setFailure(null)
        toggleBrief(!on).then((message) => {
          if (!alive.current) return
          setPending(false)
          setFailure(message)
        }, (reason) => {
          if (!alive.current) return
          setPending(false)
          setFailure(reason instanceof Error ? reason.message : String(reason))
        })
      }

      const state = known ? (on ? 'on' : 'off') : 'unread'
      const title = t(known ? (on ? 'chip.title.on' : 'chip.title.off') : 'chip.title.unknown')
      const ariaLabel = known
        ? t('chip.aria', { state: t(on ? 'chip.on' : 'chip.off') })
        : t('chip.aria.unknown')

      return h(React.Fragment, null,
        h('style', { key: 'style' }, STYLE),
        h('span', { className: 'dshb-wrap' },
          h('button', {
            type: 'button',
            className: 'dshb-chip',
            'data-state': state,
            'data-pending': pending ? '' : undefined,
            'aria-pressed': on,
            'aria-busy': pending ? true : undefined,
            'aria-label': ariaLabel,
            title: pending ? t('chip.busy') : title,
            // Keep the typed draft focused: a tool-row button that takes focus
            // moves the caret out of the composer.
            onMouseDown: event => event.preventDefault(),
            onClick: toggle,
          },
          h(Glyph),
          h('span', { className: 'dshb-label' }, t('chip.label'))),
          failure !== null
            ? h('span', { className: 'dshb-error', role: 'status', title: failure }, failure)
            : null))
    }

    return {
      inject: ['slots', 'locale', 'remote', 'remote.commands'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'brief-mode: dictionaries')
        ctx.effect(() => ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
          name: 'conversation.input.left',
          id: 'brief-mode',
          order: 100,
          locale: NS,
          inject: sessionId => ({
            /**
             * Ask the Host to switch this Session's brief mode.
             * @param next - Wanted state.
             * @returns null on success, otherwise a user-visible failure line.
             */
            toggleBrief: async (next) => {
              let result
              try {
                result = await ctx.remote.commands.execute(sessionId, `/brief ${next ? 'on' : 'off'}`, [])
              } catch (reason) {
                return reason instanceof Error ? reason.message : String(reason)
              }
              if (!result.ok) {
                const code = result.error === undefined ? undefined : result.error.code
                const message = result.error === undefined ? 'command request failed' : result.error.message
                return typeof code === 'string' && code !== '' ? `${message} (${code})` : String(message)
              }
              const execution = result.value
              if (execution === undefined) return 'brief-mode: /brief is not a registered command'
              return execution.result.kind === 'error' ? execution.result.text : null
            },
          }),
        }, BriefToggle)), 'brief-mode: composer tool-row entry')
      },
    }
  },
})
