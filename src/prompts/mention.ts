import type { PromptContext } from './common.js'
import { extraInstructions, header, join, untrusted } from './common.js'

/**
 * A task requested by a person. The request is passed through as-is. When it
 * names a known command right after the trigger phrase (`@factory verify ...`),
 * the trusted part of the prompt runs it as a slash command (`/verify`).
 */
export function mentionPrompt(ctx: PromptContext): string {
  const n = ctx.number
  const login = ctx.author?.login ?? 'unknown'
  const view = ctx.isPR
    ? `gh pr view ${n} --comments`
    : `gh issue view ${n} --comments`

  const review = ctx.reviewContext
    ? join(
        `The request was left as a review comment on \`${ctx.reviewContext.path}\`${ctx.reviewContext.line ? ` line ${ctx.reviewContext.line}` : ''}. Diff hunk:`,
        untrusted('diff hunk', ctx.reviewContext.diffHunk)
      )
    : ''

  const changes = ctx.isPR
    ? `If the request needs code changes, check out the PR in your workspace with \`gh pr checkout ${n}\`, then commit and push to its head branch. If that push is rejected (for example, the PR comes from a fork that does not allow edits from maintainers), push your commits to the branch named in your workspace rule instead, open a PR from it against the PR's base branch, and say so in your reply.`
    : `If the request needs code changes, create a branch, push it and open a PR that references #${n} (use "Closes #${n}" if it fully resolves the issue).`

  const reply = ctx.reviewCommentId
    ? `When you are done, reply in the review thread you were asked in: write \`{"body": "..."}\` to a JSON file and run \`gh api repos/${ctx.repo}/pulls/${n}/comments/${ctx.reviewCommentId}/replies --method POST --input <file>\`. Keep it to a short summary with links to what you changed.`
    : `When you are done, reply on #${n} with a short summary and links to what you created.`

  return join(
    `@${login} asked you to do something on GitHub.`,
    header(ctx),
    `Read the whole thread first with \`${view}\`.`,
    review,
    ctx.command
      ? `The request runs a command: run /${ctx.command}, taking its arguments from the rest of the request.`
      : '',
    untrusted(`request from @${login}`, ctx.text),
    join('Do what the request asks.', changes, reply),
    extraInstructions(ctx.extra)
  )
}
