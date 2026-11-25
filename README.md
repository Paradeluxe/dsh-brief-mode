# @local/dsh-brief-mode

A switch in the composer tool row that keeps one context-injection row in the conversation, telling the model to keep the user-facing final reply short and plain.

- **Host** (`index.js`): registers the `briefMode` Session projection (folded from the `brief` command's lifecycle events), keeps exactly one `user/message` context row in the Session surface (`source.kind = 'brief-mode'`, rendered as `上下文注入 · brief-mode`) by appending it once and replacing it on every change, and registers the `/brief [on|off]` human command.
- **Client** (`client.js`): contributes a compact ghost control into `conversation.input.left` (the composer tool row), renders it from `useProjection('briefMode')`, and switches it through `ctx.remote.commands.execute` — the same path a typed `/brief off` takes.

The injected text is the row's `config.instruction` (default: the work must stay complete — unlimited time and resources, no skipped steps — while the user-facing final reply is one plain human sentence). Turning the switch off rewrites the same row with a closing line, so the model stops applying it and the transcript never accumulates copies.

See `docs/DETAIL.md` for usage, internals, and limitations.
