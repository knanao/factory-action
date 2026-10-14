import type { PromptContext } from './common.js'
import { extraInstructions, header, join } from './common.js'

/**
 * A scheduled refresh of the repository's wiki with the `wiki` skill. The
 * skill uploads the wiki to the Factory app; the same pages are also pushed
 * to `droid-wiki/` on the default branch so they render on GitHub too. There
 * is no thread for this run, so the prompt answers the skill's questions in
 * advance, and the session cleans up its worktree itself (cleanup mode only
 * fires when an issue or PR closes).
 */
export function wikiPrompt(ctx: PromptContext): string {
  return join(
    'Refresh the wiki of the whole repository.',
    header(ctx),
    `Triggered by the '${ctx.event}' event. There is no issue or PR for this run, so nobody can answer questions: do not ask any. Where the skill would ask, choose for yourself: document the whole repository at the default branch, and for other choices take the skill's standard option. Record each choice in the session when you finish.`,
    'In your worktree (fresh from the default branch), run /wiki on the entire repository. Skip the narrated video overview (wiki-video-gen) unless the additional instructions below ask for it: it is slow and rarely wanted on a schedule.',
    'The skill uploads the wiki to the Factory app. Also update GitHub: copy the generated pages into the `droid-wiki/` directory (create it if it does not exist), commit only that directory (message "docs(wiki): refresh droid-wiki (<YYYY-MM-DD>)") and push the commit directly to the default branch. Pushing the wiki pages there is part of the task, so it does not break your worktree rule.',
    'If that push is rejected (branch protection, or the default branch moved on), do not force it: push your worktree branch instead, open one pull request titled "docs: refresh droid-wiki" against the default branch with the same changes, and stop there.',
    'When you are done, clean up after yourself the way the cleanup task would: if the worktree named in your worktree rule exists, `cd` to the shared clone, run `git worktree remove --force <that worktree>`, `git branch -D <its branch>` and `git worktree prune`. A scheduled run has no issue or PR whose close would trigger that for you.',
    extraInstructions(ctx.extra)
  )
}
