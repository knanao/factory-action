import type { Mode } from '../inputs.js'
import type { PromptContext } from './common.js'
import { header, join } from './common.js'
import { deepSecurityPrompt } from './deep-security.js'
import { mentionPrompt } from './mention.js'
import { qaPrompt } from './qa.js'
import { reviewPrompt } from './review.js'
import { securityPrompt } from './security.js'
import { wikiPrompt } from './wiki.js'

export type { PromptContext } from './common.js'
export { systemRules } from './common.js'
export { cleanupPrompt } from './cleanup.js'

/** Builds the message text sent to the session. */
export function buildPrompt(mode: Mode, ctx: PromptContext): string {
  switch (mode) {
    case 'mention':
      return mentionPrompt(ctx)
    case 'review':
      return reviewPrompt(ctx)
    case 'security':
      return securityPrompt(ctx)
    case 'deep-security':
      return deepSecurityPrompt(ctx)
    case 'qa':
      return qaPrompt(ctx)
    case 'wiki':
      return wikiPrompt(ctx)
    case 'cleanup':
      throw new Error("mode 'cleanup' does not build a task prompt")
    case 'custom':
      return join(
        header(ctx),
        `Triggered by the '${ctx.event}' event.`,
        ctx.extra
      )
  }
}
