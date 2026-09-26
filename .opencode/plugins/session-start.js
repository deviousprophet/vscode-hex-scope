/* global process */
/**
 * Trellis Session Start Plugin (OpenCode v2)
 *
 * Injects compact SessionStart context into the copy of the latest user
 * message that OpenCode sends to the model. Uses the v2 `session.hook("context")`
 * hook, which mutates only the outgoing model payload — TUI / Web / SQLite
 * history stay untouched.
 */

import { TrellisContext, debugLog, isTrellisSubagent } from "../lib/trellis-context.js"
import { prependEphemeralText, transcriptHasAssistantMessage } from "../lib/context-visibility.js"
import { buildSessionContext } from "../lib/session-utils.js"

const FIRST_REPLY_NOTICE_RE = /<first-reply-notice>[\s\S]*?<\/first-reply-notice>\s*/g

function stripFirstReplyNotice(context) {
  return context.replace(FIRST_REPLY_NOTICE_RE, "")
}

// OpenCode v2 plugin: default-export a definition with an id and a setup(ctx)
// function. Hooks are registered on their owning domain.
export default {
  id: "trellis.session-start",
  async setup(ctx) {
    const directory = ctx.location.directory
    const trellis = new TrellisContext(directory)
    debugLog("session", "Plugin loaded, directory:", directory)

    await ctx.session.hook("context", (event) => {
      try {
        const platformInput = { sessionID: event?.sessionID, agent: event?.agent }
        debugLog("session", "context hook called, agent:", platformInput.agent)

        if (isTrellisSubagent(platformInput)) {
          debugLog("session", "Skipping trellis subagent turn:", platformInput.agent)
          return
        }

        if (process.env.TRELLIS_HOOKS === "0" || process.env.TRELLIS_DISABLE_HOOKS === "1") {
          debugLog("session", "Skipping - TRELLIS_HOOKS disabled")
          return
        }

        if (process.env.OPENCODE_NON_INTERACTIVE === "1") {
          debugLog("session", "Skipping - non-interactive mode")
          return
        }

        let context = buildSessionContext(trellis, platformInput)
        if (transcriptHasAssistantMessage(event?.messages)) {
          context = stripFirstReplyNotice(context)
        }
        debugLog("session", "Built context, length:", context.length)
        prependEphemeralText(event?.messages, context, "sessionStart")
      } catch (error) {
        debugLog("session", "Error in context hook:", error.message, error.stack)
      }
    })
  },
}
