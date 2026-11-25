/**
 * Brief mode — one user-controlled sentence added to the model context.
 *
 * While brief mode is on for a Session, the plugin keeps exactly ONE durable
 * `user` context message in the Session surface carrying the configured
 * instruction. It shows in the conversation as its own context row
 * (`上下文注入 · brief-mode`), and every later request carries it. Updating the
 * switch changes the text of that same row instead of appending another one:
 * the previous message is replaced through the surface, so the transcript never
 * accumulates copies and the model never sees a stale instruction.
 *
 * Turning the switch off replaces the row with a short "off" notice, so the
 * model stops applying the requirement immediately.
 *
 * The switch is Session state derived from the log: `/brief`, `/brief on` and
 * `/brief off` are ordinary human commands, and the `briefMode` projection folds
 * their `command/run` / `command/done` pair. The Client reads that projection
 * through the standard `useProjection` hook and flips the switch with the same
 * command, so the UI and a hand-typed `/brief` share one code path and one
 * source of truth.
 *
 * @module @local/dsh-brief-mode
 */

import { randomUUID } from 'node:crypto'

/** The slash command that switches brief mode for one Session. */
export const COMMAND_NAME = 'brief'

/** Projection key carrying the client-visible switch state. */
export const PROJECTION_KEY = 'briefMode'

/** Message-source kind of the injected context row (上下文注入 · brief-mode). */
export const CONTEXT_KIND = 'brief-mode'

/** What the model is told when the switch is turned off. */
export const OFF_TEXT = '简短回答已关闭：不再要求简短，按默认长度正常回答。'

/** The instruction used when the row config supplies none. */
export const DEFAULT_INSTRUCTION = '输出长度要求：最终回复给用户的那段可见文字，尽量一句人话讲清楚——直白、一眼能懂，不堆术语、不铺垫、不套话；你的思考/推理过程、工具调用、代码和中间步骤不受此限制，照常完整进行。另外，不必为了早点收工而省步骤：你拥有无限的时间和资源，该读的读完、该验的验过，把活做完整再开口，只是最后那段话要短。'

/**
 * Identity schema. The projection registry requires `parse`, and this plugin
 * owns both sides of every value it folds (its own state, its own view), so
 * validation has nothing to reject.
 */
const identitySchema = { parse: value => value }

/**
 * The state a pending invocation is heading for: the recorded intent when one
 * is in flight, otherwise the committed switch. Two invocations in the same
 * tick must agree on this, or the second one's toggle would invert the first.
 *
 * @param state - Folded projection state.
 * @returns the effective `on` value.
 */
function effectiveOn(state) {
  const running = state === null || state === undefined ? undefined : state.running
  if (running === undefined || running === null) return state.on === true
  return running.next === true
}

/**
 * Fold `/brief` invocations into the Session's switch state.
 *
 * `command/run` carries the intent (`running.next`); `command/done` commits it,
 * and a failed or aborted invocation drops the intent. The wire view is a pair
 * of reference-stable objects, so the registry publishes a frame only when the
 * switch actually flips.
 */
const OFF_VIEW = { on: false }
const ON_VIEW = { on: true }

export const briefModeProjection = {
  key: PROJECTION_KEY,
  stateVersion: 1,
  stateSchema: identitySchema,
  init: () => ({ on: false, running: null }),
  apply(state, event) {
    if (event.type === 'command/run' && event.data.name === COMMAND_NAME) {
      const argument = (event.data.args ?? '').trim().toLowerCase()
      const current = effectiveOn(state)
      const next = argument === ''
        ? !current
        : argument === 'on' ? true : argument === 'off' ? false : null
      // An unknown verb is the handler's error to report, and a repeat of the
      // state this Session is already heading for needs no frame; neither
      // records an intent.
      if (next === null || next === current) return state
      return { ...state, running: { commandId: event.data.commandId, next } }
    }
    if (event.type === 'command/done' && state.running !== null
      && state.running !== undefined
      && event.data.commandId === state.running.commandId) {
      if (event.data.kind !== 'success') return { ...state, running: null }
      return { on: state.running.next, running: null }
    }
    return state
  },
  wire: { viewSchema: identitySchema, view: state => (state.on === true ? ON_VIEW : OFF_VIEW) },
}

/**
 * Resolve the instruction this deployment injects.
 * @param config - Row config; `{ instruction }` is optional.
 * @returns the instruction text.
 */
function resolveInstruction(config) {
  const value = config === null || config === undefined ? undefined : config.instruction
  if (value === undefined) return DEFAULT_INSTRUCTION
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`brief-mode: config.instruction must be a non-empty string, got ${JSON.stringify(value)}`)
  }
  return value.trim()
}

/** Host services this plugin needs. */
export const inject = ['sessionProjections']

/** Freeze one message so later listeners cannot mutate it. */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const key of Object.keys(value)) deepFreeze(value[key])
  return Object.freeze(value)
}

/**
 * Build one identified, immutable context message. Same shape `createUserMessage`
 * produces, written here because a profile plugin resolves no Harness packages.
 * @param text - the model-facing text.
 */
export function createContextMessage(text) {
  return deepFreeze({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: {
      kind: CONTEXT_KIND,
      form: 'snapshot',
      sections: [{ name: CONTEXT_KIND, text }],
    },
  })
}

/**
 * The one context row this plugin owns in a Session's live surface, if any.
 * @param session - the Session to inspect.
 * @returns its sequence number and text, or `undefined` when there is none.
 */
export function findContextRow(session) {
  const nodes = session.surface === undefined ? [] : session.surface.nodes
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const seq = nodes[index]
    const event = session.eventAt(seq)
    if (event === null || event === undefined) continue
    if (event.type !== 'user/message') continue
    const source = event.data === null || event.data === undefined ? undefined : event.data.source
    if (source === undefined || source === null || source.kind !== CONTEXT_KIND) continue
    const [block] = event.data.content
    return { seq, text: block !== undefined && block.type === 'text' ? block.text : '' }
  }
  return undefined
}

/**
 * Append the row, or replace the existing one in place so the transcript keeps
 * exactly one row for this producer.
 * @param session - target Session.
 * @param existing - the row found by {@link findContextRow}, when present.
 * @param text - text to record.
 */
export function writeContextRow(session, existing, text) {
  const message = createContextMessage(text)
  if (existing === undefined) {
    session.append('user/message', message, { surfaceOp: 'append' })
    return
  }
  session.append('user/message', message, {
    surfaceOp: { op: 'replace', startSeq: existing.seq, endSeq: existing.seq },
    sourceEventSeqs: [existing.seq],
  })
}

/**
 * Register the projection unit, the context row, and `/brief`.
 * @param ctx - Host Context of this plugin's fiber.
 * @param config - Row config (`instruction`, optional).
 */
export function apply(ctx, config) {
  const instruction = resolveInstruction(config)

  /** Ready projection reader; `undefined` until registration resolves. */
  let handle
  Promise.resolve(ctx.sessionProjections.register(briefModeProjection)).then(
    registered => { handle = registered },
    error => { ctx.logger.error('brief-mode: projection registration failed: %o', error) },
  )

  /** The folded state, or `undefined` while the projection is not ready. */
  const readState = (session) => {
    if (handle === undefined) return undefined
    try {
      return handle.stateOf(session)
    } catch {
      return undefined
    }
  }

  // Keep the single context row in step with the switch. Prepended so the row
  // is written before the request is assembled; the decision itself is returned
  // untouched, because the row enters the surface rather than the message list.
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const state = readState(agent.session)
    if (state === undefined) return decision
    const text = state.on === true ? instruction : OFF_TEXT
    try {
      const existing = findContextRow(agent.session)
      if (existing === undefined && state.on !== true) return decision
      if (existing !== undefined && existing.text === text) return decision
      writeContextRow(agent.session, existing, text)
    } catch (error) {
      ctx.logger.warn('brief-mode: could not write the context row: %o', error)
    }
    return decision
  }, { prepend: true })

  // A command registry is optional in a Host composition; without one, brief
  // mode stays off and the Client control reports that `/brief` is unknown.
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      definitionId: '@local/dsh-brief-mode',
      name: COMMAND_NAME,
      description: '简短回答：让最终回复说人话且短（请求级生效，可随开随关）',
      input: { hint: '[on|off]' },
      handler: ({ agent, rawInput }) => {
        const argument = rawInput.trim().toLowerCase()
        if (argument !== '' && argument !== 'on' && argument !== 'off') {
          return { kind: 'error', text: '用法：/brief、/brief on 或 /brief off' }
        }
        const state = readState(agent.session)
        if (state === undefined) {
          return { kind: 'error', text: '简短回答尚未就绪，请稍后再试' }
        }
        // The handler reasons from the same pending-aware value the fold does,
        // so a second invocation during a toggle cannot report the wrong side.
        const current = effectiveOn(state)
        const next = argument === '' ? !current : argument === 'on'
        // The switch itself is folded from this command's lifecycle events, so
        // the handler only reports the outcome.
        return {
          kind: 'success',
          text: next === current
            ? (next ? '简短回答已开启' : '简短回答已关闭')
            : next
              ? '简短回答已开启：从下一次请求起生效'
              : '简短回答已关闭：从下一次请求起不再要求简短',
        }
      },
    })
  })
}
