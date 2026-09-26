/**
 * OpenCode v2 message-shape helpers.
 *
 * OpenCode v2 returns messages from `ctx.session.hook("context")` as
 * `@opencode/ai` `Message` objects: `{ id?, role, content: ContentPart[], ... }`.
 * Text lives in `content` parts of shape `{ type: "text", text }`.
 *
 * This replaces the V1 `experimental.chat.messages.transform` shape
 * (`{ info, parts }`). The V2 `context` hook only mutates the outgoing model
 * call — never persisted history — so the V1 part-id/synthetic bookkeeping
 * that kept injected copies out of stored replay is no longer needed.
 */

const TRELLIS_MARKER = "trellis"

// Injected text always starts with one of these wrappers. Prefix detection is
// used alongside the metadata marker because a downstream serializer may drop
// unknown part metadata before a later hook sees the part.
const TRELLIS_TEXT_PREFIXES = ["<session-context>", "<workflow-state>", "<first-reply-notice>"]

/** Latest `role === "user"` message, or undefined. */
export function findLatestUserMessage(messages) {
  if (!Array.isArray(messages)) return undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return messages[i]
  }
  return undefined
}

function isTrellisInjectedPart(part) {
  if (part?.metadata?.[TRELLIS_MARKER] != null) return true
  if (typeof part?.text !== "string") return false
  return TRELLIS_TEXT_PREFIXES.some(prefix => part.text.startsWith(prefix))
}

/**
 * Return the first ordinary user-authored text part in a v2 `content` array.
 * Trellis-injected parts are skipped so a later hook never mistakes them for
 * the user's prompt.
 */
export function findUserTextPart(content) {
  if (!Array.isArray(content)) return undefined
  return content.find(
    part => part?.type === "text" && typeof part.text === "string" && !isTrellisInjectedPart(part),
  )
}

export function latestUserPromptText(messages) {
  const message = findLatestUserMessage(messages)
  const part = findUserTextPart(message?.content)
  return typeof part?.text === "string" ? part.text : ""
}

export function transcriptHasAssistantMessage(messages) {
  if (!Array.isArray(messages)) return false
  return messages.some(message => message?.role === "assistant")
}

/**
 * Prepend a model-only text part to the latest user message's content.
 * Mutates the outgoing `event.messages` in place; v2 never persists this.
 */
export function prependEphemeralText(messages, text, kind = "context") {
  if (!Array.isArray(messages)) return false
  if (typeof text !== "string") return false
  const message = findLatestUserMessage(messages)
  if (!message || !Array.isArray(message.content)) return false

  message.content.unshift({
    type: "text",
    text,
    metadata: { [TRELLIS_MARKER]: { [kind]: true } },
  })
  return true
}
